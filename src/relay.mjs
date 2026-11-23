import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

// Service-owned relay (B30/ADR-010). A local forward proxy with exactly one fixed
// upstream, used only by the intended worker. It does not accept an arbitrary target,
// does not inherit ambient credentials or proxy settings, and never follows a redirect
// with the request body. It bounds requests, bytes and duration independently of the
// worker and fails closed on bind/upstream/teardown uncertainty.
//
// This module is the fixture/loopback implementation plus the deployable listener.
// It is NOT wired into the live composition path: `createConfiguredTaskService` keeps
// live closed (ADR-009/010). The deployable cross-compartment placement (worker netns
// or VM vs. relay netns/VM) is exercised separately by the OS-network fixture.

export class RelayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RelayError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RelayError(code, message);
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_TIMEOUT_MS = 2_147_483_647;

// Reject unspecified/wildcard bind addresses: 0.0.0.0 and every all-zero IPv6 form
// (canonical `::` and any compressed alias such as `0:0:0:0:0:0:0::`). The relay must
// never bind every interface.
function isUnspecifiedAddress(host) {
  const family = isIP(host);
  if (family === 4) return host === '0.0.0.0';
  if (family === 6) return isAllZeroIpv6(host);
  return false;
}

// Sound all-zero IPv6 predicate: expand `::` compression to eight groups and require
// every group to be zero. Handles canonical, trailing and interior compression.
function isAllZeroIpv6(host) {
  if (!host.includes('::')) {
    const groups = host.split(':');
    return groups.length === 8 && groups.every(group => /^0+$/.test(group));
  }
  const parts = host.split('::');
  if (parts.length !== 2) return false;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  if (left.length + right.length > 7) return false;
  const zeros = 8 - left.length - right.length;
  const groups = [...left, ...Array(zeros).fill('0'), ...right];
  return groups.every(group => /^0+$/.test(group));
}

// A private/loopback bind address only. Reject 0.0.0.0, :: and empty hosts: the relay
// never binds a public/unspecified interface. Fixtures use 127.0.0.1; deployments use
// an explicit private address on the dedicated worker-facing interface.
function validateListen(listen) {
  if (!listen || typeof listen !== 'object' || Array.isArray(listen)) {
    fail('invalid_argument', 'relay listen must be an object');
  }
  if (typeof listen.host !== 'string' || !listen.host || !isIP(listen.host)) {
    fail('invalid_argument', 'relay listen host must be a concrete IP address');
  }
  if (isUnspecifiedAddress(listen.host)) fail('invalid_argument', 'relay listen host must not be unspecified');
  if (!Number.isInteger(listen.port) || listen.port < 0 || listen.port > 65535) {
    fail('invalid_argument', 'relay listen port is invalid');
  }
}

function validateUpstream(upstream) {
  if (!upstream || typeof upstream !== 'object' || Array.isArray(upstream)) {
    fail('invalid_argument', 'relay upstream must be an object');
  }
  if (typeof upstream.origin !== 'string' ||
      !/^https?:\/\/[^/]+$/.test(upstream.origin) ||
      /\s/.test(upstream.origin)) {
    fail('invalid_argument', 'relay upstream origin must be a fixed absolute URL');
  }
  if (typeof upstream.path !== 'string' || !upstream.path.startsWith('/') || /\s/.test(upstream.path)) {
    fail('invalid_argument', 'relay upstream path must be a fixed absolute path');
  }
  if (upstream.method !== 'POST') fail('invalid_argument', 'relay upstream method must be POST');
}

function validateLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    fail('invalid_argument', 'relay limits must be an object');
  }
  const { maxRequests, maxRequestBytes, maxResponseBytes, timeoutMs } = limits;
  if (!Number.isInteger(maxRequests) || maxRequests < 1) fail('invalid_argument', 'relay maxRequests is invalid');
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1) fail('invalid_argument', 'relay maxRequestBytes is invalid');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) fail('invalid_argument', 'relay maxResponseBytes is invalid');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) fail('invalid_argument', 'relay timeoutMs is invalid');
}

// Canonical policy identity, bound by the live approval so a changed relay refuses.
export function relayPolicyDigest({ listen, upstream, model, limits }) {
  return createHash('sha256')
    .update(canonical({ listen, upstream, model, limits }))
    .digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Read a request body up to maxBytes. Returns the Buffer, or throws a RelayError when
// the body exceeds the bound. Never buffers more than maxBytes + 1 to detect overflow.
function readBody(req, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const done = error => { if (!settled) { settled = true; error ? reject(error) : resolve(Buffer.concat(chunks)); } };
    const abort = () => done(new RelayError('unavailable', 'request deadline exceeded'));
    signal?.addEventListener('abort', abort, { once: true });
    req.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        done(new RelayError('limit_exceeded', 'request body exceeds relay bound'));
        // Reject the request without retaining its body, but drain the remaining
        // incoming bytes so the HTTP connection can close cleanly.
        // Stop retaining/draining hostile input. The caller sends its bounded refusal
        // before the connection is destroyed by the deadline cleanup.
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => done());
    req.on('error', error => done(new RelayError('unavailable', error.code ?? 'request-error')));
    req.on('aborted', abort);
  });
}

// Write a plain terminal response and end the exchange. No upstream body is forwarded.
function respond(res, status, text) {
  if (res.headersSent) { try { res.destroy(); } catch { /* already failing */ } return; }
  res.writeHead(status, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function createRelay({ listen, upstream, model, limits } = {}) {
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)?$/.test(model)) {
    fail('invalid_argument', 'relay model must be a single fixed identifier');
  }
  validateListen(listen);
  validateUpstream(upstream);
  validateLimits(limits);

  const policyDigest = relayPolicyDigest({ listen, upstream, model, limits });
  let server;
  let started = false;
  let stopped = false;
  let requests = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  let latched = false;
  let latchReason = null;
  let boundAddress = null;

  const handle = async (req, res) => {
    const deadline = Date.now() + limits.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setTimeout(() => {
        if (!req.complete && !res.writableFinished && !req.socket.destroyed) req.socket.destroy();
      }, 10).unref?.();
    }, limits.timeoutMs);
    timer.unref?.();
    req.once('close', () => { if (req.complete && res.writableFinished) clearTimeout(timer); });
    const cleanupTimer = () => {
      if (!req.complete) {
        res.once('finish', () => {
          if (!req.complete && !req.socket.destroyed) req.socket.destroy();
          clearTimeout(timer);
        });
      } else clearTimeout(timer);
    };
    const respondAndClear = (status, text) => {
      cleanupTimer();
      if (!req.complete && !res.headersSent) {
        res.writeHead(status, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(text), connection: 'close' });
        res.end(text);
      } else respond(res, status, text);
    };
    const expired = () => controller.signal.aborted || Date.now() >= deadline;
    const terminal = () => latched || stopped || expired();
    requests += 1;
    if (latched || stopped) return respondAndClear(503, 'relay latched');
    if (requests > limits.maxRequests) {
      latched = true;
      latchReason = 'request-count';
      return respondAndClear(429, 'relay request limit exceeded');
    }
    if (req.method !== upstream.method) {
      latched = true;
      latchReason = 'method';
      return respondAndClear(405, 'method not allowed');
    }
    // The relay ingress accepts only the fixed model endpoint path, never an
    // arbitrary target or proxy form.
    if (req.url !== upstream.path && req.url.split('?')[0] !== upstream.path) {
      latched = true;
      latchReason = 'path';
      return respondAndClear(404, 'not found');
    }
    if (req.headers.authorization !== 'Bearer public') {
      latched = true;
      latchReason = 'credential';
      return respondAndClear(401, 'unauthorized');
    }

    let body;
    try {
      body = await readBody(req, limits.maxRequestBytes, controller.signal);
    } catch {
      const timedOut = expired();
      latched = true;
      latchReason = timedOut ? 'timeout' : 'body-bound';
      return respondAndClear(timedOut ? 504 : 413, timedOut ? 'relay deadline exceeded' : 'request body exceeds relay bound');
    }
    if (latched || stopped) return respondAndClear(503, 'relay latched');
    if (expired()) { latched = true; latchReason = 'timeout'; return respondAndClear(504, 'relay deadline exceeded'); }
    bytesIn += body.length;
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      latched = true;
      latchReason = 'body-parse';
      return respondAndClear(400, 'invalid request body');
    }
    if (parsed?.model !== model) {
      latched = true;
      latchReason = 'model';
      return respondAndClear(403, 'model not permitted');
    }

    // Forward only the fixed method/path to the fixed upstream. Never follow a
    // redirect: any 3xx is a terminal refusal and no bytes are sent to its target.
    let upstreamResponse;
    if (latched || stopped) return respondAndClear(503, 'relay latched');
    if (expired()) { latched = true; latchReason = 'timeout'; return respondAndClear(504, 'relay deadline exceeded'); }
    try {
      upstreamResponse = await fetch(`${upstream.origin}${upstream.path}`, {
        method: upstream.method,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer public',
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      const timedOut = expired();
      latched = true;
      latchReason = timedOut ? 'timeout' : 'upstream-unavailable';
      return respondAndClear(timedOut ? 504 : 502, 'upstream unavailable');
    }
    if (terminal()) { latched = true; latchReason = 'timeout'; try { await upstreamResponse.body?.cancel(); } catch {} return respondAndClear(504, 'relay deadline exceeded'); }

    if (REDIRECT_STATUS.has(upstreamResponse.status)) {
      // Fail closed: consume/discard the upstream body without following the Location.
      try { await upstreamResponse.body?.cancel(); } catch { /* discard */ }
      latched = true;
      latchReason = 'redirect-refused';
      return respondAndClear(502, 'upstream redirect refused');
    }

    try {
      const reader = upstreamResponse.body?.getReader();
      res.writeHead(upstreamResponse.status, {
        'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
      });
      if (!reader) { res.end(); clearTimeout(timer); return; }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesOut += value.byteLength;
        if (bytesOut > limits.maxResponseBytes) {
          latched = true;
          latchReason = 'response-bound';
          res.destroy();
          await reader.cancel().catch(() => {});
          return;
        }
        res.write(value);
      }
      res.end(); clearTimeout(timer);
    } catch {
      clearTimeout(timer);
      latched = true;
      latchReason = 'response-stream';
      try { res.destroy(); } catch { /* already failing */ }
    }
  };

  return {
    policyDigest,
    start() {
      return new Promise((resolve, reject) => {
        if (started || stopped) return reject(new RelayError('unavailable', 'relay lifecycle is not startable'));
        server = createServer((req, res) => {
          handle(req, res).catch(() => respond(res, 500, 'relay internal error'));
        });
        server.once('error', error => {
          started = false;
          server = undefined;
          reject(new RelayError('unavailable', error.code === 'EADDRINUSE' ? 'relay port already in use' : 'relay bind failed'));
        });
        server.listen(listen.port, listen.host, () => {
          started = true;
          boundAddress = server.address();
          resolve();
        });
      });
    },
    stop() {
      return new Promise(resolve => {
        if (!server) { stopped = true; return resolve(); }
        const srv = server;
        server = undefined;
        started = false;
        stopped = true;
        srv.close(() => resolve());
        // A lingering listener is a lifecycle risk; force-destroy active sockets so
        // stop() cannot report a clean close while a request is still in flight.
        srv.closeAllConnections?.();
      });
    },
    status() {
      return {
        started, stopped, requests, bytesIn, bytesOut,
        latched, latchReason, policyDigest, address: boundAddress,
      };
    },
  };
}

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

// Reject unspecified/wildcard bind addresses: 0.0.0.0, :: and the uncompressed all-zero
// IPv6 form. The relay must never bind every interface.
function isUnspecifiedAddress(host) {
  const family = isIP(host);
  if (family === 4) return host === '0.0.0.0';
  if (family === 6) {
    if (host === '::' || host === '::0') return true;
    const groups = host.split(':');
    return groups.length === 8 && groups.every(group => group === '0' || group === '0000');
  }
  return false;
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
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const done = error => { if (!settled) { settled = true; error ? reject(error) : resolve(Buffer.concat(chunks)); } };
    req.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) { settled = true; reject(fail('limit_exceeded', 'request body exceeds relay bound')); req.pause(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => done());
    req.on('error', error => done(new RelayError('unavailable', error.code ?? 'request-error')));
  });
}

// Write a plain terminal response and end the exchange. No upstream body is forwarded.
function respond(res, status, text) {
  if (res.headersSent) { try { res.destroy(); } catch { /* already failing */ } return; }
  res.writeHead(status, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function createRelay({ listen, upstream, model, limits } = {}) {
  if (typeof model !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(model)) {
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
    requests += 1;
    if (latched) return respond(res, 503, 'relay latched');
    if (requests > limits.maxRequests) {
      latched = true;
      latchReason = 'request-count';
      return respond(res, 429, 'relay request limit exceeded');
    }
    if (req.method !== upstream.method) {
      latched = true;
      latchReason = 'method';
      return respond(res, 405, 'method not allowed');
    }
    // The relay ingress accepts only the fixed model endpoint path, never an
    // arbitrary target or proxy form.
    if (req.url !== upstream.path && req.url.split('?')[0] !== upstream.path) {
      latched = true;
      latchReason = 'path';
      return respond(res, 404, 'not found');
    }
    if (req.headers.authorization !== 'Bearer public') {
      latched = true;
      latchReason = 'credential';
      return respond(res, 401, 'unauthorized');
    }

    let body;
    try {
      body = await readBody(req, limits.maxRequestBytes);
    } catch {
      latched = true;
      latchReason = 'body-bound';
      return respond(res, 413, 'request body exceeds relay bound');
    }
    bytesIn += body.length;
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      latched = true;
      latchReason = 'body-parse';
      return respond(res, 400, 'invalid request body');
    }
    if (parsed?.model !== model) {
      latched = true;
      latchReason = 'model';
      return respond(res, 403, 'model not permitted');
    }

    // Forward only the fixed method/path to the fixed upstream. Never follow a
    // redirect: any 3xx is a terminal refusal and no bytes are sent to its target.
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(`${upstream.origin}${upstream.path}`, {
        method: upstream.method,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer public',
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(limits.timeoutMs),
      });
    } catch {
      latched = true;
      latchReason = 'upstream-unavailable';
      return respond(res, 502, 'upstream unavailable');
    }

    if (REDIRECT_STATUS.has(upstreamResponse.status)) {
      // Fail closed: consume/discard the upstream body without following the Location.
      try { await upstreamResponse.body?.cancel(); } catch { /* discard */ }
      latched = true;
      latchReason = 'redirect-refused';
      return respond(res, 502, 'upstream redirect refused');
    }

    try {
      const reader = upstreamResponse.body?.getReader();
      res.writeHead(upstreamResponse.status, { 'content-type': 'application/json' });
      if (!reader) { res.end(); return; }
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
      res.end();
    } catch {
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

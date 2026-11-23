import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

// Service-owned layer-7 egress gateway (B30/ADR-010). The relay reaches only this
// gateway; the gateway alone validates the transport to the fixed origin and refuses
// every other destination, redirect or CONNECT tunnel. It never inherits ambient
// credentials/proxy settings and its logs omit request/response bodies and any
// authorization material.
//
// Like `src/relay.mjs`, this is deployable infrastructure that is NOT wired into the
// live composition path. Live mode requires an HTTPS origin, a real hostname and Node's
// default certificate/hostname verification; DNS and TLS failures latch distinctly. The
// offline tests exercise that path with a disposable CA and a test-only resolver only; a
// deployed cross-namespace TLS chain is not exercised here.

export class EgressGatewayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EgressGatewayError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EgressGatewayError(code, message);
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_TIMEOUT_MS = 2_147_483_647;

// Reject unspecified/wildcard bind addresses: 0.0.0.0 and every all-zero IPv6 form
// (canonical `::` and any compressed alias such as `0:0:0:0:0:0:0::`). The gateway must
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

function validateListen(listen) {
  if (!listen || typeof listen !== 'object' || Array.isArray(listen)) {
    fail('invalid_argument', 'gateway listen must be an object');
  }
  if (typeof listen.host !== 'string' || !listen.host || !isIP(listen.host)) {
    fail('invalid_argument', 'gateway listen host must be a concrete IP address');
  }
  if (isUnspecifiedAddress(listen.host)) fail('invalid_argument', 'gateway listen host must not be unspecified');
  if (!Number.isInteger(listen.port) || listen.port < 0 || listen.port > 65535) {
    fail('invalid_argument', 'gateway listen port is invalid');
  }
}

// origin is the single fixed upstream: https in live mode, http loopback in fixture mode.
function validateOrigin(origin, mode) {
  if (typeof origin !== 'string' || /\s/.test(origin) || !/^https?:\/\/[^/]+$/.test(origin)) {
    fail('invalid_argument', 'gateway origin must be a fixed absolute URL');
  }
  const url = new URL(origin);
  if (mode === 'live') {
    if (url.protocol !== 'https:') fail('invalid_argument', 'live gateway origin must be https');
    if (url.hostname === 'localhost' || isIP(url.hostname)) fail('invalid_argument', 'live gateway origin must be a real hostname');
  } else if (mode === 'fixture') {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') fail('invalid_argument', 'fixture gateway origin must be loopback http');
  } else {
    fail('invalid_argument', 'gateway mode must be live or fixture');
  }
}

// Live mode trusts only Node's default verification (plus any operator-provided CA set at
// process start). An ambient bypass of certificate validation is refused, never honored.
function tlsBypassEnabled() {
  return process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
}

// Classify an upstream fetch failure into a distinct terminal latch. DNS and TLS failures
// fail closed like any other upstream failure, but are named so a reviewer can see which
// trust step refused the origin.
export function classifyUpstreamFailure(error) {
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns-failure';
  if (typeof code === 'string' && /^(ERR_TLS_|ERR_SSL_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO_|CERT_)/.test(code)) {
    return 'tls-failure';
  }
  return 'upstream-unavailable';
}

function validateLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    fail('invalid_argument', 'gateway limits must be an object');
  }
  for (const field of ['maxRequests', 'maxRequestBytes', 'maxResponseBytes', 'timeoutMs']) {
    if (!Number.isInteger(limits[field]) || limits[field] < 1) fail('invalid_argument', `gateway ${field} is invalid`);
  }
  if (limits.timeoutMs > MAX_TIMEOUT_MS) fail('invalid_argument', 'gateway timeoutMs is invalid');
}

export function gatewayPolicyDigest({ mode, listen, origin, path, limits }) {
  return createHash('sha256')
    .update(canonical({ mode, listen, origin, path, limits }))
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

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const done = error => { if (!settled) { settled = true; error ? reject(error) : resolve(Buffer.concat(chunks)); } };
    req.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        done(new EgressGatewayError('limit_exceeded', 'gateway request body exceeds bound'));
        // Reject the request without retaining its body, but drain the remaining
        // incoming bytes so the HTTP connection can close cleanly.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => done());
    req.on('error', error => done(new EgressGatewayError('unavailable', error.code ?? 'request-error')));
  });
}

function respond(res, status, text) {
  if (res.headersSent) { try { res.destroy(); } catch { /* already failing */ } return; }
  res.writeHead(status, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

// Logs carry only non-private metadata: never bodies, authorization headers or prompts.
function sanitizedEvent(type, detail) {
  return { at: Date.now(), type, detail };
}

export function createEgressGateway({ mode, listen, origin, path, limits, log = () => {} } = {}) {
  if (typeof path !== 'string' || !path.startsWith('/') || /\s/.test(path)) {
    fail('invalid_argument', 'gateway path must be a fixed absolute path');
  }
  validateListen(listen);
  validateOrigin(origin, mode);
  validateLimits(limits);
  if (typeof log !== 'function') fail('invalid_argument', 'gateway log must be a function');
  if (mode === 'live' && tlsBypassEnabled()) {
    fail('invalid_argument', 'live gateway refuses an ambient TLS verification bypass');
  }

  const policyDigest = gatewayPolicyDigest({ mode, listen, origin, path, limits });
  let server;
  let started = false;
  let stopped = false;
  let requests = 0;
  let bytesOut = 0;
  let refused = [];
  let latched = false;
  let latchReason = null;
  let boundAddress = null;

  const latch = reason => {
    latched = true;
    latchReason = reason;
    refused.push(reason);
    log(sanitizedEvent('refused', reason));
  };

  const handle = async (req, res) => {
    requests += 1;
    if (latched) return respond(res, 503, 'gateway latched');
    if (requests > limits.maxRequests) {
      latch('request-count');
      return respond(res, 429, 'gateway request limit exceeded');
    }
    // A CONNECT request is a tunnel attempt; refuse before any upstream I/O.
    if (req.method === 'CONNECT') {
      latch('connect');
      return respond(res, 405, 'tunnel refused');
    }
    if (req.method !== 'POST') {
      latch('method');
      return respond(res, 405, 'method not allowed');
    }
    if (req.url !== path && req.url.split('?')[0] !== path) {
      latch('path');
      return respond(res, 404, 'not found');
    }
    if (req.headers.authorization !== 'Bearer public') {
      latch('credential');
      return respond(res, 401, 'unauthorized');
    }
    let body;
    try {
      body = await readBody(req, limits.maxRequestBytes);
    } catch {
      latch('body-bound');
      return respond(res, 413, 'request body exceeds gateway bound');
    }

    if (mode === 'live' && tlsBypassEnabled()) {
      latch('tls-policy');
      return respond(res, 502, 'upstream unavailable');
    }

    // Forward only the fixed method/path to the fixed origin with the fixed anonymous
    // credential. Never inherit arbitrary client headers. Redirects are refused.
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer public',
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(limits.timeoutMs),
      });
    } catch (error) {
      latch(classifyUpstreamFailure(error));
      return respond(res, 502, 'upstream unavailable');
    }

    if (REDIRECT_STATUS.has(upstreamResponse.status)) {
      try { await upstreamResponse.body?.cancel(); } catch { /* discard */ }
      latch('redirect-refused');
      return respond(res, 502, 'upstream redirect refused');
    }

    try {
      const reader = upstreamResponse.body?.getReader();
      res.writeHead(upstreamResponse.status, {
        'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
      });
      if (!reader) { res.end(); return; }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesOut += value.byteLength;
        if (bytesOut > limits.maxResponseBytes) {
          latch('response-bound');
          res.destroy();
          await reader.cancel().catch(() => {});
          return;
        }
        res.write(value);
      }
      res.end();
    } catch {
      latch('response-stream');
      try { res.destroy(); } catch { /* already failing */ }
    }
  };

  return {
    policyDigest,
    start() {
      return new Promise((resolve, reject) => {
        if (started || stopped) return reject(new EgressGatewayError('unavailable', 'gateway lifecycle is not startable'));
        server = createServer((req, res) => {
          handle(req, res).catch(() => respond(res, 500, 'gateway internal error'));
        });
        // CONNECT arrives as the server 'connect' event, not the 'request' event.
        // Refuse any tunnel attempt before it can establish a relay to an upstream.
        server.on('connect', (req, socket) => {
          requests += 1;
          if (!latched && requests <= limits.maxRequests) latch('connect');
          socket.write('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n');
          socket.destroy();
        });
        server.once('error', error => {
          started = false;
          server = undefined;
          reject(new EgressGatewayError('unavailable', error.code === 'EADDRINUSE' ? 'gateway port already in use' : 'gateway bind failed'));
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
        srv.closeAllConnections?.();
      });
    },
    status() {
      return { started, stopped, requests, bytesOut, refused: [...refused], latched, latchReason, policyDigest, address: boundAddress };
    },
  };
}

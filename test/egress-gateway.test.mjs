import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createEgressGateway, gatewayPolicyDigest } from '../src/egress-gateway.mjs';

const PATH = '/v1/chat/completions';

// Node's fetch (undici) and http.request treat CONNECT as a tunnel, so send the
// request line over a raw socket and read the status line back.
function connectRequest(port) {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.on('connect', () => socket.write(`CONNECT ${PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`));
    socket.on('data', chunk => { data += chunk.toString(); });
    const done = () => resolve(data);
    socket.on('end', done);
    socket.on('error', done);
    socket.setTimeout(2000, () => { socket.destroy(); done(); });
  });
}

async function startServer(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, body });
      handler(req, res, body, requests);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const stop = () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
  return { server, requests, origin: `http://127.0.0.1:${address.port}`, port: address.port, stop };
}

function gatewayConfig(origin, overrides = {}) {
  return { mode: 'fixture', listen: { host: '127.0.0.1', port: 0 }, origin, path: PATH,
    limits: { maxRequests: 12, maxRequestBytes: 64 * 1024, maxResponseBytes: 64 * 1024, timeoutMs: 5_000 },
    ...overrides };
}

async function startGateway(origin, overrides) {
  const gateway = createEgressGateway(gatewayConfig(origin, overrides));
  await gateway.start();
  const base = `http://127.0.0.1:${gateway.status().address.port}${PATH}`;
  return { gateway, base };
}

test('B30-07: gateway forwards only the fixed path and refuses CONNECT and other paths', async t => {
  const origin = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  t.after(() => origin.stop());
  const { gateway, base } = await startGateway(origin.origin);
  t.after(() => gateway.stop());

  // CONNECT is a tunnel attempt.
  const connectText = await connectRequest(gateway.status().address.port);
  assert.match(connectText, /405/);
  // Wrong path.
  const wrong = await fetch(`http://127.0.0.1:${gateway.status().address.port}/other`, { method: 'POST', body: '{}' });
  assert.equal(wrong.status, 404);
  assert.equal(origin.requests.length, 0);

  const ok = await fetch(base, { method: 'POST', body: JSON.stringify({ model: 'x' }) });
  assert.equal(ok.status, 200);
  assert.equal(origin.requests.length, 1);
  assert.deepEqual(gateway.status().refused, ['connect', 'path']);
});

for (const code of [301, 302, 303, 307, 308]) {
  test(`B30-07: gateway refuses upstream ${code} without following to the alternate origin`, async t => {
    const alternate = await startServer((req, res) => { res.writeHead(200); res.end('leaked'); });
    const origin = await startServer((req, res) => {
      res.writeHead(code, { location: `http://127.0.0.1:${alternate.port}/leak` });
      res.end('redirect');
    });
    t.after(() => origin.stop());
    t.after(() => alternate.stop());
    const { gateway, base } = await startGateway(origin.origin);
    t.after(() => gateway.stop());

    const response = await fetch(base, { method: 'POST', body: JSON.stringify({ model: 'x' }) });
    assert.equal(response.status, 502);
    assert.equal(alternate.requests.length, 0);
    assert.ok(gateway.status().refused.includes('redirect-refused'));
  });
}

test('B30-07: gateway logs are sanitized (no body or authorization material)', async t => {
  const origin = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  t.after(() => origin.stop());
  const events = [];
  const gateway = createEgressGateway(gatewayConfig(origin.origin, { log: e => events.push(e) }));
  await gateway.start();
  const base = `http://127.0.0.1:${gateway.status().address.port}${PATH}`;
  t.after(() => gateway.stop());

  await connectRequest(gateway.status().address.port);
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['at', 'detail', 'type']);
  assert.equal(events[0].type, 'refused');
  assert.equal(events[0].detail, 'connect');
});

test('gateway policy digest binds mode/origin/path/limits', () => {
  const config = gatewayConfig('http://127.0.0.1:1234');
  assert.match(gatewayPolicyDigest(config), /^[a-f0-9]{64}$/);
  const changed = gatewayConfig('http://127.0.0.1:1234');
  changed.path = '/other';
  assert.notEqual(gatewayPolicyDigest(config), gatewayPolicyDigest(changed));
});

test('gateway rejects a live origin that is not https and non-loopback hostname', () => {
  assert.throws(() => createEgressGateway(gatewayConfig('http://127.0.0.1:1', { mode: 'live' })), /live gateway origin must be https/);
  assert.throws(() => createEgressGateway(gatewayConfig('https://127.0.0.1', { mode: 'live' })), /real hostname/);
});

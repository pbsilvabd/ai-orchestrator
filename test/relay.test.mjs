import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRelay, relayPolicyDigest } from '../src/relay.mjs';

const MODEL = 'opencode/deepseek-v4.1-flash-free';
const PATH = '/v1/chat/completions';

// A fixture HTTP origin that records requests and responds according to a handler.
async function startServer(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
      handler(req, res, body, requests);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const stop = () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
  return { server, requests, origin: `http://127.0.0.1:${address.port}`, port: address.port, stop };
}

function relayConfig(origin) {
  return { listen: { host: '127.0.0.1', port: 0 }, upstream: { origin, path: PATH, method: 'POST' },
    model: MODEL, limits: { maxRequests: 12, maxRequestBytes: 64 * 1024, maxResponseBytes: 64 * 1024, timeoutMs: 5_000 } };
}

async function startRelay(origin) {
  const relay = createRelay(relayConfig(origin));
  await relay.start();
  const address = relay.status().address;
  const base = `http://127.0.0.1:${address.port}${PATH}`;
  return { relay, base };
}

async function post(base, body = { model: MODEL }) {
  return fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer public' },
    body: JSON.stringify(body) });
}

test('B30-01: relay forwards exactly the fixed method/path/model and public bearer', async t => {
  const origin = await startServer((req, res, body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, echo: JSON.parse(body.toString('utf8')).model }));
  });
  t.after(() => origin.stop());
  const { relay, base } = await startRelay(origin.origin);
  t.after(() => relay.stop());

  const response = await post(base, { model: MODEL, prompt: 'hello' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, echo: MODEL });
  assert.equal(origin.requests.length, 1);
  assert.equal(origin.requests[0].method, 'POST');
  assert.equal(origin.requests[0].url, PATH);
  assert.equal(origin.requests[0].authorization, 'Bearer public');
  assert.equal(JSON.parse(origin.requests[0].body.toString('utf8')).model, MODEL);

  const status = relay.status();
  assert.equal(status.requests, 1);
  assert.equal(status.bytesIn, origin.requests[0].body.length);
  assert.ok(status.bytesOut > 0);
  assert.equal(status.latched, false);
});

test('B30-01: relay never forwards an arbitrary target, wrong credential or wrong model', async t => {
  const origin = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  t.after(() => origin.stop());
  const { relay, base } = await startRelay(origin.origin);
  t.after(() => relay.stop());

  // Wrong credential latches and forwards nothing.
  const badAuth = await fetch(base, { method: 'POST', headers: { authorization: 'Bearer evil' }, body: JSON.stringify({ model: MODEL }) });
  assert.equal(badAuth.status, 401);
  assert.equal(origin.requests.length, 0);

  const status = relay.status();
  assert.equal(status.latched, true);
  assert.equal(status.latchReason, 'credential');
  // A latched relay refuses subsequent requests without forwarding.
  const after = await post(base);
  assert.equal(after.status, 503);
  assert.equal(origin.requests.length, 0);
});

test('B30-01: independent request counter bounds forwarding regardless of worker', async t => {
  const origin = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  t.after(() => origin.stop());
  const config = relayConfig(origin.origin);
  config.limits.maxRequests = 2;
  const relay = createRelay(config);
  await relay.start();
  const address = relay.status().address;
  const base = `http://127.0.0.1:${address.port}${PATH}`;
  t.after(() => relay.stop());

  await post(base); await post(base);
  const third = await post(base);
  assert.equal(third.status, 429);
  assert.equal(origin.requests.length, 2);
  assert.equal(relay.status().requests, 3);
  assert.equal(relay.status().latchReason, 'request-count');
});

for (const code of [301, 302, 303, 307, 308]) {
  test(`B30-02: upstream ${code} redirect is refused with zero alternate-origin bytes`, async t => {
    const alternate = await startServer((req, res) => { res.writeHead(200); res.end('leaked'); });
    const origin = await startServer((req, res) => {
      res.writeHead(code, { location: `http://127.0.0.1:${alternate.port}/leak` });
      res.end('redirect');
    });
    t.after(() => origin.stop());
    t.after(() => alternate.stop());
    const { relay, base } = await startRelay(origin.origin);
    t.after(() => relay.stop());

    const response = await post(base);
    assert.equal(response.status, 502);
    assert.equal(origin.requests.length, 1);
    assert.equal(alternate.requests.length, 0);
    const status = relay.status();
    assert.equal(status.latched, true);
    assert.equal(status.latchReason, 'redirect-refused');
  });
}

test('B30-04: relay refuses to launch on a port conflict', async t => {
  const origin = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  t.after(() => origin.stop());
  const first = createRelay({ ...relayConfig(origin.origin), listen: { host: '127.0.0.1', port: 0 } });
  await first.start();
  t.after(() => first.stop());
  const boundPort = first.status().address.port;

  const second = createRelay({ ...relayConfig(origin.origin), listen: { host: '127.0.0.1', port: boundPort } });
  await assert.rejects(() => second.start(), /port already in use|unavailable/);
});

test('B30-04: upstream failure fails closed and latches', async t => {
  const dead = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  const deadOrigin = dead.origin;
  await dead.stop(); // no listener anymore
  const { relay, base } = await startRelay(deadOrigin);
  t.after(() => relay.stop());

  const response = await post(base);
  assert.equal(response.status, 502);
  assert.equal(relay.status().latched, true);
  assert.equal(relay.status().latchReason, 'upstream-unavailable');
});

test('B30-04: stop is terminal and a stopped relay cannot be restarted', async t => {
  const origin = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  t.after(() => origin.stop());
  const relay = createRelay(relayConfig(origin.origin));
  await relay.start();
  await relay.stop();
  assert.equal(relay.status().stopped, true);
  await assert.rejects(() => relay.start(), /lifecycle/);
});

test('B30-04: stop releases the port (no dangling unowned listener)', async t => {
  const origin = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  t.after(() => origin.stop());
  const relay = createRelay(relayConfig(origin.origin));
  await relay.start();
  const port = relay.status().address.port;
  await relay.stop();
  // A different relay can bind the same port: the first listener is fully gone.
  const second = createRelay({ ...relayConfig(origin.origin), listen: { host: '127.0.0.1', port } });
  await second.start();
  t.after(() => second.stop());
  assert.equal(second.status().started, true);
  assert.equal(second.status().address.port, port);
});

test('B30-04: upstream timeout latches with a terminal error and no second request', async t => {
  const origin = await startServer((req, res) => {
    // Hold the request without responding; the relay timeout must fire.
  });
  t.after(() => origin.stop());
  const config = relayConfig(origin.origin);
  config.limits.timeoutMs = 500;
  const relay = createRelay(config);
  await relay.start();
  const base = `http://127.0.0.1:${relay.status().address.port}${PATH}`;
  t.after(() => relay.stop());

  const response = await post(base);
  assert.equal(response.status, 504);
  assert.equal(relay.status().latched, true);
  assert.equal(relay.status().latchReason, 'timeout');
  assert.equal(origin.requests.length, 1, 'timeout must not produce a second upstream request');
});

test('B30-04: upstream partial-body drop latches and never replays', async t => {
  const origin = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
    res.write('{"partial":');
    setTimeout(() => res.destroy(), 20);
  });
  t.after(() => origin.stop());
  const { relay, base } = await startRelay(origin.origin);
  t.after(() => relay.stop());

  const response = await post(base);
  assert.equal(response.status, 200); // headers already sent before the drop
  await response.text().catch(() => {});
  const status = relay.status();
  assert.equal(status.latched, true, 'partial-body drop must latch the relay');
  assert.equal(origin.requests.length, 1, 'partial-body drop must not replay the request');
});

test('B30-04: a concurrent latch refuses an in-flight request without rewriting the reason', async t => {
  const origin = await startServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 250);
  });
  t.after(() => origin.stop());
  const { relay, base } = await startRelay(origin.origin);
  t.after(() => relay.stop());

  const pending = post(base);
  await new Promise(resolve => setTimeout(resolve, 50));
  const wrongMethod = await fetch(base, { method: 'GET', headers: { authorization: 'Bearer public' } });
  assert.equal(wrongMethod.status, 405);
  await wrongMethod.text();
  const response = await pending;
  assert.equal(response.status, 503, 'a latch by another request is not a deadline');
  assert.match(await response.text(), /relay latched/);
  assert.equal(relay.status().latchReason, 'method', 'the original latch reason is retained');
  assert.equal(origin.requests.length, 1, 'no second upstream request is made');
});

test('relay policy digest binds the exact configuration', () => {
  const config = relayConfig('http://127.0.0.1:1234');
  assert.match(relayPolicyDigest(config), /^[a-f0-9]{64}$/);
  const changed = relayConfig('http://127.0.0.1:1234');
  changed.upstream.path = '/other';
  assert.notEqual(relayPolicyDigest(config), relayPolicyDigest(changed));
});

test('relay rejects unspecified/wildcard bind addresses including compressed all-zero IPv6', () => {
  const unspecified = [
    '0.0.0.0', '::', '::0', '0:0:0:0:0:0:0:0',
    '0:0:0:0:0:0:0::', '0:0:0:0:0::', '::0:0:0:0:0:0:0', '0:0:0:0:0:0::0',
  ];
  for (const host of unspecified) {
    const config = relayConfig('http://127.0.0.1:1234');
    config.listen = { host, port: 0 };
    assert.throws(() => createRelay(config), /must not be unspecified/);
  }
  // Concrete (non-unspecified) addresses remain accepted.
  for (const host of ['127.0.0.1', '::1', '2001:db8::1']) {
    const config = relayConfig('http://127.0.0.1:1234');
    config.listen = { host, port: 0 };
    assert.doesNotThrow(() => createRelay(config));
  }
});

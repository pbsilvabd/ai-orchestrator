import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfiguredTaskService } from '../src/configured-service.mjs';
import { freeListenerPlan } from '../src/free-listeners.mjs';
import { reconcileListenerLock } from '../src/listener-supervisor.mjs';
import { FREE_MODEL_ID } from '../src/free-provider.mjs';
import { approvalFor, fixture, metadata } from './fixtures/free-worker.mjs';

// Offline wiring tests (B30-04). They use real child processes, real loopback ports and
// real lock files. Admission is a clearly-labelled test double that only carries the policy
// digests; the signed-SSHSIG positive path remains `not_run`. No external network is used.

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'integration', 'listener-fixture-child.mjs');
const LIMITS = { maxRequests: 12, maxRequestBytes: 65_536, maxResponseBytes: 65_536, timeoutMs: 5_000 };

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function occupy(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function portAccepts(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = connect(port, host);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function until(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('condition not reached before timeout');
}

async function killAndWait(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
}

async function locks(home) {
  return readdir(join(home, 'listeners')).then(names => names.filter(name => name.endsWith('.lock.json')), () => []);
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function listenerPorts(t, overrides = {}) {
  const relayPort = await freePort();
  const gatewayPort = await freePort();
  const originPort = await freePort();
  const spawned = [];
  const supervisor = {
    readyTimeoutMs: 10_000,
    stopTimeoutMs: 3_000,
    killTimeoutMs: 3_000,
    fork: (...args) => { const child = fork(...args); spawned.push(child); return child; },
    ...(overrides.supervisor ?? {}),
  };
  const listeners = { relayPort, gatewayPort, gatewayOrigin: `http://127.0.0.1:${originPort}`,
    limits: LIMITS, supervisor };
  return { listeners, spawned };
}

function activeConfig(f) {
  return { ...f.config, worker: { type: 'opencode-free', executable: process.execPath, writablePaths: ['src/**'] } };
}

// Labelled test double for the signed admission gate: it carries the policy digests the real
// factory exposes and admits without a signature. It exercises wiring only.
function admissionDouble(plan) {
  const gate = () => ({ admitted: true, revalidate() {} });
  Object.defineProperty(gate, 'relayPolicyDigest', { value: plan.relayPolicyDigest, enumerable: true });
  Object.defineProperty(gate, 'gatewayPolicyDigest', { value: plan.gatewayPolicyDigest, enumerable: true });
  Object.defineProperty(gate, 'maxRequests', { value: plan.maxRequests, enumerable: true });
  return gate;
}

async function approvalAt(f) {
  const file = join(f.home, 'approval.json');
  await writeFile(file, JSON.stringify(approvalFor(f.request)));
  return file;
}

test('B30-04: the relay bind host is explicit, private or loopback, and covered by the policy digest', () => {
  const base = { relayPort: 18081, gatewayPort: 18082,
    gatewayOrigin: 'http://127.0.0.1:18083', limits: LIMITS };
  const loopbackPlan = freeListenerPlan(base);
  assert.equal(loopbackPlan.relayHost, '127.0.0.1');
  assert.equal(loopbackPlan.relayConfig.listen.host, '127.0.0.1');
  assert.equal(loopbackPlan.workerBaseURL, 'http://127.0.0.1:18081/v1');

  const workerFacing = freeListenerPlan({ ...base, relayHost: '10.30.1.1' });
  assert.equal(workerFacing.relayConfig.listen.host, '10.30.1.1');
  assert.equal(workerFacing.workerBaseURL, 'http://10.30.1.1:18081/v1');
  assert.notEqual(workerFacing.relayPolicyDigest, loopbackPlan.relayPolicyDigest,
    'the bind address is part of the approved relay policy');

  const ipv6 = freeListenerPlan({ ...base, relayHost: 'fd00::1' });
  assert.equal(ipv6.workerBaseURL, 'http://[fd00::1]:18081/v1');
  const oneRequest = freeListenerPlan({ ...base, limits: { ...LIMITS, maxRequests: 1 } });
  assert.equal(oneRequest.maxRequests, 1);
  assert.equal(oneRequest.relayConfig.limits.maxRequests, 1);
  assert.equal(oneRequest.gatewayConfig.limits.maxRequests, 1);

  for (const relayHost of ['0.0.0.0', '::', '0:0:0:0:0:0:0::', '8.8.8.8', '1.1.1.1', '100.64.0.1',
    'localhost', 'example.com', '', '10.30.1.999', '::ffff:10.30.1.1']) {
    assert.throws(() => freeListenerPlan({ ...base, relayHost }), { code: 'invalid_argument' }, relayHost);
  }
  for (const relayHost of ['127.0.0.1', '127.0.0.2', '10.30.1.1', '172.16.0.1', '192.168.1.10',
    '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(freeListenerPlan({ ...base, relayHost }).relayConfig.listen.host, relayHost);
  }
});

test('B30-04: an explicit relay bind address is honored and the previous loopback address stays closed', async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  listeners.relayHost = '127.0.0.2';
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal(await portAccepts(listeners.relayPort, '127.0.0.2'), true,
    'the relay binds the explicit address');
  assert.equal(await portAccepts(listeners.relayPort, '127.0.0.1'), false,
    'the default loopback address is not additionally exposed');
  await service.close();
  assert.equal(await portAccepts(listeners.relayPort, '127.0.0.2'), false);
});

test('B30-04: supervised relay accepts the pinned worker wire model and forwards only to its fixed gateway',
  { timeout: 15_000 }, async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  const originRequests = [];
  const origin = createHttpServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      originRequests.push({ url: req.url, authorization: req.headers.authorization, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: JSON.parse(body.toString()).model }));
    });
  });
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => {
    origin.closeAllConnections?.();
    await new Promise(resolve => origin.close(resolve));
  });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  const response = await fetch(`http://127.0.0.1:${listeners.relayPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer public', 'content-type': 'application/json' },
    body: JSON.stringify({ model: FREE_MODEL_ID }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { model: FREE_MODEL_ID });
  assert.deepEqual(originRequests.map(({ url, authorization }) => ({ url, authorization })), [
    { url: '/v1/chat/completions', authorization: 'Bearer public' },
  ]);
  assert.equal(JSON.parse(originRequests[0].body.toString()).model, FREE_MODEL_ID);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
});

test('B30-05: one-request signed ceiling composes all three caps and blocks request two', { timeout: 15_000 }, async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  listeners.limits = { ...LIMITS, maxRequests: 1 };
  const originRequests = [];
  const origin = createHttpServer((req, res) => {
    originRequests.push(req.url);
    req.resume();
    res.end('{}');
  });
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => { origin.closeAllConnections?.(); await new Promise(resolve => origin.close(resolve)); });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  assert.equal(plan.maxRequests, 1);
  assert.equal(plan.relayConfig.limits.maxRequests, 1);
  assert.equal(plan.gatewayConfig.limits.maxRequests, 1);
  const request = () => fetch(`http://127.0.0.1:${listeners.relayPort}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: 'Bearer public' }, body: JSON.stringify({ model: FREE_MODEL_ID }),
  });
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429);
  assert.deepEqual(originRequests, ['/v1/chat/completions']);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal((await locks(f.home)).length, 2);
});

test('B30-04: supervised listeners bound oversized bodies, latch without upstream I/O, and remain owned and alive',
  { timeout: 15_000 }, async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  const originRequests = [];
  const origin = createHttpServer((req, res) => {
    originRequests.push(req.url);
    req.resume();
    res.writeHead(200);
    res.end('{}');
  });
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => {
    origin.closeAllConnections?.();
    await new Promise(resolve => origin.close(resolve));
  });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  const payload = JSON.stringify({ model: FREE_MODEL_ID, padding: 'x'.repeat(LIMITS.maxRequestBytes) });
  const send = (port, body) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer public', 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(5_000),
  });

  const relayOverflow = await send(listeners.relayPort, payload);
  assert.equal(relayOverflow.status, 413);
  assert.equal(await relayOverflow.text(), 'request body exceeds relay bound');
  assert.equal(originRequests.length, 0);
  const relayLatched = await send(listeners.relayPort, '{}');
  assert.equal(relayLatched.status, 503);

  const gatewayOverflow = await send(listeners.gatewayPort, payload);
  assert.equal(gatewayOverflow.status, 413);
  assert.equal(await gatewayOverflow.text(), 'request body exceeds gateway bound');
  assert.equal(originRequests.length, 0);
  const gatewayLatched = await send(listeners.gatewayPort, '{}');
  assert.equal(gatewayLatched.status, 503);

  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal((await locks(f.home)).length, 2, 'both child ownership locks remain held while listeners run');
});

test('B30-04: body waiters cannot pass a terminal latch in either supervised listener', { timeout: 15_000 }, async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  const originRequests = [];
  const origin = createHttpServer((req, res) => { originRequests.push(req.url); req.resume(); res.end('{}'); });
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => { origin.closeAllConnections?.(); await new Promise(resolve => origin.close(resolve)); });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  // Headers-only A is held open while B triggers the terminal method latch.
  for (const port of [listeners.relayPort, listeners.gatewayPort]) {
    const a = httpRequest({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
      headers: { authorization: 'Bearer public', 'content-length': '2' } });
    const aStatus = new Promise((resolve, reject) => {
      a.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      a.on('error', reject);
    });
    a.flushHeaders();
    await new Promise(resolve => setImmediate(resolve));
    const b = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer public' },
      body: JSON.stringify({ model: FREE_MODEL_ID, padding: 'x'.repeat(LIMITS.maxRequestBytes) }),
    });
    assert.equal(b.status, 413);
    a.end('{}');
    assert.equal(await aStatus, 503);
  }
  // Aborted body collection is also terminal; it cannot leave a waiter that later
  // starts forwarding when additional bytes arrive or a new connection is made.
  for (const port of [listeners.relayPort, listeners.gatewayPort]) {
    const aborted = httpRequest({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
      headers: { authorization: 'Bearer public', 'content-length': '20' } });
    aborted.on('error', () => {});
    aborted.flushHeaders();
    aborted.write('{"');
    await new Promise(resolve => setTimeout(resolve, 50));
    aborted.destroy();
    await new Promise(resolve => setTimeout(resolve, 10));
    const refused = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer public' }, body: JSON.stringify({ model: FREE_MODEL_ID }),
    });
    assert.equal(refused.status, 503);
  }
  assert.deepEqual(originRequests, []);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal((await locks(f.home)).length, 2);
});

test('B30-04: ingress deadline bounds stalled bodies and closes clients without upstream work', { timeout: 15_000 }, async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  listeners.limits = { ...LIMITS, timeoutMs: 250 };
  let originRequests = 0;
  const origin = createHttpServer((req, res) => { originRequests++; req.resume(); res.end('{}'); });
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => { origin.closeAllConnections?.(); await new Promise(resolve => origin.close(resolve)); });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  for (const [index, port] of [listeners.relayPort, listeners.gatewayPort].entries()) {
    let clientRequest;
    const status = new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
        headers: { authorization: 'Bearer public', ...(index === 0
          ? { 'content-length': '100' } : { 'transfer-encoding': 'chunked' }) } },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      clientRequest = req;
      req.on('error', reject);
      req.flushHeaders(); // first request is stalled content-length; second is stalled chunked
    });
    assert.equal(await status, 504);
    clientRequest.removeAllListeners('error');
    clientRequest.on('error', () => {}); // late client-side socket errors are expected
    assert.doesNotThrow(() => {
      clientRequest.write('late-data');
      clientRequest.end();
      clientRequest.destroy(new Error('late-abort'));
    });
    const refused = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer public' }, body: JSON.stringify({ model: FREE_MODEL_ID }),
    });
    assert.equal(refused.status, 503);
  }
  assert.equal(originRequests, 0);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal((await locks(f.home)).length, 2);
});

test('B30-04: early refusals close incomplete content-length and chunked requests within the policy deadline', { timeout: 15_000 }, async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  listeners.limits = { ...LIMITS, timeoutMs: 75 };
  let originRequests = 0;
  const origin = createHttpServer((req, res) => { originRequests++; req.resume(); res.end('{}'); });
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => { origin.closeAllConnections?.(); await new Promise(resolve => origin.close(resolve)); });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  const lockBytes = await Promise.all((await readdir(join(f.home, 'listeners'))).filter(x => x.endsWith('.lock.json'))
    .map(x => readFile(join(f.home, 'listeners', x))));
  const stalled = (port, authorization, bodyMode) => new Promise((resolve, reject) => {
      let responseStatus = null;
      const startedAt = Date.now();
      const req = httpRequest({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
        headers: { authorization, ...(bodyMode === 'content-length' ? { 'content-length': '100' } : { 'transfer-encoding': 'chunked' }) } },
      res => {
        responseStatus = res.statusCode;
        res.resume();
        res.on('end', () => {
          const socket = req.socket;
          if (socket.destroyed) resolve({ status: responseStatus, closed: true, durationMs: Date.now() - startedAt });
          else socket.once('close', () => resolve({ status: responseStatus, closed: true, durationMs: Date.now() - startedAt }));
        });
      });
      req.on('error', error => error.code === 'ECONNRESET'
        ? resolve({ status: responseStatus, closed: true, durationMs: Date.now() - startedAt }) : reject(error));
      req.flushHeaders();
      const timer = setTimeout(() => req.destroy(), 250);
      timer.unref?.();
      req.once('close', () => clearTimeout(timer));
    });
  for (const [port, invalidMode, latchedMode] of [
    [listeners.relayPort, 'content-length', 'chunked'],
    [listeners.gatewayPort, 'chunked', 'content-length'],
  ]) {
    const invalid = await stalled(port, 'Bearer invalid', invalidMode);
    assert.ok(invalid.status === 401 || invalid.status === null, `invalid-credential bounded response: ${invalid.status}`);
    assert.ok(invalid.durationMs <= 100, `invalid-credential connection closed in ${invalid.durationMs}ms`);
    const latched = await stalled(port, 'Bearer public', latchedMode);
    assert.ok(latched.status === 503 || latched.status === null, `already-latched bounded response: ${latched.status}`);
    assert.ok(latched.durationMs <= 100, `latched connection closed in ${latched.durationMs}ms`);
  }
  assert.equal(originRequests, 0);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.deepEqual(await Promise.all((await readdir(join(f.home, 'listeners'))).filter(x => x.endsWith('.lock.json'))
    .map(x => readFile(join(f.home, 'listeners', x)))), lockBytes);
});

test('B30-04: abort in a fresh listener latches during another admitted pending request', { timeout: 15_000 }, async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  let originRequests = 0;
  const origin = createHttpServer((req, res) => { originRequests++; req.resume(); res.end('{}'); });
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => { origin.closeAllConnections?.(); await new Promise(resolve => origin.close(resolve)); });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  const lockBytes = await Promise.all((await readdir(join(f.home, 'listeners'))).filter(x => x.endsWith('.lock.json'))
    .map(x => readFile(join(f.home, 'listeners', x))));
  // Observe the listener's terminal latch instead of guessing with a fixed sleep: the abort
  // must be processed before A's body is completed, otherwise the test proves nothing about
  // forwarding after a latch.
  const waitForLatch = async port => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const status = (await service.freeListenerStatus()).find(item => item?.address?.port === port);
      if (status?.latched) return status;
      if (Date.now() >= deadline) throw new Error(`listener ${port} did not latch after the aborted request`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  for (const port of [listeners.relayPort, listeners.gatewayPort]) {
    let first;
    const firstResponse = new Promise((resolve, reject) => {
      first = httpRequest({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
        headers: { authorization: 'Bearer public', 'content-length': '100' } },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      first.on('error', reject);
      first.flushHeaders();
    });
    const aborted = httpRequest({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
      headers: { authorization: 'Bearer public', 'content-length': '20' } });
    aborted.on('error', () => {});
    const connected = new Promise(resolve => aborted.once('socket', socket => {
      if (socket.connecting) socket.once('connect', resolve);
      else resolve();
    }));
    aborted.flushHeaders();
    await connected;
    aborted.write('{"');
    aborted.destroy();
    await waitForLatch(port);
    const valid = Buffer.from(JSON.stringify({ model: FREE_MODEL_ID }));
    first.end(Buffer.concat([valid, Buffer.alloc(100 - valid.length, 0x20)]));
    assert.equal(await firstResponse, 503);
    const later = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer public' },
      body: JSON.stringify({ model: FREE_MODEL_ID }),
    });
    assert.equal(later.status, 503, 'the aborted body left the fresh listener terminally latched');
    assert.equal(originRequests, 0, `listener ${port} must not have forwarded A`);
  }
  assert.equal(originRequests, 0);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.deepEqual(await Promise.all((await readdir(join(f.home, 'listeners'))).filter(x => x.endsWith('.lock.json'))
    .map(x => readFile(join(f.home, 'listeners', x)))), lockBytes);
});

test('B30-04: a listener status query cannot leak an unhandled rejection', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const origin = createHttpServer((_req, res) => res.end('{}'));
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  t.after(async () => { origin.closeAllConnections?.(); await new Promise(resolve => origin.close(resolve)); });
  const plan = freeListenerPlan(listeners);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);

  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));

  // Gateway exits first: its status() now throws synchronously. The relay is still running
  // when the combined query starts and exits before it can answer, which is the ordering
  // that previously left the relay's pending query unhandled.
  await killAndWait(spawned[0]);
  await until(() => service.freeListenerStates().gateway === 'exited');
  const pending = service.freeListenerStatus();
  assert.equal(typeof pending?.then, 'function', 'the status query must return a promise');
  await killAndWait(spawned[1]);
  await assert.rejects(pending);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, [], 'no unhandled rejection escaped the status query');
});

test('B30-04: fixture origin cleanup is registered before a refused composition', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const origin = createHttpServer((_req, res) => res.end('{}'));
  await new Promise(resolve => origin.listen(new URL(listeners.gatewayOrigin).port, '127.0.0.1', resolve));
  let closed = false;
  t.after(async () => {
    origin.closeAllConnections?.();
    await new Promise(resolve => origin.close(() => { closed = true; resolve(); }));
    assert.equal(closed, true, 'refusal-path teardown closes the bound test origin');
  });
  const plan = freeListenerPlan(listeners);
  const mismatch = () => ({ admitted: true, revalidate() {} });
  Object.defineProperty(mismatch, 'relayPolicyDigest', { value: plan.relayPolicyDigest, enumerable: true });
  Object.defineProperty(mismatch, 'gatewayPolicyDigest', { value: 'f'.repeat(64), enumerable: true });
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: mismatch },
  { metadata: async () => metadata(), freeListeners: listeners }));
  assert.equal(spawned.length, 0);
  assert.equal(closed, false, 'the teardown hook owns cleanup even after composition refusal');
  // The registered teardown runs after this assertion and closes the already-bound origin.
});

test('B30-04: supervised listeners refuse to start without an approved run; no child, lock or metadata lookup', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  let metadataCalls = 0;
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    admission: admissionDouble(plan) },
  { metadata: async () => { metadataCalls++; return metadata(); }, freeListeners: listeners }),
  /approved run/);
  assert.equal(spawned.length, 0);
  assert.equal(metadataCalls, 0);
  assert.deepEqual(await locks(f.home), []);
});

test('B30-05: admission that does not bind the supervised relay and gateway digests refuses before any child starts', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  let metadataCalls = 0;
  const metadataSource = async () => { metadataCalls++; return metadata(); };
  const wrong = () => {
    const gate = () => ({ admitted: true, revalidate() {} });
    Object.defineProperty(gate, 'relayPolicyDigest', { value: 'd'.repeat(64), enumerable: true });
    Object.defineProperty(gate, 'gatewayPolicyDigest', { value: plan.gatewayPolicyDigest, enumerable: true });
    return gate;
  };
  for (const admission of [undefined, wrong()]) {
    await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile, admission },
      { metadata: metadataSource, freeListeners: listeners }), /admission gate bound to the relay and gateway policy digests/);
  }
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: metadataSource, freeListeners: listeners, fixtureEndpoint: 'http://127.0.0.1:43210/v1' }),
  /invalid free worker service configuration/);
  assert.equal(spawned.length, 0);
  assert.equal(metadataCalls, 0);
  assert.deepEqual(await locks(f.home), []);
});

test('B30-04: a gateway port conflict refuses launch with no relay, no lock and no worker', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const blocker = await occupy(listeners.gatewayPort);
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners }),
  error => error.code === 'unavailable' && /port already in use/.test(error.message));
  assert.equal(spawned.length, 1, 'only the gateway child was started, and it was refused');
  assert.deepEqual(await locks(f.home), []);
});

test('B30-04: a relay launch failure stops the gateway it already started and leaves no lock', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const blocker = await occupy(listeners.relayPort);
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners }),
  error => error.code === 'unavailable' && /port already in use/.test(error.message));
  assert.equal(spawned.length, 2);
  assert.equal(await portAccepts(listeners.gatewayPort), false, 'the gateway it started is stopped');
  assert.deepEqual(await locks(f.home), []);
});

test('B30-04: an approved composition starts both listeners and close stops them and releases every lock', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal(await portAccepts(listeners.relayPort), true);
  assert.equal(await portAccepts(listeners.gatewayPort), true);
  assert.equal((await locks(f.home)).length, 2);
  const closed = await service.close();
  assert.equal(closed.releaseOwnership, true);
  assert.equal(spawned.length, 2);
  assert.equal(await portAccepts(listeners.relayPort), false);
  assert.equal(await portAccepts(listeners.gatewayPort), false);
  assert.deepEqual(await locks(f.home), []);
  assert.deepEqual(service.freeListenerStates(), { relay: 'stopped', gateway: 'stopped' });
});

test('B30-04: restart after a confirmed close composes again with new ownership', async t => {
  const f = fixture(t);
  const { listeners } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const compose = () => createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  const first = await compose();
  await first.close();
  const second = await compose();
  f.services.push(second);
  assert.deepEqual(second.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal(await portAccepts(listeners.relayPort), true);
  await second.close();
  assert.deepEqual(await locks(f.home), []);
});

test('B30-04: an uncertain stop during launch cleanup keeps the owner and both listener locks, refuses restart, and reconciles only with exact evidence', async t => {
  const f = fixture(t);
  const children = [];
  const { listeners } = await listenerPorts(t, { supervisor: {
    entry: FIXTURE,
    env: { B30_FIXTURE_MODE: 'ignore-stop' },
    stopTimeoutMs: 300,
    killTimeoutMs: 300,
    terminate: () => {},
    fork: (...args) => { const child = fork(...args); children.push(child); return child; },
  } });
  t.after(async () => { for (const child of children) await killAndWait(child); });
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  // The fixture child reports no policy digest, so the post-start policy check fails and the
  // cleanup must stop two listeners whose stops cannot be confirmed.
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners }), /did not exit/);
  const retained = await locks(f.home);
  assert.equal(retained.length, 2, 'both unconfirmed listeners keep ownership');
  // The retained task-home owner refuses a restart before any listener start; the listener
  // locks above independently keep their ports and locks until operator reconciliation.
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: { ...listeners, supervisor: {} } }), /another service owns/);
  assert.equal(children.length, 2, 'the refused restart spawned no child');
  // Only after the processes are verified stopped may a maintainer release each lock.
  await killAndWait(children[0]);
  await killAndWait(children[1]);
  for (const name of retained) {
    const record = JSON.parse(await readFile(join(f.home, 'listeners', name), 'utf8'));
    await assert.rejects(reconcileListenerLock({ home: f.home, name: record.name, token: record.token,
      pid: record.pid, confirmedStopped: false }), { code: 'invalid_argument' });
    await reconcileListenerLock({ home: f.home, name: record.name, token: record.token, pid: record.pid,
      confirmedStopped: true });
  }
  assert.deepEqual(await locks(f.home), []);
});

test('B30-04: a crashed listener makes the next dispatch fail closed as blocked, with no replay', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  // Not registered in f.services: a blocked dispatch retains its owner by design, and the
  // fixture teardown would refuse to remove that evidence. The `finally` closes the service
  // so a failed assertion cannot leak listeners; the fixture teardown removes the directory.
  let closed;
  try {
    await killAndWait(spawned[1]);
    await until(() => service.freeListenerStates().relay === 'exited');
    // The approval binds this exact request, so the approved submission is the one dispatched.
    const { taskId } = service.submitTask(f.request);
    await until(() => service.store.readTask(taskId).status === 'blocked');
    const task = service.store.readTask(taskId);
    assert.equal(task.block.reason, 'worker-outcome-uncertain');
    assert.equal(task.cancel.executionStopped, 'unknown');
    assert.equal(task.attempts.length, 1, 'the reserved dispatch is not replayed');
    assert.equal(task.attempts[0].finishedAt, null);
    closed = await service.close();
    assert.equal(closed.releaseOwnership, false);
    assert.equal(await portAccepts(listeners.gatewayPort), false, 'the surviving gateway is stopped on close');
    assert.deepEqual(await locks(f.home), [], 'the exited relay lock was released by its confirmed exit');
  } finally {
    if (closed === undefined) await service.close().catch(() => {});
  }
});

test('B30-04: task text cannot select listener ports, bind addresses, provider or model', async t => {
  const f = fixture(t);
  const { listeners, spawned } = await listenerPorts(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  const before = spawned.length;
  for (const extra of [
    { relayPort: 1 }, { listen: { host: '0.0.0.0', port: 9 } },
    { provider: { baseURL: 'https://opencode.ai/inference/openai/v1' } }, { upstream: { origin: 'http://127.0.0.1:9' } },
    { model: 'opencode/gpt-6-luna' },
  ]) {
    assert.throws(() => service.submitTask({ ...f.request, idempotencyKey: `text-${Object.keys(extra)[0]}`, ...extra }),
      { code: 'invalid_argument' });
  }
  assert.equal(spawned.length, before);
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  assert.equal(await portAccepts(listeners.relayPort), true);
  assert.equal(service.store.listTasks().length, 0);
});

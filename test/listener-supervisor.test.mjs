import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createListenerSupervisor, ListenerError, reconcileListenerLock } from '../src/listener-supervisor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'integration', 'listener-fixture-child.mjs');
const CHILD = join(HERE, '..', 'src', 'listener-child.mjs');
const MODEL = 'opencode/deepseek-v4.1-flash-free';
const PATH = '/v1/chat/completions';
const LIMITS = { maxRequests: 12, maxRequestBytes: 64 * 1024, maxResponseBytes: 64 * 1024, timeoutMs: 5_000 };

async function startOrigin() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null,
        body: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    origin: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

async function tempHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'b30-listener-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

function relayConfig(origin) {
  return { listen: { host: '127.0.0.1', port: 0 }, upstream: { origin, path: PATH, method: 'POST' },
    model: MODEL, limits: LIMITS };
}

function gatewayConfig(origin, port = 0) {
  return { mode: 'fixture', listen: { host: '127.0.0.1', port }, origin, path: PATH, limits: LIMITS };
}

const post = (base, body = { model: MODEL }) =>
  fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer public' },
    body: JSON.stringify(body) });

function portAccepts(port) {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function killAndWait(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

test('B30-04: supervised relay child serves the fixed request and stops with a confirmed exit', async t => {
  const origin = await startOrigin();
  t.after(() => origin.stop());
  const home = await tempHome(t);
  const supervisor = createListenerSupervisor({ home });
  const handle = await supervisor.start({ name: 'relay-a', kind: 'relay', config: relayConfig(origin.origin) });
  t.after(() => (handle.state() === 'running' ? handle.stop().catch(() => {}) : null));

  const response = await post(`http://127.0.0.1:${handle.port}${PATH}`);
  assert.equal(response.status, 200);
  assert.equal(origin.requests.length, 1);
  assert.equal(origin.requests[0].authorization, 'Bearer public');
  assert.equal((await handle.status()).requests, 1);

  const stopped = await handle.stop();
  assert.equal(stopped.outcome, 'stopped');
  assert.equal(stopped.code, 0);
  assert.equal(handle.state(), 'stopped');
  assert.equal(await portAccepts(handle.port), false, 'a confirmed stop frees the port');
  assert.equal(await exists(supervisor.lockPath('relay-a')), false, 'a confirmed stop releases the lock');
  await assert.rejects(() => handle.stop(), { code: 'unavailable' });
});

test('B30-04: a supervised port conflict refuses launch, releases its own lock and keeps the first listener', async t => {
  const origin = await startOrigin();
  t.after(() => origin.stop());
  const home = await tempHome(t);
  const supervisor = createListenerSupervisor({ home });
  const first = await supervisor.start({ name: 'gateway-a', kind: 'gateway', config: gatewayConfig(origin.origin) });
  t.after(() => (first.state() === 'running' ? first.stop().catch(() => {}) : null));

  await assert.rejects(
    () => supervisor.start({ name: 'gateway-b', kind: 'gateway', config: gatewayConfig(origin.origin, first.port) }),
    error => error instanceof ListenerError && error.code === 'unavailable' && /port already in use/.test(error.message),
  );
  assert.equal(await exists(supervisor.lockPath('gateway-b')), false, 'a refused child releases its own lock');
  assert.equal(await portAccepts(first.port), true, 'the first listener keeps its port');

  const response = await post(`http://127.0.0.1:${first.port}${PATH}`);
  assert.equal(response.status, 200);
  assert.equal(origin.requests.length, 1);
});

test('B30-04: a held listener lock refuses a second start with no second child', async t => {
  const origin = await startOrigin();
  t.after(() => origin.stop());
  const home = await tempHome(t);
  let spawns = 0;
  const supervisor = createListenerSupervisor({
    home,
    fork: (...args) => { spawns += 1; return fork(...args); },
  });
  const first = await supervisor.start({ name: 'relay-b', kind: 'relay', config: relayConfig(origin.origin) });
  t.after(() => (first.state() === 'running' ? first.stop().catch(() => {}) : null));
  const lockBefore = await readFile(supervisor.lockPath('relay-b'), 'utf8');

  await assert.rejects(
    () => supervisor.start({ name: 'relay-b', kind: 'relay', config: relayConfig(origin.origin) }),
    { code: 'owner-present' },
  );
  assert.equal(spawns, 1, 'a refused start must not spawn a second child');
  assert.equal(await readFile(supervisor.lockPath('relay-b'), 'utf8'), lockBefore);
  assert.equal(await portAccepts(first.port), true);
});

test('B30-04: restart after a confirmed stop issues a new lock token', async t => {
  const origin = await startOrigin();
  t.after(() => origin.stop());
  const home = await tempHome(t);
  const supervisor = createListenerSupervisor({ home });
  const first = await supervisor.start({ name: 'relay-c', kind: 'relay', config: relayConfig(origin.origin) });
  await first.stop();

  const second = await supervisor.start({ name: 'relay-c', kind: 'relay', config: relayConfig(origin.origin) });
  t.after(() => (second.state() === 'running' ? second.stop().catch(() => {}) : null));
  assert.notEqual(second.token, first.token);
  const response = await post(`http://127.0.0.1:${second.port}${PATH}`);
  assert.equal(response.status, 200);
  assert.equal(origin.requests.length, 1);
});

test('B30-04: an unconfirmed child stop keeps the port and lock and refuses restart until reconciled', async t => {
  const home = await tempHome(t);
  const children = [];
  const supervisor = createListenerSupervisor({
    home,
    entry: FIXTURE,
    env: { B30_FIXTURE_MODE: 'ignore-stop' },
    stopTimeoutMs: 300,
    killTimeoutMs: 300,
    terminate: child => { children.push(child); },
  });
  const handle = await supervisor.start({ name: 'listener-x', kind: 'relay', config: {} });
  t.after(() => killAndWait(children[0]));

  await assert.rejects(() => handle.stop(), { code: 'uncertain-stop' });
  assert.equal(handle.state(), 'unknown');
  assert.equal(await portAccepts(handle.port), true, 'the unresolved child still owns its port');
  const lock = JSON.parse(await readFile(supervisor.lockPath('listener-x'), 'utf8'));
  assert.equal(lock.token, handle.token);
  assert.equal(lock.pid, handle.pid);
  await assert.rejects(
    () => supervisor.start({ name: 'listener-x', kind: 'relay', config: {} }),
    { code: 'owner-present' },
  );

  await killAndWait(children[0]);
  assert.equal(await portAccepts(handle.port), false);
  await assert.rejects(
    () => reconcileListenerLock({ home, name: 'listener-x', token: handle.token, pid: handle.pid, confirmedStopped: false }),
    { code: 'invalid_argument' },
  );
  await assert.rejects(
    () => reconcileListenerLock({ home, name: 'listener-x', token: 'wrong', pid: handle.pid, confirmedStopped: true }),
    { code: 'invalid_argument' },
  );
  assert.equal(await exists(supervisor.lockPath('listener-x')), true, 'a bad reconciliation never releases the lock');
  await reconcileListenerLock({ home, name: 'listener-x', token: handle.token, pid: handle.pid, confirmedStopped: true });
  assert.equal(await exists(supervisor.lockPath('listener-x')), false);
});

test('B30-04: a child that never reports ready is settled, and its lock is kept only when the exit is unconfirmed', async t => {
  const home = await tempHome(t);
  const children = [];
  const unconfirmed = createListenerSupervisor({
    home,
    entry: FIXTURE,
    env: { B30_FIXTURE_MODE: 'silent' },
    readyTimeoutMs: 300,
    killTimeoutMs: 300,
    terminate: child => { children.push(child); },
  });
  t.after(() => killAndWait(children[0]));
  await assert.rejects(() => unconfirmed.start({ name: 'silent-x', kind: 'gateway', config: {} }), { code: 'uncertain-stop' });
  assert.equal(await exists(unconfirmed.lockPath('silent-x')), true, 'an unconfirmed ready timeout keeps ownership');
  const lock = JSON.parse(await readFile(unconfirmed.lockPath('silent-x'), 'utf8'));

  await killAndWait(children[0]);
  await assert.rejects(
    () => reconcileListenerLock({ home, name: 'silent-x', token: lock.token, pid: lock.pid + 1, confirmedStopped: true }),
    { code: 'invalid_argument' },
  );
  await reconcileListenerLock({ home, name: 'silent-x', token: lock.token, pid: lock.pid, confirmedStopped: true });

  const confirmed = createListenerSupervisor({
    home,
    entry: FIXTURE,
    env: { B30_FIXTURE_MODE: 'silent' },
    readyTimeoutMs: 300,
    killTimeoutMs: 5_000,
  });
  await assert.rejects(() => confirmed.start({ name: 'silent-y', kind: 'gateway', config: {} }), { code: 'unavailable' });
  assert.equal(await exists(confirmed.lockPath('silent-y')), false, 'a confirmed exit releases the lock');
});

test('B30-04: an unusable listener home refuses before any child is spawned', async t => {
  const home = await tempHome(t);
  const notADirectory = join(home, 'not-a-directory');
  await writeFile(notADirectory, 'x');
  let spawns = 0;
  const supervisor = createListenerSupervisor({
    home: notADirectory,
    fork: (...args) => { spawns += 1; return fork(...args); },
  });
  await assert.rejects(
    () => supervisor.start({ name: 'relay-d', kind: 'relay', config: relayConfig('http://127.0.0.1:1') }),
    { code: 'unavailable' },
  );
  assert.equal(spawns, 0);
  await assert.rejects(
    () => supervisor.start({ name: 'Bad Name', kind: 'relay', config: {} }),
    { code: 'invalid_argument' },
  );
});

test('B30-04: a listener child stops and frees its port when its supervisor disconnects', async t => {
  const origin = await startOrigin();
  t.after(() => origin.stop());
  const child = fork(CHILD, [], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume();
  child.stderr.resume();
  t.after(() => killAndWait(child));
  const message = once(child, 'message');
  child.send({ type: 'start', kind: 'relay', config: relayConfig(origin.origin) });
  const [ready] = await message;
  assert.equal(ready.type, 'ready');
  const exit = once(child, 'exit');
  child.disconnect();
  const [code] = await exit;
  assert.equal(code, 0);
  assert.equal(await portAccepts(ready.port), false, 'an orphaned child must not keep its listener');
});

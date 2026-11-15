import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfiguredTaskService } from '../src/configured-service.mjs';
import { freeListenerPlan } from '../src/free-listeners.mjs';
import { reconcileListenerLock } from '../src/listener-supervisor.mjs';
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

function portAccepts(port) {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
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
  return gate;
}

async function approvalAt(f) {
  const file = join(f.home, 'approval.json');
  await writeFile(file, JSON.stringify(approvalFor(f.request)));
  return file;
}

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
      { metadata: metadataSource, freeListeners: listeners }), /does not bind the supervised relay and gateway policy/);
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

test('B30-04: an uncertain stop during launch cleanup keeps both locks, refuses restart, and reconciles only with exact evidence', async t => {
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
  // A default-supervisor restart is refused while those locks exist.
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: admissionDouble(plan) },
  { metadata: async () => metadata(), freeListeners: { ...listeners, supervisor: {} } }), /lock is held/);
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

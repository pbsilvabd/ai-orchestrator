import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfiguredTaskService } from '../src/configured-service.mjs';
import { FREE_LISTENER_START_AUTHORITY, freeListenerPlan } from '../src/free-listeners.mjs';
import { createTaskService } from '../src/service.mjs';
import { createSignedApprovalAdmission, canonical, canonicalApprovalBytes, liveRequestHash,
  locateSshKeygen, measureHostBinaryDigest, openApprovalLedger, LIVE_APPROVAL_SCHEMA_VERSION,
  FIDO2_SSH_PROFILE } from '../src/live-approval.mjs';
import { FREE_ENDPOINT, FREE_MODEL } from '../src/free-provider.mjs';
import { approvalFor, fixture, metadata } from './fixtures/free-worker.mjs';

// B30-04/05 authority and ownership boundary. Listener children are real processes that bind
// real loopback ports, counted through an injected fork. The admission path uses the REAL
// signed-approval factory and `ssh-keygen -Y verify` with a disposable, non-hardware test
// signer. That proves refusals (missing, malformed, non-FIDO2, forged) and zero effects; it
// does NOT prove a positive signed or hardware-backed authorization path (B30-05 partial).

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'integration', 'listener-fixture-child.mjs');
const LIMITS = { maxRequests: 12, maxRequestBytes: 65_536, maxResponseBytes: 65_536, timeoutMs: 5_000 };
const SSH = locateSshKeygen();
const PRINCIPAL = 'maintainer';
const hasSsh = SSH !== null;

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
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('condition not reached before timeout');
}

async function killAndWait(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exit;
}

async function listenerLocks(home) {
  return readdir(join(home, 'listeners')).then(names => names.filter(name => name.endsWith('.lock.json')), () => []);
}

async function listenersAt(t, overrides = {}) {
  const relayPort = await freePort();
  const gatewayPort = await freePort();
  const originPort = await freePort();
  const spawned = [];
  const supervisor = { readyTimeoutMs: 10_000, stopTimeoutMs: 3_000, killTimeoutMs: 3_000,
    fork: (...args) => { const child = fork(...args); spawned.push(child); return child; },
    ...(overrides.supervisor ?? {}) };
  const listeners = { relayPort, gatewayPort, gatewayOrigin: `http://127.0.0.1:${originPort}`, limits: LIMITS,
    supervisor };
  return { listeners, spawned, relayPort, gatewayPort };
}

function activeConfig(f) {
  return { ...f.config, worker: { type: 'opencode-free', executable: process.execPath, writablePaths: ['src/**'] } };
}

function ssh(args, input) {
  return execFileSync(SSH, args, { input, encoding: 'utf8', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1_048_576 });
}

// Disposable test-only key material. Never a real maintainer or hardware key.
function generateKey(dir) {
  const keyPath = join(dir, 'testkey');
  ssh(['-q', '-t', 'ed25519', '-N', '', '-f', keyPath, '-C', '']);
  return { keyPath, pubKey: readFileSync(`${keyPath}.pub`, 'utf8').trim() };
}

function writeAllowedSigners(dir, pubKey) {
  const path = join(dir, 'allowed_signers');
  writeFileSync(path, `${PRINCIPAL} namespaces="ai-orchestrator-live@pbsilvabd" ${pubKey}\n`, 'utf8');
  return path;
}

function signApproval(dir, keyPath, approval) {
  const dataPath = join(dir, 'approval.json');
  writeFileSync(dataPath, canonicalApprovalBytes(approval));
  ssh(['-Y', 'sign', '-f', keyPath, '-n', 'ai-orchestrator-live@pbsilvabd', dataPath]);
  return readFileSync(`${dataPath}.sig`, 'utf8');
}

function sshString(value) {
  const buffer = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(buffer.length);
  return Buffer.concat([length, buffer]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

// A forged armored SSHSIG whose inner blob claims FIDO2 presence/verification. The real
// ssh-keygen verification must still refuse it (it is not a valid maintainer signature).
function forgedSecurityKeySignature() {
  const inner = Buffer.concat([sshString('sk-ssh-ed25519@openssh.com'), sshString('sk-key'),
    Buffer.from([0x05]), u32(0), sshString('forged-signature')]);
  const armor = Buffer.concat([Buffer.from('SSHSIG'), u32(1), sshString('ssh-ed25519 AAAA'),
    sshString('ai-orchestrator-live@pbsilvabd'), sshString(''), sshString('sha512'), sshString(inner)]);
  return `-----BEGIN SSH SIGNATURE-----\n${armor.toString('base64')}\n-----END SSH SIGNATURE-----\n`;
}

// Structurally valid live approval bound to the fixture request. Digests are local to this
// test; no positive signature is ever accepted.
function liveApprovalFor(f, plan) {
  const snapshot = metadata();
  const now = Date.now();
  return {
    schemaVersion: LIVE_APPROVAL_SCHEMA_VERSION,
    signatureProfile: FIDO2_SSH_PROFILE,
    approvalId: 'fixture-live-approval',
    principal: PRINCIPAL,
    requestHash: liveRequestHash(f.request),
    objective: f.request.objective,
    model: FREE_MODEL,
    endpoint: FREE_ENDPOINT,
    repository: { baseRef: f.baseCommit, branch: f.request.repository.branch },
    privacyAcknowledged: true,
    paidBudgetUSD: 0,
    maxAttempts: 1,
    limits: { budgetMs: f.request.limits.budgetMs, maxOutputBytes: f.request.limits.maxOutputBytes, maxRequests: 12 },
    issuedAt: now - 1_000,
    expiresAt: now + 60_000,
    hostBinaryDigest: measureHostBinaryDigest(process.execPath),
    relayPolicyDigest: plan.relayPolicyDigest,
    gatewayPolicyDigest: plan.gatewayPolicyDigest,
    metadataDigest: createHash('sha256').update(canonical(snapshot)).digest('hex'),
  };
}

// Real gate: disposable allowed-signers entry (not hardware-backed) and the composed digests.
function realGate({ plan, dir, pubKey }) {
  return createSignedApprovalAdmission({
    allowedSigners: writeAllowedSigners(dir, pubKey),
    principal: PRINCIPAL,
    relayPolicyDigest: plan.relayPolicyDigest,
    gatewayPolicyDigest: plan.gatewayPolicyDigest,
    maxRequests: plan.maxRequests,
    metadata: metadata(),
    ledger: openApprovalLedger({ home: join(dir, 'ledger') }),
    hostExecutable: process.execPath,
    sshKeygen: SSH,
    approvalProfile: FIDO2_SSH_PROFILE,
  });
}

function keyMaterial(t) {
  if (!hasSsh) return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'b30-authority-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const { keyPath, pubKey } = generateKey(dir);
  return { dir, keyPath, pubKey };
}

// A clearly labelled test double: carries the plan digests but admits nothing cryptographically.
function gateDouble(plan) {
  const gate = () => ({ admitted: true, revalidate() {} });
  Object.defineProperty(gate, 'relayPolicyDigest', { value: plan.relayPolicyDigest, enumerable: true });
  Object.defineProperty(gate, 'gatewayPolicyDigest', { value: plan.gatewayPolicyDigest, enumerable: true });
  Object.defineProperty(gate, 'maxRequests', { value: plan.maxRequests, enumerable: true });
  return gate;
}

async function approvalAt(f) {
  const file = join(f.home, 'approval.json');
  writeFileSync(file, JSON.stringify(approvalFor(f.request)));
  return file;
}

test('B30-04: a competing task-home owner refuses before any listener child, port or lock exists', async t => {
  const f = fixture(t);
  const holder = createTaskService({ home: f.home, config: f.config });
  f.services.push(holder);
  const { listeners, spawned, relayPort, gatewayPort } = await listenersAt(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  let metadataCalls = 0;
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gateDouble(plan) },
  { metadata: async () => { metadataCalls++; return metadata(); }, freeListeners: listeners }),
  error => error.code === 'unavailable' && /another service owns/.test(error.message));
  assert.equal(spawned.length, 0, 'no listener child was spawned');
  assert.equal(metadataCalls, 0, 'no metadata lookup before ownership');
  assert.equal(await portAccepts(relayPort), false);
  assert.equal(await portAccepts(gatewayPort), false);
  assert.deepEqual(await listenerLocks(f.home), []);
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), true,
    'the competing owner keeps its lock; the refused attempt never removes it');
});

test('B30-05: request-cap mismatch refuses before ownership, metadata or listeners', async t => {
  const f = fixture(t);
  const { listeners, spawned, relayPort, gatewayPort } = await listenersAt(t);
  const plan = freeListenerPlan(listeners);
  const gate = () => ({ admitted: true, revalidate() {} });
  Object.assign(gate, { relayPolicyDigest: plan.relayPolicyDigest,
    gatewayPolicyDigest: plan.gatewayPolicyDigest, maxRequests: 1 });
  let metadataCalls = 0;
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f),
    approvalFile: await approvalAt(f), admission: gate },
  { metadata: async () => { metadataCalls++; return metadata(); }, freeListeners: listeners }),
  /admission gate bound to the relay and gateway policy digests/);
  assert.equal(spawned.length, 0);
  assert.equal(metadataCalls, 0);
  assert.equal(await portAccepts(relayPort), false);
  assert.equal(await portAccepts(gatewayPort), false);
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), false);
  assert.deepEqual(await listenerLocks(f.home), []);
});

test('B30-04: a corrupt task store refuses before any listener child, port or lock exists', async t => {
  const f = fixture(t);
  const { listeners, spawned, relayPort, gatewayPort } = await listenersAt(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  mkdirSync(join(f.home, 'tasks'), { recursive: true });
  writeFileSync(join(f.home, 'tasks', '00000000-0000-4000-8000-0000000000ff.json'), '{not valid json');
  let metadataCalls = 0;
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gateDouble(plan) },
  { metadata: async () => { metadataCalls++; return metadata(); }, freeListeners: listeners }),
  error => error.code === 'unavailable');
  assert.equal(spawned.length, 0);
  assert.equal(metadataCalls, 0);
  assert.equal(await portAccepts(relayPort), false);
  assert.equal(await portAccepts(gatewayPort), false);
  assert.deepEqual(await listenerLocks(f.home), []);
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), false,
    'a refused reconciliation releases the owner it acquired');
});

test('B30-04: ownership is held while listeners run, so a second composition adds no child, port or lock', async t => {
  const f = fixture(t);
  const { listeners, spawned, relayPort, gatewayPort } = await listenersAt(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const gate = gateDouble(plan);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gate }, { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  assert.equal(spawned.length, 2);
  // A digest-only double exposes no host identity, so the reported authority says so.
  assert.match(service.freeListenerAuthority, /test double or generic gate/);
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gate }, { metadata: async () => metadata(), freeListeners: listeners }),
  error => error.code === 'unavailable' && /another service owns/.test(error.message));
  assert.equal(spawned.length, 2, 'the refused second composition started no child');
  assert.equal((await listenerLocks(f.home)).length, 2, 'no extra listener lock');
  assert.equal(await portAccepts(relayPort), true);
  assert.equal(await portAccepts(gatewayPort), true);
  const closed = await service.close();
  assert.equal(closed.releaseOwnership, true);
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), false);
  assert.deepEqual(await listenerLocks(f.home), []);
});

test('B30-05: the real gate refuses a missing task signature with no task, workspace or worker effect',
  { skip: !hasSsh }, async t => {
  const f = fixture(t);
  const keys = keyMaterial(t);
  const { listeners, spawned } = await listenersAt(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const admission = realGate({ plan, dir: keys.dir, pubKey: keys.pubKey });
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission }, { metadata: async () => metadata(), freeListeners: listeners });
  f.services.push(service);
  assert.equal(plan.startupAuthority, FREE_LISTENER_START_AUTHORITY);
  assert.equal(plan.startupAuthority.includes('not SSHSIG-verified'), true);
  assert.equal(/signed-approved start/.test(plan.startupAuthority), false);
  // Listeners start under trusted composition (not a task signature); count them precisely.
  assert.equal(spawned.length, 2);
  assert.equal(service.freeListenerAuthority.includes('not SSHSIG-verified'), true);
  assert.throws(() => service.submitTask(f.request), error => error.code === 'authorization_denied');
  assert.equal(service.store.listTasks().length, 0, 'no task record is persisted');
  assert.deepEqual(readdirSync(join(f.home, 'workspaces')), [], 'no workspace is created');
  assert.equal(spawned.length, 2, 'the refused submission starts no further child');
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
});

test('B30-05: real-gate refusals (malformed, non-FIDO2, forged) leave no task, workspace or worker effect',
  { skip: !hasSsh }, async t => {
    const f = fixture(t);
    const keys = keyMaterial(t);
    const { listeners, spawned } = await listenersAt(t);
    const plan = freeListenerPlan(listeners);
    const approvalFile = await approvalAt(f);
    const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
      admission: realGate({ plan, dir: keys.dir, pubKey: keys.pubKey }) },
    { metadata: async () => metadata(), freeListeners: listeners });
    f.services.push(service);
    const approval = liveApprovalFor(f, plan);
    const realSignature = signApproval(keys.dir, keys.keyPath, approval);
    const attempts = [
      // Structurally invalid live approval: refused before any binding.
      { approval: { schemaVersion: 1 }, signature: 'SSHSIG-forged' },
      // Not an SSHSIG at all.
      { approval, signature: 'not-an-sshsig' },
      // Cryptographically valid non-FIDO2 signature: refused for missing presence/verification.
      { approval, signature: realSignature },
      // Claims FIDO2 flags but is not a valid signature: refused by ssh-keygen verification.
      { approval, signature: forgedSecurityKeySignature() },
    ];
    for (const [index, extra] of attempts.entries()) {
      assert.throws(() => service.submitTask({ ...f.request, idempotencyKey: `refused-${index}`, ...extra }),
        error => error.code === 'authorization_denied' || error.code === 'invalid_argument');
    }
    assert.equal(service.store.listTasks().length, 0);
    assert.deepEqual(readdirSync(join(f.home, 'workspaces')), []);
    assert.equal(spawned.length, 2, 'only the composition-time listener children exist');
    // No approval ID was reserved by any refusal.
    const ledgerDir = join(keys.dir, 'ledger', 'approvals');
    assert.deepEqual(existsSync(ledgerDir) ? readdirSync(ledgerDir) : [], []);
    assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  });

test('B30-04: close releases the owner only after the listeners have stopped', async t => {
  const f = fixture(t);
  const { listeners, relayPort, gatewayPort } = await listenersAt(t);
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const gate = gateDouble(plan);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gate }, { metadata: async () => metadata(), freeListeners: listeners });
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), true);
  const closed = await service.close();
  assert.equal(closed.releaseOwnership, true);
  assert.equal(await portAccepts(relayPort), false);
  assert.equal(await portAccepts(gatewayPort), false);
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), false);
  assert.deepEqual(await listenerLocks(f.home), []);
});

test('B30-04: an unconfirmable stop at close rejects, keeps owner and listener locks, and refuses restart', async t => {
  const f = fixture(t);
  const children = [];
  const { listeners, relayPort, gatewayPort } = await listenersAt(t, { supervisor: {
    entry: FIXTURE,
    env: { B30_FIXTURE_MODE: 'ignore-stop-valid' },
    stopTimeoutMs: 300,
    killTimeoutMs: 300,
    terminate: () => {},
    fork: (...args) => { const child = fork(...args); children.push(child); return child; },
  } });
  t.after(async () => { for (const child of children) await killAndWait(child); });
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const gate = gateDouble(plan);
  // This composition succeeds (the fixture reports the real policy digest) but its children
  // ignore `stop`, so close cannot confirm the exit.
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gate }, { metadata: async () => metadata(), freeListeners: listeners });
  assert.deepEqual(service.freeListenerStates(), { relay: 'running', gateway: 'running' });
  await assert.rejects(service.close(), error => error.code === 'uncertain-stop' || /did not exit/.test(error.message));
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), true,
    'uncertain listener stop keeps task-home ownership');
  const retained = await listenerLocks(f.home);
  assert.equal(retained.length, 2, 'both unconfirmed listeners keep ownership');
  assert.equal(await portAccepts(relayPort), true, 'the unconfirmed children still hold their ports');
  assert.equal(await portAccepts(gatewayPort), true);
  // A second composition is refused at the still-held task-home owner lock.
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gate }, { metadata: async () => metadata(), freeListeners: { ...listeners, supervisor: {} } }),
  error => error.code === 'unavailable' && /another service owns/.test(error.message));
  // Only an operator-verified stop may release each listener lock.
  for (const child of children) await killAndWait(child);
  await until(async () => !(await portAccepts(relayPort)) && !(await portAccepts(gatewayPort)));
  const { reconcileListenerLock } = await import('../src/listener-supervisor.mjs');
  for (const name of retained) {
    const record = JSON.parse(readFileSync(join(f.home, 'listeners', name), 'utf8'));
    assert.equal(await portAccepts(relayPort), false);
    await reconcileListenerLock({ home: f.home, name: record.name, token: record.token,
      pid: record.pid, confirmedStopped: true });
  }
  assert.deepEqual(await listenerLocks(f.home), []);
});

test('B30-04: an unconfirmable stop during failed-startup cleanup keeps the task-home owner', async t => {
  const f = fixture(t);
  const children = [];
  // Occupy the relay port so the relay child cannot bind and the launch fails after the
  // gateway has already started.
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const relayPort = blocker.address().port;
  const gatewayPort = await freePort();
  const originPort = await freePort();
  const listeners = { relayPort, gatewayPort, gatewayOrigin: `http://127.0.0.1:${originPort}`, limits: LIMITS,
    supervisor: { entry: FIXTURE, env: { B30_FIXTURE_MODE: 'ignore-stop-valid' },
      readyTimeoutMs: 10_000, stopTimeoutMs: 300, killTimeoutMs: 300, terminate: () => {},
      fork: (...args) => { const child = fork(...args); children.push(child); return child; } } };
  t.after(async () => { for (const child of children) await killAndWait(child); });
  const plan = freeListenerPlan(listeners);
  const approvalFile = await approvalAt(f);
  const gate = gateDouble(plan);
  // The gateway starts, the relay cannot bind, and the gateway ignores the cleanup `stop`.
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gate }, { metadata: async () => metadata(), freeListeners: listeners }),
  error => error.code === 'uncertain-stop' || /did not exit/.test(error.message));
  assert.equal(children.length, 2, 'both children were spawned before the launch failure');
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), true,
    'unconfirmed cleanup keeps task-home ownership');
  const retained = await listenerLocks(f.home);
  assert.equal(retained.length, 1, 'only the started gateway keeps its listener lock');
  assert.equal(await portAccepts(gatewayPort), true, 'the unconfirmed gateway still holds its port');
  // The retained owner lock refuses a second composition before it spawns anything.
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig(f), approvalFile,
    admission: gate }, { metadata: async () => metadata(), freeListeners: { ...listeners, supervisor: {} } }),
  error => error.code === 'unavailable' && /another service owns/.test(error.message));
  assert.equal(children.length, 2);
  for (const child of children) await killAndWait(child);
  await until(async () => !(await portAccepts(gatewayPort)));
  const { reconcileListenerLock } = await import('../src/listener-supervisor.mjs');
  for (const name of retained) {
    const record = JSON.parse(readFileSync(join(f.home, 'listeners', name), 'utf8'));
    await reconcileListenerLock({ home: f.home, name: record.name, token: record.token,
      pid: record.pid, confirmedStopped: true });
  }
  assert.deepEqual(await listenerLocks(f.home), []);
});

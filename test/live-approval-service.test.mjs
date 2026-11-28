import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTaskStore } from '../src/tasks.mjs';
import { createTaskService, ServiceError } from '../src/service.mjs';
import { FREE_MODEL, FREE_ENDPOINT } from '../src/free-provider.mjs';
import { LIVE_NAMESPACE, canonical, canonicalApprovalBytes, openApprovalLedger,
  locateSshKeygen, createSignedApprovalAdmission, liveRequestHash, measureHostBinaryDigest } from '../src/live-approval.mjs';

// The SSHSIG cryptographic positive path needs a real FIDO2 hardware key and is therefore
// `not_run`. This suite exercises the service admission *mechanism* (ordering, replay
// preservation, before-persistence refusal, error mapping) with a clearly-labelled mock,
// and the real factory's negative (refusal) paths with disposable test-only keys or
// structurally-invalid approvals. No hardware signing is simulated or claimed.

const SSH = locateSshKeygen();
const hasSsh = SSH !== null;
const PRINCIPAL = 'maintainer';

const digestOf = value => createHash('sha256').update(canonical(value)).digest('hex');

const NOW = 5_000_000;

function initGitRepo(dir) {
  execFileSync('git', ['init', dir], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test Runner'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'Initial commit'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'branch', '-M', 'main'], { stdio: 'ignore', windowsHide: true });
}

const taskFiles = dir => readdirSync(join(dir, 'tasks')).filter(name => name.endsWith('.json'));

function resolveCommit(dir, ref = 'main') {
  return execFileSync('git', ['-C', dir, 'rev-parse', ref], { encoding: 'utf8', windowsHide: true }).trim();
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-approval-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The repository doubles as the task-store home so repository validation (a real git repo)
// and task persistence share the temp dir, matching the task-service test layout.
// `extra` may be a plain object or a `(dir) => object` factory so admission options can
// close over the freshly created temp directory.
function makeService(t, overrides = {}) {
  const dir = fixture(t);
  initGitRepo(dir);
  const store = openTaskStore({ home: dir });
  const extra = typeof overrides.extra === 'function' ? overrides.extra(dir) : (overrides.extra ?? {});
  const service = createTaskService({
    store,
    config: {
      clientId: 'opencode-primary',
      authorization: { models: ['mock/a'], tools: ['read', 'edit'], writableRoots: [dir] },
      limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
    },
    now: overrides.now ?? NOW,
    ...extra,
  });
  t.after(() => service.close());
  return { dir, store, service };
}

const validRequest = (dir, overrides = {}) => ({
  idempotencyKey: 'goal-1',
  clientId: 'opencode-primary',
  objective: 'Add a regression test',
  acceptanceCriteria: ['node --test passes'],
  repository: { path: dir, baseRef: 'main', branch: 'task/example' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src'] },
  limits: { maxAttempts: 1, budgetMs: 60_000, maxOutputBytes: 65_536 },
  ...overrides,
});

const expected = code => error => error instanceof ServiceError && error.code === code;

// A structurally valid approval whose binding digests are computed from the passed
// request payload, metadata, policy digests and resolved commit, so only the signature
// gate (or a deliberately-invalid override) can refuse it.
function boundApproval(payload, { relayPolicyDigest, gatewayPolicyDigest, metadata, baseCommit, approvalId = 'approval-0001' } = {}) {
  return {
    schemaVersion: 1,
    approvalId,
    principal: PRINCIPAL,
    requestHash: liveRequestHash(payload),
    objective: payload.objective,
    model: FREE_MODEL,
    endpoint: FREE_ENDPOINT,
    repository: { baseRef: baseCommit, branch: payload.repository.branch },
    privacyAcknowledged: true,
    paidBudgetUSD: 0,
    maxAttempts: 1,
    limits: { budgetMs: payload.limits.budgetMs, maxOutputBytes: payload.limits.maxOutputBytes, maxRequests: 12 },
    issuedAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    hostBinaryDigest: 'c'.repeat(64),
    relayPolicyDigest,
    gatewayPolicyDigest,
    metadataDigest: digestOf(metadata),
  };
}

const freshMetadata = () => ({ observedAt: NOW, cost: { text: { input: { price: 0 }, output: { price: 0 } } } });

// --- Service admission mechanism (mock admission, no hardware) -------------------------

test('a passive service without admission accepts a plain request and ignores approval fields', t => {
  const { dir, service } = makeService(t);
  const result = service.submitTask(validRequest(dir));
  assert.equal(result.idempotentReplay, false);
  assert.equal(taskFiles(dir).length, 1);
});

test('admission runs for a new task, after replay resolution and before persistence', t => {
  const calls = [];
  const { dir, service, store } = makeService(t, {
    extra: { admission: (payload, { taskId }) => { calls.push({ taskId, requestHash: liveRequestHash(payload) }); return { admitted: true, revalidate() {} }; } },
  });
  const result = service.submitTask(validRequest(dir));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskId, result.taskId);
  // The admitted task record carries the same pre-generated taskId.
  assert.equal(store.readTask(result.taskId).taskId, result.taskId);
  // The persisted request must not retain the approval envelope (stripped from storage).
  assert.equal(store.readTask(result.taskId).request.approval, undefined);
  assert.equal(store.readTask(result.taskId).request.signature, undefined);
});

test('an identical replay returns the original task without re-running admission', t => {
  let calls = 0;
  const { dir, service } = makeService(t, { extra: { admission: () => { calls += 1; return { admitted: true, revalidate() {} }; } } });
  const first = service.submitTask(validRequest(dir));
  assert.equal(calls, 1);
  const replay = service.submitTask(validRequest(dir));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.taskId, first.taskId);
  assert.equal(calls, 1, 'replay must not re-run admission');
  assert.equal(taskFiles(dir).length, 1);
});

test('an admission refusal happens before persistence and leaves no task record', t => {
  const { dir, service } = makeService(t, {
    extra: { admission: () => { throw new ServiceError('authorization_denied', 'refused'); } },
  });
  assert.throws(() => service.submitTask(validRequest(dir)), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 0, 'refused submission must not persist a task');
});

test('admission error codes map to contract codes without leaking admission internals', t => {
  for (const [code, mapped] of [['authorization_denied', 'authorization_denied'], ['invalid_argument', 'invalid_argument'], ['unavailable', 'unavailable']]) {
    const { dir, service } = makeService(t, {
      extra: { admission: () => { const e = new Error('detail'); e.code = code; throw e; } },
    });
    assert.throws(() => service.submitTask(validRequest(dir)), expected(mapped));
    assert.equal(taskFiles(dir).length, 0);
  }
});

test('a resolving async admission is rejected as an internal service error', t => {
  const { dir, service } = makeService(t, {
    extra: { admission: async () => {} },
  });
  assert.throws(() => service.submitTask(validRequest(dir)), expected('internal'));
  assert.equal(taskFiles(dir).length, 0);
});

test('a rejected async admission is observed while preserving refusal and clean close', async t => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const { dir, service } = makeService(t, {
    extra: { admission: async () => { throw new Error('fixture async verifier failed'); } },
  });
  assert.throws(() => service.submitTask(validRequest(dir)), expected('internal'));
  assert.equal(taskFiles(dir).length, 0, 'unsupported async admission must not persist');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, [], 'rejected admission must not leak an unhandled rejection');
  assert.equal(service.close(), undefined, 'the service must close normally after refusal');
});

test('a rejected thenable admission is observed and refused before persistence', async t => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const { dir, service } = makeService(t, {
    extra: { admission: () => ({
      then(_resolve, reject) { reject(new Error('fixture thenable verifier failed')); },
    }) },
  });
  assert.throws(() => service.submitTask(validRequest(dir)), expected('internal'));
  assert.equal(taskFiles(dir).length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
  assert.equal(service.close(), undefined);
});

test('a rejected async worker validateSubmission is observed and refused before persistence', async t => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const { dir, service } = makeService(t, {
    extra: { worker: {
      validateSubmission: async () => { throw new Error('fixture worker verifier failed'); },
      prepare() { throw new Error('worker must not be prepared after validation refusal'); },
    } },
  });
  assert.throws(() => service.submitTask(validRequest(dir)), expected('internal'));
  assert.equal(taskFiles(dir).length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
  await assert.doesNotReject(service.close());
});

test('admission results lacking admitted:true and a callable revalidate are refused before persistence', t => {
  const bad = [false, true, undefined, null, { admitted: true }, { revalidate() {} }, { admitted: false, revalidate() {} }];
  for (const value of bad) {
    const { dir, service } = makeService(t, { extra: { admission: () => value } });
    assert.throws(() => service.submitTask(validRequest(dir)), expected('authorization_denied'));
    assert.equal(taskFiles(dir).length, 0, `return ${JSON.stringify(value)} must not persist a task`);
  }
});

// --- Real factory negative (refusal) paths, no hardware needed ------------------------

const RELAY = 'd'.repeat(64);
const GATEWAY = 'e'.repeat(64);
// The real factory now measures the trusted host executable itself (never a caller-supplied
// digest). For refusal-path tests the factory is given a disposable host executable whose
// digest may differ from the approval's, because the structural/signature refusal fires
// before the host binding is reached.
function makeHostExecutable(dir) {
  const path = join(dir, 'host-exe');
  writeFileSync(path, 'fixture-host-binary');
  return path;
}
const hostIdentity = dir => ({ hostExecutable: makeHostExecutable(dir) });

test('the real factory refuses a submission with no approval envelope before persistence', t => {
  const { dir, service } = makeService(t, {
    extra: d => ({
      admission: createSignedApprovalAdmission({
        allowedSigners: 'principal namespaces="x" ssh-ed25519 AAA', principal: PRINCIPAL,
        relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(),
        ledger: openApprovalLedger({ home: join(d, 'ledger') }),
        ...hostIdentity(d),
      }),
    }),
  });
  assert.throws(() => service.submitTask(validRequest(dir)), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 0);
});

test('the real factory measures the host executable itself and refuses an unreadable path', t => {
  const { dir, service } = makeService(t, {
    extra: d => ({
      admission: createSignedApprovalAdmission({
        allowedSigners: 'p namespaces="x" ssh-ed25519 AAA', principal: PRINCIPAL,
        relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(),
        ledger: openApprovalLedger({ home: join(d, 'ledger') }),
        hostExecutable: join(d, 'does-not-exist'),
      }),
    }),
  });
  const payload = validRequest(dir);
  const approval = boundApproval(payload, { relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(), baseCommit: resolveCommit(dir) });
  // measure() runs before the signature gate; an unreadable path must fail as unavailable,
  // proving the factory derives the digest from the executable file, never a caller digest.
  assert.throws(() => service.submitTask({ ...payload, approval, signature: '-----BEGIN SSH SIGNATURE-----\nAA==\n-----END SSH SIGNATURE-----\n' }), expected('unavailable'));
  assert.equal(taskFiles(dir).length, 0);
});

test('the real factory refuses an expired approval before persistence', t => {
  const { dir, service } = makeService(t, {
    extra: d => ({
      admission: createSignedApprovalAdmission({
        allowedSigners: 'p namespaces="x" ssh-ed25519 AAA', principal: PRINCIPAL,
        relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(),
        ledger: openApprovalLedger({ home: join(d, 'ledger') }),
        ...hostIdentity(d),
      }),
    }),
  });
  const payload = validRequest(dir);
  const approval = { ...boundApproval(payload, { relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(), baseCommit: resolveCommit(dir) }), expiresAt: NOW - 1 };
  assert.throws(() => service.submitTask({ ...payload, approval, signature: '-----BEGIN SSH SIGNATURE-----\nAA==\n-----END SSH SIGNATURE-----\n' }), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 0);
});

test('the real factory refuses a paid approval before persistence', t => {
  const { dir, service } = makeService(t, {
    extra: d => ({
      admission: createSignedApprovalAdmission({
        allowedSigners: 'p namespaces="x" ssh-ed25519 AAA', principal: PRINCIPAL,
        relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(),
        ledger: openApprovalLedger({ home: join(d, 'ledger') }),
        ...hostIdentity(d),
      }),
    }),
  });
  const payload = validRequest(dir);
  const approval = { ...boundApproval(payload, { relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(), baseCommit: resolveCommit(dir) }), paidBudgetUSD: 1 };
  assert.throws(() => service.submitTask({ ...payload, approval, signature: '-----BEGIN SSH SIGNATURE-----\nAA==\n-----END SSH SIGNATURE-----\n' }), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 0);
});

test('the real factory refuses a non-hardware signature before the ledger reserves', { skip: !hasSsh }, t => {
  const dir = fixture(t);
  initGitRepo(dir);
  const keyPath = join(dir, 'testkey');
  execFileSync(SSH, ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath, '-C', ''], { windowsHide: true });
  const pubKey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
  const allowedSigners = join(dir, 'allowed_signers');
  writeFileSync(allowedSigners, `${PRINCIPAL} namespaces="${LIVE_NAMESPACE}" ${pubKey}\n`, 'utf8');

  const payload = validRequest(dir);
  const metadata = freshMetadata();
  const approval = boundApproval(payload, { relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata, baseCommit: resolveCommit(dir) });
  const dataPath = join(dir, 'approval.json');
  writeFileSync(dataPath, canonicalApprovalBytes(approval));
  execFileSync(SSH, ['-Y', 'sign', '-f', keyPath, '-n', LIVE_NAMESPACE, dataPath], { windowsHide: true });
  const signature = readFileSync(`${dataPath}.sig`, 'utf8');

  const ledger = openApprovalLedger({ home: join(dir, 'ledger') });
  const store = openTaskStore({ home: dir });
  const service = createTaskService({
    store,
    config: { clientId: 'opencode-primary', authorization: { models: ['mock/a'], tools: ['read', 'edit'], writableRoots: [dir] }, limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 } },
    now: NOW,
    admission: createSignedApprovalAdmission({ allowedSigners, principal: PRINCIPAL, relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata, ledger, sshKeygen: SSH, ...hostIdentity(dir) }),
  });
  t.after(() => service.close());

  // A cryptographically-valid ed25519 signature still lacks FIDO2 presence/verification.
  assert.throws(() => service.submitTask({ ...payload, approval, signature }), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 0, 'no task persisted');
  assert.equal(ledger.lookup('approval-0001'), undefined, 'refused signature never reserves the ID');
});

// --- Single-use across the service via the real ledger (mock verifier, no hardware) ---

test('single-use: one approval ID admits exactly one task; a second key is refused', t => {
  const dir = fixture(t);
  initGitRepo(dir);
  const ledger = openApprovalLedger({ home: join(dir, 'ledger') });
  const store = openTaskStore({ home: dir });
  const admission = (payload, { taskId }) => {
    const approvalId = payload.approval?.approvalId;
    if (approvalId === undefined) { const e = new Error('missing approval'); e.code = 'authorization_denied'; throw e; }
    // Real durable single-use ledger; only the hardware signature check is not exercised.
    ledger.reserve({ approvalId, taskId });
    return { admitted: true, revalidate() {} };
  };
  const service = createTaskService({
    store,
    config: { clientId: 'opencode-primary', authorization: { models: ['mock/a'], tools: ['read', 'edit'], writableRoots: [dir] }, limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 } },
    now: NOW,
    admission,
  });
  t.after(() => service.close());

  const first = service.submitTask({ ...validRequest(dir), approval: { approvalId: 'approval-shared' }, signature: 'sig' });
  assert.equal(first.idempotentReplay, false);
  assert.equal(taskFiles(dir).length, 1);
  // The approval envelope is excluded from the canonical payload and never persisted.
  assert.equal(store.readTask(first.taskId).request.approval, undefined);
  assert.equal(store.readTask(first.taskId).request.signature, undefined);

  // Identical replay: service idempotency resolves before admission, so the ledger is not
  // consulted again and the original task is returned.
  const replay = service.submitTask({ ...validRequest(dir), approval: { approvalId: 'approval-shared' }, signature: 'sig' });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.taskId, first.taskId);

  // Different idempotencyKey (a distinct task) reusing the same approval ID is refused and
  // never persisted, because the ledger binds the approval ID to the first taskId.
  assert.throws(() => service.submitTask({ ...validRequest(dir), idempotencyKey: 'goal-2', approval: { approvalId: 'approval-shared' }, signature: 'sig' }), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 1, 'the second task must not be persisted');
});

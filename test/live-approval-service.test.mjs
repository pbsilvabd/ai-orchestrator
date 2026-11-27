import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTaskStore } from '../src/tasks.mjs';
import { createTaskService, ServiceError } from '../src/service.mjs';
import { FREE_MODEL, FREE_ENDPOINT } from '../src/free-provider.mjs';
import { LIVE_NAMESPACE, LIVE_APPROVAL_SCHEMA_VERSION, FIDO2_SSH_PROFILE, SOFTWARE_SSH_PROFILE,
  canonical, canonicalApprovalBytes, openApprovalLedger,
  locateSshKeygen, createSignedApprovalAdmission, liveRequestHash, measureHostBinaryDigest } from '../src/live-approval.mjs';

// The software SSHSIG positive path uses disposable temporary keys and real OpenSSH
// verification. FIDO2 hardware signing remains `not_run`; synthesized signatures are used
// only to test parser/refusal behavior, never claimed as hardware evidence. This suite also
// covers admission ordering, replay, before-persistence refusal, error mapping and factory
// binding.

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
function boundApproval(payload, { relayPolicyDigest, gatewayPolicyDigest, metadata, baseCommit,
  approvalId = 'approval-0001', signatureProfile = FIDO2_SSH_PROFILE,
  hostBinaryDigest = 'c'.repeat(64) } = {}) {
  return {
    schemaVersion: LIVE_APPROVAL_SCHEMA_VERSION,
    signatureProfile,
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
    hostBinaryDigest,
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

test('an async admission is rejected as an internal service error', t => {
  const { dir, service } = makeService(t, {
    extra: { admission: async () => {} },
  });
  assert.throws(() => service.submitTask(validRequest(dir)), expected('internal'));
  assert.equal(taskFiles(dir).length, 0);
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

function signApproval(dir, keyPath, approval, namespace = LIVE_NAMESPACE) {
  const path = join(dir, 'approval.json');
  rmSync(`${path}.sig`, { force: true });
  writeFileSync(path, canonicalApprovalBytes(approval));
  execFileSync(SSH, ['-Y', 'sign', '-f', keyPath, '-n', namespace, path],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return readFileSync(`${path}.sig`, 'utf8');
}

test('the real factory refuses a submission with no approval envelope before persistence', t => {
  const { dir, service } = makeService(t, {
    extra: d => ({
      admission: createSignedApprovalAdmission({
        allowedSigners: 'principal namespaces="x" ssh-ed25519 AAA', principal: PRINCIPAL,
        relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(),
        ledger: openApprovalLedger({ home: join(d, 'ledger') }),
        approvalProfile: FIDO2_SSH_PROFILE,
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
        approvalProfile: FIDO2_SSH_PROFILE,
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
        approvalProfile: FIDO2_SSH_PROFILE,
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
        approvalProfile: FIDO2_SSH_PROFILE,
        ...hostIdentity(d),
      }),
    }),
  });
  const payload = validRequest(dir);
  const approval = { ...boundApproval(payload, { relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata: freshMetadata(), baseCommit: resolveCommit(dir) }), paidBudgetUSD: 1 };
  assert.throws(() => service.submitTask({ ...payload, approval, signature: '-----BEGIN SSH SIGNATURE-----\nAA==\n-----END SSH SIGNATURE-----\n' }), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 0);
});

test('B31-02/05: real software admission preserves envelope-free replay and refuses a re-signed second task', { skip: !hasSsh }, t => {
  const dir = fixture(t);
  initGitRepo(dir);
  const keyDir = mkdtempSync(join(tmpdir(), 'b31-operator-key-'));
  t.after(() => rmSync(keyDir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const keyPath = join(keyDir, 'testkey');
  execFileSync(SSH, ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath, '-C', ''], { windowsHide: true });
  const pubKey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
  const allowedSigners = join(dir, 'allowed_signers');
  writeFileSync(allowedSigners, `${PRINCIPAL} namespaces="${LIVE_NAMESPACE}" ${pubKey}\n`, 'utf8');
  const otherKey = join(keyDir, 'revoked-other-key');
  execFileSync(SSH, ['-q', '-t', 'ed25519', '-N', '', '-f', otherKey, '-C', ''], { windowsHide: true });
  const krl = join(dir, 'revoked.krl');
  execFileSync(SSH, ['-k', '-f', krl, `${otherKey}.pub`], { windowsHide: true });

  const payload = validRequest(dir);
  const metadata = freshMetadata();
  const hostExecutable = makeHostExecutable(dir);
  const approval = boundApproval(payload, { relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY,
    metadata, baseCommit: resolveCommit(dir), signatureProfile: SOFTWARE_SSH_PROFILE,
    hostBinaryDigest: measureHostBinaryDigest(hostExecutable) });
  const signature = signApproval(keyDir, keyPath, approval);

  const ledger = openApprovalLedger({ home: join(dir, 'ledger') });
  let reservationAttempts = 0;
  // Observe the real ledger without replacing either verification or persistence.
  const observedLedger = { reserve(input) { reservationAttempts++; return ledger.reserve(input); } };
  const store = openTaskStore({ home: dir });
  const service = createTaskService({
    store,
    config: { clientId: 'opencode-primary', authorization: { models: ['mock/a'], tools: ['read', 'edit'], writableRoots: [dir] }, limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 } },
    now: NOW,
    admission: createSignedApprovalAdmission({ allowedSigners, principal: PRINCIPAL,
      relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata, ledger: observedLedger,
      sshKeygen: SSH, approvalProfile: SOFTWARE_SSH_PROFILE, hostExecutable, krl }),
  });
  t.after(() => service.close());

  const result = service.submitTask({ ...payload, approval, signature });
  assert.equal(result.idempotentReplay, false);
  assert.equal(taskFiles(dir).length, 1, 'verified software-profile approval admits one task');
  assert.equal(ledger.lookup('approval-0001').taskId, result.taskId, 'real signature reaches the single-use ledger');
  const persistedTask = readFileSync(join(dir, 'tasks', taskFiles(dir)[0]), 'utf8');
  const privateKey = readFileSync(keyPath, 'utf8');
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const text = readFileSync(join(entry.parentPath, entry.name), 'utf8');
    assert.equal(text.includes(privateKey), false, 'private key bytes are absent from the service home');
    assert.equal(text.includes('BEGIN OPENSSH PRIVATE KEY'), false,
      'a JSON-escaped private key cannot evade the private-key check');
  }
  assert.equal(store.readTask(result.taskId).request.approval, undefined);
  assert.equal(store.readTask(result.taskId).request.signature, undefined);

  for (const request of [{ ...payload, approval, signature }, payload]) {
    const replay = service.submitTask(request);
    assert.equal(replay.idempotentReplay, true, 'replay needs no approval envelope');
    assert.equal(replay.taskId, result.taskId);
  }
  assert.equal(reservationAttempts, 1, 'replays bypass signature admission and reservation');
  const claimPath = join(dir, 'ledger', 'approvals', `${approval.approvalId}.json`);
  const claimBytes = readFileSync(claimPath);
  const secondPayload = validRequest(dir, { idempotencyKey: 'goal-2',
    objective: 'A distinct approved task',
    repository: { ...payload.repository, branch: 'task/second' } });
  const secondApproval = boundApproval(secondPayload, { relayPolicyDigest: RELAY,
    gatewayPolicyDigest: GATEWAY, metadata, baseCommit: resolveCommit(dir),
    signatureProfile: SOFTWARE_SSH_PROFILE,
    hostBinaryDigest: measureHostBinaryDigest(hostExecutable) });
  const secondSignature = signApproval(keyDir, keyPath, secondApproval);
  assert.throws(() => service.submitTask({ ...secondPayload,
    approval: secondApproval, signature: secondSignature }), expected('authorization_denied'));
  assert.equal(reservationAttempts, 2, 'the newly signed and bound request reaches the real single-use ledger');
  assert.deepEqual(readFileSync(claimPath), claimBytes, 'the original approval claim is not overwritten');
  assert.equal(readFileSync(join(dir, 'tasks', taskFiles(dir)[0]), 'utf8'), persistedTask);
  assert.equal(taskFiles(dir).length, 1);
  assert.equal(readdirSync(join(dir, 'idempotency')).length, 1);
  assert.deepEqual(store.readTask(result.taskId).attempts, [], 'passive admission never dispatches');
  assert.equal(existsSync(join(dir, 'workspaces')), false);
  assert.equal(execFileSync('git', ['-C', dir, 'branch', '--list', 'task/*'],
    { encoding: 'utf8', windowsHide: true }).trim(), '', 'admission creates no task branches');
});

test('B31-01/03: real signed software refusals leave no task, index, workspace, branch or claim',
  { skip: !hasSsh }, async t => {
    const keyDir = mkdtempSync(join(tmpdir(), 'b31-refusal-keys-'));
    t.after(() => rmSync(keyDir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
    const keyPath = join(keyDir, 'signer');
    const otherKey = join(keyDir, 'other');
    for (const path of [keyPath, otherKey])
      execFileSync(SSH, ['-q', '-t', 'ed25519', '-N', '', '-f', path, '-C', ''], { windowsHide: true });
    const cases = [
      { name: 'missing signed profile', code: 'invalid_argument', change(a) { delete a.signatureProfile; } },
      { name: 'unknown signed profile', code: 'invalid_argument', change(a) { a.signatureProfile = 'auto'; } },
      { name: 'schema v1', code: 'invalid_argument', change(a) { a.schemaVersion = 1; } },
      { name: 'trusted profile mismatch', change(a) { a.signatureProfile = FIDO2_SSH_PROFILE; } },
      { name: 'wrong signer', key: otherKey },
      { name: 'wrong namespace', namespace: 'wrong-namespace' },
      { name: 'changed signed bytes', tamper: true },
      { name: 'signed expired approval', change(a) { a.expiresAt = NOW - 1; } },
      { name: 'revoked signer', revoked: true },
    ];
    for (const scenario of cases) await t.test(scenario.name, t => {
      let ledger;
      let metadata;
      let hostExecutable;
      let reservationAttempts = 0;
      const { dir, service } = makeService(t, { extra: dir => {
        const allowedSigners = join(dir, 'allowed_signers');
        writeFileSync(allowedSigners,
          `${PRINCIPAL} namespaces="${LIVE_NAMESPACE}" ${readFileSync(`${keyPath}.pub`, 'utf8').trim()}\n`);
        const krl = join(dir, 'revoked.krl');
        execFileSync(SSH, ['-k', '-f', krl, `${scenario.revoked ? keyPath : otherKey}.pub`],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        ledger = openApprovalLedger({ home: join(dir, 'ledger') });
        metadata = freshMetadata();
        hostExecutable = makeHostExecutable(dir);
        return { admission: createSignedApprovalAdmission({
          allowedSigners, principal: PRINCIPAL, krl, relayPolicyDigest: RELAY,
          gatewayPolicyDigest: GATEWAY, metadata, hostExecutable, sshKeygen: SSH,
          approvalProfile: SOFTWARE_SSH_PROFILE,
          ledger: { reserve(input) { reservationAttempts++; return ledger.reserve(input); } },
        }) };
      } });
      const payload = validRequest(dir);
      const approval = boundApproval(payload, { relayPolicyDigest: RELAY,
        gatewayPolicyDigest: GATEWAY, metadata, baseCommit: resolveCommit(dir),
        signatureProfile: SOFTWARE_SSH_PROFILE,
        hostBinaryDigest: measureHostBinaryDigest(hostExecutable) });
      scenario.change?.(approval);
      const signature = signApproval(keyDir, scenario.key ?? keyPath, approval, scenario.namespace);
      if (scenario.tamper) approval.objective += ' altered after signing';
      assert.throws(() => service.submitTask({ ...payload, approval, signature }),
        expected(scenario.code ?? 'authorization_denied'));
      assert.equal(reservationAttempts, 0, 'refusal precedes even an attempted reservation');
      assert.equal(ledger.lookup(approval.approvalId), undefined);
      assert.deepEqual(readdirSync(join(dir, 'ledger', 'approvals')), []);
      assert.deepEqual(taskFiles(dir), []);
      assert.deepEqual(readdirSync(join(dir, 'idempotency')), []);
      assert.equal(existsSync(join(dir, 'workspaces')), false);
      assert.equal(execFileSync('git', ['-C', dir, 'branch', '--list', 'task/*'],
        { encoding: 'utf8', windowsHide: true }).trim(), '');
      const worktrees = execFileSync('git', ['-C', dir, 'worktree', 'list', '--porcelain'],
        { encoding: 'utf8', windowsHide: true });
      assert.equal(worktrees.split('\n').filter(line => line.startsWith('worktree ')).length, 1);
    });
  });

test('B31-04: trusted FIDO2 refuses software keys with either signed profile before reservation', { skip: !hasSsh }, t => {
  const dir = fixture(t);
  initGitRepo(dir);
  const keyDir = mkdtempSync(join(tmpdir(), 'b31-operator-key-'));
  t.after(() => rmSync(keyDir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const keyPath = join(keyDir, 'testkey');
  execFileSync(SSH, ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath, '-C', ''], { windowsHide: true });
  const pubKey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
  const allowedSigners = join(dir, 'allowed_signers');
  writeFileSync(allowedSigners, `${PRINCIPAL} namespaces="${LIVE_NAMESPACE}" ${pubKey}\n`, 'utf8');

  const payload = validRequest(dir);
  const metadata = freshMetadata();
  const hostExecutable = makeHostExecutable(dir);
  const approval = boundApproval(payload, { relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY,
    metadata, baseCommit: resolveCommit(dir), signatureProfile: SOFTWARE_SSH_PROFILE,
    hostBinaryDigest: measureHostBinaryDigest(hostExecutable) });
  const ledger = openApprovalLedger({ home: join(dir, 'ledger') });
  const store = openTaskStore({ home: dir });
  const service = createTaskService({
    store,
    config: { clientId: 'opencode-primary', authorization: { models: ['mock/a'], tools: ['read', 'edit'], writableRoots: [dir] }, limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 } },
    now: NOW,
    admission: createSignedApprovalAdmission({ allowedSigners, principal: PRINCIPAL,
      relayPolicyDigest: RELAY, gatewayPolicyDigest: GATEWAY, metadata, ledger,
      sshKeygen: SSH, approvalProfile: FIDO2_SSH_PROFILE, hostExecutable }),
  });
  t.after(() => service.close());

  for (const signatureProfile of [SOFTWARE_SSH_PROFILE, FIDO2_SSH_PROFILE]) {
    const signedApproval = { ...approval, signatureProfile };
    const signature = signApproval(keyDir, keyPath, signedApproval);
    assert.throws(() => service.submitTask({ ...payload, approval: signedApproval, signature }),
      expected('authorization_denied'));
    assert.equal(taskFiles(dir).length, 0, 'profile mismatch or software key refuses before persistence');
    assert.equal(ledger.lookup('approval-0001'), undefined, 'neither refusal reserves the ID');
  }
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

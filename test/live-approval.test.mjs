import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FREE_MODEL, FREE_ENDPOINT } from '../src/free-provider.mjs';
import { LIVE_NAMESPACE, canonical, canonicalApprovalBytes, validateLiveApproval, verifyLiveApproval,
  verifyApprovalBinding, parseSshSig, securityKeyFlags, openApprovalLedger,
  locateSshKeygen, approvalDigest, admitLiveApproval, measureHostBinaryDigest } from '../src/live-approval.mjs';

const SSH = locateSshKeygen();
const PRINCIPAL = 'maintainer';
const digestOf = value => createHash('sha256').update(canonical(value)).digest('hex');

function approval(overrides = {}) {
  const base = {
    schemaVersion: 1,
    approvalId: 'approval-0001',
    principal: PRINCIPAL,
    requestHash: 'a'.repeat(64),
    objective: 'Add a fixture regression test in src only',
    model: FREE_MODEL,
    endpoint: FREE_ENDPOINT,
    repository: { baseRef: 'b'.repeat(40), branch: 'task/fixture' },
    privacyAcknowledged: true,
    paidBudgetUSD: 0,
    maxAttempts: 1,
    limits: { budgetMs: 60_000, maxOutputBytes: 65_536, maxRequests: 12 },
    issuedAt: Date.now() - 60_000,
    expiresAt: Date.now() + 60_000,
    hostBinaryDigest: 'c'.repeat(64),
    relayPolicyDigest: 'd'.repeat(64),
    gatewayPolicyDigest: 'e'.repeat(64),
    metadataDigest: 'f'.repeat(64),
  };
  return { ...base, ...overrides };
}

function ssh(args, input) {
  return execFileSync(SSH, args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1_048_576 });
}

// Generate a disposable test-only ed25519 key. Never a real maintainer key.
function generateKey(dir, name = 'testkey') {
  const keyPath = join(dir, name);
  ssh(['-q', '-t', 'ed25519', '-N', '', '-f', keyPath, '-C', '']);
  return { keyPath, pubKey: readFileSync(`${keyPath}.pub`, 'utf8').trim() };
}

function writeAllowedSigners(dir, principal, pubKey) {
  const path = join(dir, 'allowed_signers');
  writeFileSync(path, `${principal} namespaces="${LIVE_NAMESPACE}" ${pubKey}\n`, 'utf8');
  return path;
}

function sign(dir, keyPath, namespace, dataPath) {
  const sigPath = `${dataPath}.sig`;
  ssh(['-Y', 'sign', '-f', keyPath, '-n', namespace, dataPath]);
  return readFileSync(sigPath, 'utf8');
}

function makeSkSignature(flags) {
  // Synthesized FIDO2/sk inner signature blob: sig_type, key_blob, flags, counter, sig.
  const parts = [];
  parts.push(sshString('sk-ssh-ed25519@openssh.com'));
  parts.push(sshString('sk-key'));
  parts.push(Buffer.from([flags]));
  const counter = Buffer.alloc(4); counter.writeUInt32BE(0);
  parts.push(counter);
  parts.push(sshString('sig'));
  return Buffer.concat(parts);
}

function sshString(s) {
  const b = Buffer.from(s);
  const l = Buffer.alloc(4); l.writeUInt32BE(b.length);
  return Buffer.concat([l, b]);
}

const hasSsh = SSH !== null;

test('SSHSIG plumbing: ssh-keygen -Y sign and -Y verify round-trip byte-for-byte', { skip: !hasSsh }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-ssh-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const { keyPath, pubKey } = generateKey(dir);
  const allowed = writeAllowedSigners(dir, PRINCIPAL, pubKey);
  const dataPath = join(dir, 'approval.json');
  writeFileSync(dataPath, canonicalApprovalBytes(approval()));

  const armored = sign(dir, keyPath, LIVE_NAMESPACE, dataPath);
  assert.match(armored, /BEGIN SSH SIGNATURE/);
  // Verified through the same ssh-keygen path the service uses.
  ssh(['-Y', 'verify', '-f', allowed, '-I', PRINCIPAL, '-n', LIVE_NAMESPACE, '-s', `${dataPath}.sig`],
    readFileSync(dataPath));
  const parsed = parseSshSig(armored);
  assert.equal(parsed.namespace, LIVE_NAMESPACE);
  assert.equal(parsed.version, 1);
});

test('SSHSIG plumbing: wrong namespace, wrong signer, edited bytes and revoked key are refused', { skip: !hasSsh }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-ssh-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const { keyPath, pubKey } = generateKey(dir);
  const other = generateKey(dir, 'otherkey');
  const allowed = writeAllowedSigners(dir, PRINCIPAL, pubKey);
  const dataPath = join(dir, 'approval.json');
  writeFileSync(dataPath, canonicalApprovalBytes(approval()));
  const armored = sign(dir, keyPath, LIVE_NAMESPACE, dataPath);
  const sigPath = `${dataPath}.sig`;

  assert.throws(() => ssh(['-Y', 'verify', '-f', allowed, '-I', PRINCIPAL, '-n', 'wrong-namespace', '-s', sigPath], readFileSync(dataPath)));
  // Wrong signer: allowed_signers lists pubKey; verify against a different identity.
  const wrongAllowed = join(dir, 'wrong_allowed');
  writeFileSync(wrongAllowed, `${PRINCIPAL} namespaces="${LIVE_NAMESPACE}" ${other.pubKey}\n`);
  assert.throws(() => ssh(['-Y', 'verify', '-f', wrongAllowed, '-I', PRINCIPAL, '-n', LIVE_NAMESPACE, '-s', sigPath], readFileSync(dataPath)));

  // Edited bytes.
  writeFileSync(dataPath, Buffer.concat([readFileSync(dataPath), Buffer.from('x')]));
  assert.throws(() => ssh(['-Y', 'verify', '-f', allowed, '-I', PRINCIPAL, '-n', LIVE_NAMESPACE, '-s', sigPath], readFileSync(dataPath)));

  // Revoked key (KRL).
  writeFileSync(dataPath, canonicalApprovalBytes(approval()));
  const krl = join(dir, 'krl');
  ssh(['-k', '-f', krl, `${keyPath}.pub`]);
  assert.throws(() => ssh(['-Y', 'verify', '-f', allowed, '-I', PRINCIPAL, '-n', LIVE_NAMESPACE, '-s', sigPath, '-r', krl], readFileSync(dataPath)));
});

test('securityKeyFlags: null for non-sk keys, exact flags for sk signatures', () => {
  // An ed25519 signature is not a security-key signature: no presence/verification.
  const ed25519Blob = Buffer.concat([sshString('ssh-ed25519'), sshString('sig')]);
  assert.equal(securityKeyFlags(ed25519Blob), null);
  const flags = securityKeyFlags(makeSkSignature(0x05));
  assert.deepEqual(flags, { userPresence: true, userVerification: true });
  const presenceOnly = securityKeyFlags(makeSkSignature(0x01));
  assert.deepEqual(presenceOnly, { userPresence: true, userVerification: false });
  const neither = securityKeyFlags(makeSkSignature(0x00));
  assert.deepEqual(neither, { userPresence: false, userVerification: false });
});

test('B30-05: a non-hardware (non-sk) signature is refused for live approval', { skip: !hasSsh }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-ssh-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const { keyPath, pubKey } = generateKey(dir);
  const allowed = writeAllowedSigners(dir, PRINCIPAL, pubKey);
  const dataPath = join(dir, 'approval.json');
  writeFileSync(dataPath, canonicalApprovalBytes(approval()));
  const armored = sign(dir, keyPath, LIVE_NAMESPACE, dataPath);
  // The ed25519 signature cryptographically verifies, but proves no presence/verification.
  assert.throws(() => verifyLiveApproval({ approval: approval(), signature: armored,
    allowedSigners: allowed, principal: PRINCIPAL, krl: '', sshKeygen: SSH }), /presence and verification/);
});

test('B30-05: a signature that carries sk flags still requires real ssh-keygen verification', { skip: !hasSsh }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-ssh-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const { pubKey } = generateKey(dir);
  const allowed = writeAllowedSigners(dir, PRINCIPAL, pubKey);
  // A forged SSHSIG armor whose inner signature looks like an sk signature with
  // presence+verification flags: the flag gate passes, then cryptographic
  // verification must refuse it (it is not a real maintainer signature).
  const fake = Buffer.concat([
    Buffer.from('SSHSIG'),
    (() => { const v = Buffer.alloc(4); v.writeUInt32BE(1); return v; })(),
    sshString('ssh-ed25519'),
    sshString(LIVE_NAMESPACE),
    sshString(''),
    sshString('sha512'),
    sshString(makeSkSignature(0x05)),
  ]).toString('base64');
  const armored = `-----BEGIN SSH SIGNATURE-----\n${fake}\n-----END SSH SIGNATURE-----\n`;
  assert.throws(() => verifyLiveApproval({ approval: approval(), signature: armored,
    allowedSigners: allowed, principal: PRINCIPAL, krl: '', sshKeygen: SSH }), /verification failed/);
});

test('B30-05: canonical approval rejects unknown fields, expiry, paid budget, multiple attempts', () => {
  assert.doesNotThrow(() => validateLiveApproval(approval()));
  assert.throws(() => validateLiveApproval({ ...approval(), extra: 1 }), /unknown or missing/);
  assert.throws(() => validateLiveApproval(approval({ expiresAt: Date.now() - 1 })), /expired/);
  assert.throws(() => validateLiveApproval(approval({ expiresAt: Date.now() + 20 * 60 * 1000, issuedAt: Date.now() })), /15 minutes/);
  assert.throws(() => validateLiveApproval(approval({ paidBudgetUSD: 1 })), /zero-paid/);
  assert.throws(() => validateLiveApproval(approval({ maxAttempts: 2 })), /one attempt/);
  assert.throws(() => validateLiveApproval(approval({ model: 'provider/other' })), /fixed free model/);
  assert.throws(() => validateLiveApproval(approval({ endpoint: 'https://evil.invalid/v1' })), /fixed endpoint/);
});

test('B30-05: approval binding refuses policy drift, stale or paid metadata', () => {
  const metadata = { observedAt: Date.now(), cost: { text: { input: { price: 0 }, output: { price: 0 } } } };
  const a = approval({ metadataDigest: digestOf(metadata) });
  const baseCommit = 'b'.repeat(40);
  const hostBinaryDigest = 'c'.repeat(64);
  const request = { objective: a.objective, repository: { branch: a.repository.branch },
    limits: { maxAttempts: a.maxAttempts, budgetMs: a.limits.budgetMs, maxOutputBytes: a.limits.maxOutputBytes } };
  assert.doesNotThrow(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest,
    maxRequests: 12, metadata: { ...metadata } }));
  const oneRequestApproval = approval({ ...a, limits: { ...a.limits, maxRequests: 1 } });
  assert.doesNotThrow(() => verifyApprovalBinding({ approval: oneRequestApproval,
    requestHash: oneRequestApproval.requestHash, baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: oneRequestApproval.relayPolicyDigest,
    gatewayPolicyDigest: oneRequestApproval.gatewayPolicyDigest, maxRequests: 1, metadata: { ...metadata } }));
  assert.throws(() => verifyApprovalBinding({ approval: oneRequestApproval,
    requestHash: oneRequestApproval.requestHash, baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: oneRequestApproval.relayPolicyDigest,
    gatewayPolicyDigest: oneRequestApproval.gatewayPolicyDigest, maxRequests: 12, metadata: { ...metadata } }),
  /below the effective listener policy/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: '0'.repeat(64),
     baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest, maxRequests: 12, metadata }), /bind the submitted/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: '0'.repeat(64), gatewayPolicyDigest: a.gatewayPolicyDigest, maxRequests: 12, metadata }), /relay policy drifted/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: '0'.repeat(64), maxRequests: 12, metadata }), /gateway policy drifted/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit: 'c'.repeat(40), request, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest, maxRequests: 12, metadata }), /base commit/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request: { ...request, objective: 'Different objective' }, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest, maxRequests: 12, metadata }), /objective/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request: { ...request, repository: { branch: 'task/other' } }, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest, maxRequests: 12, metadata }), /branch/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request: { ...request, limits: { ...request.limits, maxAttempts: 2 } }, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest, maxRequests: 12, metadata }), /attempt limit/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request, hostBinaryDigest: '0'.repeat(64),
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest, maxRequests: 12, metadata }), /host binary/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest,
    maxRequests: 12, metadata: { ...metadata, observedAt: Date.now() - 6 * 60 * 1000 } }), /stale/);
  assert.throws(() => verifyApprovalBinding({ approval: a, requestHash: a.requestHash,
    baseCommit, request, hostBinaryDigest,
    relayPolicyDigest: a.relayPolicyDigest, gatewayPolicyDigest: a.gatewayPolicyDigest,
    maxRequests: 12, metadata: { ...metadata, cost: { text: { input: { price: 1 }, output: { price: 0 } } } } }), /zero-price/);
});

test('B30-05: one approval ID cannot admit two tasks; identical replay is readable', t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const ledger = openApprovalLedger({ home: dir });
  const first = ledger.reserve({ approvalId: 'approval-0001', taskId: 'task-1111' });
  assert.equal(first.admitted, true);
  const replay = ledger.reserve({ approvalId: 'approval-0001', taskId: 'task-1111' });
  assert.equal(replay.replay, true);
  assert.equal(replay.taskId, 'task-1111');
  assert.throws(() => ledger.reserve({ approvalId: 'approval-0001', taskId: 'task-2222' }), /different task/);
  assert.equal(ledger.lookup('approval-0001').taskId, 'task-1111');
});

test('B30-05: a claim survives restart (a new ledger instance reads it, never re-admits)', t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  openApprovalLedger({ home: dir }).reserve({ approvalId: 'approval-0001', taskId: 'task-1111' });
  // New instance simulates a restart.
  const reopened = openApprovalLedger({ home: dir });
  assert.deepEqual(reopened.reserve({ approvalId: 'approval-0001', taskId: 'task-1111' }),
    { admitted: false, replay: true, taskId: 'task-1111' });
  assert.throws(() => reopened.reserve({ approvalId: 'approval-0001', taskId: 'task-2222' }), /different task/);
});

test('B30-05: approval ID is single-use across two competing processes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-claim-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const home = join(dir, 'home');
  const readyA = join(dir, 'ready-a');
  const readyB = join(dir, 'ready-b');
  const go = join(dir, 'go');
  const fixture = join(import.meta.dirname, 'fixtures', 'approval-claim.mjs');

  const runChild = (taskId, readyFile) => new Promise(resolve => {
    const child = spawn(process.execPath, [fixture, home, 'shared-id', taskId, readyFile, go],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', code => resolve({ code, out: out.trim(), err }));
  });

  const childA = runChild('task-A', readyA);
  const childB = runChild('task-B', readyB);
  const waitFor = async path => {
    const deadline = Date.now() + 10_000;
    while (!existsSync(path)) {
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${path}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  await waitFor(readyA);
  await waitFor(readyB);
  writeFileSync(go, 'go', 'utf8');

  const [a, b] = await Promise.all([childA, childB]);
  assert.equal(a.code, 0, a.err);
  assert.equal(b.code, 0, b.err);
  const resultA = JSON.parse(a.out);
  const resultB = JSON.parse(b.out);
  const admitted = [resultA, resultB].filter(r => r.ok && r.result?.admitted === true);
  assert.equal(admitted.length, 1, `exactly one process must admit; got ${JSON.stringify([resultA, resultB])}`);
  const losers = [resultA, resultB].filter(r => !(r.ok && r.result?.admitted === true));
  assert.equal(losers.length, 1);
  assert.equal(losers[0].ok, false);
  assert.equal(losers[0].code, 'authorization_denied');
});

test('measureHostBinaryDigest hashes the executable bytes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-host-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const path = join(dir, 'exe');
  writeFileSync(path, 'binary-bytes');
  assert.equal(measureHostBinaryDigest(path), createHash('sha256').update('binary-bytes').digest('hex'));
});

test('approval digest is stable over canonical bytes', () => {
  // Construct one approval once so the digest comparison uses the same timestamped bytes,
  // then compare against a spread copy and a deliberate field change. The previous form
  // called approval() twice, so a millisecond clock boundary made the hashes legitimately
  // differ (flaky, as seen on Ubuntu CI).
  const a = approval();
  assert.match(approvalDigest(a), /^[a-f0-9]{64}$/);
  assert.equal(approvalDigest(a), approvalDigest({ ...a }));
  assert.notEqual(approvalDigest(a), approvalDigest({ ...a, approvalId: 'approval-0002' }));
});

test('B30-05: admission verifies the signature before binding or reserving the ID', { skip: !hasSsh }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'b30-ssh-'));
  t.after(() => rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const { keyPath, pubKey } = generateKey(dir);
  const allowed = writeAllowedSigners(dir, PRINCIPAL, pubKey);
  const dataPath = join(dir, 'approval.json');
  writeFileSync(dataPath, canonicalApprovalBytes(approval()));
  const armored = sign(dir, keyPath, LIVE_NAMESPACE, dataPath);
  const ledger = openApprovalLedger({ home: join(dir, 'ledger') });
  // The non-sk signature is refused at the signature gate; the ledger is never reached.
  assert.throws(() => admitLiveApproval({ approval: approval(), signature: armored,
    allowedSigners: allowed, principal: PRINCIPAL, requestHash: 'a'.repeat(64),
    baseCommit: 'b'.repeat(40), relayPolicyDigest: 'd'.repeat(64), gatewayPolicyDigest: 'e'.repeat(64),
    metadata: { observedAt: Date.now(), cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
    taskId: 'task-1', ledger, sshKeygen: SSH }), /presence and verification/);
  assert.equal(ledger.lookup('approval-0001'), undefined);
});

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, linkSync, openSync,
  fsyncSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { FREE_MODEL, FREE_ENDPOINT } from './free-provider.mjs';
import { canonicalPayload } from './tasks.mjs';

// Offline signed live approval (B30/ADR-010). The maintainer signs the exact bytes of a
// strict canonical UTF-8 approval JSON with OpenSSH SSHSIG under a fixed namespace, using
// a FIDO2-backed SSH key that records user-presence and user-verification. Verification
// delegates the cryptographic check to `ssh-keygen -Y verify` against a single-principal
// `allowed_signers` file and a key-revocation list, then independently enforces the
// canonical field set, expiry, metadata freshness, policy digests, and the presence/
// verification flags parsed from the SSHSIG blob.
//
// This module verifies and reserves approvals; it does not create a maintainer key or
// perform live inference. A non-hardware (non-`-sk`) signature, or one missing the
// presence/verification flags, is always refused for live approval.

export class LiveApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LiveApprovalError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LiveApprovalError(code, message);
}

export const LIVE_NAMESPACE = 'ai-orchestrator-live@pbsilvabd';
export const LIVE_APPROVAL_SCHEMA_VERSION = 1;
const MAX_ISSUE_WINDOW_MS = 15 * 60 * 1000;
const METADATA_TTL_MS = 5 * 60 * 1000;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const APPROVAL_FIELDS = ['schemaVersion', 'approvalId', 'principal', 'requestHash', 'objective',
  'model', 'endpoint', 'repository', 'privacyAcknowledged', 'paidBudgetUSD', 'maxAttempts',
  'limits', 'issuedAt', 'expiresAt', 'hostBinaryDigest', 'relayPolicyDigest',
  'gatewayPolicyDigest', 'metadataDigest'];

const isTimestamp = value => Number.isInteger(value) && value >= 0;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('invalid_argument', 'approval contains an unsupported value');
  return encoded;
}

export function canonicalApprovalBytes(approval) {
  return Buffer.from(canonical(approval), 'utf8');
}

export function approvalDigest(approval) {
  return createHash('sha256').update(canonicalApprovalBytes(approval)).digest('hex');
}

// Strict structural validation: exact field set, types, bounds and no noncanonical keys.
export function validateLiveApproval(approval, now = Date.now()) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval))
    fail('invalid_argument', 'approval must be an object');
  if (Object.keys(approval).sort().join(',') !== APPROVAL_FIELDS.sort().join(','))
    fail('invalid_argument', 'approval has unknown or missing fields');
  const a = approval;
  if (a.schemaVersion !== LIVE_APPROVAL_SCHEMA_VERSION) fail('invalid_argument', 'unsupported approval schema');
  if (typeof a.approvalId !== 'string' || !IDENTIFIER.test(a.approvalId)) fail('invalid_argument', 'invalid approvalId');
  if (typeof a.principal !== 'string' || !IDENTIFIER.test(a.principal)) fail('invalid_argument', 'invalid principal');
  if (typeof a.requestHash !== 'string' || !DIGEST.test(a.requestHash)) fail('invalid_argument', 'invalid requestHash');
  if (typeof a.objective !== 'string' || !a.objective.trim() || a.objective.length > 4000) fail('invalid_argument', 'invalid objective');
  if (a.model !== FREE_MODEL) fail('authorization_denied', 'approval model is not the fixed free model');
  if (a.endpoint !== FREE_ENDPOINT) fail('authorization_denied', 'approval endpoint is not the fixed endpoint');
  if (!a.repository || typeof a.repository !== 'object' || Array.isArray(a.repository) ||
      !/^[a-f0-9]{40,64}$/.test(a.repository.baseRef ?? '') ||
      typeof a.repository.branch !== 'string' || !a.repository.branch || /[\s\x00-\x1f]/.test(a.repository.branch))
    fail('invalid_argument', 'approval repository is invalid');
  if (a.privacyAcknowledged !== true) fail('authorization_denied', 'approval lacks privacy acknowledgement');
  if (a.paidBudgetUSD !== 0) fail('authorization_denied', 'approval is not zero-paid');
  if (a.maxAttempts !== 1) fail('authorization_denied', 'approval must allow exactly one attempt');
  if (!a.limits || typeof a.limits !== 'object' || Array.isArray(a.limits) ||
      !Number.isInteger(a.limits.budgetMs) || a.limits.budgetMs < 1 || a.limits.budgetMs > 600_000 ||
      !Number.isInteger(a.limits.maxOutputBytes) || a.limits.maxOutputBytes < 0 || a.limits.maxOutputBytes > 1_048_576 ||
      !Number.isInteger(a.limits.maxRequests) || a.limits.maxRequests < 1 || a.limits.maxRequests > 12)
    fail('authorization_denied', 'approval limits are invalid');
  if (!isTimestamp(a.issuedAt) || !isTimestamp(a.expiresAt)) fail('invalid_argument', 'approval timestamps are invalid');
  if (a.expiresAt - a.issuedAt > MAX_ISSUE_WINDOW_MS) fail('invalid_argument', 'approval issue window exceeds 15 minutes');
  if (a.expiresAt <= now) fail('authorization_denied', 'approval is expired');
  for (const field of ['hostBinaryDigest', 'relayPolicyDigest', 'gatewayPolicyDigest', 'metadataDigest'])
    if (typeof a[field] !== 'string' || !DIGEST.test(a[field])) fail('invalid_argument', `invalid ${field}`);
}

// Minimal SSH wire-format reader over a Buffer.
function sshReader(buffer, offset = 0) {
  return {
    readU32() { if (offset + 4 > buffer.length) fail('invalid_argument', 'truncated SSH blob'); const v = buffer.readUInt32BE(offset); offset += 4; return v; },
    readByte() { if (offset + 1 > buffer.length) fail('invalid_argument', 'truncated SSH blob'); return buffer[offset++]; },
    readString() { const len = this.readU32(); if (offset + len > buffer.length) fail('invalid_argument', 'truncated SSH string'); const s = buffer.subarray(offset, offset + len); offset += len; return s; },
  };
}

// Parse the armored SSHSIG produced by `ssh-keygen -Y sign`. The magic preamble is a
// raw six-byte "SSHSIG", followed by a uint32 version and length-prefixed strings.
export function parseSshSig(armored) {
  if (typeof armored !== 'string') fail('invalid_argument', 'signature is not text');
  const body = armored.split(/\r?\n/).filter(line => line && !line.startsWith('-----')).join('');
  const buffer = Buffer.from(body, 'base64');
  if (buffer.subarray(0, 6).toString('utf8') !== 'SSHSIG') fail('invalid_argument', 'not an SSHSIG signature');
  const reader = sshReader(buffer, 6);
  const version = reader.readU32();
  const publicKey = reader.readString();
  const namespace = reader.readString().toString('utf8');
  const reserved = reader.readString();
  const hashAlgorithm = reader.readString().toString('utf8');
  const signature = reader.readString();
  return { version, publicKey, namespace, reserved, hashAlgorithm, signature };
}

// For a FIDO2/security-key signature, extract the presence/verification flags from the
// inner signature blob. Returns null when the signature is not from a `-sk` key (which
// has no presence/verification evidence and must be refused for live approval).
export function securityKeyFlags(signature) {
  const reader = sshReader(signature);
  const sigType = reader.readString().toString('utf8');
  if (!/sk-/.test(sigType)) return null;
  reader.readString(); // public key portion
  const flags = reader.readByte();
  return {
    userPresence: (flags & 0x01) !== 0,
    userVerification: (flags & 0x04) !== 0,
  };
}

// Verify an SSHSIG over the exact approval bytes. The cryptographic verification is
// delegated to `ssh-keygen -Y verify`; the flags check is performed independently.
export function verifyLiveApproval({
  approval, signature, allowedSigners, principal, krl = '', namespace = LIVE_NAMESPACE,
  now = Date.now(), sshKeygen = 'ssh-keygen',
} = {}) {
  if (typeof approval !== 'object' || approval === null) fail('invalid_argument', 'approval is required');
  validateLiveApproval(approval, now);
  if (typeof signature !== 'string' || typeof allowedSigners !== 'string' ||
      typeof principal !== 'string' || typeof namespace !== 'string' || typeof krl !== 'string')
    fail('invalid_argument', 'signature, allowedSigners, principal, namespace and krl are required');
  if (principal !== approval.principal) fail('authorization_denied', 'approval principal does not match the signer');

  const canonicalBytes = canonicalApprovalBytes(approval);
  const parsed = parseSshSig(signature);
  if (parsed.namespace !== namespace) fail('authorization_denied', 'signature namespace does not match');
  const flags = securityKeyFlags(parsed.signature);
  if (!flags || !flags.userPresence || !flags.userVerification) {
    fail('authorization_denied', 'signature does not prove FIDO2 user presence and verification');
  }

  // The detached signature is a file; the signed message goes to stdin.
  const sigFile = join(tmpdir(), `b30-approval-${randomUUID()}.sig`);
  try {
    writeFileSync(sigFile, signature, 'utf8');
    const args = ['-Y', 'verify', '-f', allowedSigners, '-I', principal, '-n', namespace, '-s', sigFile];
    if (krl) args.push('-r', krl);
    execFileSync(sshKeygen, args, { input: canonicalBytes, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1_048_576, windowsHide: true });
  } catch (error) {
    if (error.code === 'ENOENT') fail('unavailable', 'ssh-keygen is not available');
    fail('authorization_denied', 'signature verification failed');
  } finally {
    try { unlinkSync(sigFile); } catch { /* already removed */ }
  }
  return {
    verified: true,
    principal,
    namespace,
    flags,
    approvalDigest: approvalDigest(approval),
  };
}

// Bind the approval to the actual resolved base commit, the effective validated request
// (readable objective, branch, attempt/limits), the measured trusted host binary, the
// relay/gateway policy and fresh zero-price metadata. Reject any mismatch before the ledger
// is reserved.
export function verifyApprovalBinding({ approval, requestHash, baseCommit, request, hostBinaryDigest,
  relayPolicyDigest, gatewayPolicyDigest, maxRequests, metadata, now = Date.now() } = {}) {
  validateLiveApproval(approval, now);
  if (approval.requestHash !== requestHash) fail('authorization_denied', 'approval does not bind the submitted request');
  if (typeof baseCommit !== 'string' || approval.repository.baseRef !== baseCommit)
    fail('authorization_denied', 'approval does not bind the resolved base commit');
  // The signed human-readable scope must equal the effective validated request.
  if (!request || approval.objective !== request.objective)
    fail('authorization_denied', 'approval objective does not match the request');
  if (approval.repository.branch !== request.repository?.branch)
    fail('authorization_denied', 'approval branch does not match the request');
  if (approval.maxAttempts !== request.limits?.maxAttempts)
    fail('authorization_denied', 'approval attempt limit does not match the request');
  if (approval.limits.budgetMs !== request.limits?.budgetMs ||
      approval.limits.maxOutputBytes !== request.limits?.maxOutputBytes)
    fail('authorization_denied', 'approval limits do not match the request');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 12 ||
      approval.limits.maxRequests < maxRequests)
    fail('authorization_denied', 'approval request ceiling is below the effective listener policy');
  // The signed host identity must match the measured trusted executable bytes.
  if (typeof hostBinaryDigest !== 'string' || approval.hostBinaryDigest !== hostBinaryDigest)
    fail('authorization_denied', 'approval host binary digest does not match the measured executable');
  if (approval.relayPolicyDigest !== relayPolicyDigest) fail('authorization_denied', 'relay policy drifted from the approval');
  if (approval.gatewayPolicyDigest !== gatewayPolicyDigest) fail('authorization_denied', 'gateway policy drifted from the approval');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    fail('authorization_denied', 'live approval requires fresh metadata');
  if (!isTimestamp(metadata.observedAt) || metadata.observedAt > now || now - metadata.observedAt > METADATA_TTL_MS)
    fail('authorization_denied', 'metadata is stale');
  if (metadata.cost?.text?.input?.price !== 0 || metadata.cost?.text?.output?.price !== 0)
    fail('authorization_denied', 'metadata is not zero-price');
  const metadataDigest = createHash('sha256').update(canonical(metadata)).digest('hex');
  if (metadataDigest !== approval.metadataDigest) fail('authorization_denied', 'metadata does not match the approval digest');
  return { bound: true, metadataDigest, expiresAt: approval.expiresAt };
}

// Durable single-use reservation: one approval ID admits at most one task, and an
// identical read never dispatches a second task. This is a cooperative local-file
// ledger (same trust model as the task store), not OS authentication.
//
// The claim is atomic and no-replace: the complete record is written to a private
// temp file, fsynced, then hard-linked to the target. link(2) fails with EEXIST when
// the target already exists, so exactly one process can claim an ID and the winner's
// content is already durable before the link becomes visible. A later claim never
// overwrites an existing reservation; callers re-read on EEXIST.
export function openApprovalLedger({ home } = {}) {
  const root = resolve(home);
  const dir = join(root, 'approvals');
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (error) { fail('unavailable', 'cannot prepare approval ledger'); }
  const pathFor = id => join(dir, `${id}.json`);
  const read = id => {
    let text;
    try {
      text = readFileSync(pathFor(id), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      fail('unavailable', 'approval ledger is unreadable');
    }
    try {
      return JSON.parse(text);
    } catch {
      fail('unavailable', 'approval ledger record is unreadable');
    }
  };
  const claim = (id, record) => {
    const target = pathFor(id);
    const temp = join(dir, `.${id}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(record), 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      // Atomic no-replace claim: fails with EEXIST when another process won.
      linkSync(temp, target);
    } catch (error) {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* failing */ } }
      if (error.code === 'EEXIST') fail('already-claimed', 'approval ID already claimed');
      fail('unavailable', 'cannot persist approval reservation');
    } finally {
      try { unlinkSync(temp); } catch { /* already removed */ }
    }
  };
  return {
    reserve({ approvalId, taskId, now = Date.now() } = {}) {
      if (typeof approvalId !== 'string' || !IDENTIFIER.test(approvalId) || typeof taskId !== 'string' || !IDENTIFIER.test(taskId))
        fail('invalid_argument', 'invalid approval reservation identity');
      const existing = read(approvalId);
      if (existing) {
        if (existing.taskId === taskId) return { admitted: false, replay: true, taskId };
        fail('authorization_denied', 'approval ID already admitted a different task');
      }
      try {
        claim(approvalId, { approvalId, taskId, admittedAt: now });
      } catch (error) {
        if (error instanceof LiveApprovalError && error.code === 'already-claimed') {
          // A competing process claimed it first. Only an exact replay is readable.
          const winner = read(approvalId);
          if (winner && winner.taskId === taskId) return { admitted: false, replay: true, taskId };
          fail('authorization_denied', 'approval ID already admitted a different task');
        }
        throw error;
      }
      return { admitted: true, replay: false, taskId };
    },
    lookup(approvalId) {
      if (typeof approvalId !== 'string' || !IDENTIFIER.test(approvalId)) fail('invalid_argument', 'invalid approvalId');
      return read(approvalId);
    },
  };
}

// Locate an `ssh-keygen` binary for tests/fixtures. Falls back to common Windows Git
// locations so CI without ssh-keygen on PATH can still run; returns null when absent.
export function locateSshKeygen(env = process.env) {
  if (process.platform !== 'win32') return existsSync('/usr/bin/ssh-keygen') ? '/usr/bin/ssh-keygen' : null;
  const candidates = [
    join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'ssh-keygen.exe'),
    join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'ssh-keygen.exe'),
    'ssh-keygen',
  ];
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) return candidate; } catch { /* continue */ }
  }
  return null;
}

// SHA-256 of the trusted configured executable bytes. The approval's hostBinaryDigest must
// equal this measured value, both at admission and again immediately before spawn.
export function measureHostBinaryDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Canonical identity of an executable path: resolves symlinks/junctions/aliases so a signed
// admission's host executable and the configured worker executable can be compared for
// equality; falls back to lexical resolution when the file does not yet exist.
export function canonicalExecutablePath(path) {
  try { return realpathSync.native(path); }
  catch { return resolve(path); }
}

// End-to-end admission order: verify the offline signature, bind the effective request, the
// measured host binary, the resolved base commit, the policy and metadata, then reserve the
// approval ID. A live success path requires a real hardware-key signature with
// presence/verification; the binding and ledger are never reached for a refused signature.
export function admitLiveApproval({ approval, signature, allowedSigners, principal, krl = '',
  namespace = LIVE_NAMESPACE, requestHash, baseCommit, request, hostBinaryDigest,
  relayPolicyDigest, gatewayPolicyDigest, maxRequests = 12, metadata,
  taskId, ledger, now = Date.now(), sshKeygen = 'ssh-keygen' } = {}) {
  verifyLiveApproval({ approval, signature, allowedSigners, principal, krl, namespace, now, sshKeygen });
  const binding = verifyApprovalBinding({ approval, requestHash, baseCommit, request, hostBinaryDigest,
    relayPolicyDigest, gatewayPolicyDigest, maxRequests, metadata, now });
  if (!ledger || typeof ledger.reserve !== 'function') fail('invalid_argument', 'approval ledger is required');
  const reservation = ledger.reserve({ approvalId: approval.approvalId, taskId, now });
  return { ...reservation, expiresAt: binding.expiresAt, metadataObservedAt: metadata.observedAt,
    hostBinaryDigest: approval.hostBinaryDigest };
}

// Canonical request hash bound by a live approval: the SHA-256 of the pure task payload
// (clientSessionId, approval and signature excluded), matching the store's idempotency
// identity so the maintainer signs the same canonical bytes the service hashes.
export function liveRequestHash(payload) {
  return createHash('sha256').update(canonicalPayload(payload)).digest('hex');
}

// Build a synchronous service-admission gate (see createTaskService's `admission` option)
// that binds the standalone SSHSIG verification and atomic single-use ledger to a NEW task
// submission. The approval and its armored signature are read from the submitted payload's
// optional `approval` and `signature` fields (never from task text). The host identity is
// NOT caller-supplied: the factory measures the SHA-256 of the trusted configured
// executable at `hostExecutable` (the same path the configured worker uses) both at
// admission and again at pre-spawn revalidation, so a stale/foreign digest cannot pass. On
// success the gate returns a trusted in-memory receipt with a `revalidate(now)` method.
export function createSignedApprovalAdmission({ allowedSigners, principal, krl = '',
  namespace = LIVE_NAMESPACE, relayPolicyDigest, gatewayPolicyDigest, maxRequests = 12, metadata, ledger,
  hostExecutable, sshKeygen = 'ssh-keygen' } = {}) {
  if (typeof allowedSigners !== 'string' || typeof principal !== 'string' ||
      typeof namespace !== 'string' || typeof krl !== 'string' ||
      typeof relayPolicyDigest !== 'string' || typeof gatewayPolicyDigest !== 'string' ||
      typeof sshKeygen !== 'string')
    fail('invalid_argument', 'signed approval admission requires allowedSigners, principal, namespace, krl, policy digests and sshKeygen');
  if (!ledger || typeof ledger.reserve !== 'function')
    fail('invalid_argument', 'signed approval admission requires a reservation ledger');
  if (typeof hostExecutable !== 'string' || !isAbsolute(hostExecutable))
    fail('invalid_argument', 'signed approval admission requires the absolute trusted host executable path');
  const measure = () => {
    try { return measureHostBinaryDigest(hostExecutable); }
    catch { fail('unavailable', 'cannot measure the trusted host executable'); }
  };
  const gate = (payload, { taskId, baseCommit, now = Date.now() } = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      fail('invalid_argument', 'submission payload is required for signed approval admission');
    const approval = payload.approval;
    const signature = payload.signature;
    if (approval === undefined || signature === undefined)
      fail('authorization_denied', 'a signed live approval is required for new tasks');
    const hostBinaryDigest = measure();
    const result = admitLiveApproval({ approval, signature, allowedSigners, principal, krl, namespace,
      requestHash: liveRequestHash(payload), baseCommit, request: payload, hostBinaryDigest,
      relayPolicyDigest, gatewayPolicyDigest, maxRequests, metadata, taskId, ledger, now, sshKeygen });
    // A trusted in-memory receipt: never persisted, never in task text. Its closure re-checks
    // freshness and host identity (re-measuring the same executable) without the signature.
    return {
      ...result,
      revalidate(at = Date.now()) {
        if (at >= result.expiresAt) fail('authorization_denied', 'approval expired before dispatch');
        if (at - result.metadataObservedAt > METADATA_TTL_MS) fail('authorization_denied', 'metadata stale before dispatch');
        if (measure() !== result.hostBinaryDigest)
          fail('authorization_denied', 'host binary changed before dispatch');
      },
    };
  };
  // Expose the canonical host executable so trusted composition (createConfiguredTaskService)
  // can verify the gate measures the same executable the configured worker will start.
  Object.defineProperty(gate, 'hostExecutable', { value: canonicalExecutablePath(hostExecutable), enumerable: true });
  // The relay/gateway digests the signed approval must bind, so composition can refuse a
  // supervised listener configuration that differs from the approved policy.
  Object.defineProperty(gate, 'relayPolicyDigest', { value: relayPolicyDigest, enumerable: true });
  Object.defineProperty(gate, 'gatewayPolicyDigest', { value: gatewayPolicyDigest, enumerable: true });
  Object.defineProperty(gate, 'maxRequests', { value: maxRequests, enumerable: true });
  return gate;
}

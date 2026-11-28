// Service surface for the M2b task contract (docs/task-contract.md, ADR-008).
// This module orchestrates the durable task store and implements the four contract
// operations: submit_task, get_task_status, get_task_result and cancel_task. It owns
// strict request validation, ownership checks, allowlist clamping, lifecycle decisions
// and sanitized error mapping. An explicitly configured worker enables the serial
// scheduler; artifact collection remains B13.
//
// The service is transport neutral: it is synchronous and returns plain response
// objects, or throws ServiceError with a contract error code. The MCP/API transport
// adapter serializes the error envelope { error: { code, message } } and sets isError.

import { isAbsolute, sep, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { TaskStoreError, openTaskStore } from './tasks.mjs';
import { RepositoryError, validateRepositoryIdentity } from './repository.mjs';
import { createTaskScheduler } from './scheduler.mjs';
import { redactSecrets, containsSecretPattern, truncateUtf8, truncateUtf8Tail } from './redaction.mjs';

export const SCHEMA_VERSION = 1;
export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled'];
// A result is available once the task reached a terminal state. Blocked is terminal
// until a human reconciles it, and a blocked task returns partial artifacts.
export const RESULT_STATUSES = ['succeeded', 'failed', 'blocked', 'cancelled'];
export const EVIDENCE_LEVELS = ['unit', 'local-http', 'opencode-integration', 'use-on-project'];
export const ERROR_CODES = ['invalid_argument', 'unknown_task', 'not_owner', 'idempotency_conflict',
  'authorization_denied', 'limit_exceeded', 'result_not_ready', 'unavailable', 'internal'];
export const MAX_DIFF_BYTES = 1_048_576; // 1 MiB diff cap from the contract.
export const MAX_LOG_BYTES = 262_144; // 256 KiB log tail cap from the contract.

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,128}$/;
const OBJECTIVE_MAX = 4000;
const ACCEPTANCE_MAX = 20;
const SUBMIT_REQUIRED = ['idempotencyKey', 'clientId', 'objective', 'acceptanceCriteria', 'repository', 'authorization', 'limits'];
// approval/signature are the B30 signed live-approval envelope: optional on the transport,
// required only when a signed-approval admission gate is configured. They are excluded from
// the canonical payload/request hash and never persisted on the task record.
const SUBMIT_OPTIONAL = ['clientSessionId', 'approval', 'signature'];
const REPOSITORY_FIELDS = ['path', 'baseRef', 'branch'];
const AUTHORIZATION_FIELDS = ['models', 'tools', 'writablePaths'];
const LIMITS_FIELDS = ['maxAttempts', 'budgetMs', 'maxOutputBytes'];
const INCLUDED_ARTIFACTS = new Set(['diff', 'tests', 'log']);

export class ServiceError extends Error {
  constructor(code, message, osCode) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    if (osCode !== undefined) this.osCode = osCode;
  }
}

function fail(code, message) {
  throw new ServiceError(code, message);
}

function toServiceError(error) {
  if (error instanceof ServiceError) return error;
  if (error instanceof TaskStoreError) return new ServiceError(error.code, error.message, error.osCode);
  if (error instanceof RepositoryError) return new ServiceError(error.code, error.message);
  // Unexpected failures stay generic: no stack, no payload, no private data.
  return new ServiceError('internal', 'task service failure');
}

// The service contract deliberately keeps admission synchronous. If a trusted
// adapter accidentally returns a Promise/thenable, attach a rejection observer
// before refusing it so a rejected async callback cannot escape as an
// unhandledRejection after the caller has already handled the synchronous error.
function isThenableAndObserve(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  let then;
  try {
    then = value.then;
  } catch {
    Promise.resolve(value).catch(() => {});
    return true;
  }
  if (typeof then !== 'function') return false;
  Promise.resolve(value).catch(() => {});
  return true;
}

// Error envelope defined by the contract: { error: { code, message } }.
export function errorEnvelope(error) {
  return { error: { code: error.code, message: error.message } };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(object, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail('invalid_argument', `unknown ${label} field`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) fail('invalid_argument', `${label} is missing ${key}`);
  }
}

export const DEFAULT_CONFIG = {
  clientId: 'opencode-primary',
  authorization: { models: [], tools: [], writableRoots: [] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
};

// Module-local registry of task-home ownership capabilities. Only `openTaskHome` inserts an
// entry after it holds the exclusive lock and has reconciled the store. A plain object, a
// spread copy, a released capability or one already handed to a service is not a valid
// handoff; caller honesty is not an ownership boundary.
const taskHomeHandoffs = new WeakMap();

export function createTaskService(options = {}) {
  const ownership = options.ownership;
  let handoff;
  if (ownership !== undefined) {
    handoff = taskHomeHandoffs.get(ownership);
    if (handoff === undefined || handoff.state !== 'minted' ||
        ownership.store !== handoff.store || typeof ownership.releaseOwner !== 'function' ||
        options.store !== undefined || typeof options.home !== 'string') {
      fail('invalid_argument', 'ownership must be an unconsumed capability minted by openTaskHome for the requested home');
    }
    let ownedHome;
    try { ownedHome = typeof handoff.store.home === 'string' ? resolve(handoff.store.home) : undefined; }
    catch { ownedHome = undefined; }
    if (ownedHome !== resolve(options.home) || handoff.home !== ownedHome)
      fail('invalid_argument', 'ownership capability does not belong to the requested task home');
  }
  const store = handoff?.store ?? options.store ?? openTaskStore({ home: options.home });
  const configured = isPlainObject(options.config) ? options.config : {};
  const admission = options.admission;
  if (admission !== undefined && typeof admission !== 'function')
    fail('invalid_argument', 'admission must be a synchronous function');
  const config = {
    clientId: typeof configured.clientId === 'string' ? configured.clientId : DEFAULT_CONFIG.clientId,
    authorization: { ...DEFAULT_CONFIG.authorization, ...(isPlainObject(configured.authorization) ? configured.authorization : {}) },
    limits: { ...DEFAULT_CONFIG.limits, ...(isPlainObject(configured.limits) ? configured.limits : {}) },
  };
  const startupNow = typeof options.now === 'function' ? options.now() :
    (Number.isInteger(options.now) ? options.now : Date.now());
  const now = () => {
    if (typeof options.now === 'function') return options.now();
    if (Number.isInteger(options.now)) return options.now;
    return Date.now();
  };
  // In-memory trusted receipts from a signed-approval admission gate, keyed by taskId.
  // They are never persisted and never entered into task text; the scheduler re-checks
  // them immediately before spawn (B30-05 pre-dispatch revalidation).
  const receipts = new Map();
  const revalidate = admission === undefined ? undefined : (taskId, at) => {
    const receipt = receipts.get(taskId);
    if (receipt === undefined || typeof receipt.revalidate !== 'function')
      fail('authorization_denied', 'signed approval receipt is missing or invalid before dispatch');
    try {
      const result = receipt.revalidate(at);
      if (isThenableAndObserve(result))
        fail('internal', 'signed approval revalidation must be synchronous');
    } catch (error) {
      if (error?.code === 'authorization_denied' || error?.code === 'invalid_argument' || error?.code === 'unavailable')
        fail(error.code, error.message);
      throw toServiceError(error);
    }
  };
  // Consume after every pure argument check, immediately before the first effect. Release
  // authority then transfers to this service: the creator-facing `releaseOwner` refuses, and
  // only this service's close path may run `beforeRelease` and remove the owner lock.
  let releaseOwner;
  let scheduler;
  if (handoff !== undefined) {
    handoff.state = 'consumed';
    // Ownership was acquired and reconciled by `openTaskHome` before any caller effect; this
    // service must not acquire or reconcile a second time (no double acquisition). Its close
    // path uses the private release function, never the creator-facing one.
    releaseOwner = handoff.release;
  }
  try {
    if (handoff === undefined) {
      releaseOwner = acquireServiceOwnership(store.home);
      // Reconcile exactly once as the service starts. Never accept requests against an
      // ambiguous index or an unresolved in-flight task.
      const reconciliation = store.reconcile({ now: startupNow, ownershipToken: releaseOwner.token });
      if (reconciliation.conflicts.length) fail('unavailable', 'task store reconciliation found conflicts');
    }
    if (options.worker !== undefined) scheduler = createTaskScheduler({ store,
      clientId: config.clientId, worker: options.worker, now, revalidate });
  } catch (error) {
    if (handoff === undefined) {
      // A failed acquisition has no lock to release; a failed reconciliation does.
      if (typeof releaseOwner === 'function') releaseOwner();
    } else {
      // Construction failed before any service existed, so release authority never actually
      // transferred. Return the capability to its creator, whose cleanup path may stop
      // external effects through `beforeRelease`; a cleanup failure still keeps the lock.
      handoff.state = 'minted';
    }
    throw toServiceError(error);
  }

  // Ownership: the task owner is the client that submitted it; the caller is the
  // service-configured client. Other clients receive not_owner.
  const requireOwned = taskId => {
    let task;
    try {
      task = store.readTask(taskId);
    } catch (error) {
      throw toServiceError(error);
    }
    if (task.clientId !== config.clientId) fail('not_owner', 'task is not owned by this client');
    return task;
  };

  const submitTask = request => {
    const payload = validateSubmitRequest(request, config);
    if (containsSecretPattern(payload)) fail('invalid_argument', 'request contains credential-shaped text');

    // 1. Resolve client-scoped idempotency by original canonical payload first.
    // An identical replay must return the original task without rechecking repository
    // existence, branch availability or a moving ref.
    let existing;
    try {
      existing = store.findIdempotentTask(payload.clientId, payload.idempotencyKey, payload);
    } catch (error) {
      throw toServiceError(error);
    }
    if (existing !== undefined) {
      return {
        schemaVersion: SCHEMA_VERSION,
        taskId: existing.taskId,
        status: existing.status,
        acceptedAt: existing.acceptedAt,
        idempotentReplay: true,
      };
    }
    if (scheduler?.snapshot().stopped) fail('unavailable', 'task scheduler requires inspection');
    // Trusted synchronous admission, after replay resolution but before new-task
    // filesystem/persistence effects. Task text cannot supply this callback.
    try {
      const decision = options.worker?.validateSubmission?.(structuredClone(payload));
      if (isThenableAndObserve(decision)) fail('internal', 'worker admission must be synchronous');
    } catch (error) {
      if (error?.code === 'authorization_denied') fail('authorization_denied', 'worker admission denied');
      throw toServiceError(error);
    }

    // 2. New request: validate repository identity, baseRef commit-ish, and branch availability.
    let repoValidation;
    try {
      repoValidation = validateRepositoryIdentity({
        repositoryPath: payload.repository.path,
        writableRoots: config.authorization.writableRoots,
        baseRef: payload.repository.baseRef,
        branch: payload.repository.branch,
      });
    } catch (error) {
      throw toServiceError(error);
    }

    // 2b. Signed live-approval admission (B30-05), for NEW tasks only, after replay
    //     resolution and repository inspection but before task persistence, workspace or
    //     spawn. A synchronous trusted gate (never task text) verifies and binds the SSHSIG
    //     and reserves the approval ID against the pre-generated taskId; any refusal throws
    //     before the task record is written. When absent, admission stays passive (default).
    //     A successful gate MUST return an object with `admitted: true` and a callable
    //     `revalidate` bound to this task; `false`, `true`, `undefined` or an object lacking
    //     the verifier are refused before persistence.
    let taskId;
    if (admission !== undefined) {
      taskId = randomUUID();
      try {
        const decision = admission(structuredClone(payload), { taskId, baseCommit: repoValidation.baseCommitSha, now: now() });
        if (isThenableAndObserve(decision)) fail('internal', 'signed approval admission must be synchronous');
        if (!decision || typeof decision !== 'object' || decision.admitted !== true ||
            typeof decision.revalidate !== 'function')
          fail('authorization_denied', 'signed approval admission must return an admitted receipt with a revalidation verifier');
        receipts.set(taskId, decision);
      } catch (error) {
        if (error?.code === 'authorization_denied') fail('authorization_denied', 'signed approval admission denied');
        if (error?.code === 'invalid_argument') fail('invalid_argument', 'invalid signed approval submission');
        if (error?.code === 'unavailable') fail('unavailable', 'signed approval admission unavailable');
        throw toServiceError(error);
      }
    }

    // 3. Persist new task record with fixed full base SHA as immutable metadata.
    let created;
    try {
      created = store.createTask({
        clientId: payload.clientId,
        idempotencyKey: payload.idempotencyKey,
        payload,
        baseCommit: repoValidation.baseCommitSha,
        now: now(),
        ...(taskId !== undefined ? { taskId } : {}),
      });
    } catch (error) {
      throw toServiceError(error);
    }
    if (!created.replay) scheduler?.enqueue(created.task.taskId);
    return {
      schemaVersion: SCHEMA_VERSION,
      taskId: created.task.taskId,
      status: created.task.status,
      acceptedAt: created.task.acceptedAt,
      idempotentReplay: created.replay,
    };
  };

  const getTaskStatus = (input = {}) => {
    validateOperationInput(input, ['taskId'], 'get_task_status');
    const task = requireOwned(input.taskId);
    const statusView = {
      schemaVersion: SCHEMA_VERSION,
      taskId: task.taskId,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      attempts: task.attempts.map(attempt => ({
        attemptId: attempt.attemptId,
        model: attempt.model,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        outcome: attempt.outcome ?? null,
      })),
      cancel: {
        requestedAt: task.cancel.requestedAt,
        executionStopped: task.cancel.executionStopped,
        effectsReverted: task.cancel.effectsReverted,
      },
    };
    if (task.status === 'blocked') {
      statusView.block = { reason: task.block.reason, requiresReconciliation: task.block.requiresReconciliation };
    }
    statusView.progress = task.progress;
    statusView.resultAvailable = RESULT_STATUSES.includes(task.status);
    return statusView;
  };

  const getTaskResult = (input = {}) => {
    validateOperationInput(input, ['taskId', 'include'], 'get_task_result');
    const taskId = input.taskId;
    const include = input.include;
    if (include !== undefined) {
      if (!Array.isArray(include)) fail('invalid_argument', 'include must be an array');
      for (const entry of include) {
        if (typeof entry !== 'string' || !INCLUDED_ARTIFACTS.has(entry)) fail('invalid_argument', 'include has an unknown artifact');
      }
    }
    const task = requireOwned(taskId);
    if (!RESULT_STATUSES.includes(task.status)) fail('result_not_ready', 'task is not finished');

    // Flat fields remain readable for valid v1 records written before B13.
    const artifact = task.artifact ?? task;
    const selected = new Set(include ?? INCLUDED_ARTIFACTS);
    const includeLogs = selected.has('log');
    const runs = (Array.isArray(artifact.testRuns) ? artifact.testRuns : []).map(run => ({
      command: redactSecrets(run?.command),
      exitCode: run?.exitCode,
      durationMs: run?.durationMs,
      summary: redactSecrets(run?.summary),
      outputTail: redactSecrets(run?.outputTail),
      outputTruncated: run?.outputTruncated === true,
    }));
    const changedFiles = selected.has('diff') && Array.isArray(artifact.changedFiles) ? artifact.changedFiles.map(redactSecrets) : [];
    let diff = selected.has('diff') && typeof artifact.diff === 'string' ? redactSecrets(artifact.diff) : null;
    let diffTruncated = selected.has('diff') && artifact.diffTruncated === true;
    const diffLimit = Math.min(MAX_DIFF_BYTES, task.request?.limits?.maxOutputBytes ?? MAX_DIFF_BYTES);
    if (diff !== null && Buffer.byteLength(diff, 'utf8') > diffLimit) {
      diff = truncateUtf8(diff, diffLimit);
      diffTruncated = true;
    }
    let logsTruncated = false;
    const maxOutputBytes = task.request?.limits?.maxOutputBytes ?? MAX_DIFF_BYTES;
    let remainingLogBytes = Math.min(MAX_LOG_BYTES,
      Math.max(0, maxOutputBytes - Buffer.byteLength(diff ?? '', 'utf8')));
    const boundLog = log => {
      const raw = includeLogs && typeof log.outputTail === 'string' ? log.outputTail : '';
      const trimmed = truncateUtf8Tail(raw, remainingLogBytes);
      const didTruncate = Buffer.byteLength(raw, 'utf8') > Buffer.byteLength(trimmed, 'utf8');
      const outputTruncated = includeLogs && (log.outputTruncated === true || didTruncate);
      logsTruncated ||= outputTruncated;
      remainingLogBytes -= Buffer.byteLength(trimmed, 'utf8');
      return { outputTail: trimmed, outputTruncated };
    };
    const workerLog = includeLogs && task.artifact?.workerLog ?
      boundLog({ ...artifact.workerLog, outputTail: redactSecrets(artifact.workerLog.outputTail) }) : undefined;
    const boundedRuns = runs.map(run => ({ ...run, ...boundLog(run) }));

    const limitations = Array.isArray(artifact.limitations) ? artifact.limitations.map(redactSecrets) : [];
    const passed = runs.some(run => typeof run.command === 'string' && run.command.trim() && run.exitCode === 0);
    if (task.status === 'succeeded' && !passed) {
      limitations.unshift('success without a recorded passing test command and exit code');
    }
    if ((task.status === 'failed' || task.status === 'blocked') &&
        task.artifact === undefined && typeof task.diff !== 'string') {
      limitations.push('no artifact record for a failed task');
    }
    if (task.reconciliation?.decision === 'failed' && task.reconciliation.administrativeOutcome === 'unknown') {
      limitations.push('administrative failure after an interrupted dispatch; worker outcome remains unknown and success or side effects are not established');
    }

    // Unit-level local test execution is the evidence source of the M2b worker; the
    // verification state of a success claim is tracked by the recorded runs and the
    // limitations list, never by the level label alone.
    const evidenceLevel = EVIDENCE_LEVELS.includes(artifact.evidenceLevel) ? artifact.evidenceLevel : 'unit';

    return {
      schemaVersion: SCHEMA_VERSION,
      taskId: task.taskId,
      status: task.status,
      baseCommit: redactSecrets(artifact.baseCommit ?? task.baseCommit ?? task.request?.repository?.baseRef ?? null),
      branch: redactSecrets(artifact.branch ?? task.request?.repository?.branch ?? null),
      headCommit: redactSecrets(artifact.headCommit ?? null),
      diff,
      diffTruncated,
      changedFiles,
      testRuns: selected.has('tests') || includeLogs ? boundedRuns : [],
      ...(workerLog && { workerLog }),
      logsTruncated,
      attempts: task.attempts.map(attempt => ({
        attemptId: attempt.attemptId,
        model: redactSecrets(attempt.model),
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        outcome: redactSecrets(attempt.outcome ?? null),
      })),
      limitations,
      cost: artifact.cost ?? { known: false, amount: null, currency: 'unknown', note: 'cost is unknown until a provider is authorized' },
      evidenceLevel,
      sanitized: true, // Credential-shaped strings were redacted at input/artifact boundaries.
    };
  };

  const cancelTask = (input = {}) => {
    validateOperationInput(input, ['taskId', 'reason'], 'cancel_task');
    const task = requireOwned(input.taskId);
    const reason = input.reason;
    if (reason !== undefined && typeof reason !== 'string') fail('invalid_argument', 'cancel reason must be a string');
    const at = now();
    if (RESULT_STATUSES.includes(task.status)) {
      return { schemaVersion: SCHEMA_VERSION, cancelRequestedAt: task.cancel.requestedAt, status: task.status, effect: 'already_terminal' };
    }
    if (task.status === 'queued') {
      try { store.updateTask(task.taskId, draft => {
        draft.status = 'cancelled';
        draft.finishedAt = at;
        draft.cancel.requestedAt = at;
        draft.cancel.executionStopped = true;
        draft.cancel.effectsReverted = false;
        draft.block = null;
        draft.progress.push({ at, event: 'cancel', detail: redactSecrets(reason ?? null) });
      }); } catch (error) { throw toServiceError(error); }
      return { schemaVersion: SCHEMA_VERSION, cancelRequestedAt: at, status: 'cancelled', effect: 'not_started' };
    }
    // running: the stop cannot be proven here, so the task blocks until reconciliation.
    try { store.updateTask(task.taskId, draft => {
      draft.cancel.requestedAt = at;
      draft.status = 'blocked';
      draft.cancel.executionStopped = 'unknown';
      draft.finishedAt = at;
      draft.block = { reason: 'cancelled-uncertain', requiresReconciliation: true };
      draft.progress.push({ at, event: 'blocked', detail: 'cancelled-uncertain' });
    }); } catch (error) { throw toServiceError(error); }
    // Persist the terminal decision before signalling the worker. The scheduler
    // aborts only the root process and must keep the queue halted: descendants or
    // external effects are still unknown even when the root later exits.
    scheduler?.requestCancellation(task.taskId);
    return { schemaVersion: SCHEMA_VERSION, cancelRequestedAt: at, status: 'blocked', effect: 'requested' };
  };

  let closed = false;
  let closing;
  const guardOpen = operation => (...args) => {
    if (closed) fail('unavailable', 'task service is closed');
    return operation(...args);
  };
  return { store, config, now,
    submitTask: guardOpen(submitTask), getTaskStatus: guardOpen(getTaskStatus),
    getTaskResult: guardOpen(getTaskResult), cancelTask: guardOpen(cancelTask),
    whenIdle: () => scheduler?.whenIdle() ?? Promise.resolve(),
    schedulerStatus: () => scheduler?.snapshot() ?? null,
    close: () => {
      closed = true;
      if (!scheduler) {
        const released = releaseOwner();
        // Passive default services keep synchronous close; a capability handoff may have
        // asynchronous pre-release cleanup, in which case its Promise is returned.
        return released instanceof Promise ? released : undefined;
      }
      // Ownership is released only after scheduler idle and the service's own private release
      // (which runs `beforeRelease`, for example stopping supervised listeners), so a failed
      // release keeps the task-home owner.
      closing ??= scheduler.close().then(async result => {
        if (result.releaseOwnership) await releaseOwner();
        return result;
      });
      return closing;
    } };
}

// Acquire task-home ownership and reconcile the store before any caller starts effects that
// depend on it (for example supervised listener children). The returned capability is the only
// handoff accepted by `createTaskService({ ownership })`: it is minted after the exclusive lock
// is held and reconciliation succeeded, can be consumed once, and is invalidated on release.
// `beforeRelease` (trusted composition, for example stopping listeners) runs while ownership is
// still held; if it or the lock release fails, the capability becomes unusable and the owner
// lock is retained for explicit maintainer reconciliation. On any other refusal the lock is
// released and no task-store write has been accepted.
export function openTaskHome({ home, now = Date.now, beforeRelease } = {}) {
  if (typeof home !== 'string' || !isAbsolute(home)) fail('invalid_argument', 'task home must be an absolute path');
  if (beforeRelease !== undefined && typeof beforeRelease !== 'function')
    fail('invalid_argument', 'beforeRelease must be a function');
  const releaseLock = acquireServiceOwnership(home);
  try {
    const store = openTaskStore({ home });
    const reconciliation = store.reconcile({ now: typeof now === 'function' ? now() : now,
      ownershipToken: releaseLock.token });
    if (reconciliation.conflicts.length) fail('unavailable', 'task store reconciliation found conflicts');
    const record = { state: 'minted', store, home: resolve(store.home) };
    let releasing;
    // Private release path. Only a minted capability's creator cleanup or the consuming
    // service's close may reach it; it is never exposed on the capability object.
    const release = () => (releasing ??= (async () => {
      if (record.state === 'released') return;
      record.state = 'releasing';
      try {
        if (beforeRelease !== undefined) await beforeRelease();
        releaseLock();
      } catch (error) {
        // The lock is removed only when `releaseLock` itself succeeded. Any uncertainty keeps
        // the capability unusable and the owner in place for explicit reconciliation.
        record.state = 'uncertain';
        throw error;
      }
      record.state = 'released';
    })());
    record.release = release;
    // The creator-facing release is valid only while the capability is still minted and
    // unconsumed, for example to clean up after a failed construction. Once a service has
    // consumed it, release authority has transferred: only that service's private close path
    // may run `beforeRelease` and remove the lock.
    const releaseOwner = () => {
      if (record.state !== 'minted')
        fail('invalid_argument', 'task-home ownership is held by a service; only service.close() may release it');
      return release();
    };
    const capability = Object.freeze({ store, releaseOwner });
    taskHomeHandoffs.set(capability, record);
    return capability;
  } catch (error) {
    releaseLock();
    throw toServiceError(error);
  }
}

function acquireServiceOwnership(home) {
  const locks = join(home, 'locks');
  const lockPath = join(locks, 'service-owner.lock');
  const maintenancePath = join(locks, 'maintenance-owner.lock');
  const recoveryPath = join(locks, 'owner-recovery.lock');
  const token = randomUUID();
  let fd;
  let created = false;
  try {
    mkdirSync(locks, { recursive: true, mode: 0o700 });
    if (existsSync(maintenancePath) || existsSync(recoveryPath)) fail('unavailable', 'task-store maintenance or owner recovery is active');
    fd = openSync(lockPath, 'wx', 0o600);
    created = true;
    writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: Date.now(), nonce: token })}\n`);
    closeSync(fd);
    // Pairwise post-create checks make simultaneous cooperative acquisition fail
    // closed: neither owner proceeds if both locks were created in the race window.
    if (existsSync(maintenancePath) || existsSync(recoveryPath)) fail('unavailable', 'task-store maintenance or owner recovery is active');
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* preserve the original acquisition error */ }
    }
    if (created) {
      try { unlinkSync(lockPath); } catch { /* a stale lock fails closed */ }
    }
    if (error.code === 'EEXIST') fail('unavailable', 'another service owns this task store');
    throw new ServiceError('unavailable', 'cannot acquire task store ownership', error.code);
  }
  let released = false;
  const release = () => {
    if (released) return;
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (owner.nonce !== token) throw new ServiceError('unavailable', 'task store ownership changed');
      unlinkSync(lockPath);
    }
    catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error.code !== 'ENOENT') throw new ServiceError('unavailable', 'cannot release task store ownership', error.code);
    }
    released = true;
  };
  release.token = token;
  return release;
}

function validateSubmitRequest(request, config) {
  if (!isPlainObject(request)) fail('invalid_argument', 'submit_task requires an object');
  hasExactKeys(request, SUBMIT_REQUIRED, SUBMIT_OPTIONAL, 'submit_task');

  const idempotencyKey = request.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !IDENTIFIER.test(idempotencyKey)) {
    fail('invalid_argument', 'idempotencyKey is not a valid identifier');
  }
  const clientId = request.clientId;
  if (typeof clientId !== 'string' || !IDENTIFIER.test(clientId)) {
    fail('invalid_argument', 'clientId is not a valid identifier');
  }
  if (clientId !== config.clientId) fail('authorization_denied', 'clientId does not match the configured client');
  const objective = request.objective;
  if (typeof objective !== 'string' || objective.length < 1 || objective.length > OBJECTIVE_MAX) {
    fail('invalid_argument', 'objective must be 1..4000 characters');
  }
  const acceptanceCriteria = request.acceptanceCriteria;
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length < 1 || acceptanceCriteria.length > ACCEPTANCE_MAX) {
    fail('invalid_argument', 'acceptanceCriteria must have 1..20 items');
  }
  for (const item of acceptanceCriteria) {
    if (typeof item !== 'string' || item.length < 1) fail('invalid_argument', 'acceptanceCriteria items must be non-empty strings');
  }

  const repository = request.repository;
  if (!isPlainObject(repository)) fail('invalid_argument', 'repository must be an object');
  hasExactKeys(repository, REPOSITORY_FIELDS, [], 'repository');
  const repositoryPath = repository.path;
  if (typeof repositoryPath !== 'string' || repositoryPath.length < 1) fail('invalid_argument', 'repository.path must be a non-empty string');
  const resolvedPath = resolve(repositoryPath);
  const writableRoots = config.authorization.writableRoots.map(root => resolve(root));
  const insideRoot = writableRoots.some(root => resolvedPath === root || resolvedPath.startsWith(root + sep));
  if (!insideRoot) fail('authorization_denied', 'repository.path is outside the configured writable roots');
  const baseRef = repository.baseRef;
  if (typeof baseRef !== 'string' || baseRef.length < 1) fail('invalid_argument', 'repository.baseRef must be a non-empty string');
  const branch = repository.branch;
  if (typeof branch !== 'string' || !BRANCH.test(branch)) fail('invalid_argument', 'repository.branch is not a valid branch name');

  const authorization = request.authorization;
  if (!isPlainObject(authorization)) fail('invalid_argument', 'authorization must be an object');
  hasExactKeys(authorization, AUTHORIZATION_FIELDS, [], 'authorization');
  const models = authorization.models;
  if (!Array.isArray(models)) fail('invalid_argument', 'authorization.models must be an array');
  for (const model of models) {
    if (typeof model !== 'string' || model.length < 1) fail('invalid_argument', 'authorization.models entries must be strings');
    if (!config.authorization.models.includes(model)) fail('authorization_denied', 'authorization model is outside the allowlist');
  }
  const tools = authorization.tools;
  if (!Array.isArray(tools)) fail('invalid_argument', 'authorization.tools must be an array');
  for (const tool of tools) {
    if (typeof tool !== 'string' || tool.length < 1) fail('invalid_argument', 'authorization.tools entries must be strings');
    if (!config.authorization.tools.includes(tool)) fail('authorization_denied', 'authorization tool is outside the allowlist');
  }
  const writablePaths = authorization.writablePaths;
  if (!Array.isArray(writablePaths)) fail('invalid_argument', 'authorization.writablePaths must be an array');
  for (const writablePath of writablePaths) {
    if (typeof writablePath !== 'string' || writablePath.length < 1) fail('invalid_argument', 'authorization.writablePaths entries must be strings');
    // Relative globs resolve from the repository. Absolute paths remain accepted
    // only when their static prefix stays inside both the repository and configured roots.
    if (writablePath.split(/[\\/]/).includes('..')) {
      fail('authorization_denied', 'authorization writable path escapes the repository');
    }
    const staticPrefix = writablePath.split(/[*?{[]/, 1)[0].replace(/[\\/]+$/, '');
    const resolvedWritablePath = isAbsolute(writablePath)
      ? resolve(staticPrefix || writablePath)
      : resolve(repositoryPath, staticPrefix || '.');
    const insideRepository = resolvedWritablePath === resolvedPath || resolvedWritablePath.startsWith(resolvedPath + sep);
    const allowed = insideRepository && writableRoots.some(root => resolvedWritablePath === root || resolvedWritablePath.startsWith(root + sep));
    if (!allowed) fail('authorization_denied', 'authorization writable path is outside the configured roots');
  }

  const limits = request.limits;
  if (!isPlainObject(limits)) fail('invalid_argument', 'limits must be an object');
  hasExactKeys(limits, LIMITS_FIELDS, [], 'limits');
  const maxAttempts = limits.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) fail('invalid_argument', 'task maxAttempts must be a positive integer');
  if (maxAttempts > config.limits.maxAttempts) fail('limit_exceeded', 'task maxAttempts exceeds the configured limit');
  const budgetMs = limits.budgetMs;
  if (!Number.isInteger(budgetMs) || budgetMs < 1) fail('limit_exceeded', 'task budgetMs must be a positive integer');
  if (budgetMs > config.limits.budgetMs) fail('limit_exceeded', 'task budgetMs exceeds the configured budget');
  const maxOutputBytes = limits.maxOutputBytes;
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) fail('limit_exceeded', 'task maxOutputBytes must be a positive integer');
  if (maxOutputBytes > config.limits.maxOutputBytes) fail('limit_exceeded', 'task maxOutputBytes exceeds the configured limit');

  if (request.clientSessionId !== undefined && typeof request.clientSessionId !== 'string') {
    fail('invalid_argument', 'clientSessionId must be a string');
  }

  return request;
}

function validateOperationInput(input, allowed, operation) {
  if (!isPlainObject(input)) fail('invalid_argument', `${operation} requires an object`);
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail('invalid_argument', `unknown ${operation} field`);
  if (typeof input.taskId !== 'string' || !IDENTIFIER.test(input.taskId)) fail('invalid_argument', 'taskId is not a valid identifier');
}

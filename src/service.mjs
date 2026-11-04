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
import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { TaskStoreError, openTaskStore } from './tasks.mjs';
import { RepositoryError, validateRepositoryIdentity } from './repository.mjs';
import { createTaskScheduler } from './scheduler.mjs';

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
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=]+/gi,
  /\b(authorization\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi,
];

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,128}$/;
const OBJECTIVE_MAX = 4000;
const ACCEPTANCE_MAX = 20;
const SUBMIT_REQUIRED = ['idempotencyKey', 'clientId', 'objective', 'acceptanceCriteria', 'repository', 'authorization', 'limits'];
const SUBMIT_OPTIONAL = ['clientSessionId'];
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

export function createTaskService(options = {}) {
  const store = options.store ?? openTaskStore({ home: options.home });
  const configured = isPlainObject(options.config) ? options.config : {};
  const config = {
    clientId: typeof configured.clientId === 'string' ? configured.clientId : DEFAULT_CONFIG.clientId,
    authorization: { ...DEFAULT_CONFIG.authorization, ...(isPlainObject(configured.authorization) ? configured.authorization : {}) },
    limits: { ...DEFAULT_CONFIG.limits, ...(isPlainObject(configured.limits) ? configured.limits : {}) },
  };
  const startupNow = typeof options.now === 'function' ? options.now() :
    (Number.isInteger(options.now) ? options.now : Date.now());
  const releaseOwner = acquireServiceOwnership(store.home);
  // Reconcile exactly once as the service starts. Never accept requests against an
  // ambiguous index or an unresolved in-flight task.
  try {
    const reconciliation = store.reconcile({ now: startupNow });
    if (reconciliation.conflicts.length) fail('unavailable', 'task store reconciliation found conflicts');
  } catch (error) {
    releaseOwner();
    throw toServiceError(error);
  }
  const now = () => {
    if (typeof options.now === 'function') return options.now();
    if (Number.isInteger(options.now)) return options.now;
    return Date.now();
  };
  let scheduler;
  try {
    if (options.worker !== undefined) scheduler = createTaskScheduler({ store,
      clientId: config.clientId, worker: options.worker, now });
  } catch (error) { releaseOwner(); throw toServiceError(error); }

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

    // 3. Persist new task record with fixed full base SHA as immutable metadata.
    let created;
    try {
      created = store.createTask({
        clientId: payload.clientId,
        idempotencyKey: payload.idempotencyKey,
        payload,
        baseCommit: repoValidation.baseCommitSha,
        now: now(),
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

    const runs = (Array.isArray(task.testRuns) ? task.testRuns : []).map(run => ({
      command: redactSecrets(run?.command),
      exitCode: run?.exitCode,
      durationMs: run?.durationMs,
      summary: redactSecrets(run?.summary),
      outputTail: redactSecrets(run?.outputTail),
      outputTruncated: run?.outputTruncated === true,
    }));
    const changedFiles = Array.isArray(task.changedFiles) ? task.changedFiles.map(redactSecrets) : [];
    let diff = typeof task.diff === 'string' ? redactSecrets(task.diff) : null;
    let diffTruncated = task.diffTruncated === true;
    let outputBytes = 0;
    const diffLimit = Math.min(MAX_DIFF_BYTES, task.request?.limits?.maxOutputBytes ?? MAX_DIFF_BYTES);
    if (diff !== null && Buffer.byteLength(diff, 'utf8') > diffLimit) {
      diff = truncateUtf8(diff, diffLimit);
      diffTruncated = true;
    }
    if (diff !== null) outputBytes = Buffer.byteLength(diff, 'utf8');
    let logsTruncated = false;
    const maxOutputBytes = task.request?.limits?.maxOutputBytes ?? MAX_DIFF_BYTES;
    let remainingLogBytes = Math.min(MAX_LOG_BYTES, Math.max(0, maxOutputBytes - outputBytes));
    const boundedRuns = runs.map(run => {
      const raw = typeof run.outputTail === 'string' ? run.outputTail : '';
      if (run.outputTruncated === true) logsTruncated = true;
      const cap = Math.min(remainingLogBytes, Math.max(0, maxOutputBytes - outputBytes));
      const trimmed = truncateUtf8Tail(raw, cap);
      const didTruncate = Buffer.byteLength(raw, 'utf8') > Buffer.byteLength(trimmed, 'utf8');
      if (didTruncate) logsTruncated = true;
      const emittedBytes = Buffer.byteLength(trimmed, 'utf8');
      outputBytes += emittedBytes;
      remainingLogBytes -= emittedBytes;
      return { ...run, outputTail: trimmed, outputTruncated: run.outputTruncated === true || didTruncate };
    });

    const limitations = [];
    const passed = runs.some(run => typeof run.command === 'string' && run.command.trim() && run.exitCode === 0);
    if (task.status === 'succeeded' && !passed) {
      limitations.push('success without a recorded passing test command and exit code');
    }
    if ((task.status === 'failed' || task.status === 'blocked') && diff === null) {
      limitations.push('no artifact record for a failed task');
    }

    // Unit-level local test execution is the evidence source of the M2b worker; the
    // verification state of a success claim is tracked by the recorded runs and the
    // limitations list, never by the level label alone.
    const evidenceLevel = 'unit';

    return {
      schemaVersion: SCHEMA_VERSION,
      taskId: task.taskId,
      status: task.status,
      baseCommit: redactSecrets(task.baseCommit ?? task.request?.repository?.baseRef ?? null),
      branch: redactSecrets(task.branch ?? task.request?.repository?.branch ?? null),
      headCommit: redactSecrets(task.headCommit ?? null),
      diff,
      diffTruncated,
      changedFiles,
      testRuns: boundedRuns,
      logsTruncated,
      attempts: task.attempts.map(attempt => ({
        attemptId: attempt.attemptId,
        model: redactSecrets(attempt.model),
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        outcome: redactSecrets(attempt.outcome ?? null),
      })),
      limitations,
      cost: { known: false, amount: null, currency: 'unknown', note: 'cost is unknown until a provider is authorized' },
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
      if (!scheduler) { releaseOwner(); return; }
      closing ??= scheduler.close().then(result => {
        if (result.releaseOwnership) releaseOwner();
        return result;
      });
      return closing;
    } };
}

function acquireServiceOwnership(home) {
  const locks = join(home, 'locks');
  const lockPath = join(locks, 'service-owner.lock');
  let fd;
  let created = false;
  try {
    mkdirSync(locks, { recursive: true, mode: 0o700 });
    fd = openSync(lockPath, 'wx', 0o600);
    created = true;
    writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`);
    closeSync(fd);
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
  return () => {
    if (released) return;
    try { unlinkSync(lockPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new ServiceError('unavailable', 'cannot release task store ownership', error.code);
    }
    released = true;
  };
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

function redactSecrets(value) {
  if (typeof value !== 'string') return value;
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, match => {
    const separator = match.match(/^([^:=]*[:=]\s*)/);
    return `${separator?.[1] ?? ''}[REDACTED]`;
  }), value);
}

function containsSecretPattern(value) {
  if (typeof value === 'string') return SECRET_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
  if (Array.isArray(value)) return value.some(containsSecretPattern);
  if (isPlainObject(value)) return Object.values(value).some(containsSecretPattern);
  return false;
}

function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

function truncateUtf8Tail(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

// Service surface for the M2b task contract (docs/task-contract.md, ADR-008).
// This module orchestrates the durable task store and implements the four contract
// operations: submit_task, get_task_status, get_task_result and cancel_task. It owns
// strict request validation, ownership checks, allowlist clamping, lifecycle decisions
// and sanitized error mapping. It does not execute workers; artifact collection belongs
// to the executor adapter built on top of these primitives.
//
// The service is transport neutral: it is synchronous and returns plain response
// objects, or throws ServiceError with a contract error code. The MCP/API transport
// adapter serializes the error envelope { error: { code, message } } and sets isError.

import { sep, resolve } from 'node:path';
import { TaskStoreError, openTaskStore } from './tasks.mjs';

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
    if (!allowed.has(key)) fail('invalid_argument', `unknown ${label} field: ${key}`);
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
  const now = () => {
    if (typeof options.now === 'function') return options.now();
    if (Number.isInteger(options.now)) return options.now;
    return Date.now();
  };

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
    let created;
    try {
      created = store.createTask({
        clientId: payload.clientId,
        idempotencyKey: payload.idempotencyKey,
        payload,
        now: now(),
      });
    } catch (error) {
      throw toServiceError(error);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      taskId: created.task.taskId,
      status: created.task.status,
      acceptedAt: created.task.acceptedAt,
      idempotentReplay: created.replay,
    };
  };

  const getTaskStatus = (input = {}) => {
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

    const runs = (Array.isArray(task.testRuns) ? task.testRuns : []).map(run => (
      run && typeof run.outputTail === 'string' && run.outputTail.length > MAX_LOG_BYTES
        ? { ...run, outputTail: run.outputTail.slice(0, MAX_LOG_BYTES) }
        : run
    ));
    const changedFiles = Array.isArray(task.changedFiles) ? task.changedFiles : [];
    let diff = typeof task.diff === 'string' ? task.diff : null;
    let diffTruncated = task.diffTruncated === true;
    if (diff !== null && diff.length > MAX_DIFF_BYTES) {
      diff = diff.slice(0, MAX_DIFF_BYTES);
      diffTruncated = true;
    }

    const limitations = [];
    const passed = runs.some(run => run && run.exitCode === 0);
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
      baseCommit: task.baseCommit ?? task.request?.repository?.baseRef ?? null,
      branch: task.branch ?? task.request?.repository?.branch ?? null,
      headCommit: task.headCommit ?? null,
      diff,
      diffTruncated,
      changedFiles,
      testRuns: runs,
      attempts: task.attempts,
      limitations,
      cost: { known: false, amount: null, currency: 'unknown', note: 'cost is unknown until a provider is authorized' },
      evidenceLevel,
      sanitized: true,
    };
  };

  const cancelTask = (input = {}) => {
    const task = requireOwned(input.taskId);
    const reason = input.reason;
    if (reason !== undefined && typeof reason !== 'string') fail('invalid_argument', 'cancel reason must be a string');
    const at = now();
    if (RESULT_STATUSES.includes(task.status)) {
      return { schemaVersion: SCHEMA_VERSION, cancelRequestedAt: task.cancel.requestedAt, status: task.status, effect: 'already_terminal' };
    }
    if (task.status === 'queued') {
      const cancelled = store.updateTask(task.taskId, draft => {
        draft.status = 'cancelled';
        draft.finishedAt = at;
        draft.cancel.requestedAt = at;
        draft.cancel.executionStopped = true;
        draft.cancel.effectsReverted = false;
        draft.block = null;
        draft.progress.push({ at, event: 'cancel', detail: reason ?? null });
      });
      return { schemaVersion: SCHEMA_VERSION, cancelRequestedAt: at, status: 'cancelled', effect: 'not_started' };
    }
    // running: the stop cannot be proven here, so the task blocks until reconciliation.
    const blocked = store.updateTask(task.taskId, draft => {
      draft.cancel.requestedAt = at;
      draft.status = 'blocked';
      draft.finishedAt = at;
      draft.block = { reason: 'cancelled-uncertain', requiresReconciliation: true };
      draft.progress.push({ at, event: 'blocked', detail: 'cancelled-uncertain' });
    });
    return { schemaVersion: SCHEMA_VERSION, cancelRequestedAt: at, status: 'blocked', effect: 'requested' };
  };

  return { store, config, now, submitTask, getTaskStatus, getTaskResult, cancelTask };
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
    const resolvedWritablePath = resolve(writablePath);
    const allowed = writableRoots.some(root => resolvedWritablePath === root || resolvedWritablePath.startsWith(root + sep));
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

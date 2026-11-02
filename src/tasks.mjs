import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Durable task records (M2b step 2). This module owns persistence, the idempotency
// index and startup reconciliation. It does not implement the four operations, the
// executor or cancellation; those build on top of these primitives.
//
// Scope: one local service process, a trusted directory and cooperative writers.
// Atomic writes follow ADR-004 (exclusive temp file, fsync, rename in the same
// directory). There is no cross-process lock here; M2b runs one task at a time and
// the service owns the records. A crash between the record and the index write is
// repaired by reconcile(), which rebuilds a missing entry from the record.

const SCHEMA_VERSION = 1;
const STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const DIGEST = /^[a-f0-9]{64}$/;

export const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class TaskStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TaskStoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TaskStoreError(code, message);
}

// Persistence failures keep the OS error code (never the message, which repeats the
// absolute path) so a maintainer can tell ENOSPC from EPERM without leaking locations.
function unavailable(message, cause) {
  const error = new TaskStoreError('unavailable', message);
  error.osCode = typeof cause?.code === 'string' ? cause.code : 'unknown';
  throw error;
}

const isTimestamp = value => Number.isInteger(value) && value >= 0;

// Canonical form used for the idempotency hash: sorted keys, no whitespace and no
// clientSessionId, which is correlation metadata and never an authority.
export function canonicalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    fail('invalid_argument', 'payload must be an object');
  const { clientSessionId, ...rest } = payload;
  void clientSessionId;
  return stringify(rest);
}

function stringify(value) {
  if (Array.isArray(value)) return `[${value.map(stringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stringify(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('invalid_argument', 'payload contains an unsupported value');
  return encoded;
}

export function defaultHome(env = process.env, platform = process.platform) {
  if (env.AI_ORCHESTRATOR_HOME) return resolve(env.AI_ORCHESTRATOR_HOME);
  const base = platform === 'win32'
    ? env.LOCALAPPDATA ?? join(env.USERPROFILE ?? homedir(), 'AppData', 'Local')
    : env.XDG_STATE_HOME ?? join(env.HOME ?? homedir(), '.local', 'state');
  return join(base, 'ai-orchestrator');
}

export function openTaskStore(options = {}) {
  const home = resolve(options.home ?? defaultHome());
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const tasksDir = join(home, 'tasks');
  const indexDir = join(home, 'idempotency');

  // The contract also names locks/ and artifacts/. Step 2 does not use them, so they
  // are not created here: an empty directory would suggest locking or artifact storage
  // that does not exist yet. The step that needs one creates it.
  for (const directory of [home, tasksDir, indexDir]) {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    } catch (error) {
      unavailable('cannot prepare the task store directory', error);
    }
  }

  const taskPath = taskId => join(tasksDir, `${taskId}.json`);

  const indexName = (clientId, idempotencyKey) =>
    createHash('sha256').update(`${clientId}\u0000${idempotencyKey}`).digest('hex');

  const indexPath = (clientId, idempotencyKey) =>
    join(indexDir, `${indexName(clientId, idempotencyKey)}.json`);

  const writeJson = (directory, name, value) => {
    const target = join(directory, name);
    const temp = join(directory, `.${name}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(value), 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, target); // Same directory; never truncate a committed record.
    } catch (error) {
      // Only the OS error code is reported: filesystem messages repeat the full path.
      unavailable('cannot persist task state', error);
    } finally {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* Already failing. */ } }
      try { unlinkSync(temp); } catch { /* Absent on success or already removed. */ }
    }
  };

  // Returns undefined when the file does not exist; every other failure is fatal for
  // the caller so an unreadable record never looks like an absent one.
  const readJson = (path, message) => {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      unavailable(message, error);
    }
    try {
      return JSON.parse(text);
    } catch {
      fail('unavailable', message);
    }
  };

  const readTask = taskId => {
    if (typeof taskId !== 'string' || !IDENTIFIER.test(taskId))
      fail('invalid_argument', 'taskId is not a valid identifier');
    const record = readJson(taskPath(taskId), 'task record is unreadable');
    if (record === undefined) fail('unknown_task', 'no task record for that id');
    try { validateTask(record); }
    catch { fail('unavailable', 'task record failed validation'); }
    if (record.taskId !== taskId) fail('unavailable', 'task record identity mismatch');
    return record;
  };

  const writeTask = task => {
    writeJson(tasksDir, `${task.taskId}.json`, task);
  };

  const readIndex = (clientId, idempotencyKey) => {
    const entry = readJson(indexPath(clientId, idempotencyKey), 'idempotency index is unreadable');
    if (entry === undefined) return undefined;
    try { validateIndex(entry); }
    catch { fail('unavailable', 'idempotency index failed validation'); }
    return entry;
  };

  const listTasks = () => {
    let names;
    try {
      names = readdirSync(tasksDir);
    } catch (error) {
      unavailable('cannot read the task store', error);
    }
    return names
      .filter(name => name.endsWith('.json'))
      .sort()
      .map(name => readTask(name.slice(0, -'.json'.length)));
  };

  const createTask = ({ clientId, idempotencyKey, payload, now = Date.now() } = {}) => {
    if (typeof clientId !== 'string' || !IDENTIFIER.test(clientId))
      fail('invalid_argument', 'clientId is not a valid identifier');
    if (typeof idempotencyKey !== 'string' || !IDENTIFIER.test(idempotencyKey))
      fail('invalid_argument', 'idempotencyKey is not a valid identifier');
    if (!isTimestamp(now)) fail('invalid_argument', 'now is not a timestamp');

    const canonical = canonicalPayload(payload);
    const payloadHash = createHash('sha256').update(canonical).digest('hex');
    const existing = readIndex(clientId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.payloadHash !== payloadHash)
        fail('idempotency_conflict', 'idempotency key was used with a different payload');
      return { task: structuredClone(readTask(existing.taskId)), replay: true };
    }

    const { clientSessionId, ...request } = payload;
    void clientSessionId;
    const task = {
      schemaVersion: SCHEMA_VERSION,
      taskId: randomUUID(),
      clientId,
      idempotencyKey,
      payloadHash,
      request,
      status: 'queued',
      createdAt: now,
      acceptedAt: now,
      startedAt: null,
      finishedAt: null,
      attempts: [],
      cancel: { requestedAt: null, executionStopped: null, effectsReverted: false },
      block: null,
      progress: [{ at: now, event: 'accepted', detail: null }],
    };
    validateTask(task);
    // Persist the record before the index: a crash in between leaves a readable task
    // that reconcile() indexes again, instead of an index pointing at nothing.
    writeTask(task);
    try {
      writeJson(indexDir, `${indexName(clientId, idempotencyKey)}.json`, {
        schemaVersion: SCHEMA_VERSION,
        clientId,
        idempotencyKey,
        payloadHash,
        taskId: task.taskId,
      });
    } catch (error) {
      // Without the index the next submit would create a duplicate task, so remove the
      // orphan record and fail. If that cleanup also fails, the store stays unavailable
      // until reconcile() repairs it at startup.
      try {
        unlinkSync(taskPath(task.taskId));
      } catch {
        unavailable('cannot persist the idempotency index', error);
      }
      throw error;
    }
    return { task: structuredClone(task), replay: false };
  };

  const updateTask = (taskId, mutate) => {
    if (typeof mutate !== 'function') fail('invalid_argument', 'mutate must be a function');
    const draft = structuredClone(readTask(taskId));
    const result = mutate(draft);
    const next = result === undefined ? draft : result;
    validateTask(next);
    if (next.taskId !== taskId) fail('invalid_argument', 'a task record cannot change identity');
    writeTask(next);
    return structuredClone(next);
  };

  // Startup reconciliation. A running task, or a queued task that already dispatched
  // an attempt, becomes blocked: a restart never proves that effects stopped and no
  // task is ever replayed. Missing idempotency entries are rebuilt from the records.
  const reconcile = ({ now = Date.now() } = {}) => {
    if (!isTimestamp(now)) fail('invalid_argument', 'now is not a timestamp');
    const blocked = [];
    const repaired = [];
    const conflicts = [];
    const tasks = listTasks();
    // Preflight every existing index before changing any task. An ambiguous mapping
    // must leave active execution records untouched for explicit maintainer review.
    const identities = new Map();
    for (const task of tasks) {
      const identity = indexName(task.clientId, task.idempotencyKey);
      const prior = identities.get(identity) ?? [];
      prior.push(task.taskId);
      identities.set(identity, prior);
    }
    for (const taskIds of identities.values()) {
      if (taskIds.length > 1) conflicts.push(...taskIds);
    }
    for (const task of tasks) {
      const entry = readJson(join(indexDir, `${indexName(task.clientId, task.idempotencyKey)}.json`), 'idempotency index is unreadable');
      if (entry !== undefined) {
        try { validateIndex(entry); }
        catch { fail('unavailable', 'idempotency index failed validation'); }
        if (entry.clientId !== task.clientId || entry.idempotencyKey !== task.idempotencyKey || entry.taskId !== task.taskId || entry.payloadHash !== task.payloadHash) {
          if (!conflicts.includes(task.taskId)) conflicts.push(task.taskId);
        }
      }
    }
    if (conflicts.length) return { blocked, repaired, conflicts };
    for (const task of tasks) {
      if (task.status === 'running' || (task.status === 'queued' && task.attempts.length > 0)) {
        const next = structuredClone(task);
        next.status = 'blocked';
        next.cancel.executionStopped = 'unknown';
        next.finishedAt ??= now;
        next.block = { reason: 'service-restart', requiresReconciliation: true };
        next.progress.push({ at: now, event: 'blocked', detail: 'service-restart' });
        validateTask(next);
        writeTask(next);
        blocked.push(task.taskId);
      }
      const name = `${indexName(task.clientId, task.idempotencyKey)}.json`;
      const entry = readJson(join(indexDir, name), 'idempotency index is unreadable');
      if (entry === undefined) {
        writeJson(indexDir, name, {
          schemaVersion: SCHEMA_VERSION,
          clientId: task.clientId,
          idempotencyKey: task.idempotencyKey,
          payloadHash: task.payloadHash,
          taskId: task.taskId,
        });
        repaired.push(task.taskId);
      }
    }
    return { blocked, repaired, conflicts };
  };

  // Explicit maintenance only. Blocked records are never removed automatically; other
  // terminal records expire after the retention window (30 days by default).
  const prune = ({ now = Date.now(), retentionMs: override } = {}) => {
    if (!isTimestamp(now)) fail('invalid_argument', 'now is not a timestamp');
    const window = override ?? retentionMs;
    if (!isTimestamp(window)) fail('invalid_argument', 'retentionMs is not a duration');
    const removed = [];
    for (const task of listTasks()) {
      if (!TERMINAL.has(task.status)) continue;
      const at = task.finishedAt ?? task.createdAt;
      if (at >= now - window) continue;
      try {
        unlinkSync(taskPath(task.taskId));
      } catch (error) {
        if (error.code !== 'ENOENT') unavailable('cannot remove an expired task record', error);
      }
      const path = indexPath(task.clientId, task.idempotencyKey);
      const entry = readJson(path, 'idempotency index is unreadable');
      if (entry !== undefined && entry.taskId === task.taskId) {
        try {
          unlinkSync(path);
        } catch (error) {
          if (error.code !== 'ENOENT') unavailable('cannot remove an expired index entry', error);
        }
      }
      removed.push(task.taskId);
    }
    return { removed };
  };

  return {
    home,
    paths: { tasks: tasksDir, idempotency: indexDir },
    createTask,
    readTask: taskId => structuredClone(readTask(taskId)),
    updateTask,
    listTasks: () => structuredClone(listTasks()),
    reconcile,
    prune,
  };
}

function validateTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task))
    fail('invalid_argument', 'task record must be an object');
  if (task.schemaVersion !== SCHEMA_VERSION)
    fail('invalid_argument', 'unsupported task schema version');
  for (const field of ['taskId', 'clientId', 'idempotencyKey'])
    if (typeof task[field] !== 'string' || !IDENTIFIER.test(task[field]))
      fail('invalid_argument', `${field} is not a valid identifier`);
  if (typeof task.payloadHash !== 'string' || !DIGEST.test(task.payloadHash))
    fail('invalid_argument', 'payloadHash is not a SHA-256 hex digest');
  if (!STATUSES.has(task.status)) fail('invalid_argument', 'unknown task status');
  for (const field of ['createdAt', 'acceptedAt'])
    if (!isTimestamp(task[field]))
      fail('invalid_argument', `${field} is not a timestamp`);
  for (const field of ['startedAt', 'finishedAt'])
    if (task[field] !== null && !isTimestamp(task[field]))
      fail('invalid_argument', `${field} is not a timestamp or null`);

  if (!Array.isArray(task.attempts)) fail('invalid_argument', 'attempts must be an array');
  for (const attempt of task.attempts) {
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt))
      fail('invalid_argument', 'attempt must be an object');
    if (typeof attempt.attemptId !== 'string' || !IDENTIFIER.test(attempt.attemptId))
      fail('invalid_argument', 'attemptId is not a valid identifier');
    if (typeof attempt.model !== 'string' || attempt.model.length === 0)
      fail('invalid_argument', 'attempt model is required');
    if (!isTimestamp(attempt.startedAt))
      fail('invalid_argument', 'attempt startedAt is not a timestamp');
    if (attempt.finishedAt !== null && attempt.finishedAt !== undefined && !isTimestamp(attempt.finishedAt))
      fail('invalid_argument', 'attempt finishedAt is not a timestamp or null');
  }

  const cancel = task.cancel;
  if (!cancel || typeof cancel !== 'object' || Array.isArray(cancel))
    fail('invalid_argument', 'cancel state must be an object');
  if (cancel.requestedAt !== null && !isTimestamp(cancel.requestedAt))
    fail('invalid_argument', 'cancel.requestedAt is not a timestamp or null');
  if (![null, true, 'unknown'].includes(cancel.executionStopped))
    fail('invalid_argument', 'cancel.executionStopped must be null, true or unknown');
  if (cancel.effectsReverted !== false)
    fail('invalid_argument', 'cancel.effectsReverted must stay false');

  if (task.block !== null) {
    if (!task.block || typeof task.block !== 'object' || Array.isArray(task.block))
      fail('invalid_argument', 'block state must be an object or null');
    if (typeof task.block.reason !== 'string' || task.block.reason.length === 0)
      fail('invalid_argument', 'block reason is required');
    if (task.block.requiresReconciliation !== true)
      fail('invalid_argument', 'a blocked task always requires reconciliation');
  }

  if (!Array.isArray(task.progress)) fail('invalid_argument', 'progress must be an array');
  for (const entry of task.progress) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      fail('invalid_argument', 'progress entry must be an object');
    if (!isTimestamp(entry.at)) fail('invalid_argument', 'progress timestamp is required');
    if (typeof entry.event !== 'string' || entry.event.length === 0)
      fail('invalid_argument', 'progress event is required');
    if (entry.detail !== null && entry.detail !== undefined && typeof entry.detail !== 'string')
      fail('invalid_argument', 'progress detail must be a string or null');
  }
}

function validateIndex(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    fail('invalid_argument', 'idempotency entry must be an object');
  if (entry.schemaVersion !== SCHEMA_VERSION)
    fail('invalid_argument', 'unsupported idempotency schema version');
  for (const field of ['clientId', 'idempotencyKey', 'taskId'])
    if (typeof entry[field] !== 'string' || !IDENTIFIER.test(entry[field]))
      fail('invalid_argument', `${field} is not a valid identifier`);
  if (typeof entry.payloadHash !== 'string' || !DIGEST.test(entry.payloadHash))
    fail('invalid_argument', 'payloadHash is not a SHA-256 hex digest');
}

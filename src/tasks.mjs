import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// Durable task records (M2b step 2). This module owns persistence, the idempotency
// index and startup reconciliation. It does not implement the four operations, the
// executor or cancellation; those build on top of these primitives.
//
// Scope: a local service/maintainer process, trusted directory and cooperative
// writers. Service and maintainer ownership interlock; ordinary store reads/updates
// are not a hostile-writer transaction. Atomic writes follow ADR-004 (exclusive
// temp file, fsync, rename in the same directory). A crash between record and index
// writes is repaired by reconcile(), which rebuilds a missing entry from the record.

const SCHEMA_VERSION = 1;
const STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
// Ordinary updates cannot reconcile blocked work or prove a running worker stopped.
// Those require separately designed maintainer/executor operations.
const TRANSITIONS = {
  queued: ['running', 'cancelled', 'blocked'],
  running: ['succeeded', 'failed', 'blocked'],
  succeeded: [], failed: [], cancelled: [], blocked: [],
};
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
  if (!options || typeof options !== 'object' || Array.isArray(options))
    fail('invalid_argument', 'openTaskStore options must be an object');
  const home = resolve(options.home ?? defaultHome());
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  if (!isTimestamp(retentionMs)) fail('invalid_argument', 'retentionMs is not a duration');
  return createTaskStore({ home, retentionMs }, null);
}

function createTaskStore({ home, retentionMs }, maintenanceCapability) {
  const tasksDir = join(home, 'tasks');
  const indexDir = join(home, 'idempotency');
  const locksDir = join(home, 'locks');
  const ownsServiceLock = token => {
    if (typeof token !== 'string') return false;
    try { return JSON.parse(readFileSync(join(locksDir, 'service-owner.lock'), 'utf8')).nonce === token; }
    catch { return false; }
  };
  const ownsMaintenanceCapability = capability => {
    if (!maintenanceCapability || capability !== maintenanceCapability || existsSync(join(locksDir, 'service-owner.lock'))) return false;
    try {
      const lock = JSON.parse(readFileSync(join(locksDir, 'maintenance-owner.lock'), 'utf8'));
      return lock.nonce === maintenanceCapability.lockNonce;
    }
    catch { return false; }
  };

  // Lock coordination and prune journals use locks/. Artifacts remain a separate
  // directory created by the artifact producer when it needs one.
  for (const directory of [home, tasksDir, indexDir, locksDir]) {
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

  const pruneJournalPath = taskId => join(home, 'locks', `prune-${taskId}.json`);

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

  const listPrunedKeys = () => readdirSync(indexDir).filter(name => name.endsWith('.json')).sort()
    .map(name => readJson(join(indexDir, name), 'idempotency index is unreadable'))
    .filter(entry => {
      if (entry === undefined) return false;
      try { validateIndex(entry); } catch { fail('unavailable', 'idempotency index failed validation'); }
      return entry.prunedAt !== undefined;
    });

  const repairPruneJournals = ({ ownershipToken } = {}) => {
    if (!ownsServiceLock(ownershipToken) && !ownsMaintenanceCapability(ownershipToken))
      fail('unavailable', 'prune-journal repair requires scoped service or maintenance authority');
    const repaired = [];
    for (const name of readdirSync(locksDir).filter(n => /^prune-[A-Za-z0-9._:-]+\.json$/.test(n))) {
      const journal = readJson(join(locksDir, name), 'prune journal is unreadable');
      if (!journal || journal.schemaVersion !== 1 || typeof journal.taskId !== 'string' ||
          !IDENTIFIER.test(journal.taskId) || typeof journal.clientId !== 'string' ||
          !IDENTIFIER.test(journal.clientId) || typeof journal.idempotencyKey !== 'string' ||
          !IDENTIFIER.test(journal.idempotencyKey) || typeof journal.payloadHash !== 'string' ||
          !DIGEST.test(journal.payloadHash) || typeof journal.indexName !== 'string' ||
          !/^[a-f0-9]{64}\.json$/.test(journal.indexName) || !isTimestamp(journal.startedAt) ||
          journal.indexName !== `${indexName(journal.clientId, journal.idempotencyKey)}.json` ||
          name !== `prune-${journal.taskId}.json`)
        fail('unavailable', 'prune journal failed validation');
      if (existsSync(taskPath(journal.taskId))) {
        const retained = readTask(journal.taskId);
        if (retained.clientId !== journal.clientId || retained.idempotencyKey !== journal.idempotencyKey ||
            retained.payloadHash !== journal.payloadHash)
          fail('unavailable', 'prune journal conflicts with a task record');
        try { unlinkSync(join(locksDir, name)); } catch (error) { if (error.code !== 'ENOENT') unavailable('cannot clear unused prune journal', error); }
        repaired.push(journal.taskId);
        continue;
      }
      const indexFile = join(indexDir, journal.indexName);
      const entry = readJson(indexFile, 'idempotency index is unreadable');
      if (entry !== undefined) {
        try { validateIndex(entry); } catch { fail('unavailable', 'idempotency index failed validation'); }
        if (entry.taskId !== journal.taskId || entry.clientId !== journal.clientId ||
            entry.idempotencyKey !== journal.idempotencyKey || entry.payloadHash !== journal.payloadHash)
          fail('unavailable', 'prune journal conflicts with an idempotency entry');
      }
      const tombstone = { schemaVersion: SCHEMA_VERSION, clientId: journal.clientId,
        idempotencyKey: journal.idempotencyKey, payloadHash: journal.payloadHash,
        taskId: journal.taskId, prunedAt: entry?.prunedAt ?? journal.startedAt };
      if (entry?.prunedAt === undefined) writeJson(indexDir, journal.indexName, tombstone);
      try { unlinkSync(join(locksDir, name)); } catch (error) { if (error.code !== 'ENOENT') unavailable('cannot clear prune journal', error); }
      repaired.push(journal.taskId);
    }
    return { repaired };
  };

  const findIdempotentTask = (clientId, idempotencyKey, payload) => {
    if (typeof clientId !== 'string' || !IDENTIFIER.test(clientId))
      fail('invalid_argument', 'clientId is not a valid identifier');
    if (typeof idempotencyKey !== 'string' || !IDENTIFIER.test(idempotencyKey))
      fail('invalid_argument', 'idempotencyKey is not a valid identifier');
    const canonical = canonicalPayload(payload);
    const payloadHash = createHash('sha256').update(canonical).digest('hex');
    const existing = readIndex(clientId, idempotencyKey);
    if (existing === undefined) return undefined;
    if (existing.payloadHash !== payloadHash)
      fail('idempotency_conflict', 'idempotency key was used with a different payload');
    if (existing.prunedAt !== undefined)
      fail('unavailable', 'task result was pruned; its idempotency key remains reserved');
    return readTask(existing.taskId);
  };

  const createTask = ({ clientId, idempotencyKey, payload, now = Date.now(), baseCommit = null } = {}) => {
    if (typeof clientId !== 'string' || !IDENTIFIER.test(clientId))
      fail('invalid_argument', 'clientId is not a valid identifier');
    if (typeof idempotencyKey !== 'string' || !IDENTIFIER.test(idempotencyKey))
      fail('invalid_argument', 'idempotencyKey is not a valid identifier');
    if (!isTimestamp(now)) fail('invalid_argument', 'now is not a timestamp');
    if (baseCommit !== null && baseCommit !== undefined && (typeof baseCommit !== 'string' || !/^[0-9a-f]{40,64}$/.test(baseCommit))) {
      fail('invalid_argument', 'baseCommit must be a full commit SHA or null');
    }

    const canonical = canonicalPayload(payload);
    const payloadHash = createHash('sha256').update(canonical).digest('hex');
    const existing = readIndex(clientId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.payloadHash !== payloadHash)
        fail('idempotency_conflict', 'idempotency key was used with a different payload');
      if (existing.prunedAt !== undefined)
        fail('unavailable', 'task result was pruned; its idempotency key remains reserved');
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
      baseCommit: baseCommit ?? null,
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
    const previous = readTask(taskId);
    const draft = structuredClone(previous);
    const result = mutate(draft);
    const next = result === undefined ? draft : result;
    validateTask(next);
    if (next.taskId !== taskId) fail('invalid_argument', 'a task record cannot change identity');
    validateUpdate(previous, next);
    writeTask(next);
    return structuredClone(next);
  };

  // Startup reconciliation. A running task, or a queued task that already dispatched
  // an attempt, becomes blocked: a restart never proves that effects stopped and no
  // task is ever replayed. Missing idempotency entries are rebuilt from the records.
  const reconcile = ({ now = Date.now(), ownershipToken } = {}) => {
    if (!ownsServiceLock(ownershipToken) && !ownsMaintenanceCapability(ownershipToken))
      fail('unavailable', 'reconciliation requires scoped service or maintenance authority');
    if (!isTimestamp(now)) fail('invalid_argument', 'now is not a timestamp');
    const blocked = [];
    const repaired = [];
    const conflicts = [];
    // Finish only explicitly journaled prune operations; never discard an orphan index.
    repairPruneJournals({ ownershipToken });
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
        validateUpdate(task, next);
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
  // terminal records expire after the configured retention window (30 days by default).
  const prune = ({ now = Date.now(), retentionMs: override, maintenanceCapability } = {}) => {
    if (!ownsMaintenanceCapability(maintenanceCapability))
      fail('unavailable', 'pruning requires exclusive maintainer ownership');
    if (!isTimestamp(now)) fail('invalid_argument', 'now is not a timestamp');
    const window = override ?? retentionMs;
    if (!isTimestamp(window)) fail('invalid_argument', 'retentionMs is not a duration');
    const removed = [];
    for (const task of listTasks()) {
      if (!TERMINAL.has(task.status)) continue;
      const at = task.finishedAt ?? task.createdAt;
      if (at >= now - window) continue;
      const hashedIndexName = `${indexName(task.clientId, task.idempotencyKey)}.json`;
      const existingIndex = readJson(indexPath(task.clientId, task.idempotencyKey), 'idempotency index is unreadable');
      if (existingIndex !== undefined) {
        try { validateIndex(existingIndex); } catch { fail('unavailable', 'idempotency index failed validation'); }
        if (existingIndex.clientId !== task.clientId || existingIndex.idempotencyKey !== task.idempotencyKey ||
            existingIndex.payloadHash !== task.payloadHash || existingIndex.taskId !== task.taskId)
          fail('unavailable', 'expired task conflicts with its idempotency index');
      }
      const journal = { schemaVersion: 1, taskId: task.taskId, clientId: task.clientId,
        idempotencyKey: task.idempotencyKey, payloadHash: task.payloadHash,
        indexName: hashedIndexName, startedAt: now };
      writeJson(locksDir, `prune-${task.taskId}.json`, journal);
      try {
        unlinkSync(taskPath(task.taskId));
      } catch (error) {
        if (error.code !== 'ENOENT') unavailable('cannot remove an expired task record', error);
      }
      const path = indexPath(task.clientId, task.idempotencyKey);
      const entry = readJson(path, 'idempotency index is unreadable');
      if (entry !== undefined && entry.taskId === task.taskId) {
        writeJson(indexDir, hashedIndexName, { schemaVersion: SCHEMA_VERSION,
          clientId: task.clientId, idempotencyKey: task.idempotencyKey,
          payloadHash: task.payloadHash, taskId: task.taskId, prunedAt: now });
      } else if (entry === undefined) {
        writeJson(indexDir, hashedIndexName, { schemaVersion: SCHEMA_VERSION,
          clientId: task.clientId, idempotencyKey: task.idempotencyKey,
          payloadHash: task.payloadHash, taskId: task.taskId, prunedAt: now });
      } else fail('unavailable', 'expired task conflicts with its idempotency index');
      try { unlinkSync(pruneJournalPath(task.taskId)); } catch (error) { if (error.code !== 'ENOENT') unavailable('cannot clear prune journal', error); }
      removed.push(task.taskId);
    }
    return { removed };
  };

  const reconcileBlocked = ({ taskId, decision, actor, reason, evidence, now: at = Date.now(),
    maintenanceCapability } = {}) => {
    if (!ownsMaintenanceCapability(maintenanceCapability))
      fail('unavailable', 'reconciliation requires exclusive maintainer ownership');
    if (!isTimestamp(at) || !IDENTIFIER.test(taskId ?? '') || !['failed', 'cancelled'].includes(decision) ||
        typeof actor !== 'string' || !actor.trim() || actor.length > 128 ||
        typeof reason !== 'string' || !reason.trim() || reason.length > 1000 ||
        !evidence || typeof evidence !== 'object' || Array.isArray(evidence))
      fail('invalid_argument', 'reconciliation requires actor, reason and bound evidence');
    const task = readTask(taskId);
    const recordBytes = readFileSync(taskPath(taskId));
    const recordDigest = createHash('sha256').update(recordBytes).digest('hex');
    const expectedKeys = ['taskId', 'fromStatus', 'decision', 'recordDigest', 'observation', 'outcomeAssessment',
      'workerStopped', 'processTreeChecked', 'inventoryComplete', 'inventorySource',
      'liveWorkerPids', 'observedAt'];
    if (Object.keys(evidence).sort().join(',') !== expectedKeys.sort().join(',') ||
        evidence.taskId !== taskId || evidence.fromStatus !== 'blocked' || evidence.decision !== decision ||
        typeof evidence.observation !== 'string' || !evidence.observation.trim() || evidence.observation.length > 2000 ||
        !['known-failure', 'unknown', 'cancel-request'].includes(evidence.outcomeAssessment) ||
        evidence.workerStopped !== true || evidence.processTreeChecked !== true || evidence.inventoryComplete !== true ||
        typeof evidence.inventorySource !== 'string' || !evidence.inventorySource.trim() || evidence.inventorySource.length > 500 ||
        !Array.isArray(evidence.liveWorkerPids) || evidence.liveWorkerPids.length !== 0 || !isTimestamp(evidence.observedAt))
      fail('invalid_argument', 'reconciliation evidence is absent, forged or conflicts with current state');
    if (task.reconciliation) {
      if (task.reconciliation.decision === decision && task.reconciliation.actor === actor &&
          task.reconciliation.reason === reason && stringify(task.reconciliation.evidence) === stringify(evidence))
        return structuredClone(task);
      fail('internal', 'task already has a conflicting reconciliation decision');
    }
    if (evidence.recordDigest !== recordDigest)
      fail('invalid_argument', 'reconciliation evidence does not bind the current committed record');
    if (task.status !== 'blocked') fail('internal', 'only blocked tasks can be reconciled');
    let administrativeOutcome;
    if (decision === 'failed') {
      const knownFailure = task.attempts.length > 0 && task.attempts.every(a => isTimestamp(a.finishedAt) &&
        ['failed', 'spawn-error', 'launch-failed'].includes(a.outcome));
      if (evidence.outcomeAssessment === 'known-failure') {
        if (!knownFailure) fail('invalid_argument', 'known-failure closure requires recorded completed failure outcomes');
        administrativeOutcome = 'known-failure';
      } else if (evidence.outcomeAssessment === 'unknown') {
        if (!task.attempts.some(a => a.finishedAt == null || a.outcome === 'unknown'))
          fail('invalid_argument', 'unknown-outcome closure requires an unfinished or explicitly unknown dispatch attempt');
        administrativeOutcome = 'unknown';
      } else fail('invalid_argument', 'failed recovery requires known-failure or explicit unknown-outcome assessment');
    } else if (task.cancel.requestedAt === null || evidence.outcomeAssessment !== 'cancel-request') {
      fail('invalid_argument', 'cancelled recovery requires a persisted cancellation request');
    } else administrativeOutcome = 'cancel-request';
    const next = structuredClone(task);
    next.status = decision;
    next.finishedAt = at;
    next.block = null;
    next.cancel.executionStopped = administrativeOutcome === 'unknown' ? 'unknown' : true;
    next.cancel.effectsReverted = false;
    next.reconciliation = { actor, reason, decision, fromStatus: 'blocked', recordDigest,
      priorBlock: structuredClone(task.block), administrativeOutcome,
      evidenceDigest: createHash('sha256').update(stringify(evidence)).digest('hex'),
      evidence: structuredClone(evidence), reconciledAt: at };
    next.progress.push({ at, event: 'maintainer-reconciliation', detail: decision });
    validateTask(next);
    validateMaintenanceUpdate(task, next);
    writeTask(next);
    return structuredClone(next);
  };

  return {
    home,
    paths: { tasks: tasksDir, idempotency: indexDir },
    createTask,
    findIdempotentTask: (clientId, key, payload) => {
      const found = findIdempotentTask(clientId, key, payload);
      return found ? structuredClone(found) : undefined;
    },
    readTask: taskId => structuredClone(readTask(taskId)),
    updateTask,
    listTasks: () => structuredClone(listTasks()),
    listPrunedKeys: () => structuredClone(listPrunedKeys()),
    reconcile,
    repairPruneJournals,
    reconcileBlocked,
    prune,
  };
}

// Maintainer-only cooperative exclusion. This is deliberately separate from the
// service API and is never passed to a worker or transport adapter.
export function openTaskMaintenance({ home, now = Date.now(), retentionMs = DEFAULT_RETENTION_MS, recoverStaleOwner } = {}) {
  if (!isTimestamp(now)) fail('invalid_argument', 'now is not a timestamp');
  if (!isTimestamp(retentionMs)) fail('invalid_argument', 'retentionMs is not a duration');
  const root = resolve(home ?? defaultHome());
  const locks = join(root, 'locks');
  try { mkdirSync(locks, { recursive: true, mode: 0o700 }); }
  catch (error) { unavailable('cannot prepare maintenance lock', error); }
  const lockPath = join(locks, 'maintenance-owner.lock');
  const servicePath = join(locks, 'service-owner.lock');
  const recoveryPath = join(locks, 'owner-recovery.lock');
  if (existsSync(recoveryPath)) fail('unavailable', 'owner recovery gate exists; preserve state and inspect it');
  let recoveryGateBytes;
  const recoveryKind = recoverStaleOwner?.lockKind ?? 'service';
  if (recoverStaleOwner?.lockKind !== undefined && !['service', 'maintenance'].includes(recoverStaleOwner.lockKind))
    fail('invalid_argument', 'lockKind must be service or maintenance');
  const recoveryTarget = recoveryKind === 'maintenance' ? lockPath : servicePath;
  if (recoverStaleOwner && existsSync(recoveryTarget)) {
    recoveryGateBytes = acquireRecoveryGate(recoveryPath, now);
    try { removeVerifiedStaleLock(recoveryTarget, recoverStaleOwner, now, recoveryKind); }
    catch (error) {
      releaseRecoveryGate(recoveryPath, recoveryGateBytes);
      throw error;
    }
  }
  const maintenanceLockNonce = randomUUID();
  const maintenanceCapability = Object.freeze({ lockNonce: maintenanceLockNonce });
  let fd;
  let lockCreated = false;
  try {
    fd = openSync(lockPath, 'wx', 0o600);
    lockCreated = true;
    writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: now, nonce: maintenanceLockNonce })}\n`);
    fsyncSync(fd); closeSync(fd); fd = undefined;
    if (existsSync(servicePath))
      fail('unavailable', 'service ownership appeared during maintenance acquisition');
    if (recoveryGateBytes) releaseRecoveryGate(recoveryPath, recoveryGateBytes);
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    if (lockCreated) { try { unlinkSync(lockPath); } catch {} }
    if (recoveryGateBytes) { try { releaseRecoveryGate(recoveryPath, recoveryGateBytes); } catch {} }
    if (error instanceof TaskStoreError) throw error;
    if (error.code === 'EEXIST') fail('unavailable', 'another owner holds task-store maintenance');
    unavailable('cannot acquire task-store maintenance', error);
  }
  let store;
  try { store = createTaskStore({ home: root, retentionMs }, maintenanceCapability); }
  catch (error) { try { unlinkSync(lockPath); } catch {} throw error; }
  let closed = false;
  const guard = fn => (...args) => {
    if (closed) fail('unavailable', 'maintenance handle is closed');
    if (existsSync(join(locks, 'service-owner.lock'))) fail('unavailable', 'service ownership appeared during maintenance');
    return fn(...args);
  };
  const taskDigest = taskId => {
    const task = store.readTask(taskId);
    const bytes = readFileSync(join(root, 'tasks', `${taskId}.json`));
    return { task, recordDigest: createHash('sha256').update(bytes).digest('hex') };
  };
  const inspectStore = guard(() => ({ tasks: store.listTasks(), prunedKeys: store.listPrunedKeys(), pruneJournals:
    readdirSync(locks).filter(name => /^prune-[A-Za-z0-9._:-]+\.json$/.test(name))
      .sort().map(name => {
        try { return { name, content: JSON.parse(readFileSync(join(locks, name), 'utf8')) }; }
        catch { fail('unavailable', 'prune journal is unreadable'); }
      }) }));
  const reconcileBlocked = guard(input => store.reconcileBlocked({ ...input, now, maintenanceCapability }));
  return {
    home: root,
    inspectStore,
    inspectTask: guard(taskDigest),
    reconcileBlocked,
    reconcile: guard(input => store.reconcile({ ...input, ownershipToken: maintenanceCapability })),
    repairIndexes: guard(() => store.repairPruneJournals({ ownershipToken: maintenanceCapability })),
    prune: guard(input => store.prune({ ...input, maintenanceCapability })),
    listTasks: guard(store.listTasks),
    close() {
      if (closed) return;
      closed = true;
      try {
        const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (lock.nonce !== maintenanceLockNonce) fail('unavailable', 'maintenance lock ownership changed');
        unlinkSync(lockPath);
      } catch (error) {
        if (error instanceof TaskStoreError) throw error;
        if (error.code !== 'ENOENT') unavailable('cannot release maintenance lock', error);
      }
    },
  };
}

function removeVerifiedStaleLock(ownerPath, assertion, now, lockKind) {
  if (typeof assertion?.actor !== 'string' || !assertion.actor.trim() ||
      typeof assertion.reason !== 'string' || !assertion.reason.trim() ||
      typeof assertion.evidence !== 'string' || !assertion.evidence.trim() || assertion.processTreeChecked !== true ||
      assertion.inventoryComplete !== true || typeof assertion.inventorySource !== 'string' || !assertion.inventorySource.trim() ||
      !Array.isArray(assertion.liveWorkerPids) || assertion.liveWorkerPids.length !== 0)
    fail('unavailable', 'stale-owner recovery requires complete process inventory with no live worker PIDs');
  let ownerBytes;
  let owner;
  try { ownerBytes = readFileSync(ownerPath); owner = JSON.parse(ownerBytes.toString('utf8')); }
  catch { fail('unavailable', 'owner lock is unreadable; preserve it for inspection'); }
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) fail('unavailable', 'owner lock PID is invalid');
  try {
    process.kill(owner.pid, 0);
    fail('unavailable', 'owner PID is live or its state is ambiguous');
  } catch (error) {
    if (error instanceof TaskStoreError) throw error;
    if (error.code !== 'ESRCH') fail('unavailable', 'owner process state is ambiguous');
  }
  const locks = dirname(ownerPath);
  const auditPath = join(locks, `recovery-${now}-${randomUUID()}.json`);
  const audit = { schemaVersion: 1, lockKind, actor: assertion.actor, reason: assertion.reason,
    evidence: assertion.evidence, processTreeChecked: true, inventoryComplete: true,
    inventorySource: assertion.inventorySource, liveWorkerPids: [], observedPid: owner.pid,
    ownerLockDigest: createHash('sha256').update(ownerBytes).digest('hex'), at: now };
  try {
    const auditFd = openSync(auditPath, 'wx', 0o600);
    try { writeFileSync(auditFd, JSON.stringify(audit)); fsyncSync(auditFd); } finally { closeSync(auditFd); }
    if (!readFileSync(ownerPath).equals(ownerBytes)) fail('unavailable', 'owner lock changed during recovery');
    unlinkSync(ownerPath);
  } catch (error) {
    if (error instanceof TaskStoreError) throw error;
    unavailable('cannot record stale-owner recovery', error);
  }
}

function acquireRecoveryGate(gatePath, now) {
  const bytes = Buffer.from(`${JSON.stringify({ pid: process.pid, startedAt: now, nonce: randomUUID() })}\n`);
  let fd;
  try {
    fd = openSync(gatePath, 'wx', 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    return bytes;
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    if (error.code === 'EEXIST') fail('unavailable', 'another stale-owner recovery holds the exclusive gate');
    unavailable('cannot acquire stale-owner recovery gate', error);
  }
}

function releaseRecoveryGate(gatePath, expectedBytes) {
  let current;
  try { current = readFileSync(gatePath); }
  catch (error) { if (error.code === 'ENOENT') return; unavailable('cannot verify stale-owner recovery gate', error); }
  if (!current.equals(expectedBytes)) fail('unavailable', 'stale-owner recovery gate changed; preserve state');
  try { unlinkSync(gatePath); }
  catch (error) { if (error.code !== 'ENOENT') unavailable('cannot release stale-owner recovery gate', error); }
}

function validateMaintenanceUpdate(previous, next) {
  for (const field of ['schemaVersion', 'taskId', 'clientId', 'idempotencyKey', 'payloadHash',
    'createdAt', 'acceptedAt', 'startedAt', 'attempts', 'request'])
    if (stringify(previous[field]) !== stringify(next[field])) fail('internal', 'maintenance cannot alter task identity or dispatch history');
  if (!sameOptionalValue(previous.baseCommit, next.baseCommit))
    fail('internal', 'maintenance cannot alter optional task base metadata');
  if (previous.status !== 'blocked' || !['failed', 'cancelled'].includes(next.status) ||
      previous.cancel.effectsReverted !== false || next.cancel.effectsReverted !== false)
    fail('internal', 'invalid maintenance lifecycle transition');
}

function sameOptionalValue(previous, next) {
  if (previous === undefined || next === undefined) return previous === next;
  return stringify(previous) === stringify(next);
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

  if (task.baseCommit !== undefined && task.baseCommit !== null) {
    if (typeof task.baseCommit !== 'string' || !/^[0-9a-f]{40,64}$/.test(task.baseCommit)) {
      fail('invalid_argument', 'baseCommit must be a full commit SHA or null');
    }
  }

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
    if (attempt.workspace !== undefined) {
      const receipt = attempt.workspace;
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
          Object.keys(receipt).sort().join(',') !== 'baseCommit,branch,receiptPath,taskId,workspacePath' ||
          receipt.taskId !== task.taskId || receipt.baseCommit !== task.baseCommit ||
          typeof receipt.baseCommit !== 'string' || !/^[a-f0-9]{40,64}$/.test(receipt.baseCommit) ||
          receipt.branch !== task.request?.repository?.branch ||
          typeof receipt.workspacePath !== 'string' || !isAbsolute(receipt.workspacePath) ||
          receipt.workspacePath !== join(dirname(receipt.workspacePath), task.taskId) ||
          receipt.receiptPath !== join(dirname(receipt.workspacePath), `${task.taskId}.workspace.json`))
        fail('invalid_argument', 'invalid workspace dispatch receipt');
    }
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

  if (task.reconciliation !== undefined) {
    const audit = task.reconciliation;
    const auditKeys = ['actor', 'reason', 'decision', 'fromStatus', 'recordDigest', 'evidenceDigest',
      'priorBlock', 'administrativeOutcome', 'evidence', 'reconciledAt'];
    const evidenceKeys = ['taskId', 'fromStatus', 'decision', 'recordDigest', 'observation', 'outcomeAssessment', 'workerStopped',
      'processTreeChecked', 'inventoryComplete', 'inventorySource', 'liveWorkerPids', 'observedAt'];
    if (!audit || typeof audit !== 'object' || Array.isArray(audit) ||
        Object.keys(audit).sort().join(',') !== auditKeys.sort().join(',') ||
        !['failed', 'cancelled'].includes(audit.decision) || audit.fromStatus !== 'blocked' ||
        audit.decision !== task.status || typeof audit.actor !== 'string' || !audit.actor.trim() || audit.actor.length > 128 ||
        typeof audit.reason !== 'string' || !audit.reason.trim() || audit.reason.length > 1000 ||
        !DIGEST.test(audit.recordDigest) || !DIGEST.test(audit.evidenceDigest) || !isTimestamp(audit.reconciledAt) ||
        !audit.priorBlock || typeof audit.priorBlock !== 'object' || Array.isArray(audit.priorBlock) ||
        audit.priorBlock.requiresReconciliation !== true || typeof audit.priorBlock.reason !== 'string' ||
        !audit.priorBlock.reason ||
        !['known-failure', 'unknown', 'cancel-request'].includes(audit.administrativeOutcome) ||
        (audit.decision === 'failed' && !['known-failure', 'unknown'].includes(audit.administrativeOutcome)) ||
        (audit.decision === 'cancelled' && audit.administrativeOutcome !== 'cancel-request') ||
        !audit.evidence || typeof audit.evidence !== 'object' || Array.isArray(audit.evidence) ||
        Object.keys(audit.evidence).sort().join(',') !== evidenceKeys.sort().join(',') || audit.evidence.taskId !== task.taskId ||
        audit.evidence.recordDigest !== audit.recordDigest || audit.evidence.decision !== audit.decision ||
        audit.evidence.outcomeAssessment !== audit.administrativeOutcome ||
        audit.evidence.fromStatus !== 'blocked' || audit.evidence.workerStopped !== true ||
        audit.evidence.processTreeChecked !== true || audit.evidence.inventoryComplete !== true ||
        !Array.isArray(audit.evidence.liveWorkerPids) || audit.evidence.liveWorkerPids.length !== 0 ||
        typeof audit.evidence.inventorySource !== 'string' || !audit.evidence.inventorySource.trim() ||
        audit.evidence.inventorySource.length > 500 ||
        typeof audit.evidence.observation !== 'string' || !audit.evidence.observation.trim() || audit.evidence.observation.length > 2000 ||
        !isTimestamp(audit.evidence.observedAt) ||
        createHash('sha256').update(stringify(audit.evidence)).digest('hex') !== audit.evidenceDigest)
      fail('invalid_argument', 'maintainer reconciliation audit is invalid');
    if ((audit.administrativeOutcome === 'known-failure' &&
          (!task.attempts.length || task.attempts.some(a => !isTimestamp(a.finishedAt) ||
            !['failed', 'spawn-error', 'launch-failed'].includes(a.outcome)))) ||
        (audit.administrativeOutcome === 'unknown' &&
          (!task.attempts.some(a => a.finishedAt == null || a.outcome === 'unknown') || task.cancel.executionStopped !== 'unknown')) ||
        (audit.administrativeOutcome === 'cancel-request' && task.cancel.requestedAt === null))
      fail('invalid_argument', 'maintainer outcome classification conflicts with persisted lifecycle evidence');
  }

  if ((task.status === 'blocked') !== (task.block !== null))
    fail('invalid_argument', 'block metadata must match task status');
  if (['queued', 'running'].includes(task.status) && task.finishedAt !== null)
    fail('invalid_argument', 'active task cannot have a finish timestamp');
  if (task.status === 'queued' && task.startedAt !== null)
    fail('invalid_argument', 'queued task cannot have a start timestamp');
  if (['succeeded', 'failed', 'blocked', 'cancelled'].includes(task.status) && task.finishedAt === null)
    fail('invalid_argument', 'terminal task requires a finish timestamp');
  if (['running', 'succeeded'].includes(task.status) && task.startedAt === null)
    fail('invalid_argument', 'executed task requires a start timestamp');
  if (task.status === 'failed' && task.startedAt === null &&
      (task.reconciliation?.decision !== 'failed' || task.reconciliation?.administrativeOutcome !== 'unknown'))
    fail('invalid_argument', 'failed task without a start timestamp requires an unknown-outcome maintainer receipt');
  if (task.status === 'failed' && task.reconciliation?.administrativeOutcome === 'unknown' &&
      task.cancel.executionStopped !== 'unknown')
    fail('invalid_argument', 'administrative failure with unknown outcome must preserve unknown stop evidence');
  if (task.status === 'blocked' && cancel.executionStopped !== 'unknown')
    fail('invalid_argument', 'blocked task must preserve uncertain execution');
  if (task.status === 'cancelled' && (cancel.requestedAt === null || cancel.executionStopped !== true))
    fail('invalid_argument', 'cancelled task requires a stop confirmation and request');

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
  if (task.artifact !== undefined) validateArtifact(task.artifact);
}

function validateArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact))
    fail('invalid_argument', 'artifact must be an object');
  const required = ['baseCommit', 'branch', 'headCommit', 'diff', 'diffTruncated', 'changedFiles',
    'testRuns', 'logsTruncated', 'limitations', 'cost', 'evidenceLevel'];
  const keys = Object.keys(artifact).filter(key => key !== 'workerLog');
  if (keys.sort().join(',') !== required.sort().join(','))
    fail('invalid_argument', 'artifact fields do not match the producer contract');
  if (Object.hasOwn(artifact, 'workerLog')) {
    const log = artifact.workerLog;
    if (!log || typeof log !== 'object' || Array.isArray(log) || Object.keys(log).length !== 2 ||
        typeof log.outputTail !== 'string' || typeof log.outputTruncated !== 'boolean')
      fail('invalid_argument', 'artifact worker log is invalid');
  }
  for (const field of ['baseCommit', 'branch'])
    if (typeof artifact[field] !== 'string' || !artifact[field]) fail('invalid_argument', `artifact ${field} is required`);
  if (artifact.headCommit !== null && (typeof artifact.headCommit !== 'string' || !/^[0-9a-f]{40,64}$/.test(artifact.headCommit)))
    fail('invalid_argument', 'artifact headCommit is invalid');
  if (artifact.diff !== null && typeof artifact.diff !== 'string') fail('invalid_argument', 'artifact diff is invalid');
  if (typeof artifact.diffTruncated !== 'boolean' || typeof artifact.logsTruncated !== 'boolean')
    fail('invalid_argument', 'artifact truncation flags are required');
  for (const field of ['changedFiles', 'testRuns', 'limitations'])
    if (!Array.isArray(artifact[field])) fail('invalid_argument', `artifact ${field} must be an array`);
  if (artifact.changedFiles.some(path => typeof path !== 'string') || artifact.limitations.some(value => typeof value !== 'string'))
    fail('invalid_argument', 'artifact text lists are invalid');
  for (const run of artifact.testRuns) {
    if (!run || typeof run !== 'object' || Array.isArray(run) || typeof run.command !== 'string' ||
        !Number.isInteger(run.exitCode) || !Number.isInteger(run.durationMs) || run.durationMs < 0 ||
        typeof run.summary !== 'string' || typeof run.outputTail !== 'string' || typeof run.outputTruncated !== 'boolean')
      fail('invalid_argument', 'artifact test run is invalid');
  }
  if (!artifact.cost || typeof artifact.cost !== 'object' || artifact.cost.known !== false ||
      artifact.cost.amount !== null || typeof artifact.cost.currency !== 'string' || typeof artifact.cost.note !== 'string')
    fail('invalid_argument', 'artifact cost is invalid');
  if (!['unit', 'local-http', 'opencode-integration', 'use-on-project'].includes(artifact.evidenceLevel))
    fail('invalid_argument', 'artifact evidence level is invalid');
}

function validateUpdate(previous, next) {
  const sameReconciliation = previous.reconciliation === undefined || next.reconciliation === undefined
    ? previous.reconciliation === next.reconciliation
    : stringify(previous.reconciliation) === stringify(next.reconciliation);
  if (!sameReconciliation)
    fail('internal', 'maintainer reconciliation receipts can only be written by the dedicated operation');
  for (const field of ['schemaVersion', 'taskId', 'clientId', 'idempotencyKey',
    'payloadHash', 'createdAt', 'acceptedAt']) {
    if (next[field] !== previous[field])
      fail('invalid_argument', 'task identity and acceptance fields are immutable');
  }
  if (previous.baseCommit !== undefined && previous.baseCommit !== null &&
      next.baseCommit !== previous.baseCommit) {
    fail('invalid_argument', 'task base commit is immutable once set');
  }
  if (stringify(next.request) !== stringify(previous.request))
    fail('invalid_argument', 'accepted task request is immutable');
  if (previous.startedAt !== null && next.startedAt !== previous.startedAt)
    fail('invalid_argument', 'task start timestamp is immutable once set');
  for (const [index, attempt] of previous.attempts.entries()) {
    if (!next.attempts[index] || ['attemptId', 'model', 'startedAt'].some(
      field => next.attempts[index][field] !== attempt[field]))
      fail('internal', 'persisted dispatch evidence cannot be removed or replaced');
    if (attempt.workspace !== undefined && stringify(next.attempts[index].workspace) !== stringify(attempt.workspace))
      fail('internal', 'persisted workspace dispatch receipt cannot be replaced');
  }
  if (previous.status !== next.status && !TRANSITIONS[previous.status].includes(next.status))
    fail('internal', 'illegal task status transition');
  if (previous.status === 'queued' && next.status === 'running' && previous.attempts.length)
    fail('internal', 'persisted dispatch cannot be restarted');
  if (previous.status === 'queued' && next.status === 'cancelled' &&
    (previous.attempts.length || next.attempts.length || next.startedAt !== null))
    fail('internal', 'dispatched task cannot be cancelled as unstarted');
  if (previous.status === 'queued' && next.status === 'blocked' && !previous.attempts.length)
    fail('internal', 'queued task without a dispatch cannot be blocked');
  if (TERMINAL.has(previous.status) || previous.status === 'blocked') {
    for (const field of ['startedAt', 'finishedAt', 'cancel', 'block', 'attempts', 'reconciliation']) {
      if ((previous[field] !== undefined || next[field] !== undefined) &&
          stringify(previous[field]) !== stringify(next[field]))
        fail('internal', 'terminal task lifecycle metadata is immutable');
    }
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
  if (entry.prunedAt !== undefined && !isTimestamp(entry.prunedAt))
    fail('invalid_argument', 'prunedAt is not a timestamp');
}

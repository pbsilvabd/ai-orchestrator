import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTaskStore, TaskStoreError } from '../src/tasks.mjs';
import { createTaskService, ServiceError } from '../src/service.mjs';

function startTask(store, taskId) {
  if (store.readTask(taskId).status === 'queued') {
    store.updateTask(taskId, draft => { draft.status = 'running'; draft.startedAt = draft.createdAt; });
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_TASK = '00000000-0000-4000-8000-000000000000';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-service-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeService(t, overrides = {}) {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const service = createTaskService({
    store,
    config: {
      clientId: 'opencode-primary',
      authorization: { models: ['mock/a', 'mock/b'], tools: ['read', 'edit', 'bash'], writableRoots: [dir] },
      limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
      ...overrides.config,
    },
    now: overrides.now ?? 1_000,
  });
  return { dir, store, service };
}

const taskFiles = dir => readdirSync(join(dir, 'tasks')).filter(name => name.endsWith('.json'));

const validRequest = (dir, overrides = {}) => ({
  idempotencyKey: 'goal-1',
  clientId: 'opencode-primary',
  objective: 'Add a regression test',
  acceptanceCriteria: ['node --test passes'],
  repository: { path: dir, baseRef: 'main', branch: 'task/example' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: [join(dir, 'src')] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
  ...overrides,
});
const validSubmit = (service, dir, overrides = {}) => service.submitTask(validRequest(dir, overrides));

const expected = code => error => error instanceof ServiceError && error.code === code;

test('result preserves prior truncation and requires a recorded test command', t => {
  const { service, store, dir } = makeService(t);
  const { taskId } = validSubmit(service, dir);
  startTask(store, taskId);
  store.updateTask(taskId, draft => {
    draft.status = 'succeeded';
    draft.finishedAt = 1_500;
    draft.testRuns = [{ exitCode: 0, outputTail: 'partial', outputTruncated: true }];
  });
  const result = service.getTaskResult({ taskId });
  assert.equal(result.logsTruncated, true);
  assert.equal(result.testRuns[0].outputTruncated, true);
  assert.equal(result.limitations.length, 1);
});

test('submit_task validates strictly and returns a queued task id', t => {
  const { dir, service } = makeService(t);
  const result = validSubmit(service, dir);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.status, 'queued');
  assert.equal(result.idempotentReplay, false);
  assert.match(result.taskId, UUID_V4);
  assert.equal(result.acceptedAt, 1_000);
});

test('submit_task rejects unknown, missing or out of range fields', t => {
  const { dir, service } = makeService(t);
  const before = taskFiles(dir).length;
  assert.throws(() => service.submitTask({ ...validRequest(dir), surprise: true }), expected('invalid_argument'));
  assert.throws(() => service.submitTask({ ...validRequest(dir), objective: '' }), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, { objective: 'x'.repeat(4001) })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, { acceptanceCriteria: [] })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, { acceptanceCriteria: ['ok', ...Array.from({ length: 20 }, (_, i) => `c${i}`)] })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, { repository: { path: dir, baseRef: 'main' } })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, { repository: { path: dir, baseRef: 'main', branch: 'task/example', extra: 1 } })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, { repository: { path: dir, baseRef: 'main', branch: 'task example' } })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, { repository: { path: '/outside/repo', baseRef: 'main', branch: 'task/example' } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validRequest(dir, { authorization: { models: ['mock/unknown'], tools: ['read'], writablePaths: [join(dir, 'src')] } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validRequest(dir, { authorization: { models: ['mock/a'], tools: ['unknown-tool'], writablePaths: [join(dir, 'src')] } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validRequest(dir, { authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['/outside/src'] } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validRequest(dir, { limits: { maxAttempts: 3, budgetMs: 600_000, maxOutputBytes: 1_048_576 } })), expected('limit_exceeded'));
  assert.throws(() => service.submitTask(validRequest(dir, { limits: { maxAttempts: 2, budgetMs: 600_001, maxOutputBytes: 1_048_576 } })), expected('limit_exceeded'));
  assert.throws(() => service.submitTask(validRequest(dir, { limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_577 } })), expected('limit_exceeded'));
  assert.equal(taskFiles(dir).length, before, 'invalid requests must not persist records');
});

test('startup fails closed on an index conflict without changing active work', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir);
  store.updateTask(taskId, draft => { draft.status = 'running'; draft.startedAt = 1_100; });
  const indexFile = join(dir, 'idempotency', readdirSync(join(dir, 'idempotency'))[0]);
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  index.taskId = UNKNOWN_TASK;
  writeFileSync(indexFile, JSON.stringify(index));

  assert.throws(() => createTaskService({ store, config: service.config, now: 1_200 }), expected('unavailable'));
  assert.equal(store.readTask(taskId).status, 'running');
});

test('service startup repairs a missing index before it accepts a duplicate submit', t => {
  const { dir, store, service } = makeService(t);
  const request = validRequest(dir);
  const first = service.submitTask(request);
  for (const name of readdirSync(join(dir, 'idempotency'))) rmSync(join(dir, 'idempotency', name));
  const restarted = createTaskService({ store, config: service.config, now: 1_100 });
  const second = restarted.submitTask(request);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.idempotentReplay, true);
  assert.equal(taskFiles(dir).length, 1);
});

test('service startup blocks an interrupted running task before reads', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir);
  store.updateTask(taskId, draft => { draft.status = 'running'; draft.startedAt = 1_050; });
  const restarted = createTaskService({ store, config: service.config, now: 1_100 });
  assert.equal(restarted.getTaskStatus({ taskId }).status, 'blocked');
});

test('relative writable globs resolve from repository.path', t => {
  const { dir, service } = makeService(t);
  assert.doesNotThrow(() => service.submitTask(validRequest(dir, {
    authorization: { models: ['mock/a'], tools: ['read'], writablePaths: ['src/**', 'test/**'] },
  })));
});

test('startup finds duplicate client keys even when both index entries are missing', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir);
  const original = store.readTask(taskId);
  const duplicateId = '11111111-1111-4111-8111-111111111111';
  writeFileSync(join(dir, 'tasks', `${duplicateId}.json`), JSON.stringify({ ...original, taskId: duplicateId }));
  for (const name of readdirSync(join(dir, 'idempotency'))) rmSync(join(dir, 'idempotency', name));

  assert.throws(() => createTaskService({ store, config: service.config, now: 1_200 }), expected('unavailable'));
  assert.equal(store.readTask(taskId).status, 'queued');
  assert.equal(store.readTask(duplicateId).status, 'queued');
});

test('credential-shaped request text is rejected without mutating the caller or storing data', t => {
  const { dir, service } = makeService(t);
  const request = validRequest(dir, { objective: 'Use Bearer REVIEW_FAKE_CREDENTIAL_ONLY' });
  const original = structuredClone(request);
  assert.throws(() => service.submitTask(request), expected('invalid_argument'));
  assert.deepEqual(request, original);
  assert.equal(taskFiles(dir).length, 0);
});

test('submit_task replays idempotently and conflicts on changed payloads', t => {
  const { dir, service } = makeService(t);
  const first = validSubmit(service, dir, { idempotencyKey: 'goal-1' });
  const second = validSubmit(service, dir, { idempotencyKey: 'goal-1' });

  assert.equal(second.idempotentReplay, true);
  assert.equal(second.taskId, first.taskId);

  assert.throws(() => validSubmit(service, dir, { idempotencyKey: 'goal-1', objective: 'Different objective' }), expected('idempotency_conflict'));
  assert.equal(taskFiles(dir).length, 1);

  assert.throws(() => service.submitTask(validRequest(dir, { clientId: 'other-client', idempotencyKey: 'goal-1' })), expected('authorization_denied'));
  assert.equal(taskFiles(dir).length, 1);
});

test('get_task_status returns the queued view and terminal result availability', t => {
  const { store, service, dir } = makeService(t);
  const { taskId } = validSubmit(service, dir);

  const queued = service.getTaskStatus({ taskId });
  assert.equal(queued.schemaVersion, 1);
  assert.equal(queued.taskId, taskId);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.resultAvailable, false);
  assert.equal('block' in queued, false);
  assert.deepEqual(queued.progress, [{ at: 1_000, event: 'accepted', detail: null }]);
  assert.equal(queued.cancel.requestedAt, null);
  assert.equal(queued.cancel.executionStopped, null);
  assert.equal(queued.cancel.effectsReverted, false);

  store.updateTask(taskId, draft => { draft.status = 'running'; draft.startedAt = 1_200; });
  assert.equal(service.getTaskStatus({ taskId }).status, 'running');
  assert.equal(service.getTaskStatus({ taskId }).resultAvailable, false);

  store.updateTask(taskId, draft => { draft.status = 'succeeded'; draft.finishedAt = 1_500; });
  assert.equal(service.getTaskStatus({ taskId }).resultAvailable, true);
});

test('cancel_task cancels queued work and blocks uncertain running work', t => {
  const { store, service, dir } = makeService(t);

  const queued = validSubmit(service, dir, { idempotencyKey: 'goal-queued' });
  assert.throws(() => service.cancelTask({ taskId: queued.taskId, unexpected: true }), expected('invalid_argument'));
  const cancelled = service.cancelTask({ taskId: queued.taskId });
  assert.equal(cancelled.schemaVersion, 1);
  assert.equal(cancelled.effect, 'not_started');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelRequestedAt, 1_000);
  const cancelledTask = store.readTask(queued.taskId);
  assert.equal(cancelledTask.status, 'cancelled');
  assert.equal(cancelledTask.cancel.executionStopped, true);
  assert.equal(cancelledTask.cancel.effectsReverted, false);

  const running = validSubmit(service, dir, { idempotencyKey: 'goal-running' });
  store.updateTask(running.taskId, draft => { draft.status = 'running'; draft.startedAt = 1_200; });
  const requested = service.cancelTask({ taskId: running.taskId });
  assert.equal(requested.effect, 'requested');
  assert.equal(requested.status, 'blocked');
  const blockedTask = store.readTask(running.taskId);
  assert.equal(blockedTask.status, 'blocked');
  assert.deepEqual(blockedTask.block, { reason: 'cancelled-uncertain', requiresReconciliation: true });

  const terminal = validSubmit(service, dir, { idempotencyKey: 'goal-terminal' });
  startTask(store, terminal.taskId);
  store.updateTask(terminal.taskId, draft => { draft.status = 'succeeded'; draft.finishedAt = 1_200; });
  const already = service.cancelTask({ taskId: terminal.taskId });
  assert.equal(already.effect, 'already_terminal');
  assert.equal(already.status, 'succeeded');
});

test('cancel_task maps persistence failures to service errors', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir);
  const failingStore = { ...store, reconcile: () => ({ blocked: [], repaired: [], conflicts: [] }),
    readTask: store.readTask, updateTask: () => { throw new TaskStoreError('unavailable', 'cannot persist task state'); } };
  const failingService = createTaskService({ store: failingStore, config: service.config, now: 1_100 });
  assert.throws(() => failingService.cancelTask({ taskId }), expected('unavailable'));
});

test('get_task_status enforces ownership and unknown tasks', t => {
  const { service, store, dir } = makeService(t);
  assert.throws(() => service.getTaskStatus({ taskId: UNKNOWN_TASK }), expected('unknown_task'));
  assert.throws(() => service.getTaskStatus({ taskId: 'not a valid id' }), expected('invalid_argument'));
  const sensitiveKey = 'Bearer REVIEW_FAKE_CREDENTIAL_ONLY';
  assert.throws(() => service.getTaskStatus({ taskId: UNKNOWN_TASK, [sensitiveKey]: true }), error =>
    error instanceof ServiceError && error.code === 'invalid_argument' && !error.message.includes(sensitiveKey));

  const foreignService = createTaskService({ store, config: { ...service.config, clientId: 'other-client' }, now: 1_000 });
  const foreign = validSubmit(foreignService, dir, { clientId: 'other-client', idempotencyKey: 'goal-foreign' });
  assert.throws(() => service.getTaskStatus({ taskId: foreign.taskId }), expected('not_owner'));
});

test('get_task_result returns terminal artifacts, truncation flags and limitations', t => {
  const { store, service, dir } = makeService(t);
  const { taskId } = validSubmit(service, dir, { idempotencyKey: 'goal-1' });

  assert.throws(() => service.getTaskResult({ taskId, unexpected: true }), expected('invalid_argument'));
  assert.throws(() => service.getTaskResult({ taskId }), expected('result_not_ready'));

  startTask(store, taskId);
  store.updateTask(taskId, draft => {
    draft.status = 'succeeded';
    draft.finishedAt = 1_500;
    draft.startedAt = 1_000;
    draft.attempts.push({ attemptId: 'attempt-1', model: 'mock/a', startedAt: 1_000, finishedAt: 1_500, outcome: 'success' });
    draft.testRuns = [{ command: 'node --test', exitCode: 0, durationMs: 5, summary: 'ok', outputTail: 'ok' }];
    draft.changedFiles = ['test/example.test.mjs'];
    draft.headCommit = 'abc123def456';
    draft.baseCommit = 'def456abc123';
    draft.diff = 'diff --git a/test/example.test.mjs';
  });

  const result = service.getTaskResult({ taskId });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.taskId, taskId);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.baseCommit, 'def456abc123');
  assert.equal(result.branch, 'task/example');
  assert.equal(result.headCommit, 'abc123def456');
  assert.equal(result.diff, 'diff --git a/test/example.test.mjs');
  assert.equal(result.diffTruncated, false);
  assert.deepEqual(result.changedFiles, ['test/example.test.mjs']);
  assert.equal(result.testRuns.length, 1);
  assert.equal(result.testRuns[0].exitCode, 0);
  assert.equal(result.cost.known, false);
  assert.equal(result.evidenceLevel, 'unit');
  assert.equal(result.sanitized, true);
  assert.deepEqual(result.attempts, [{ attemptId: 'attempt-1', model: 'mock/a', startedAt: 1_000, finishedAt: 1_500, outcome: 'success' }]);
  assert.deepEqual(result.limitations, []);

  store.updateTask(taskId, draft => { draft.diff = 'x'.repeat(1_048_577); });
  const truncated = service.getTaskResult({ taskId });
  assert.equal(truncated.diff.length, 1_048_576);
  assert.equal(truncated.diffTruncated, true);

  store.updateTask(taskId, draft => { draft.status = 'succeeded'; draft.testRuns = [{ command: 'node --test', exitCode: 1, durationMs: 5, summary: 'fail', outputTail: 'fail' }]; });
  const unverified = service.getTaskResult({ taskId });
  assert.deepEqual(unverified.limitations, ['success without a recorded passing test command and exit code']);

  const failedId = validSubmit(service, dir, { idempotencyKey: 'failed-artifacts' }).taskId;
  startTask(store, failedId);
  store.updateTask(failedId, draft => { draft.status = 'failed'; draft.finishedAt = 1_500; draft.diff = null; });
  const failed = service.getTaskResult({ taskId: failedId });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.limitations, ['no artifact record for a failed task']);

  assert.throws(() => service.getTaskResult({ taskId: 'bad id' }), expected('invalid_argument'));
});

test('diff limits use UTF-8 bytes and honor the task output budget', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir, { limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 16 } });
  startTask(store, taskId);
  store.updateTask(taskId, draft => { draft.status = 'failed'; draft.finishedAt = 1_100; draft.diff = 'é'.repeat(100); });
  const result = service.getTaskResult({ taskId });
  assert.ok(Buffer.byteLength(result.diff, 'utf8') <= 16);
  assert.equal(result.diffTruncated, true);
  assert.equal(result.diff.length, 8);
});

test('get_task_result enforces ownership', t => {
  const { service, store, dir } = makeService(t);
  const foreignService = createTaskService({ store, config: { ...service.config, clientId: 'other-client' }, now: 1_000 });
  const foreign = validSubmit(foreignService, dir, { clientId: 'other-client', idempotencyKey: 'goal-foreign' });
  assert.throws(() => service.getTaskResult({ taskId: foreign.taskId }), expected('not_owner'));
});

test('result enforces the log cap across multiple test runs', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir, { limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 } });
  startTask(store, taskId);
  store.updateTask(taskId, draft => {
    draft.status = 'failed';
    draft.finishedAt = 1_100;
    draft.testRuns = [1, 2].map(() => ({ command: 'fixture', exitCode: 1, durationMs: 1, summary: 'fail', outputTail: 'x'.repeat(200_000) }));
  });
  const result = service.getTaskResult({ taskId });
  assert.ok(result.testRuns.reduce((sum, run) => sum + Buffer.byteLength(run.outputTail), 0) <= 262_144);
  assert.equal(result.logsTruncated, true);
  assert.equal(result.testRuns[1].outputTruncated, true);
});

test('result redacts credential-shaped text and reports the bounded policy', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir);
  startTask(store, taskId);
  store.updateTask(taskId, draft => {
    draft.status = 'failed';
    draft.finishedAt = 1_100;
    draft.testRuns = [{ command: 'fixture', exitCode: 1, durationMs: 1, summary: 'Authorization: Bearer FAKE_REVIEW_VALUE', outputTail: 'api_key=FAKE_REVIEW_VALUE' }];
  });
  const result = service.getTaskResult({ taskId });
  assert.equal(result.sanitized, true);
  assert.equal(JSON.stringify(result).includes('FAKE_REVIEW_VALUE'), false);
  assert.match(result.testRuns[0].outputTail, /\[REDACTED\]/);
});

test('a filesystem persistence failure is reported as unavailable with the os code', t => {
  const { dir, service } = makeService(t);
  const idempotency = join(dir, 'idempotency');
  rmSync(idempotency, { recursive: true, force: true });
  writeFileSync(idempotency, 'not a directory');

  assert.throws(() => service.submitTask(validSubmit(service, dir)), error =>
    error instanceof ServiceError && error.code === 'unavailable');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTaskStore } from '../src/tasks.mjs';
import { createTaskService, ServiceError } from '../src/service.mjs';

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

const validSubmit = (service, dir, overrides = {}) => service.submitTask({
  idempotencyKey: 'goal-1',
  clientId: 'opencode-primary',
  objective: 'Add a regression test',
  acceptanceCriteria: ['node --test passes'],
  repository: { path: join(dir, 'repo'), baseRef: 'main', branch: 'task/example' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: [join(dir, 'src')] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
  ...overrides,
});

const expected = code => error => error instanceof ServiceError && error.code === code;

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
  const valid = () => validSubmit(service, dir);

  assert.throws(() => service.submitTask({ ...validSubmit(service, dir), surprise: true }), expected('invalid_argument'));
  assert.throws(() => service.submitTask({ ...validSubmit(service, dir), objective: '' }), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { objective: 'x'.repeat(4001) })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { acceptanceCriteria: [] })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { acceptanceCriteria: ['ok', ...Array.from({ length: 20 }, (_, i) => `c${i}`)] })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { repository: { path: join(dir, 'repo'), baseRef: 'main' } })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { repository: { path: join(dir, 'repo'), baseRef: 'main', branch: 'task/example', extra: 1 } })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { repository: { path: join(dir, 'repo'), baseRef: 'main', branch: 'task example' } })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { repository: { path: '/outside/repo', baseRef: 'main', branch: 'task/example' } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { authorization: { models: ['mock/unknown'], tools: ['read'], writablePaths: [join(dir, 'src')] } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { authorization: { models: ['mock/a'], tools: ['unknown-tool'], writablePaths: [join(dir, 'src')] } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['/outside/src'] } })), expected('authorization_denied'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { limits: { maxAttempts: 3, budgetMs: 600_000, maxOutputBytes: 1_048_576 } })), expected('limit_exceeded'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { limits: { maxAttempts: 2, budgetMs: 600_001, maxOutputBytes: 1_048_576 } })), expected('limit_exceeded'));
  assert.throws(() => service.submitTask(validSubmit(service, dir, { limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_577 } })), expected('limit_exceeded'));
});

test('submit_task replays idempotently and conflicts on changed payloads', t => {
  const { dir, service } = makeService(t);
  const first = validSubmit(service, dir, { idempotencyKey: 'goal-1' });
  const second = validSubmit(service, dir, { idempotencyKey: 'goal-1' });

  assert.equal(second.idempotentReplay, true);
  assert.equal(second.taskId, first.taskId);

  assert.throws(() => validSubmit(service, dir, { idempotencyKey: 'goal-1', objective: 'Different objective' }), expected('idempotency_conflict'));
  assert.equal(taskFiles(dir).length, 1);

  const other = validSubmit(service, dir, { clientId: 'other-client', idempotencyKey: 'goal-1' });
  assert.equal(other.idempotentReplay, false);
  assert.notEqual(other.taskId, first.taskId);
  assert.equal(taskFiles(dir).length, 2);
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
  store.updateTask(terminal.taskId, draft => { draft.status = 'succeeded'; draft.finishedAt = 1_200; });
  const already = service.cancelTask({ taskId: terminal.taskId });
  assert.equal(already.effect, 'already_terminal');
  assert.equal(already.status, 'succeeded');
});

test('get_task_status enforces ownership and unknown tasks', t => {
  const { service, dir } = makeService(t);
  assert.throws(() => service.getTaskStatus({ taskId: UNKNOWN_TASK }), expected('unknown_task'));
  assert.throws(() => service.getTaskStatus({ taskId: 'not a valid id' }), expected('invalid_argument'));

  const foreign = validSubmit(service, dir, { clientId: 'other-client', idempotencyKey: 'goal-foreign' });
  assert.throws(() => service.getTaskStatus({ taskId: foreign.taskId }), expected('not_owner'));
});

test('get_task_result returns terminal artifacts, truncation flags and limitations', t => {
  const { store, service, dir } = makeService(t);
  const { taskId } = validSubmit(service, dir, { idempotencyKey: 'goal-1' });

  assert.throws(() => service.getTaskResult({ taskId }), expected('result_not_ready'));

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

  store.updateTask(taskId, draft => { draft.status = 'failed'; draft.diff = null; });
  const failed = service.getTaskResult({ taskId });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.limitations, ['no artifact record for a failed task']);

  assert.throws(() => service.getTaskResult({ taskId: 'bad id' }), expected('invalid_argument'));
});

test('get_task_result enforces ownership', t => {
  const { service, dir } = makeService(t);
  const foreign = validSubmit(service, dir, { clientId: 'other-client', idempotencyKey: 'goal-foreign' });
  assert.throws(() => service.getTaskResult({ taskId: foreign.taskId }), expected('not_owner'));
});

test('a filesystem persistence failure is reported as unavailable with the os code', t => {
  const { dir, service } = makeService(t);
  const idempotency = join(dir, 'idempotency');
  rmSync(idempotency, { recursive: true, force: true });
  writeFileSync(idempotency, 'not a directory');

  assert.throws(() => service.submitTask(validSubmit(service, dir)), error =>
    error instanceof ServiceError && error.code === 'unavailable');
});

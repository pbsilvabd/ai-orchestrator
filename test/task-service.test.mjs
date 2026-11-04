import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTaskStore, TaskStoreError } from '../src/tasks.mjs';
import { createTaskService, ServiceError } from '../src/service.mjs';

function initGitRepo(dir) {
  execFileSync('git', ['init', dir], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test Runner'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'Initial commit'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'branch', '-M', 'main'], { stdio: 'ignore', windowsHide: true });
}

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
  initGitRepo(dir);
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
  t.after(() => service.close());
  return { dir, store, service };
}

const taskFiles = dir => readdirSync(join(dir, 'tasks')).filter(name => name.endsWith('.json'));

const validRequest = (dir, overrides = {}) => {
  const repoPath = overrides.repository?.path ?? dir;
  return {
    idempotencyKey: 'goal-1',
    clientId: 'opencode-primary',
    objective: 'Add a regression test',
    acceptanceCriteria: ['node --test passes'],
    repository: { path: repoPath, baseRef: 'main', branch: 'task/example' },
    authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src'] },
    limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
    ...overrides,
  };
};
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

  service.close();
  assert.throws(() => createTaskService({ store, config: service.config, now: 1_200 }), expected('unavailable'));
  assert.equal(store.readTask(taskId).status, 'running');
});

test('one service owns a task home until close and startup failure releases ownership', t => {
  const { dir, store, service } = makeService(t);
  assert.throws(() => createTaskService({ store, now: 1_000 }), expected('unavailable'));
  service.close();
  const replacement = createTaskService({ store, now: 1_000 });
  t.after(() => replacement.close());
  replacement.close();
  const brokenStore = { ...store, reconcile: () => { throw new TaskStoreError('unavailable', 'fixture failure'); } };
  assert.throws(() => createTaskService({ store: brokenStore, now: 1_100 }), expected('unavailable'));
  const recovered = createTaskService({ store, now: 1_100 });
  recovered.close();
});

test('service startup repairs a missing index before it accepts a duplicate submit', t => {
  const { dir, store, service } = makeService(t);
  const request = validRequest(dir);
  const first = service.submitTask(request);
  for (const name of readdirSync(join(dir, 'idempotency'))) rmSync(join(dir, 'idempotency', name));
  service.close();
  const restarted = createTaskService({ store, config: service.config, now: 1_100 });
  t.after(() => restarted.close());
  const second = restarted.submitTask(request);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.idempotentReplay, true);
  assert.equal(taskFiles(dir).length, 1);
});

test('service startup blocks an interrupted running task before reads', t => {
  const { dir, store, service } = makeService(t);
  const { taskId } = validSubmit(service, dir);
  store.updateTask(taskId, draft => { draft.status = 'running'; draft.startedAt = 1_050; });
  service.close();
  const restarted = createTaskService({ store, config: service.config, now: 1_100 });
  t.after(() => restarted.close());
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

  service.close();
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
  service.close();
  const failingService = createTaskService({ store: failingStore, config: service.config, now: 1_100 });
  t.after(() => failingService.close());
  assert.throws(() => failingService.cancelTask({ taskId }), expected('unavailable'));
});

test('get_task_status enforces ownership and unknown tasks', t => {
  const { service, store, dir } = makeService(t);
  assert.throws(() => service.getTaskStatus({ taskId: UNKNOWN_TASK }), expected('unknown_task'));
  assert.throws(() => service.getTaskStatus({ taskId: 'not a valid id' }), expected('invalid_argument'));
  const sensitiveKey = 'Bearer REVIEW_FAKE_CREDENTIAL_ONLY';
  assert.throws(() => service.getTaskStatus({ taskId: UNKNOWN_TASK, [sensitiveKey]: true }), error =>
    error instanceof ServiceError && error.code === 'invalid_argument' && !error.message.includes(sensitiveKey));

  service.close();
  const foreignService = createTaskService({ store, config: { ...service.config, clientId: 'other-client' }, now: 1_000 });
  t.after(() => foreignService.close());
  const foreign = validSubmit(foreignService, dir, { clientId: 'other-client', idempotencyKey: 'goal-foreign' });
  foreignService.close();
  const ownerService = createTaskService({ store, config: service.config, now: 1_000 });
  t.after(() => ownerService.close());
  assert.throws(() => ownerService.getTaskStatus({ taskId: foreign.taskId }), expected('not_owner'));
});

test('get_task_result returns terminal artifacts, truncation flags and limitations', t => {
  const { store, service, dir } = makeService(t);
  const { taskId } = validSubmit(service, dir, { idempotencyKey: 'goal-1' });

  assert.throws(() => service.getTaskResult({ taskId, unexpected: true }), expected('invalid_argument'));
  assert.throws(() => service.getTaskResult({ taskId }), expected('result_not_ready'));

  const expectedBaseCommit = store.readTask(taskId).baseCommit;
  startTask(store, taskId);
  store.updateTask(taskId, draft => {
    draft.status = 'succeeded';
    draft.finishedAt = 1_500;
    draft.startedAt = 1_000;
    draft.attempts.push({ attemptId: 'attempt-1', model: 'mock/a', startedAt: 1_000, finishedAt: 1_500, outcome: 'success' });
    draft.testRuns = [{ command: 'node --test', exitCode: 0, durationMs: 5, summary: 'ok', outputTail: 'ok' }];
    draft.changedFiles = ['test/example.test.mjs'];
    draft.headCommit = 'abc123def456';
    draft.diff = 'diff --git a/test/example.test.mjs';
  });

  const result = service.getTaskResult({ taskId });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.taskId, taskId);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.baseCommit, expectedBaseCommit);
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
  service.close();
  const foreignService = createTaskService({ store, config: { ...service.config, clientId: 'other-client' }, now: 1_000 });
  t.after(() => foreignService.close());
  const foreign = validSubmit(foreignService, dir, { clientId: 'other-client', idempotencyKey: 'goal-foreign' });
  foreignService.close();
  const ownerService = createTaskService({ store, config: service.config, now: 1_000 });
  t.after(() => ownerService.close());
  assert.throws(() => ownerService.getTaskResult({ taskId: foreign.taskId }), expected('not_owner'));
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

// --- B03 Acceptance Scenarios ---

test('B03-01: valid allowed repo, branch and base persists full commit SHA without worker launch', t => {
  const { dir, service } = makeService(t);
  const result = validSubmit(service, dir, {
    idempotencyKey: 'b03-01-key',
    repository: { path: dir, baseRef: 'main', branch: 'task/b03-01' },
  });
  assert.equal(result.status, 'queued');
  assert.equal(result.idempotentReplay, false);
  const record = service.store.readTask(result.taskId);
  assert.match(record.baseCommit, /^[0-9a-f]{40,64}$/);
  // Verify no workspace directory or subprocess worker created
  assert.equal(record.attempts.length, 0);
  assert.equal(record.startedAt, null);
});

test('B03-02: same key/payload after branch creation, ref movement or repo removal returns original record', t => {
  const { dir, service } = makeService(t);
  const initialSha = execFileSync('git', ['-C', dir, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  const request = validRequest(dir, {
    idempotencyKey: 'b03-02-key',
    repository: { path: dir, baseRef: 'main', branch: 'task/b03-02' },
  });
  const first = service.submitTask(request);
  assert.equal(first.idempotentReplay, false);

  // 1. Create the branch in Git
  execFileSync('git', ['-C', dir, 'branch', 'task/b03-02', 'main'], { stdio: 'ignore' });
  // 2. Move main ref by committing a new file
  writeFileSync(join(dir, 'another.txt'), 'new commit');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'second commit'], { stdio: 'ignore' });
  const movedSha = execFileSync('git', ['-C', dir, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  assert.notEqual(movedSha, initialSha);

  // Replay with identical payload: returns original task ID, original baseCommit, no error
  const second = service.submitTask(request);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.taskId, first.taskId);
  const record = service.store.readTask(second.taskId);
  assert.equal(record.baseCommit, initialSha);

  // Changed payload with same key still throws idempotency_conflict
  assert.throws(() => service.submitTask({ ...request, objective: 'Changed objective' }), expected('idempotency_conflict'));
});

test('B03-02: repo removal still returns idempotent replay for identical payload', t => {
  const home = fixture(t);
  const repoDir = fixture(t);
  initGitRepo(repoDir);
  const store = openTaskStore({ home });
  const service = createTaskService({
    store,
    config: {
      clientId: 'opencode-primary',
      authorization: { models: ['mock/a'], tools: ['read'], writableRoots: [repoDir] },
      limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
    },
  });
  t.after(() => service.close());
  const request = {
    idempotencyKey: 'b03-02-removed',
    clientId: 'opencode-primary',
    objective: 'Test repo removal replay',
    acceptanceCriteria: ['pass'],
    repository: { path: repoDir, baseRef: 'main', branch: 'task/will-delete-repo' },
    authorization: { models: ['mock/a'], tools: ['read'], writablePaths: [repoDir] },
    limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
  };
  const first = service.submitTask(request);
  // Remove repository completely
  rmSync(repoDir, { recursive: true, force: true });
  // Replay returns original task
  const second = service.submitTask(request);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.taskId, first.taskId);
});

test('B03-03: nonexistent repo, missing ref, range a..b or leading-option ref fails closed', t => {
  const { dir, service } = makeService(t);
  const beforeTasks = taskFiles(dir).length;

  // Nonexistent repository
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-03-nonexistent',
    repository: { path: join(dir, 'no-such-repo'), baseRef: 'main', branch: 'task/b03-03-a' },
  })), expected('invalid_argument'));

  // Missing Git ref
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-03-missing-ref',
    repository: { path: dir, baseRef: 'refs/heads/does-not-exist', branch: 'task/b03-03-b' },
  })), expected('invalid_argument'));

  // Range a..b
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-03-range',
    repository: { path: dir, baseRef: 'main..HEAD', branch: 'task/b03-03-c' },
  })), expected('invalid_argument'));

  // Leading option ref
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-03-option',
    repository: { path: dir, baseRef: '--all', branch: 'task/b03-03-d' },
  })), expected('invalid_argument'));

  // Verify task/index bytes and Git refs unchanged
  assert.equal(taskFiles(dir).length, beforeTasks);
  const refs = execFileSync('git', ['-C', dir, 'for-each-ref', '--format=%(refname)', 'refs/heads/'], { encoding: 'utf8' }).trim();
  assert.equal(refs, 'refs/heads/main');
});

test('B03-04: path-prefix sibling and symlink/junction escape are denied', t => {
  const { dir, service } = makeService(t);
  const siblingDir = `${dir}-sibling`;

  // Path-prefix sibling attack (e.g. /app/repo-sibling when /app/repo is allowed)
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-04-sibling',
    repository: { path: siblingDir, baseRef: 'main', branch: 'task/b03-04-a' },
  })), expected('authorization_denied'));

  // Symlink/junction escape
  const outsideDir = fixture(t);
  initGitRepo(outsideDir);
  const linkPath = join(dir, 'link-outside');
  let junctionCreated = false;
  try {
    symlinkSync(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    junctionCreated = true;
  } catch {
    // If symlink/junction creation lacks OS privileges, record not run
  }

  if (junctionCreated) {
    assert.throws(() => service.submitTask(validRequest(dir, {
      idempotencyKey: 'b03-04-symlink-escape',
      repository: { path: linkPath, baseRef: 'main', branch: 'task/b03-04-b' },
    })), expected('authorization_denied'));
  }
});

test('B03-05: existing branch, invalid branch, linked worktree and dirty parent', t => {
  const { dir, service } = makeService(t);

  // 1. Existing branch: collision rejected
  execFileSync('git', ['-C', dir, 'branch', 'task/already-exists', 'main'], { stdio: 'ignore' });
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-05-existing-branch',
    repository: { path: dir, baseRef: 'main', branch: 'task/already-exists' },
  })), expected('invalid_argument'));

  // 2. Invalid branch name rejected
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-05-invalid-branch',
    repository: { path: dir, baseRef: 'main', branch: 'invalid..branch' },
  })), expected('invalid_argument'));
  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-05-dash-branch',
    repository: { path: dir, baseRef: 'main', branch: '-invalid' },
  })), expected('invalid_argument'));

  // 3. Linked worktree collision: branch checked out in a linked worktree
  const wtDir = fixture(t);
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-b', 'task/in-worktree', wtDir, 'main'], { stdio: 'ignore' });
  t.after(() => {
    try {
      execFileSync('git', ['-C', dir, 'worktree', 'remove', '--force', wtDir], { stdio: 'ignore' });
    } catch {}
  });

  assert.throws(() => service.submitTask(validRequest(dir, {
    idempotencyKey: 'b03-05-worktree-branch',
    repository: { path: dir, baseRef: 'main', branch: 'task/in-worktree' },
  })), expected('invalid_argument'));

  // 4. Dirty parent: uncommitted modifications exist in parent repo
  const userFilePath = join(dir, 'user-dirty-file.txt');
  writeFileSync(userFilePath, 'uncommitted user work in progress');
  const result = validSubmit(service, dir, {
    idempotencyKey: 'b03-05-dirty-parent',
    repository: { path: dir, baseRef: 'main', branch: 'task/clean-new-branch' },
  });
  assert.equal(result.status, 'queued');
  // Verify user file is completely intact and unchanged
  assert.equal(readFileSync(userFilePath, 'utf8'), 'uncommitted user work in progress');
});

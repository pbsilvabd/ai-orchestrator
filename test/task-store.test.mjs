import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPayload, DEFAULT_RETENTION_MS, defaultHome, openTaskStore } from '../src/tasks.mjs';

function startTask(store, taskId) {
  if (store.readTask(taskId).status === 'queued') {
    store.updateTask(taskId, draft => { draft.status = 'running'; draft.startedAt = draft.createdAt; });
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const taskFiles = dir => readdirSync(join(dir, 'tasks')).filter(name => name.endsWith('.json'));
const indexFiles = dir => readdirSync(join(dir, 'idempotency')).filter(name => name.endsWith('.json'));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-tasks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const payload = (objective = 'Add a regression test') => ({
  objective,
  acceptanceCriteria: ['node --test passes'],
  repository: { path: '/abs/repo', baseRef: 'main', branch: 'task/example' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src/**'] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
});

const expected = code => error => error.name === 'TaskStoreError' && error.code === code;

const submit = (store, overrides = {}) => store.createTask({
  clientId: 'opencode-primary',
  idempotencyKey: 'goal-1',
  payload: payload(),
  now: 1_000,
  ...overrides,
});

test('createTask persists the record and the index before returning', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const { task, replay } = submit(store);

  assert.equal(replay, false);
  assert.equal(task.status, 'queued');
  assert.match(task.taskId, UUID_V4);
  assert.equal(task.acceptedAt, 1_000);
  assert.deepEqual(task.progress, [{ at: 1_000, event: 'accepted', detail: null }]);
  assert.equal(task.cancel.effectsReverted, false);

  const persisted = JSON.parse(readFileSync(join(dir, 'tasks', `${task.taskId}.json`), 'utf8'));
  assert.equal(persisted.taskId, task.taskId);
  assert.equal(persisted.request.objective, 'Add a regression test');
  assert.equal(indexFiles(dir).length, 1);
  assert.equal(readdirSync(join(dir, 'tasks')).filter(name => name.endsWith('.tmp')).length, 0);
});

test('same key and payload replays the original task without new records', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const first = submit(store);
  const second = submit(store, { now: 2_000 });

  assert.equal(second.replay, true);
  assert.equal(second.task.taskId, first.task.taskId);
  assert.equal(taskFiles(dir).length, 1);
  assert.equal(indexFiles(dir).length, 1);

  second.task.status = 'succeeded'; // Returned records are copies.
  assert.equal(store.readTask(first.task.taskId).status, 'queued');
});

test('same key with a different payload is an idempotency conflict', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const first = submit(store);

  assert.throws(() => submit(store, { payload: payload('Different objective') }),
    expected('idempotency_conflict'));
  assert.equal(taskFiles(dir).length, 1);
  assert.equal(store.readTask(first.task.taskId).status, 'queued');
});

test('clientSessionId is correlation only and never changes the idempotency hash', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const first = submit(store, { payload: { ...payload(), clientSessionId: 'session-a' } });
  const second = submit(store, { payload: { ...payload(), clientSessionId: 'session-b' } });

  assert.equal(second.replay, true);
  assert.equal(second.task.taskId, first.task.taskId);
  assert.equal('clientSessionId' in first.task.request, false);

  assert.equal(
    canonicalPayload({ b: 1, a: [2, { d: 3, c: 4 }] }),
    canonicalPayload({ a: [2, { c: 4, d: 3 }], b: 1 }),
  );
});

test('the same key for another client is a separate task', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const first = submit(store);
  const second = submit(store, { clientId: 'other-client' });

  assert.equal(second.replay, false);
  assert.notEqual(second.task.taskId, first.task.taskId);
  assert.equal(store.listTasks().length, 2);
});

test('unknown, malformed and missing records never look like absent task data', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const { task } = submit(store);

  assert.throws(() => store.readTask('00000000-0000-4000-8000-000000000000'),
    expected('unknown_task'));
  assert.throws(() => store.readTask('not a valid id'), expected('invalid_argument'));

  writeFileSync(join(dir, 'tasks', `${task.taskId}.json`), '{ not json');
  assert.throws(() => store.readTask(task.taskId), expected('unavailable'));

  writeFileSync(join(dir, 'tasks', `${task.taskId}.json`),
    JSON.stringify({ ...task, schemaVersion: 2 }));
  assert.throws(() => store.readTask(task.taskId), expected('unavailable'));
});

test('reconcile blocks running work and queued work that already dispatched', t => {
  const dir = fixture(t);
  let store = openTaskStore({ home: dir });
  const running = submit(store, { idempotencyKey: 'running-1' }).task;
  const dispatched = submit(store, { idempotencyKey: 'queued-dispatched' }).task;
  const untouched = submit(store, { idempotencyKey: 'queued-clean' }).task;

  store.updateTask(running.taskId, draft => {
    draft.status = 'running';
    draft.startedAt = 2_000;
    draft.attempts.push({ attemptId: 'attempt-1', model: 'mock/a', startedAt: 2_000, finishedAt: null });
  });
  store.updateTask(dispatched.taskId, draft => {
    draft.attempts.push({ attemptId: 'attempt-2', model: 'mock/a', startedAt: 2_000, finishedAt: null });
  });

  store = openTaskStore({ home: dir }); // Restart.
  const result = store.reconcile({ now: 5_000 });

  assert.deepEqual(result.blocked.sort(), [dispatched.taskId, running.taskId].sort());
  for (const taskId of result.blocked) {
    const task = store.readTask(taskId);
    assert.equal(task.status, 'blocked');
    assert.deepEqual(task.block, { reason: 'service-restart', requiresReconciliation: true });
    assert.equal(task.finishedAt, 5_000);
    assert.equal(task.progress.at(-1).event, 'blocked');
  }
  assert.equal(store.readTask(untouched.taskId).status, 'queued');
  assert.equal(JSON.parse(readFileSync(join(dir, 'tasks', `${running.taskId}.json`), 'utf8')).status,
    'blocked');
});

test('reconcile rebuilds a missing idempotency entry from the persisted record', t => {
  const dir = fixture(t);
  let store = openTaskStore({ home: dir });
  const { task } = submit(store);
  unlinkSync(join(dir, 'idempotency', indexFiles(dir)[0]));

  store = openTaskStore({ home: dir });
  const result = store.reconcile({ now: 2_000 });
  assert.deepEqual(result.repaired, [task.taskId]);
  assert.deepEqual(result.conflicts, []);
  assert.equal(indexFiles(dir).length, 1);

  const replay = submit(store, { now: 3_000 });
  assert.equal(replay.replay, true);
  assert.equal(replay.task.taskId, task.taskId);
  assert.equal(taskFiles(dir).length, 1);
});

test('records survive reopening and no committed record is rewritten by a read', t => {
  const dir = fixture(t);
  let store = openTaskStore({ home: dir });
  const { task } = submit(store);
  startTask(store, task.taskId);
  store.updateTask(task.taskId, draft => {
    draft.status = 'succeeded';
    draft.finishedAt = 1_500;
  });
  const committed = readFileSync(join(dir, 'tasks', `${task.taskId}.json`), 'utf8');

  store = openTaskStore({ home: dir });
  assert.equal(store.readTask(task.taskId).status, 'succeeded');
  assert.equal(readFileSync(join(dir, 'tasks', `${task.taskId}.json`), 'utf8'), committed);
});

test('updateTask rejects invalid records without changing the committed one', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const { task } = submit(store);
  const committed = readFileSync(join(dir, 'tasks', `${task.taskId}.json`), 'utf8');

  assert.throws(() => store.updateTask(task.taskId, draft => { draft.status = 'done'; }),
    expected('invalid_argument'));
  assert.throws(() => store.updateTask(task.taskId, draft => { draft.taskId = 'other'; }),
    expected('invalid_argument'));
  assert.throws(() => store.updateTask(task.taskId, draft => {
    draft.cancel.effectsReverted = true;
  }), expected('invalid_argument'));
  assert.throws(() => store.updateTask(task.taskId, draft => {
    draft.block = { reason: 'manual', requiresReconciliation: false };
  }), expected('invalid_argument'));
  assert.equal(readFileSync(join(dir, 'tasks', `${task.taskId}.json`), 'utf8'), committed);
});

test('a failed index write leaves no orphan record behind', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const first = submit(store);
  const idempotency = join(dir, 'idempotency');
  rmSync(idempotency, { recursive: true }); // Removes the goal-1 entry too.
  writeFileSync(idempotency, 'not a directory'); // Any index write now fails.

  assert.throws(() => submit(store, { idempotencyKey: 'goal-2' }), expected('unavailable'));
  assert.deepEqual(taskFiles(dir), [`${first.task.taskId}.json`]);

  // The record for goal-1 now has no index entry. Reconcile repairs it, so the next
  // submit replays instead of starting duplicate work.
  rmSync(idempotency);
  const repaired = openTaskStore({ home: dir });
  const result = repaired.reconcile({ now: 2_000 });
  assert.deepEqual(result.repaired, [first.task.taskId]);
  assert.deepEqual(result.blocked, []);

  const replay = repaired.createTask({
    clientId: 'opencode-primary', idempotencyKey: 'goal-1', payload: payload(), now: 3_000,
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.task.taskId, first.task.taskId);
  assert.deepEqual(taskFiles(dir), [`${first.task.taskId}.json`]);
});

test('an unusable home fails to open instead of silently degrading', t => {
  const dir = fixture(t);
  const file = join(dir, 'state');
  writeFileSync(file, 'x');
  assert.throws(() => openTaskStore({ home: join(file, 'nested') }), expected('unavailable'));
});

test('a second process sees the same records with no shared cache', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const { task } = submit(store);
  store.updateTask(task.taskId, draft => { draft.status = 'running'; draft.startedAt = 2_000; });

  const moduleUrl = new URL('../src/tasks.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { openTaskStore } from ${JSON.stringify(moduleUrl)};
     const store = openTaskStore({ home: process.argv[1] });
     const read = store.readTask(process.argv[2]);
     if (read.status !== 'running') process.exit(3);
     store.updateTask(read.taskId, draft => {
       draft.status = 'blocked';
       draft.finishedAt = 3_000;
       draft.block = { reason: 'service-restart', requiresReconciliation: true };
       draft.cancel.executionStopped = 'unknown';
     });
     const replay = store.createTask({
       clientId: process.argv[3], idempotencyKey: process.argv[4],
       payload: ${JSON.stringify(payload())}, now: 4_000,
     });
     process.stdout.write(JSON.stringify({ replay: replay.replay, id: replay.task.taskId }));`,
    dir, task.taskId, 'opencode-primary', 'goal-1'],
    { encoding: 'utf8', timeout: 15_000, input: '' });
  assert.equal(result.status, 0, result.stderr);

  assert.equal(store.readTask(task.taskId).status, 'blocked');
  const spawned = JSON.parse(result.stdout);
  assert.equal(spawned.replay, true); // Same key and payload resolve to the first task.
  assert.equal(spawned.id, task.taskId);
});

test('prune keeps blocked records and removes expired terminal ones', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const make = (key, status, finishedAt) => {
    const id = submit(store, { idempotencyKey: key, now: 0 }).task.taskId;
    if (status !== 'cancelled') startTask(store, id);
    return store.updateTask(id, draft => {
      draft.status = status; draft.finishedAt = finishedAt;
      if (status === 'blocked') {
        draft.block = { reason: 'fixture', requiresReconciliation: true };
        draft.cancel.executionStopped = 'unknown';
      }
      if (status === 'cancelled') {
        draft.cancel.requestedAt = 0; draft.cancel.executionStopped = true;
      }
    });
  };

  const oldSucceeded = make('old-succeeded', 'succeeded', 0);
  const oldFailed = make('old-failed', 'failed', 0);
  const oldCancelled = make('old-cancelled', 'cancelled', 0);
  const oldBlocked = make('old-blocked', 'blocked', 0);
  const recent = make('recent', 'succeeded', DEFAULT_RETENTION_MS);

  const { removed } = store.prune({ now: DEFAULT_RETENTION_MS + 1 });
  assert.deepEqual(removed.sort(),
    [oldSucceeded.taskId, oldFailed.taskId, oldCancelled.taskId].sort());
  assert.equal(taskFiles(dir).length, 2);
  assert.equal(store.readTask(oldBlocked.taskId).status, 'blocked');
  assert.equal(store.readTask(recent.taskId).status, 'succeeded');
  assert.equal(indexFiles(dir).length, 2);
});

test('defaultHome follows the platform convention and the explicit override', t => {
  const dir = fixture(t);
  const override = join(dir, 'custom-state');
  assert.equal(defaultHome({ AI_ORCHESTRATOR_HOME: override }, 'win32'), override);
  assert.equal(defaultHome({ LOCALAPPDATA: join(dir, 'localappdata') }, 'win32'),
    join(join(dir, 'localappdata'), 'ai-orchestrator'));
  assert.equal(defaultHome({ XDG_STATE_HOME: join(dir, 'xdg') }, 'linux'),
    join(join(dir, 'xdg'), 'ai-orchestrator'));
  assert.equal(defaultHome({ HOME: join(dir, 'home') }, 'linux'),
    join(join(dir, 'home'), '.local', 'state', 'ai-orchestrator'));

  const store = openTaskStore({ home: defaultHome({ AI_ORCHESTRATOR_HOME: override }, 'win32') });
  assert.equal(store.home, override);
  assert.equal(taskFiles(override).length, 0);
});

test('the store creates only the directories it uses', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  submit(store);
  assert.deepEqual(readdirSync(dir).sort(), ['idempotency', 'tasks']);
  assert.equal(store.paths.tasks, join(dir, 'tasks'));
  assert.equal('locks' in store.paths, false);
});

test('canonicalPayload is key-order independent and drops clientSessionId', t => {
  const left = { b: 1, a: [3, { d: 4, c: 5 }], nested: { z: null, y: [true, false] } };
  const right = { nested: { y: [true, false], z: null }, a: [3, { c: 5, d: 4 }], b: 1 };
  assert.equal(canonicalPayload(left), canonicalPayload(right));
  assert.equal(canonicalPayload({ ...left, clientSessionId: 'session-a' }), canonicalPayload(left));
  assert.equal(canonicalPayload(left).includes(' '), false);

  assert.throws(() => canonicalPayload(undefined), expected('invalid_argument'));
  assert.throws(() => canonicalPayload([1, 2]), expected('invalid_argument'));
  assert.throws(() => canonicalPayload({ bad: undefined }), expected('invalid_argument'));
});

test('task ids are opaque UUIDv4 values and malformed ids are rejected', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const first = submit(store, { idempotencyKey: 'id-1' });
  const second = submit(store, { idempotencyKey: 'id-2' });

  assert.match(first.task.taskId, UUID_V4);
  assert.match(second.task.taskId, UUID_V4);
  assert.notEqual(first.task.taskId, second.task.taskId);
  for (const invalid of ['', 'a/b', 'x'.repeat(129), '../escape', 'with space'])
    assert.throws(() => store.readTask(invalid), expected('invalid_argument'), invalid);
});

test('listTasks returns copies in a stable order', t => {
  const dir = fixture(t);
  const store = openTaskStore({ home: dir });
  const first = submit(store, { idempotencyKey: 'list-1' }).task;
  const second = submit(store, { idempotencyKey: 'list-2' }).task;

  assert.deepEqual(store.listTasks().map(task => task.taskId),
    [first.taskId, second.taskId].sort());
  assert.deepEqual(store.listTasks().map(task => task.taskId),
    [first.taskId, second.taskId].sort());

  const copy = store.listTasks()[0];
  copy.status = 'succeeded';
  assert.notEqual(store.readTask(first.taskId).status, 'succeeded');
});

test('a reopened store reads records written by another store instance', t => {
  const dir = fixture(t);
  const writer = openTaskStore({ home: dir });
  const created = writer.createTask({
    clientId: 'client-a', idempotencyKey: 'k-shared', payload: payload('shared'), now: 1_000,
  }).task;
  writer.updateTask(created.taskId, draft => {
    draft.status = 'running';
    draft.startedAt = 1_500;
    draft.attempts.push({ attemptId: 'attempt-1', model: 'mock/a', startedAt: 1_500, finishedAt: null });
  });

  const reader = openTaskStore({ home: dir });
  const read = reader.readTask(created.taskId);
  assert.equal(read.status, 'running');
  assert.equal(read.startedAt, 1_500);
  assert.equal(read.attempts.length, 1);

  const result = reader.reconcile({ now: 2_000 });
  assert.deepEqual(result.blocked, [created.taskId]);
  assert.equal(reader.readTask(created.taskId).block.reason, 'service-restart');
  assert.equal(writer.readTask(created.taskId).status, 'blocked');
});

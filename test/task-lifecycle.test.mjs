import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTaskStore } from '../src/tasks.mjs';
import { createTaskService } from '../src/service.mjs';

const statuses = ['queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled'];
const ordinaryEdges = new Set(['queued:running', 'queued:cancelled',
  'running:succeeded', 'running:failed', 'running:blocked']);
const expected = code => error => error.name === 'TaskStoreError' && error.code === code;

function state(draft, status) {
  draft.status = status;
  draft.startedAt = status === 'queued' ? null : draft.startedAt;
  if (['running', 'succeeded', 'failed'].includes(status)) draft.startedAt ??= 1_100;
  draft.finishedAt = ['queued', 'running'].includes(status) ? null : 1_200;
  draft.block = status === 'blocked' ? { reason: 'uncertain', requiresReconciliation: true } : null;
  draft.cancel = { requestedAt: status === 'cancelled' ? 1_150 : null,
    executionStopped: status === 'cancelled' ? true : status === 'blocked' ? 'unknown' : null,
    effectsReverted: false };
}

function fixture(t, status = 'queued') {
  const home = mkdtempSync(join(tmpdir(), 'task-lifecycle-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const store = openTaskStore({ home });
  const taskId = store.createTask({ clientId: 'owner', idempotencyKey: 'key',
    payload: { objective: 'fixture', authorization: { models: ['mock/a'] } }, now: 1_000 }).task.taskId;
  if (!['queued', 'cancelled'].includes(status)) store.updateTask(taskId, d => state(d, 'running'));
  if (status !== 'queued' && status !== 'running') store.updateTask(taskId, d => state(d, status));
  const path = join(home, 'tasks', `${taskId}.json`);
  return { home, store, taskId, path, bytes: () => readFileSync(path, 'utf8') };
}

for (const from of statuses) for (const to of statuses) {
  test(`ordinary lifecycle ${from} -> ${to}`, t => {
    const { store, taskId, bytes } = fixture(t, from);
    const before = bytes();
    if (from === to || ordinaryEdges.has(`${from}:${to}`)) {
      store.updateTask(taskId, d => state(d, to));
      assert.equal(store.readTask(taskId).status, to);
    } else {
      // Reopening queued would also clear startedAt; either guard must reject it.
      assert.throws(() => store.updateTask(taskId, d => state(d, to)),
        error => ['internal', 'invalid_argument'].includes(error.code));
      assert.equal(bytes(), before);
    }
  });
}

test('identity, request authority and acceptance metadata cannot change, even via replacement', t => {
  const { store, taskId, bytes } = fixture(t);
  const before = bytes();
  const changes = [d => { d.clientId = 'other'; }, d => { d.idempotencyKey = 'other'; },
    d => { d.payloadHash = 'a'.repeat(64); }, d => { d.createdAt++; },
    d => { d.acceptedAt++; }, d => { d.request.authorization.models.push('unapproved'); },
    d => ({ ...d, request: { objective: 'different' } })];
  for (const change of changes) {
    assert.throws(() => store.updateTask(taskId, change), expected('invalid_argument'));
    assert.equal(bytes(), before);
  }
  assert.equal(store.reconcile({ now: 2_000 }).conflicts.length, 0);
});

test('dispatched queued work blocks on restart and cannot claim unstarted cancellation', t => {
  const { store, taskId, bytes } = fixture(t);
  store.updateTask(taskId, d => { d.attempts.push({ attemptId: 'a', model: 'mock/a', startedAt: 1_100 }); });
  const before = bytes();
  assert.throws(() => store.updateTask(taskId, d => state(d, 'cancelled')), expected('internal'));
  assert.equal(bytes(), before);
  assert.deepEqual(store.reconcile({ now: 1_200 }).blocked, [taskId]);
  const blocked = bytes();
  assert.deepEqual(store.reconcile({ now: 1_300 }).blocked, []);
  assert.equal(bytes(), blocked);
});

test('cancellation cannot hide a newly inserted dispatch', t => {
  const { store, taskId, bytes } = fixture(t);
  const before = bytes();
  assert.throws(() => store.updateTask(taskId, d => {
    state(d, 'cancelled');
    d.attempts.push({ attemptId: 'a', model: 'mock/a', startedAt: 1_100 });
  }), expected('internal'));
  assert.equal(bytes(), before);
});

test('persisted dispatch identity cannot be erased before a later cancellation', t => {
  const { store, taskId, bytes } = fixture(t);
  store.updateTask(taskId, d => { d.attempts.push({ attemptId: 'a', model: 'mock/a', startedAt: 1_100 }); });
  const before = bytes();
  for (const change of [d => { d.attempts = []; },
    d => { d.attempts[0].attemptId = 'replacement'; },
    d => { d.attempts[0].model = 'mock/b'; },
    d => { d.attempts[0].startedAt++; }]) {
    assert.throws(() => store.updateTask(taskId, change), expected('internal'));
    assert.equal(bytes(), before);
  }
  store.updateTask(taskId, d => { d.attempts[0].finishedAt = 1_200; });
  assert.throws(() => store.updateTask(taskId, d => state(d, 'cancelled')), expected('internal'));
  assert.deepEqual(store.reconcile({ now: 1_300 }).blocked, [taskId]);
});

test('incoherent block and time metadata are rejected before persistence', t => {
  const { store, taskId, bytes } = fixture(t, 'running');
  const before = bytes();
  for (const change of [
    d => { state(d, 'blocked'); d.block = null; },
    d => { state(d, 'blocked'); d.cancel.executionStopped = true; },
    d => { state(d, 'failed'); d.finishedAt = null; },
    d => { d.startedAt = null; },
    d => { d.finishedAt = 1_200; },
    d => { d.block = { reason: 'unexpected', requiresReconciliation: true }; },
  ]) {
    assert.throws(() => store.updateTask(taskId, change), expected('invalid_argument'));
    assert.equal(bytes(), before);
  }
});

test('late completion cannot unblock work or rewrite terminal lifecycle evidence', t => {
  const { store, taskId, bytes } = fixture(t, 'blocked');
  const before = bytes();
  assert.throws(() => store.updateTask(taskId, d => state(d, 'succeeded')), expected('internal'));
  for (const change of [d => { d.finishedAt++; }, d => { d.block.reason = 'replacement'; },
    d => { d.attempts.push({ attemptId: 'late', model: 'mock/a', startedAt: 1_100 }); }]) {
    assert.throws(() => store.updateTask(taskId, change), expected('internal'));
    assert.equal(bytes(), before);
  }
  store.updateTask(taskId, d => { d.diff = 'partial artifact'; });
  assert.equal(store.readTask(taskId).status, 'blocked');
  assert.equal(store.readTask(taskId).diff, 'partial artifact');
});

test('legacy incoherent records fail closed on read/startup without rewriting bytes', t => {
  const { store, taskId, path, bytes } = fixture(t);
  const record = store.readTask(taskId);
  record.status = 'blocked'; // A v1 record previously accepted without block metadata.
  writeFileSync(path, JSON.stringify(record));
  const before = bytes();
  assert.throws(() => store.readTask(taskId), expected('unavailable'));
  assert.throws(() => createTaskService({ store, now: 1_200 }), e => e.code === 'unavailable');
  assert.equal(bytes(), before);
});

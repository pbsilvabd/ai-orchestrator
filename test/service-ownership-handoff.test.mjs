import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskService, openTaskHome } from '../src/service.mjs';
import { openTaskStore } from '../src/tasks.mjs';

// B30-04 ownership handoff boundary. `createTaskService({ ownership })` accepts only the
// module-local, single-use capability minted by `openTaskHome` after the exclusive lock is
// held and reconciliation succeeded. These are real store and lock fixtures; shaping a
// `{ store, releaseOwner }` object, copying a capability or replaying a released one must not
// open a second service over a home that another service owns.

const lockPath = home => join(home, 'locks', 'service-owner.lock');

function makeHome(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('B30-04: a forged ownership object cannot open a second service while another owner is active', async t => {
  const home = makeHome(t, 'owner-forged-');
  const first = createTaskService({ home, now: 1000 });
  let forgedReleases = 0;
  const forged = { store: openTaskStore({ home }), releaseOwner: () => { forgedReleases++; } };
  assert.throws(() => createTaskService({ home, ownership: forged, now: 1000 }),
    error => error.code === 'invalid_argument');
  assert.equal(forgedReleases, 0, 'the forged release was never called');
  assert.equal(existsSync(lockPath(home)), true, 'the active owner keeps the lock');
  // The first service is still the only writer for this home.
  const { task } = first.store.createTask({ clientId: 'opencode-primary',
    idempotencyKey: 'forged-check', payload: {}, now: 1000 });
  assert.equal(first.store.readTask(task.taskId).taskId, task.taskId);
  assert.throws(() => createTaskService({ home, now: 1000 }), error => error.code === 'unavailable');
  await first.close();
  assert.equal(existsSync(lockPath(home)), false);
});

test('B30-04: copies of a minted capability and reconstructed store/release pairs are refused', async t => {
  const home = makeHome(t, 'owner-copy-');
  const owner = openTaskHome({ home });
  assert.equal(Object.isFrozen(owner), true);
  assert.throws(() => createTaskService({ home, ownership: { ...owner } }),
    error => error.code === 'invalid_argument');
  assert.throws(() => createTaskService({ home, ownership: {
    store: owner.store, releaseOwner: owner.releaseOwner } }),
  error => error.code === 'invalid_argument');
  assert.throws(() => createTaskService({ home, ownership: owner, store: owner.store }),
    error => error.code === 'invalid_argument');
  assert.equal(existsSync(lockPath(home)), true, 'refused copies do not release the owner');
  // A refused copy did not consume the real capability.
  const service = createTaskService({ home, ownership: owner });
  await service.close();
  assert.equal(existsSync(lockPath(home)), false);
});

test('B30-04: a minted capability is single-use, before and after its release', async t => {
  const home = makeHome(t, 'owner-reused-');
  const owner = openTaskHome({ home });
  const service = createTaskService({ home, ownership: owner });
  assert.throws(() => createTaskService({ home, ownership: owner }),
    error => error.code === 'invalid_argument');
  await service.close();
  assert.throws(() => createTaskService({ home, ownership: owner }),
    error => error.code === 'invalid_argument');
  // The home is free for a fresh default acquisition after the confirmed close.
  const next = createTaskService({ home });
  await next.close();
});

test('B30-04: a released capability cannot be handed off and does not own the home', async t => {
  const home = makeHome(t, 'owner-released-');
  const owner = openTaskHome({ home });
  await owner.releaseOwner();
  assert.equal(existsSync(lockPath(home)), false);
  assert.throws(() => createTaskService({ home, ownership: owner }),
    error => error.code === 'invalid_argument');
  const service = createTaskService({ home });
  await service.close();
});

test('B30-04: a capability for another home is refused and remains unused', async t => {
  const first = makeHome(t, 'owner-home-a-');
  const second = makeHome(t, 'owner-home-b-');
  const owner = openTaskHome({ home: first });
  assert.throws(() => createTaskService({ home: second, ownership: owner }),
    error => error.code === 'invalid_argument');
  assert.equal(existsSync(lockPath(first)), true, 'the mismatched attempt released nothing');
  assert.equal(existsSync(lockPath(second)), false, 'the other home was never locked');
  const service = createTaskService({ home: first, ownership: owner });
  await service.close();
  assert.equal(existsSync(lockPath(first)), false);
});

test('B30-04: openTaskHome refuses a second legitimate owner without disturbing the active one', async t => {
  const home = makeHome(t, 'owner-competing-');
  const first = createTaskService({ home });
  const held = readFileSync(lockPath(home), 'utf8');
  assert.throws(() => openTaskHome({ home }), error => error.code === 'unavailable');
  assert.equal(readFileSync(lockPath(home), 'utf8'), held,
    'the refused acquisition does not replace or remove the active lock');
  await first.close();
  assert.equal(existsSync(lockPath(home)), false);
});

test('B30-04: a failed pre-release cleanup keeps ownership and the capability unusable', async t => {
  const home = makeHome(t, 'owner-uncertain-');
  const owner = openTaskHome({ home, beforeRelease: async () => {
    throw Object.assign(new Error('listener stop unconfirmed'), { code: 'uncertain-stop' });
  } });
  const service = createTaskService({ home, ownership: owner });
  await assert.rejects(service.close(), error => error.code === 'uncertain-stop');
  assert.equal(existsSync(lockPath(home)), true, 'uncertain cleanup retains the owner lock');
  assert.throws(() => createTaskService({ home, ownership: owner }),
    error => error.code === 'invalid_argument');
  assert.throws(() => openTaskHome({ home }), error => error.code === 'unavailable');
  // Maintainer recovery after inspecting the retained lock (test-only removal).
  rmSync(lockPath(home));
  const recovered = createTaskService({ home });
  await recovered.close();
});

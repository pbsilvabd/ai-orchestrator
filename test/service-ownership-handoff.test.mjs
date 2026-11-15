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

test('B30-04: the creator release cannot release a consumed capability while its service is active', async t => {
  const home = makeHome(t, 'owner-early-release-');
  const cap = openTaskHome({ home });
  const service = createTaskService({ home, ownership: cap });
  const held = readFileSync(lockPath(home), 'utf8');
  // Release authority transferred to the service at consumption: the creator-facing release
  // must refuse rather than remove the active owner's lock.
  assert.throws(() => cap.releaseOwner(), error => error.code === 'invalid_argument');
  assert.equal(readFileSync(lockPath(home), 'utf8'), held, 'the active service keeps its lock');
  assert.throws(() => createTaskService({ home }), error => error.code === 'unavailable');
  // The refused early release did not disable the service: it is still the only writer.
  const { task } = service.store.createTask({ clientId: 'opencode-primary',
    idempotencyKey: 'early-release', payload: {}, now: 1000 });
  assert.equal(service.store.readTask(task.taskId).taskId, task.taskId);
  await service.close();
  assert.equal(existsSync(lockPath(home)), false);
  // The creator still cannot release a consumed capability after close; the service path did.
  assert.throws(() => cap.releaseOwner(), error => error.code === 'invalid_argument');
  // Restart after the confirmed close acquires the home normally.
  const next = createTaskService({ home });
  await next.close();
});

test('B30-04: close is idempotent and releases once after scheduler idle', async t => {
  const home = makeHome(t, 'owner-close-idempotent-');
  const cap = openTaskHome({ home });
  const service = createTaskService({ home, ownership: cap });
  const first = service.close();
  const second = service.close();
  assert.equal(first, second, 'repeated close returns the same release operation');
  await Promise.all([first, second]);
  assert.equal(existsSync(lockPath(home)), false);
  assert.throws(() => cap.releaseOwner(), error => error.code === 'invalid_argument');
  const next = createTaskService({ home });
  await next.close();
});

test('B30-04: close runs beforeRelease cleanup while ownership is still held', async t => {
  const home = makeHome(t, 'owner-before-release-');
  let lockedDuringCleanup;
  const cap = openTaskHome({ home, beforeRelease: async () => {
    lockedDuringCleanup = existsSync(lockPath(home));
  } });
  const service = createTaskService({ home, ownership: cap });
  await service.close();
  assert.equal(lockedDuringCleanup, true, 'cleanup runs before the owner lock is removed');
  assert.equal(existsSync(lockPath(home)), false);
});

test('B30-04: a failed construction returns the capability to its creator for cleanup', async t => {
  const home = makeHome(t, 'owner-failed-construction-');
  let cleanups = 0;
  const cap = openTaskHome({ home, beforeRelease: async () => { cleanups++; } });
  // A worker without `prepare` makes scheduler creation fail after consumption. No service
  // exists, so release authority returns to the creator.
  assert.throws(() => createTaskService({ home, ownership: cap, worker: {} }),
    error => error.code === 'internal');
  assert.equal(existsSync(lockPath(home)), true);
  await cap.releaseOwner();
  assert.equal(cleanups, 1);
  assert.equal(existsSync(lockPath(home)), false);
  const next = createTaskService({ home });
  await next.close();
});

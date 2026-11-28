import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskService } from '../src/service.mjs';
import { setImmediate as immediate } from 'node:timers/promises';

// Pre-spawn revalidation of the signed approval receipt (B30-05 P1). The cryptographic
// positive path needs a real FIDO2 hardware key and stays `not_run`; these tests exercise
// the service/scheduler *mechanism* with a clearly-labelled mock receipt, proving that a
// queued task whose admission expiry/drift happens after submission is refused with zero
// workspace/spawn. A refusal before any dispatch becomes `cancelled`; a refusal after the
// dispatch reservation is `blocked` (uncertain) and never replayed.

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'approval-prespawn-'));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repo);
  git(repo, 'init');
  git(repo, 'config', 'user.name', 'Fixture');
  git(repo, 'config', 'user.email', 'fixture@example.com');
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  const baseCommit = git(repo, 'rev-parse', 'HEAD');
  const config = { clientId: 'owner',
    authorization: { models: ['fixture/mock'], tools: ['read', 'edit'], writableRoots: [repo] },
    limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 4096 } };
  const services = [];
  t.after(async () => {
    for (const service of services) await service.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const request = (key = 'one') => ({ clientId: 'owner', idempotencyKey: key,
    objective: 'Run a scoped fixture', acceptanceCriteria: ['record execution'],
    repository: { path: repo, baseRef: baseCommit, branch: `task/${key}` },
    authorization: { models: ['fixture/mock'], tools: ['read'], writablePaths: ['src/**'] },
    limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 4096 } });
  return { root, repo, home, config, services, request };
}

// A mock worker that records whether it was asked to prepare and returns a trivial
// zero-exit invocation otherwise.
const workerFor = onPrepare => ({ prepare({ workspace }) {
  onPrepare();
  return { executable: process.execPath, args: ['-e', ''], cwd: workspace.workspacePath,
    env: {}, timeoutMs: 10_000, stdoutMaxBytes: 4096, stderrMaxBytes: 4096, killGraceMs: 100 };
} });

// A mock worker whose prepare runs a side effect (advance time / drift) and whose child, if
// actually spawned, writes `marker`. Asserting the marker is absent proves zero spawn.
const markerWorker = (marker, sideEffect) => ({ prepare({ workspace }) {
  sideEffect();
  return { executable: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
    cwd: workspace.workspacePath, env: {}, timeoutMs: 10_000,
    stdoutMaxBytes: 4096, stderrMaxBytes: 4096, killGraceMs: 100 };
} });

const expired = at => { const e = new Error('expired'); e.code = 'authorization_denied'; throw e; };

test('pre-spawn: a valid receipt admits and the worker is prepared', async t => {
  const f = setup(t);
  let prepared = 0;
  let currentNow = 1_000;
  const admission = () => ({ admitted: true, expiresAt: 5_000, revalidate() {} });
  const service = createTaskService({ home: f.home, config: f.config,
    worker: workerFor(() => { prepared += 1; }), admission, now: () => currentNow });
  f.services.push(service);
  const { taskId } = service.submitTask(f.request());
  await service.whenIdle();
  assert.equal(prepared, 1);
  assert.equal(service.store.readTask(taskId).status, 'succeeded');
});

test('pre-spawn: expiry after submission cancels the queued task with zero spawn', async t => {
  const f = setup(t);
  let prepared = 0;
  let currentNow = 1_000;
  const admission = () => ({ admitted: true, expiresAt: 5_000,
    revalidate(at) { if (at >= 5_000) expired(at); } });
  const service = createTaskService({ home: f.home, config: f.config,
    worker: workerFor(() => { prepared += 1; }), admission, now: () => currentNow });
  f.services.push(service);
  const { taskId } = service.submitTask(f.request());
  currentNow = 6_000; // advance past expiry before the scheduler executes
  await service.whenIdle();
  assert.equal(prepared, 0, 'expiry before dispatch must not spawn');
  const task = service.store.readTask(taskId);
  assert.equal(task.status, 'cancelled');
  assert.equal(task.cancel.executionStopped, true);
  assert.equal(task.attempts.length, 0);
  assert.ok(task.progress.some(p => p.event === 'admission-refused'));
});

test('pre-spawn: expiry during worker.prepare blocks after dispatch with zero spawn', async t => {
  const f = setup(t);
  const marker = join(f.root, 'spawned');
  let currentNow = 1_000;
  const admission = () => ({ admitted: true, expiresAt: 5_000,
    revalidate(at) { if (at >= 5_000) expired(at); } });
  const service = createTaskService({ home: f.home, config: f.config,
    worker: markerWorker(marker, () => { currentNow = 6_000; }), admission, now: () => currentNow });
  f.services.push(service);
  const { taskId } = service.submitTask(f.request());
  await service.whenIdle();
  const task = service.store.readTask(taskId);
  assert.equal(task.status, 'blocked', 'expiry during prepare must block, not cancel');
  assert.equal(task.attempts.length, 1, 'the dispatch reservation must be preserved');
  assert.equal(task.cancel.executionStopped, 'unknown');
  assert.ok(!existsSync(marker), 'the child must not spawn');
});

test('pre-spawn: host drift during worker.prepare blocks after dispatch with zero spawn', async t => {
  const f = setup(t);
  const marker = join(f.root, 'spawned');
  let hostDigest = 'digest-a';
  const admission = () => ({ admitted: true, expiresAt: 100_000,
    revalidate() { if (hostDigest !== 'digest-a') { const e = new Error('drift'); e.code = 'authorization_denied'; throw e; } } });
  const service = createTaskService({ home: f.home, config: f.config,
    worker: markerWorker(marker, () => { hostDigest = 'digest-b'; }), admission, now: () => 1_000 });
  f.services.push(service);
  const { taskId } = service.submitTask(f.request());
  await service.whenIdle();
  const task = service.store.readTask(taskId);
  assert.equal(task.status, 'blocked', 'host drift during prepare must block, not cancel');
  assert.equal(task.attempts.length, 1);
  assert.ok(!existsSync(marker), 'the child must not spawn');
});

test('pre-spawn: async revalidation is refused before reservation or after reservation without leaking rejection', async t => {
  for (const phase of ['before-reservation', 'after-reservation']) {
    for (const outcome of ['resolve', 'reject', 'thenable-resolve', 'thenable-reject']) {
      await t.test(`${phase}/${outcome}`, async subtest => {
        const f = setup(subtest);
        const marker = join(f.root, 'spawned');
        let calls = 0;
        let prepared = 0;
        const unhandled = [];
        const onUnhandled = reason => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        subtest.after(() => process.off('unhandledRejection', onUnhandled));
        const asyncCall = phase === 'before-reservation' ? 1 : 2;
        const admission = () => ({ admitted: true, revalidate() {
          calls += 1;
          if (calls !== asyncCall) return;
          const rejects = outcome.endsWith('reject');
          const promise = rejects
            ? Promise.reject(new Error('fixture async revalidation failed'))
            : Promise.resolve();
          return outcome.startsWith('thenable')
            ? { then(resolve, reject) { promise.then(resolve, reject); } }
            : promise;
        } });
        const service = createTaskService({ home: f.home, config: f.config,
          worker: workerFor(() => { prepared += 1; }), admission, now: () => 1_000 });
        f.services.push(service);
        const { taskId } = service.submitTask(f.request(`${phase}-${outcome}`));
        await service.whenIdle();
        await immediate();
        const task = service.store.readTask(taskId);
        assert.deepEqual(unhandled, [], 'async verifier outcomes must be observed');
        assert.ok(!existsSync(marker), 'an async verifier must never authorize child spawn');
        if (phase === 'before-reservation') {
          assert.equal(prepared, 0);
          assert.equal(task.status, 'cancelled');
          assert.equal(task.attempts.length, 0);
          assert.equal(task.cancel.executionStopped, true);
        } else {
          assert.equal(prepared, 1, 'the reserved path reaches the synchronous prepare stage');
          assert.equal(task.status, 'blocked');
          assert.equal(task.attempts.length, 1, 'the dispatch reservation must be preserved');
          assert.equal(task.cancel.executionStopped, 'unknown');
        }
      });
    }
  }
});

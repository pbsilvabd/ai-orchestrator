import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskService } from '../src/service.mjs';

// Pre-spawn revalidation of the signed approval receipt (B30-05 P1). The cryptographic
// positive path needs a real FIDO2 hardware key and stays `not_run`; these tests exercise
// the service/scheduler *mechanism* with a clearly-labelled mock receipt, proving that a
// queued task whose admission expiry/drift happens after submission is blocked with zero
// workspace/spawn and a durable blocked record.

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

// A mock worker that records whether it was asked to prepare (i.e. whether spawn would
// begin) and returns a trivial zero-exit invocation otherwise.
const workerFor = onPrepare => ({ prepare({ workspace }) {
  onPrepare();
  return { executable: process.execPath, args: ['-e', ''], cwd: workspace.workspacePath,
    env: {}, timeoutMs: 10_000, stdoutMaxBytes: 4096, stderrMaxBytes: 4096, killGraceMs: 100 };
} });

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
    revalidate(at) { if (at >= 5_000) { const e = new Error('expired'); e.code = 'authorization_denied'; throw e; } } });
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

test('pre-spawn: host drift after submission cancels the queued task with zero spawn', async t => {
  const f = setup(t);
  let prepared = 0;
  let hostDigest = 'digest-a';
  const admission = () => ({ admitted: true, expiresAt: 100_000,
    revalidate() { if (hostDigest !== 'digest-a') { const e = new Error('drift'); e.code = 'authorization_denied'; throw e; } } });
  const service = createTaskService({ home: f.home, config: f.config,
    worker: workerFor(() => { prepared += 1; }), admission, now: () => 1_000 });
  f.services.push(service);
  const { taskId } = service.submitTask(f.request());
  hostDigest = 'digest-b'; // host binary changed after submission
  await service.whenIdle();
  assert.equal(prepared, 0, 'host drift before dispatch must not spawn');
  assert.equal(service.store.readTask(taskId).status, 'cancelled');
});

test('pre-spawn: a missing receipt cancels the queued task with zero spawn', async t => {
  const f = setup(t);
  let prepared = 0;
  const admission = () => undefined; // admits but supplies no trusted revalidation receipt
  const service = createTaskService({ home: f.home, config: f.config,
    worker: workerFor(() => { prepared += 1; }), admission, now: () => 1_000 });
  f.services.push(service);
  const { taskId } = service.submitTask(f.request());
  await service.whenIdle();
  assert.equal(prepared, 0, 'a missing receipt must not spawn');
  assert.equal(service.store.readTask(taskId).status, 'cancelled');
});

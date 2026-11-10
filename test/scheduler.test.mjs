import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createTaskService } from '../src/service.mjs';
import { openTaskStore } from '../src/tasks.mjs';

const serviceUrl = new URL('../src/service.mjs', import.meta.url).href;
const storeUrl = new URL('../src/tasks.mjs', import.meta.url).href;
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
const read = path => readFileSync(path, 'utf8');
const isAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(predicate, message) {
  const deadline = Date.now() + 8000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), message);
}
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'scheduler-'));
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
  const start = options => {
    const service = createTaskService({ home, config, ...options });
    services.push(service);
    return service;
  };
  const request = (key = 'one') => ({ clientId: 'owner', idempotencyKey: key,
    objective: 'Run a scoped fixture', acceptanceCriteria: ['record execution'],
    repository: { path: repo, baseRef: baseCommit, branch: `task/${key}` },
    authorization: { models: ['fixture/mock'], tools: ['read'], writablePaths: ['src/**'] },
    limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 4096 } });
  return { root, repo, home, config, baseCommit, start, request };
}
const workerFor = code => ({ prepare({ workspace }) {
  return { executable: process.execPath, args: ['-e', code], cwd: workspace.workspacePath,
    env: {}, timeoutMs: 10_000, stdoutMaxBytes: 4096, stderrMaxBytes: 4096, killGraceMs: 100 };
} });

test('B12-01: prompt submission, durable identity and serial fixtures remain observable between events', async t => {
  const f = setup(t);
  const events = join(f.root, 'events');
  const marker = join(f.root, 'active');
  const release = join(f.root, 'release');
  const child = `const fs=require('node:fs');
    const lock=${JSON.stringify(marker)},events=${JSON.stringify(events)},release=${JSON.stringify(release)};
    fs.writeFileSync(lock,'active',{flag:'wx'});fs.appendFileSync(events,'start\\n');
    const timer=setInterval(()=>{if(fs.existsSync(release)){
      clearInterval(timer);fs.appendFileSync(events,'end\\n');fs.unlinkSync(lock);}},10);`;
  const base = workerFor(child);
  const service = f.start({ worker: { prepare(input) {
    const task = service.store.readTask(input.task.taskId);
    assert.equal(task.status, 'running');
    assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0].attemptId, input.task.attempts[0].attemptId);
    assert.equal(task.attempts[0].workspace.workspacePath, input.workspace.workspacePath);
    assert.ok(existsSync(task.attempts[0].workspace.receiptPath));
    const path = join(f.home, 'tasks', `${task.taskId}.json`);
    const before = read(path);
    assert.throws(() => service.store.updateTask(task.taskId, d => {
      const alternate = join(f.root, 'alternate', task.taskId);
      d.attempts[0].workspace.workspacePath = alternate;
      d.attempts[0].workspace.receiptPath = join(f.root, 'alternate', `${task.taskId}.workspace.json`);
    }), e => e.code === 'internal');
    assert.equal(read(path), before);
    const corrupted = structuredClone(task);
    corrupted.attempts[0].workspace.branch = 'task/another';
    writeFileSync(path, JSON.stringify(corrupted));
    assert.throws(() => service.store.readTask(task.taskId), e => e.code === 'unavailable');
    writeFileSync(path, before);
    return base.prepare(input);
  } } });
  const a = service.submitTask(f.request('one'));
  const b = service.submitTask(f.request('two'));
  assert.equal(a.status, 'queued');
  assert.equal(b.status, 'queued');
  assert.equal(existsSync(events), false, 'spawn happened inside submit');
  await until(() => existsSync(marker), 'first fixture started');
  for (let n = 0; n < 10; n++) {
    assert.equal(service.getTaskStatus({ taskId: a.taskId }).status, 'running');
    assert.equal(service.getTaskStatus({ taskId: b.taskId }).status, 'queued');
    await delay(5);
  }
  assert.equal(read(events), 'start\n');
  writeFileSync(release, 'continue');
  await service.whenIdle();
  assert.equal(read(events), 'start\nend\nstart\nend\n');
  for (const { taskId } of [a, b]) {
    const task = service.store.readTask(taskId);
    assert.equal(task.status, 'succeeded');
    assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0].exitCode, 0);
    assert.match(service.getTaskResult({ taskId }).limitations[0], /without a recorded passing test/);
    assert.throws(() => service.store.updateTask(taskId, d => {
      d.attempts[0].workspace.workspacePath = f.repo;
    }));
  }
  assert.equal(git(f.repo, 'status', '--porcelain'), '');
});

test('B12-02: actual filesystem failure before the dispatch write preserves bytes and starts no child', async t => {
  const f = setup(t);
  const counter = join(f.root, 'spawned');
  const service = f.start({ worker: workerFor(`require('node:fs').writeFileSync(${JSON.stringify(counter)},'bad')`) });
  const { taskId } = service.submitTask(f.request());
  const tasks = join(f.home, 'tasks');
  const preserved = join(f.home, 'preserved-tasks');
  const before = read(join(tasks, `${taskId}.json`));
  // Replace the actual parent directory by a regular file: real ENOTDIR on write.
  renameSync(tasks, preserved);
  writeFileSync(tasks, 'not a directory');
  await service.whenIdle();
  assert.equal(existsSync(counter), false);
  assert.equal(read(join(preserved, `${taskId}.json`)), before);
  unlinkSync(tasks);
  renameSync(preserved, tasks);
  assert.equal(service.schedulerStatus().stopped, true);
  assert.equal(service.store.readTask(taskId).status, 'queued');
  assert.throws(() => service.submitTask(f.request('new')), e => e.code === 'unavailable');
});

test('B12-02: actual rename failure after reading queued state prevents preparation and preserves the record', async t => {
  const f = setup(t);
  const store = openTaskStore({ home: f.home });
  const original = store.updateTask;
  let prepared = 0;
  let before;
  let saved;
  store.updateTask = (taskId, mutate) => original(taskId, draft => {
    mutate(draft);
    const path = join(f.home, 'tasks', `${taskId}.json`);
    before = read(path);
    saved = `${path}.preserved`;
    renameSync(path, saved);
    mkdirSync(path); // Atomic rename cannot replace a directory with a regular file.
  });
  const service = f.start({ store, worker: { prepare() { prepared++; } } });
  const { taskId } = service.submitTask(f.request());
  await service.whenIdle();
  assert.equal(prepared, 0);
  assert.equal(read(saved), before);
  const path = join(f.home, 'tasks', `${taskId}.json`);
  rmdirSync(path);
  renameSync(saved, path);
  assert.equal(store.readTask(taskId).status, 'queued');
});

for (const phase of ['before-dispatch', 'after-dispatch', 'after-spawn']) {
  test(`B12-03: real service death ${phase} never replays on reopen`, { timeout: 20_000 }, async t => {
    const f = setup(t);
    const marker = join(f.root, 'spawned');
    const pidFile = join(f.root, 'worker-pid');
    const childCode = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
      fs.appendFileSync(${JSON.stringify(marker)},'spawn\\n');setTimeout(()=>{},300);`;
    const script = `
      import {createTaskService} from ${JSON.stringify(serviceUrl)};
      import {openTaskStore} from ${JSON.stringify(storeUrl)};
      const store=openTaskStore({home:process.argv[1]});
      const original=store.updateTask;
      const phase=process.argv[2];
      store.updateTask=(id,mutate)=>{
        if(phase==='before-dispatch'){process.stdout.write('boundary\\n');while(true){}}
        const result=original(id,mutate);
        if(phase==='after-dispatch'){process.stdout.write('boundary\\n');while(true){}}
        return result;
      };
      const service=createTaskService({store,config:${JSON.stringify(f.config)},worker:{prepare({workspace}){
        return {executable:process.execPath,args:['-e',${JSON.stringify(childCode)}],cwd:workspace.workspacePath,
          env:{},timeoutMs:3000,stdoutMaxBytes:1024,stderrMaxBytes:1024};
      }}});
      const result=service.submitTask(${JSON.stringify(f.request())});
      process.stdout.write(result.taskId+'\\n');setInterval(()=>{},1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.home, phase],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let errors = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { errors += bytes; });
    const exited = once(child, 'exit');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    });
    await until(() => phase === 'after-spawn' ? existsSync(marker) : output.includes('boundary'), `boundary reached: ${errors}`);
    const taskId = output.split('\n')[0];
    child.kill('SIGKILL');
    await exited;
    const observer = openTaskStore({ home: f.home });
    const before = observer.readTask(taskId);
    const expected = phase === 'before-dispatch' ? 'queued' : 'running';
    assert.equal(before.status, expected);
    assert.throws(() => createTaskService({ home: f.home }), e => e.code === 'unavailable');
    // Explicit fixture maintainer action, after known service death and worker exit.
    if (phase === 'after-spawn') {
      const fixturePid = Number(read(pidFile));
      if (isAlive(fixturePid)) process.kill(fixturePid, 'SIGKILL');
      await until(() => !isAlive(fixturePid), 'fixture root stopped before lock removal');
    }
    unlinkSync(join(f.home, 'locks', 'service-owner.lock'));
    let prepared = 0;
    const reopened = f.start({ worker: { prepare() { prepared++; throw new Error('replayed'); } } });
    await reopened.whenIdle();
    const after = reopened.store.readTask(taskId);
    assert.equal(after.status, phase === 'before-dispatch' ? 'queued' : 'blocked');
    assert.equal(after.attempts.length, before.attempts.length);
    if (phase !== 'before-dispatch') {
      assert.equal(after.cancel.executionStopped, 'unknown');
      assert.equal(after.cancel.effectsReverted, false);
      assert.equal(after.block.reason, 'service-restart');
    }
    assert.equal(prepared, 0);
    assert.equal(reopened.submitTask(f.request()).taskId, taskId);
    await reopened.whenIdle();
    assert.equal(prepared, 0, 'reconnect replay must not enqueue old work');
    assert.equal(existsSync(marker), phase === 'after-spawn');
    if (phase === 'after-spawn') assert.equal(read(marker), 'spawn\n');
  });
}

test('B12-04: duplicates, another process observer and competing owner preserve the same dispatch', async t => {
  const f = setup(t);
  const marker = join(f.root, 'ready');
  const release = join(f.root, 'release');
  const service = f.start({ worker: workerFor(`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'ready');
    const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`) });
  const original = service.submitTask(f.request());
  await until(() => existsSync(marker), 'fixture running');
  const before = service.store.readTask(original.taskId);
  for (let n = 0; n < 10; n++) {
    const replay = service.submitTask(f.request());
    assert.equal(replay.taskId, original.taskId);
    assert.equal(replay.idempotentReplay, true);
  }
  const observe = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {openTaskStore} from ${JSON.stringify(storeUrl)};
    import {createTaskService} from ${JSON.stringify(serviceUrl)};
    const store=openTaskStore({home:process.argv[1]});
    const task=store.readTask(process.argv[2]);
    let error;try{createTaskService({store})}catch(e){error=e.code}
    console.log(JSON.stringify({status:task.status,attempts:task.attempts,error}));
  `, f.home, original.taskId], { encoding: 'utf8', windowsHide: true });
  const observed = JSON.parse(observe);
  assert.equal(observed.status, 'running');
  assert.equal(observed.error, 'unavailable');
  assert.deepEqual(observed.attempts, before.attempts);
  assert.deepEqual(service.store.readTask(original.taskId), before);
  writeFileSync(release, 'continue');
  await service.whenIdle();
  assert.equal(service.store.readTask(original.taskId).attempts.length, 1);
});

test('B12-05: active shutdown blocks before abort, holds ownership and cannot launch queued work', async t => {
  const f = setup(t);
  const marker = join(f.root, 'ready');
  let prepared = 0;
  const fixture = workerFor(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`);
  const service = f.start({ worker: { prepare(input) { prepared++; return fixture.prepare(input); } } });
  const a = service.submitTask(f.request());
  const b = service.submitTask(f.request('two'));
  await until(() => existsSync(marker), 'worker running');
  const closing = service.close();
  assert.equal(service.store.readTask(a.taskId).status, 'blocked');
  assert.equal(service.store.readTask(a.taskId).block.reason, 'service-shutdown');
  assert.throws(() => createTaskService({ home: f.home }), e => e.code === 'unavailable');
  assert.deepEqual(await closing, { releaseOwnership: false });
  assert.equal(prepared, 1);
  assert.equal(service.store.readTask(b.taskId).status, 'queued');
  assert.equal(service.store.readTask(b.taskId).attempts.length, 0);
  assert.equal(service.store.readTask(a.taskId).cancel.executionStopped, 'unknown');
  assert.throws(() => service.getTaskStatus({ taskId: a.taskId }), e => e.code === 'unavailable');
  assert.equal(service.close(), closing);
  assert.ok(existsSync(join(f.home, 'locks', 'service-owner.lock')));
});

test('B14-04: cancellation persists its block first and halts the queue before worker return', async t => {
  const f = setup(t);
  const marker = join(f.root, 'ready');
  const release = join(f.root, 'release');
  const service = f.start({ worker: workerFor(`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'ready');
    const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`) });
  const a = service.submitTask(f.request());
  const b = service.submitTask(f.request('two'));
  await until(() => existsSync(marker), 'worker running');
  service.cancelTask({ taskId: a.taskId });
  const before = service.store.readTask(a.taskId);
  writeFileSync(release, 'exit zero');
  await service.whenIdle();
  const after = service.store.readTask(a.taskId);
  assert.equal(after.status, 'blocked');
  assert.equal(after.cancel.requestedAt, before.cancel.requestedAt);
  assert.equal(after.cancel.executionStopped, 'unknown');
  assert.deepEqual(after.block, before.block);
  assert.equal(after.finishedAt, before.finishedAt);
  assert.equal(service.store.readTask(b.taskId).status, 'queued');
  assert.equal(service.schedulerStatus().requiresReconciliation, true);
});

test('B14-04: a late real zero exit cannot replace an already blocked task', async t => {
  const f = setup(t);
  const marker = join(f.root, 'ready');
  const release = join(f.root, 'release');
  const service = f.start({ worker: workerFor(`const fs=require('node:fs');
    fs.writeFileSync(${JSON.stringify(marker)},'ready');
    const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){
      clearInterval(timer);process.exit(0)}} ,10)`) });
  const accepted = service.submitTask(f.request('late-success'));
  await until(() => existsSync(marker), 'worker running');
  service.store.updateTask(accepted.taskId, draft => {
    draft.status = 'blocked';
    draft.finishedAt = Date.now();
    draft.cancel.executionStopped = 'unknown';
    draft.block = { reason: 'service-shutdown', requiresReconciliation: true };
    draft.progress.push({ at: draft.finishedAt, event: 'blocked', detail: 'service-shutdown' });
  });
  const blockedBytes = readFileSync(join(f.home, 'tasks', `${accepted.taskId}.json`), 'utf8');
  writeFileSync(release, 'allow zero exit');
  await service.whenIdle();
  assert.equal(service.store.readTask(accepted.taskId).status, 'blocked');
  assert.equal(readFileSync(join(f.home, 'tasks', `${accepted.taskId}.json`), 'utf8'), blockedBytes);
  assert.equal(service.schedulerStatus().requiresReconciliation, true);
  assert.deepEqual(await service.close(), { releaseOwnership: false });
});

function assertPartialWorkerLog(service, taskId) {
  const task = service.store.readTask(taskId);
  const persisted = task.artifact.workerLog;
  assert.match(persisted.outputTail, /worker stdout/);
  assert.match(persisted.outputTail, /worker stderr/);
  assert.match(persisted.outputTail, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(task), /B14_FIXTURE_SECRET/);
  assert.equal(persisted.outputTruncated, true);
  const result = service.getTaskResult({ taskId, include: ['log'] });
  assert.deepEqual(result.workerLog, persisted);
  assert.deepEqual(result.testRuns, []);
  assert.equal(result.logsTruncated, true);
  assert.equal('workerLog' in service.getTaskResult({ taskId, include: ['tests'] }), false);
  const all = service.getTaskResult({ taskId });
  assert.ok(Buffer.byteLength((all.diff ?? '') + all.workerLog.outputTail, 'utf8') <=
    task.request.limits.maxOutputBytes);
}

const workerWritesLog = `process.stdout.write('😀'.repeat(1200) + 'worker stdout api_key=B14_FIXTURE_SECRET',
  () => process.stderr.write('worker stderr', () => fs.writeFileSync(readyPath, String(process.pid))));`;

test('B14-02: active cancellation preserves bounded worker logs and partial workspace evidence', async t => {
  const f = setup(t);
  const marker = join(f.root, 'ready');
  const service = f.start({ worker: workerFor(`const fs=require('node:fs');
    fs.writeFileSync('partial-before-cancel.txt','observed');
    const readyPath = ${JSON.stringify(marker)};
    ${workerWritesLog}
    setInterval(()=>{},1000)`) });
  const accepted = service.submitTask(f.request('active-cancel'));
  await until(() => existsSync(marker), 'worker running');
  const first = service.cancelTask({ taskId: accepted.taskId, reason: 'operator request' });
  assert.equal(first.status, 'blocked');
  assert.equal(first.effect, 'requested');
  await service.whenIdle();
  const task = service.store.readTask(accepted.taskId);
  assert.equal(task.status, 'blocked');
  assert.equal(task.cancel.executionStopped, 'unknown');
  assert.equal(task.cancel.effectsReverted, false);
  assert.equal(task.block.reason, 'cancelled-uncertain');
  assert.ok(task.artifact.changedFiles.includes('partial-before-cancel.txt'));
  assert.deepEqual(task.artifact.testRuns, []);
  assertPartialWorkerLog(service, accepted.taskId);
  assert.deepEqual(service.cancelTask({ taskId: accepted.taskId }), {
    schemaVersion: 1, cancelRequestedAt: first.cancelRequestedAt,
    status: 'blocked', effect: 'already_terminal' });
  assert.deepEqual(await service.close(), { releaseOwnership: false });
});

for (const winner of ['root exit', 'deadline']) {
  test(`B14-02: ${winner} wins at the durable task boundary`, { timeout: 25_000 }, async t => {
    const f = setup(t);
    const marker = join(f.root, 'ready');
    const release = join(f.root, 'release');
    const exited = join(f.root, 'exited');
    const deadlineWins = winner === 'deadline';
    const worker = workerFor(`const fs = require('node:fs');
      const readyPath = ${JSON.stringify(marker)};
      ${workerWritesLog}
      const timer = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(release)})) return;
        clearInterval(timer);
        fs.writeFileSync(${JSON.stringify(exited)}, 'zero');
        process.exit(0);
      }, 10);`);
    const invocationTimeout = 4_000;
    const service = f.start({ worker: {
      prepare(input) {
        return { ...worker.prepare(input), timeoutMs: deadlineWins ? 10_000 : invocationTimeout };
      },
    } });
    const accepted = service.submitTask(f.request(`deadline-order-${deadlineWins}`));
    await until(() => existsSync(marker), 'worker is ready and has emitted its output');
    if (!deadlineWins) writeFileSync(release, 'exit normally before the deadline');
    await service.whenIdle();
    const task = service.store.readTask(accepted.taskId);
    assert.equal(task.status, deadlineWins ? 'blocked' : 'succeeded');
    assert.equal(task.attempts.length, 1);
    assert.equal(existsSync(exited), !deadlineWins);
    if (deadlineWins) {
      assert.equal(task.block.reason, 'worker-outcome-uncertain');
      assert.equal(task.cancel.executionStopped, 'unknown');
      assert.equal(task.cancel.effectsReverted, false);
      assert.equal(task.artifact.diff, null, 'the task budget was exhausted');
      assertPartialWorkerLog(service, accepted.taskId);
    } else {
      assert.equal(task.attempts[0].exitCode, 0);
      assert.equal(task.block, null);
    }
    const recordPath = join(f.home, 'tasks', `${accepted.taskId}.json`);
    const finalBytes = read(recordPath);
    if (deadlineWins) {
      await until(() => !isAlive(Number(read(marker))), 'fixture root exited after the deadline');
      writeFileSync(release, 'offer normal exit after the deadline');
    } else await delay(invocationTimeout);
    assert.equal(service.cancelTask({ taskId: accepted.taskId }).effect, 'already_terminal');
    assert.equal(existsSync(exited), !deadlineWins);
    assert.equal(read(recordPath), finalBytes);
  });
}

test('B14-01: cancellation at the prepared-before-spawn boundary starts no child', async t => {
  const f = setup(t);
  const spawned = join(f.root, 'must-not-spawn');
  let service;
  service = f.start({ worker: { prepare({ task, workspace }) {
    service.cancelTask({ taskId: task.taskId, reason: 'cancel at dispatch boundary' });
    return { executable: process.execPath, args: ['-e',
      `require('node:fs').writeFileSync(${JSON.stringify(spawned)},'unexpected')`],
      cwd: workspace.workspacePath, env: {}, timeoutMs: 1000 };
  } } });
  const accepted = service.submitTask(f.request('cancel-before-spawn'));
  await service.whenIdle();
  const task = service.store.readTask(accepted.taskId);
  assert.equal(task.status, 'blocked');
  assert.equal(task.cancel.executionStopped, 'unknown');
  assert.equal(task.attempts.length, 1, 'the durable dispatch reservation cannot be erased');
  assert.equal(existsSync(spawned), false, 'cancellation before spawn must start no child');
  assert.deepEqual(await service.close(), { releaseOwnership: false });
});

test('known spawn error becomes failed; queued cancellation and idle close start no child', async t => {
  const f = setup(t);
  const service = f.start({ worker: { prepare({ workspace }) { return {
    executable: join(f.root, 'does-not-exist'), cwd: workspace.workspacePath, env: {}, timeoutMs: 1000,
  }; } } });
  const a = service.submitTask(f.request());
  const b = service.submitTask(f.request('two'));
  service.cancelTask({ taskId: b.taskId });
  await service.whenIdle();
  assert.equal(service.store.readTask(a.taskId).status, 'failed');
  assert.equal(service.store.readTask(a.taskId).attempts[0].outcome, 'spawn-error');
  assert.equal(service.store.readTask(a.taskId).attempts[0].spawnErrorCode, 'ENOENT');
  assert.equal(service.store.readTask(b.taskId).attempts.length, 0);
  assert.deepEqual(await service.close(), { releaseOwnership: true });
  const current = f.start();
  service.close();
  assert.throws(() => createTaskService({ home: f.home }), e => e.code === 'unavailable');
  current.close();
});

test('shutdown before the scheduling turn leaves pristine work queued without dispatch', async t => {
  const f = setup(t);
  let prepared = 0;
  const service = f.start({ worker: { prepare() { prepared++; } } });
  const { taskId } = service.submitTask(f.request());
  assert.deepEqual(await service.close(), { releaseOwnership: true });
  assert.equal(service.store.readTask(taskId).status, 'queued');
  assert.equal(service.store.readTask(taskId).attempts.length, 0);
  assert.equal(prepared, 0);
});

test('completion write failure retains the dispatch and output without starting another worker', async t => {
  const f = setup(t);
  const marker = join(f.root, 'ready');
  const release = join(f.root, 'release');
  let prepared = 0;
  const fixture = workerFor(`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'ready');
    const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`);
  const service = f.start({ worker: { prepare(input) { prepared++; return fixture.prepare(input); } } });
  const a = service.submitTask(f.request());
  const b = service.submitTask(f.request('two'));
  await until(() => existsSync(marker), 'worker running');
  const path = join(f.home, 'tasks', `${a.taskId}.json`);
  const before = read(path);
  const saved = `${path}.preserved`;
  renameSync(path, saved);
  mkdirSync(path);
  writeFileSync(release, 'exit zero');
  await service.whenIdle();
  assert.equal(prepared, 1);
  assert.equal(read(saved), before);
  rmdirSync(path);
  renameSync(saved, path);
  assert.equal(service.store.readTask(a.taskId).status, 'running');
  assert.equal(service.store.readTask(b.taskId).status, 'queued');
  assert.equal(service.schedulerStatus().requiresReconciliation, true);
  assert.deepEqual(await service.close(), { releaseOwnership: false });
});

test('preparation failure and deadline block once and retain ownership without exposing adapter text', async t => {
  const f = setup(t);
  const service = f.start({ worker: { prepare() { throw new Error('private adapter payload'); } } });
  const { taskId } = service.submitTask(f.request());
  await service.whenIdle();
  assert.equal(service.store.readTask(taskId).status, 'blocked');
  assert.equal(JSON.stringify(service.schedulerStatus()).includes('private'), false);
  assert.deepEqual(await service.close(), { releaseOwnership: false });

  const g = setup(t);
  const deadline = g.start({ worker: { prepare({ workspace }) { return {
    executable: process.execPath, cwd: workspace.workspacePath, args: ['-e', 'setInterval(()=>{},1000)'],
    env: {}, timeoutMs: 50, killGraceMs: 100,
  }; } } });
  const accepted = deadline.submitTask(g.request());
  await deadline.whenIdle();
  assert.equal(deadline.store.readTask(accepted.taskId).status, 'blocked');
  assert.equal(deadline.store.readTask(accepted.taskId).attempts.length, 1);
  assert.deepEqual(await deadline.close(), { releaseOwnership: false });
});

test('invalid worker startup releases ownership and a valid owner can start', t => {
  const f = setup(t);
  assert.throws(() => createTaskService({ home: f.home, worker: {} }), e => e.code === 'internal');
  const service = f.start();
  service.close();
});

test('dispatch workspace receipts use canonical home paths across filesystem aliases', async t => {
  const f = setup(t);
  mkdirSync(f.home);
  const alias = join(f.root, 'home-alias');
  symlinkSync(f.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  let planned;
  let actual;
  const fixture = workerFor('process.exit(0)');
  const service = f.start({ home: alias, worker: { prepare(input) {
    planned = input.task.attempts[0].workspace;
    actual = input.workspace;
    return fixture.prepare(input);
  } } });
  const accepted = service.submitTask(f.request());
  await service.whenIdle();
  assert.ok(planned && actual, 'worker preparation reached the receipt comparison');
  assert.equal(planned.workspacePath, actual.workspacePath);
  assert.equal(planned.receiptPath, join(actual.workspacePath, '..', `${accepted.taskId}.workspace.json`));
  assert.equal(service.store.readTask(accepted.taskId).status, 'succeeded');
});

test('worker uncertain exit blocks task with partial artifacts and launches zero test commands', async t => {
  const f = setup(t);
  const testMarker = join(f.root, 'test-marker.txt');
  const service = f.start({
    worker: {
      testCommands: [{
        executable: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(testMarker)}, 'ran')`],
        label: 'verify-no-test-launch',
        env: {},
      }],
      prepare({ workspace }) {
        writeFileSync(join(workspace.workspacePath, 'partial-output.txt'), 'partial\n');
        return {
          executable: process.execPath,
          cwd: workspace.workspacePath,
          args: ['-e', 'setInterval(()=>{},1000)'],
          env: {},
          timeoutMs: 50,
          killGraceMs: 100,
        };
      },
    },
  });
  const accepted = service.submitTask(f.request('uncertain-exit'));
  await service.whenIdle();
  const task = service.store.readTask(accepted.taskId);
  assert.equal(task.status, 'blocked');
  assert.equal(task.block.reason, 'worker-outcome-uncertain');
  assert.equal(existsSync(testMarker), false, 'test commands must not be launched when worker outcome is uncertain');
  assert.ok(task.artifact, 'partial artifact must be retained on blocked task');
  assert.deepEqual(task.artifact.testRuns, []);
  assert.ok(task.artifact.changedFiles.includes('partial-output.txt'));
  assert.deepEqual(await service.close(), { releaseOwnership: false });
});

test('cancellation during artifact tests prevents launching the next test command', async t => {
  const f = setup(t);
  const firstStarted = join(f.root, 'first-test-started');
  const releaseFirst = join(f.root, 'release-first-test');
  const secondStarted = join(f.root, 'second-test-started');
  const service = f.start({ worker: {
    testCommands: [
      { executable: process.execPath,
        args: ['-e', `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(firstStarted)},'started');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(releaseFirst)}))clearInterval(timer)},10)`],
        label: 'wait-for-cancellation', env: {} },
      { executable: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(secondStarted)},'started')`],
        label: 'must-not-start', env: {} },
    ],
    prepare: ({ workspace }) => ({ executable: process.execPath, args: ['-e', 'process.exit(0)'],
      cwd: workspace.workspacePath, env: {}, timeoutMs: 1_000 }),
  } });
  const accepted = service.submitTask(f.request('cancel-artifact-test'));
  const queued = service.submitTask(f.request('queued-after-cancel'));
  await until(() => existsSync(firstStarted), 'first artifact test starts');
  assert.equal(service.cancelTask({ taskId: accepted.taskId }).status, 'blocked');
  writeFileSync(releaseFirst, 'release');
  await service.whenIdle();
  assert.equal(existsSync(secondStarted), false);
  assert.equal(service.store.readTask(accepted.taskId).status, 'blocked');
  assert.equal(service.store.readTask(accepted.taskId).artifact.testRuns.length, 1);
  assert.deepEqual(service.store.readTask(queued.taskId).attempts, []);
  assert.equal(service.store.readTask(queued.taskId).status, 'queued');
  assert.equal(service.schedulerStatus().requiresReconciliation, true);
  assert.deepEqual(await service.close(), { releaseOwnership: false });
});

test('artifact test deadline blocks the task and retains ownership without dispatching queued work', async t => {
  const f = setup(t);
  const worker = workerFor('process.exit(0)');
  worker.testCommands = [{ executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'], label: 'slow fixture', killGraceMs: 100 }];
  const service = f.start({ worker });
  const request = f.request('artifact-test-deadline');
  request.limits.budgetMs = 7_000;
  const accepted = service.submitTask(request);
  const queued = service.submitTask(f.request('queued-after-deadline'));
  await service.whenIdle();
  const result = service.getTaskResult({ taskId: accepted.taskId });
  assert.equal(result.status, 'blocked');
  assert.equal(result.testRuns[0].exitCode, -1);
  assert.equal(result.testRuns[0].summary, 'failed (deadline)');
  assert.equal(result.diff, null);
  assert.equal(service.store.readTask(queued.taskId).status, 'queued');
  assert.deepEqual(service.store.readTask(queued.taskId).attempts, []);
  assert.deepEqual(await service.close(), { releaseOwnership: false });
});

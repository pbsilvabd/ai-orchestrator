import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_RETENTION_MS, openTaskMaintenance, openTaskStore } from '../src/tasks.mjs';
import { createTaskService } from '../src/service.mjs';

const moduleUrl = new URL('../src/tasks.mjs', import.meta.url).href;
const fixture = t => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-maintenance-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
};
const payload = { objective: 'fixture', authorization: { models: ['fixture/mock'] } };
const create = (store, key, now = 1_000) => store.createTask({ clientId: 'owner',
  idempotencyKey: key, payload: { ...payload, objective: key }, now }).task;
const bytes = (home, id) => readFileSync(join(home, 'tasks', `${id}.json`), 'utf8');
function block(store, task, { outcome, cancel = false } = {}) {
  store.updateTask(task.taskId, d => {
    d.status = 'running'; d.startedAt = 1_100;
    d.attempts.push({ attemptId: `attempt-${task.idempotencyKey}`, model: 'fixture/mock',
      startedAt: 1_100, finishedAt: outcome ? 1_200 : null, ...(outcome && { outcome }) });
  });
  store.updateTask(task.taskId, d => {
    d.status = 'blocked'; d.finishedAt = 1_300;
    d.block = { reason: 'service-restart', requiresReconciliation: true };
    d.cancel.executionStopped = 'unknown';
    if (cancel) d.cancel.requestedAt = 1_250;
  });
}
const evidenceFor = (inspection, decision, observedAt = 2_000) => ({
  taskId: inspection.task.taskId, fromStatus: 'blocked', decision,
  recordDigest: inspection.recordDigest, observation: 'Operator inspected process and task evidence.',
  outcomeAssessment: decision === 'cancelled' ? 'cancel-request' : 'known-failure',
  workerStopped: true, processTreeChecked: true, inventoryComplete: true,
  inventorySource: 'Windows process inspection fixture', liveWorkerPids: [], observedAt,
});
async function settleChildrenBounded(children, exits, timeoutMs = 1_500) {
  const completed = () => Promise.race([Promise.allSettled(exits).then(() => true), delay(timeoutMs).then(() => false)]);
  if (await completed()) return true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* Exit may have raced with the signal. */ }
  }
  return completed();
}

test('B18-01: service ownership and wrong lifecycle state refuse maintenance without byte changes', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const task = create(store, 'queued');
  const expired = create(store, 'expired-service-lock', 0);
  store.updateTask(expired.taskId, d => { d.status = 'running'; d.startedAt = 1; });
  store.updateTask(expired.taskId, d => { d.status = 'failed'; d.finishedAt = 2; });
  const before = bytes(home, task.taskId);
  const expiredBefore = bytes(home, expired.taskId);
  const indexesBefore = readdirSync(join(home, 'idempotency')).sort().map(name =>
    [name, readFileSync(join(home, 'idempotency', name))]);
  const service = createTaskService({ home, now: 1_500 });
  try {
    const serviceNonce = JSON.parse(readFileSync(join(home, 'locks', 'service-owner.lock'), 'utf8')).nonce;
    assert.throws(() => openTaskMaintenance({ home }), e => e.code === 'unavailable');
    assert.throws(() => store.prune({ now: DEFAULT_RETENTION_MS + 2 }), e => e.code === 'unavailable');
    assert.throws(() => store.prune({ now: DEFAULT_RETENTION_MS + 2, maintenanceToken: serviceNonce }), e => e.code === 'unavailable');
    assert.throws(() => store.reconcileBlocked({ taskId: task.taskId, decision: 'failed', maintenanceToken: serviceNonce }), e => e.code === 'unavailable');
    assert.throws(() => store.prune({ now: DEFAULT_RETENTION_MS + 2, maintenanceCapability: {} }), e => e.code === 'unavailable');
    assert.throws(() => store.reconcileBlocked({ taskId: task.taskId, decision: 'failed', maintenanceCapability: {} }), e => e.code === 'unavailable');
    assert.throws(() => store.reconcile({ now: 1_501 }), e => e.code === 'unavailable');
    assert.throws(() => store.reconcileBlocked({ taskId: task.taskId, decision: 'failed',
      maintenanceCapability: serviceNonce }), e => e.code === 'unavailable');
    assert.equal(bytes(home, task.taskId), before);
    assert.equal(bytes(home, expired.taskId), expiredBefore);
    assert.deepEqual(readdirSync(join(home, 'idempotency')).sort().map(name =>
      [name, readFileSync(join(home, 'idempotency', name))]), indexesBefore);
  } finally { service.close(); }
  const maintenance = openTaskMaintenance({ home, now: 1_600 });
  try {
    assert.throws(() => createTaskService({ home, now: 1_601 }), e => e.code === 'unavailable');
    assert.throws(() => store.prune({ now: DEFAULT_RETENTION_MS + 10 }), e => e.code === 'unavailable');
    for (const status of ['queued', 'running', 'succeeded']) {
      const wrong = status === 'queued' ? task : create(store, `wrong-${status}`);
      if (status !== 'queued') store.updateTask(wrong.taskId, d => { d.status = 'running'; d.startedAt = 1_200; });
      if (status === 'succeeded') store.updateTask(wrong.taskId, d => { d.status = 'succeeded'; d.finishedAt = 1_300; });
      const inspection = maintenance.inspectTask(wrong.taskId);
      const validEvidence = evidenceFor(inspection, 'failed');
      const committed = bytes(home, wrong.taskId);
      assert.throws(() => maintenance.reconcileBlocked({ taskId: wrong.taskId, decision: 'failed',
        actor: 'maintainer', reason: 'wrong lifecycle state', evidence: validEvidence }), e => e.code === 'internal');
      assert.equal(bytes(home, wrong.taskId), committed);
    }
    assert.equal(bytes(home, task.taskId), before);
  } finally { maintenance.close(); }
});

test('a stale maintenance handle cannot reuse a later owner lock', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const stale = openTaskMaintenance({ home, now: 10 });
  stale.close();
  const current = openTaskMaintenance({ home, now: 20 });
  try {
    assert.throws(() => stale.prune({ now: DEFAULT_RETENTION_MS + 100 }), e => e.code === 'unavailable');
    assert.throws(() => store.prune({ now: DEFAULT_RETENTION_MS + 100 }), e => e.code === 'unavailable');
    assert.deepEqual(current.prune({ now: DEFAULT_RETENTION_MS + 100 }), { removed: [] });
  } finally { current.close(); }
});

test('retention duration remains configurable and validated with a 30-day default', t => {
  const home = fixture(t);
  const store = openTaskStore({ home, retentionMs: 2 });
  const task = create(store, 'short-retention', 0);
  store.updateTask(task.taskId, d => { d.status = 'running'; d.startedAt = 1; });
  store.updateTask(task.taskId, d => { d.status = 'failed'; d.finishedAt = 1; });
  const maintenance = openTaskMaintenance({ home, retentionMs: 2, now: 4 });
  try { assert.deepEqual(maintenance.prune({ now: 4 }), { removed: [task.taskId] }); }
  finally { maintenance.close(); }
  assert.throws(() => openTaskStore({ home, retentionMs: -1 }), e => e.code === 'invalid_argument');
  assert.throws(() => openTaskMaintenance({ home, retentionMs: -1 }), e => e.code === 'invalid_argument');
  assert.equal(DEFAULT_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
});

test('competing real stale-maintenance recoveries serialize through the recovery gate', { timeout: 15_000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-recovery-race-'));
  const locks = join(home, 'locks');
  mkdirSync(locks);
  const module = moduleUrl;
  const stale = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {openTaskMaintenance} from ${JSON.stringify(module)};
    openTaskMaintenance({home:process.argv[1],now:10}); process.exit(0);`, home],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(stale.status, 0, stale.stderr);
  const staleLock = JSON.parse(readFileSync(join(locks, 'maintenance-owner.lock'), 'utf8'));
  const start = join(home, 'start-recoveries');
  const allow = join(home, 'allow-pid-check');
  const release = join(home, 'release-winner');
  const resultPath = id => join(home, `result-${id}.json`);
  const enteredPath = id => join(home, `entered-${id}`);
  const children = ['A', 'B'].map(id => spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import {openTaskMaintenance} from ${JSON.stringify(module)};
    const wait=p=>{const end=Date.now()+8000;while(!fs.existsSync(p)&&Date.now()<end){};return fs.existsSync(p);};
    if(!wait(${JSON.stringify(start)}))process.exit(90);
    const kill=process.kill.bind(process);
    process.kill=(pid,signal)=>{if(pid===${staleLock.pid}&&signal===0){fs.writeFileSync(${JSON.stringify(enteredPath(id))},'1');if(!wait(${JSON.stringify(allow)}))process.exit(91);}return kill(pid,signal);};
    try {
      const m=openTaskMaintenance({home:process.argv[1],now:${100 + id.charCodeAt(0)},recoverStaleOwner:{lockKind:'maintenance',
        actor:'operator',reason:'serialized recovery test',evidence:'complete fixture inventory',processTreeChecked:true,
        inventoryComplete:true,inventorySource:'controlled test inventory',liveWorkerPids:[]}});
      fs.writeFileSync(${JSON.stringify(resultPath(id))},JSON.stringify({ok:true,pid:process.pid}));
      if(!wait(${JSON.stringify(release)}))process.exit(92);m.close();
    } catch(e) { fs.writeFileSync(${JSON.stringify(resultPath(id))},JSON.stringify({ok:false,code:e.code})); }
  `, home], { stdio: 'ignore', windowsHide: true }));
  const exits = children.map(child => new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`contender exit ${code}/${signal}`)));
  }));
  t.after(async () => {
    for (const path of [start, allow, release]) { try { writeFileSync(path, 'go'); } catch {} }
    if (!await settleChildrenBounded(children, exits))
      throw new Error(`Recovery race children did not stop; retaining fixture ${home}`);
    rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  writeFileSync(start, 'go');
  const deadline = Date.now() + 7_000;
  while (Date.now() < deadline) {
    const results = ['A', 'B'].filter(id => existsSync(resultPath(id))).length;
    const arrivals = ['A', 'B'].filter(id => existsSync(enteredPath(id))).length;
    if (results === 1 && arrivals >= 1 || results === 2) break;
    await delay(10);
  }
  const arrivalsBeforeRelease = ['A', 'B'].filter(id => existsSync(enteredPath(id)));
  assert.equal(arrivalsBeforeRelease.length, 1, 'only the recovery-gate holder reaches PID verification');
  assert.throws(() => createTaskService({ home }), e => e.code === 'unavailable');
  assert.equal(existsSync(join(locks, 'service-owner.lock')), false, 'service startup is excluded by recovery gate');
  writeFileSync(allow, 'go');
  const resultDeadline = Date.now() + 7_000;
  while (!['A', 'B'].every(id => existsSync(resultPath(id))) && Date.now() < resultDeadline) await delay(10);
  assert.ok(['A', 'B'].every(id => existsSync(resultPath(id))), 'both contenders settled');
  const results = ['A', 'B'].map(id => JSON.parse(readFileSync(resultPath(id), 'utf8')));
  assert.equal(results.filter(result => result.ok).length, 1);
  const winner = results.find(result => result.ok);
  const lockPath = join(locks, 'maintenance-owner.lock');
  const replacement = readFileSync(lockPath);
  assert.equal(JSON.parse(replacement.toString('utf8')).pid, winner.pid);
  assert.deepEqual(readFileSync(lockPath), replacement, 'losing recovery never unlinked the replacement owner');
  writeFileSync(release, 'release');
  await Promise.all(exits);
  assert.equal(existsSync(lockPath), false, 'winner released its own maintenance lock');
});

test('B18-01: an actual service worker keeps direct store pruning excluded until it exits', { timeout: 20_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-maint-worker-'));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
  writeFileSync(join(repo, 'README.md'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  const marker = join(root, 'worker-active');
  const release = join(root, 'worker-release');
  const config = { clientId: 'owner', authorization: { models: ['fixture/mock'], tools: ['read'], writableRoots: [repo] },
    limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 4096 } };
  const service = createTaskService({ home, config, worker: { prepare({ workspace }) {
    return { executable: process.execPath, args: ['-e', `const fs=require('node:fs'),m=${JSON.stringify(marker)},r=${JSON.stringify(release)};fs.writeFileSync(m,'active');const t=setInterval(()=>{if(fs.existsSync(r)){clearInterval(t);fs.unlinkSync(m)}},10);`],
      cwd: workspace.workspacePath, env: {}, timeoutMs: 10_000, stdoutMaxBytes: 1024, stderrMaxBytes: 1024, killGraceMs: 100 };
  } }, now: 100 });
  t.after(async () => {
    if (existsSync(root)) writeFileSync(release, 'stop');
    await service.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  const expired = create(service.store, 'old', 0);
  service.store.updateTask(expired.taskId, d => { d.status = 'running'; d.startedAt = 1; });
  service.store.updateTask(expired.taskId, d => { d.status = 'failed'; d.finishedAt = 2; });
  const before = bytes(home, expired.taskId);
  service.submitTask({ clientId: 'owner', idempotencyKey: 'active', objective: 'active worker',
    acceptanceCriteria: ['wait'], repository: { path: repo, baseRef: base, branch: 'task/active' },
    authorization: { models: ['fixture/mock'], tools: ['read'], writablePaths: ['README.md'] },
    limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 4096 } });
  const until = Date.now() + 8_000;
  while (!existsSync(marker) && Date.now() < until) await delay(10);
  assert.ok(existsSync(marker), 'worker subprocess reached its active marker');
  assert.throws(() => openTaskMaintenance({ home }), e => e.code === 'unavailable');
  assert.throws(() => service.store.prune({ now: DEFAULT_RETENTION_MS + 10 }), e => e.code === 'unavailable');
  assert.equal(bytes(home, expired.taskId), before);
  writeFileSync(release, 'stop');
  await service.whenIdle();
});

test('B18-02: missing, forged and conflicting evidence is refused; identical decision is byte-idempotent', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const task = create(store, 'failed');
  block(store, task, { outcome: 'failed' });
  const maintenance = openTaskMaintenance({ home, now: 2_000 });
  try {
    const inspected = maintenance.inspectTask(task.taskId);
    const valid = evidenceFor(inspected, 'failed');
    const before = bytes(home, task.taskId);
    for (const evidence of [undefined, { ...valid, recordDigest: 'f'.repeat(64) },
      { ...valid, taskId: 'other' }, { ...valid, workerStopped: false }]) {
      assert.throws(() => maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'failed',
        actor: 'operator', reason: 'confirmed nonzero exit', evidence }), e => e.code === 'invalid_argument');
      assert.equal(bytes(home, task.taskId), before);
    }
    assert.throws(() => maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'failed',
      actor: 'operator', reason: 'uncertain process inventory',
      evidence: { ...valid, inventoryComplete: false } }), e => e.code === 'invalid_argument');
    assert.throws(() => maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'failed',
      actor: 'operator', reason: 'live descendant remains',
      evidence: { ...valid, liveWorkerPids: [1234] } }), e => e.code === 'invalid_argument');
    const recovered = maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'failed',
      actor: 'operator', reason: 'confirmed nonzero exit', evidence: valid });
    const committed = bytes(home, task.taskId);
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.cancel.effectsReverted, false);
    assert.equal(recovered.reconciliation.evidence.recordDigest, inspected.recordDigest);
    assert.deepEqual(maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'failed',
      actor: 'operator', reason: 'confirmed nonzero exit', evidence: valid }), recovered);
    assert.equal(bytes(home, task.taskId), committed);
    assert.throws(() => maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'cancelled',
      actor: 'operator', reason: 'conflict', evidence: { ...valid, decision: 'cancelled' } }), e => e.code === 'internal');
    assert.equal(bytes(home, task.taskId), committed);
    assert.deepEqual(maintenance.listTasks().map(item => item.taskId), [task.taskId],
      'reconciliation does not create a duplicate task or dispatch another record');
    assert.equal(maintenance.listTasks()[0].attempts.length, 1);
  } finally { maintenance.close(); }
});

test('legacy valid-v1 blocked record without baseCommit can be recovered without adding metadata', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const task = create(store, 'legacy-no-base-commit');
  block(store, task, { outcome: 'failed' });
  const path = join(home, 'tasks', `${task.taskId}.json`);
  const legacy = JSON.parse(readFileSync(path, 'utf8'));
  delete legacy.baseCommit;
  writeFileSync(path, JSON.stringify(legacy));
  assert.equal(Object.hasOwn(store.readTask(task.taskId), 'baseCommit'), false);

  const maintenance = openTaskMaintenance({ home, now: 2_000 });
  try {
    const inspected = maintenance.inspectTask(task.taskId);
    const recovered = maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'failed',
      actor: 'operator', reason: 'legacy valid-v1 recovery', evidence: evidenceFor(inspected, 'failed') });
    assert.equal(recovered.status, 'failed');
    assert.equal(Object.hasOwn(recovered, 'baseCommit'), false);
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(path, 'utf8')), 'baseCommit'), false);
  } finally { maintenance.close(); }
});

test('Windows CLI crash workflow explicitly recovers owner, blocks interrupted dispatch, reconciles and replays no worker',
  { timeout: 25_000 }, async t => {
    const home = fixture(t);
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    writeFileSync(join(repo, 'README.md'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
    const baseCommit = git('rev-parse', 'HEAD');
    const config = { clientId: 'owner', authorization: { models: ['fixture/mock'], tools: ['read'], writableRoots: [repo] },
      limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 4096 } };
    const request = { clientId: 'owner', idempotencyKey: 'cli-crash-recovery', objective: 'CLI crash fixture',
      acceptanceCriteria: ['no worker replay'], repository: { path: repo, baseRef: baseCommit, branch: 'task/cli-recovery' },
      authorization: { models: ['fixture/mock'], tools: ['read'], writablePaths: ['README.md'] },
      limits: config.limits };
    const script = fileURLToPath(new URL('../scripts/task-maintenance.mjs', import.meta.url));
    const childSource = `
      import {createTaskService} from ${JSON.stringify(new URL('../src/service.mjs', import.meta.url).href)};
      const service=createTaskService({home:process.argv[1],config:${JSON.stringify(config)},now:100});
      const created=service.store.createTask({clientId:'owner',idempotencyKey:${JSON.stringify(request.idempotencyKey)},payload:${JSON.stringify(request)},now:100});
      service.store.updateTask(created.task.taskId,d=>{d.status='running';d.startedAt=100;d.attempts.push({
        attemptId:'attempt-cli-crash',model:'fixture/mock',startedAt:100,finishedAt:null,outcome:null});});
      process.stdout.write(JSON.stringify({taskId:created.task.taskId})+'\\n');process.exit(0);`;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', childSource, home],
      { encoding: 'utf8', timeout: 10_000 });
    assert.equal(crashed.status, 0, crashed.stderr);
    const { taskId } = JSON.parse(crashed.stdout.trim());
    assert.equal(openTaskStore({ home }).readTask(taskId).status, 'running');
    const env = { ...process.env, AI_ORCHESTRATOR_HOME: home };
    const runCli = (command, input) => spawnSync(process.execPath,
      [script, command, ...(input === undefined ? [] : [JSON.stringify(input)])],
      { encoding: 'utf8', timeout: 10_000, env });

    const ownerRecovery = runCli('recover-owner', { actor: 'operator', reason: 'service crashed after dispatch',
      evidence: 'Verified owner PID absence, inspected descendants and backed up isolated state.',
      processTreeChecked: true, inventoryComplete: true, inventorySource: 'isolated Windows test inventory',
      liveWorkerPids: [] });
    assert.equal(ownerRecovery.status, 0, ownerRecovery.stderr);
    assert.equal(openTaskStore({ home }).readTask(taskId).status, 'running',
      'owner recovery alone does not rewrite task lifecycle');

    const storeReconciliation = runCli('reconcile-store', { now: 200 });
    assert.equal(storeReconciliation.status, 0, storeReconciliation.stderr);
    assert.deepEqual(JSON.parse(storeReconciliation.stdout).blocked, [taskId]);
    const inspectionResult = runCli('inspect', { taskId });
    assert.equal(inspectionResult.status, 0, inspectionResult.stderr);
    const inspection = JSON.parse(inspectionResult.stdout);
    assert.equal(inspection.task.status, 'blocked');
    const blockedDecision = runCli('reconcile', { taskId, decision: 'failed', actor: 'operator',
      reason: 'administratively close interrupted dispatch after stop/effect review', now: 300,
      evidence: { taskId, fromStatus: 'blocked', decision: 'failed', recordDigest: inspection.recordDigest,
        observation: 'Service crashed after reservation; stop and effects were investigated, but outcome remains unknown.',
        outcomeAssessment: 'unknown', workerStopped: true, processTreeChecked: true, inventoryComplete: true,
        inventorySource: 'isolated Windows test inventory', liveWorkerPids: [], observedAt: 300 } });
    assert.equal(blockedDecision.status, 0, blockedDecision.stderr);
    const reconciled = JSON.parse(blockedDecision.stdout);
    assert.equal(reconciled.status, 'failed');
    assert.equal(reconciled.attempts[0].outcome, null);
    assert.equal(reconciled.cancel.executionStopped, 'unknown');
    assert.deepEqual(reconciled.reconciliation.priorBlock,
      { reason: 'service-restart', requiresReconciliation: true });

    let workerInvocations = 0;
    const restarted = createTaskService({ home, config, worker: { prepare() { workerInvocations++; throw new Error('replayed'); } }, now: 400 });
    try {
      const replay = restarted.submitTask(request);
      await restarted.whenIdle();
      assert.equal(replay.taskId, taskId);
      assert.equal(replay.status, 'failed');
      assert.equal(replay.idempotentReplay, true);
      assert.equal(workerInvocations, 0);
      assert.equal(restarted.store.listTasks().length, 1);
    } finally { await restarted.close(); }
  });

test('B18-03: real process death between prune record/index removals is journal-recovered without duplicate acceptance', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const expired = create(store, 'expires', 0);
  store.updateTask(expired.taskId, d => { d.status = 'running'; d.startedAt = 1; });
  store.updateTask(expired.taskId, d => { d.status = 'failed'; d.finishedAt = 2; });
  const blocked = create(store, 'blocked', 0);
  block(store, blocked, { outcome: 'failed' });
  const blockedBytes = bytes(home, blocked.taskId);
  const active = create(store, 'unrelated-running-dispatch', DEFAULT_RETENTION_MS + 100);
  store.updateTask(active.taskId, d => {
    d.status = 'running'; d.startedAt = DEFAULT_RETENTION_MS + 100;
    d.attempts.push({ attemptId: 'attempt-repair-isolation', model: 'fixture/mock',
      startedAt: DEFAULT_RETENTION_MS + 100, finishedAt: null, outcome: null });
  });
  const activeBytes = bytes(home, active.taskId);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import path from 'node:path'; import {syncBuiltinESMExports} from 'node:module';
    import { openTaskMaintenance } from ${JSON.stringify(moduleUrl)};
    const maintenance=openTaskMaintenance({home:process.argv[1],now:${DEFAULT_RETENTION_MS + 100}});
    const original=fs.unlinkSync;
    fs.unlinkSync=function(file,...args){const result=original.call(this,file,...args);
      if(path.basename(path.dirname(file))==='tasks' && path.basename(file)===${JSON.stringify(`${expired.taskId}.json`)}) process.exit(73);
      return result;};
    syncBuiltinESMExports();
    maintenance.prune({now:${DEFAULT_RETENTION_MS + 100}});
    process.exit(0);`, home], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(child.status, 73, child.stderr);
  assert.equal(readdirSync(join(home, 'tasks')).filter(n => n.endsWith('.json')).length, 2);
  assert.equal(readdirSync(join(home, 'idempotency')).filter(n => n.endsWith('.json')).length, 3);
  assert.equal(bytes(home, blocked.taskId), blockedBytes);
  assert.throws(() => openTaskStore({ home }).createTask({ clientId: 'owner', idempotencyKey: 'expires',
      payload: { ...payload, objective: 'expires' }, now: DEFAULT_RETENTION_MS + 100 }), e => e.code === 'unknown_task');
  assert.throws(() => openTaskStore({ home }).createTask({ clientId: 'owner', idempotencyKey: 'expires',
    payload: { ...payload, objective: 'changed' }, now: DEFAULT_RETENTION_MS + 100 }), e => e.code === 'idempotency_conflict');
  assert.equal(readdirSync(join(home, 'tasks')).filter(n => n.endsWith('.json')).length, 2);
  const cli = fileURLToPath(new URL('../scripts/task-maintenance.mjs', import.meta.url));
  const env = { ...process.env, AI_ORCHESTRATOR_HOME: home };
  const recovery = spawnSync(process.execPath, [cli, 'recover-owner', JSON.stringify({ lockKind: 'maintenance',
    actor: 'operator', reason: 'resume interrupted prune',
    evidence: 'Confirmed owner PID absent; inspected task/index journal and process tree.',
    processTreeChecked: true, inventoryComplete: true,
    inventorySource: 'Windows process inspection fixture', liveWorkerPids: [] })], { encoding: 'utf8', env, timeout: 10_000 });
  assert.equal(recovery.status, 0, recovery.stderr);
  const repair = spawnSync(process.execPath, [cli, 'repair-index'], { encoding: 'utf8', env, timeout: 10_000 });
  assert.equal(repair.status, 0, repair.stderr);
  assert.deepEqual(JSON.parse(repair.stdout).repaired, [expired.taskId]);
  const inspected = spawnSync(process.execPath, [cli, 'inspect'], { encoding: 'utf8', env, timeout: 10_000 });
  assert.equal(inspected.status, 0, inspected.stderr);
  const storeView = JSON.parse(inspected.stdout);
  assert.deepEqual(storeView.tasks.map(x => x.taskId).sort(), [active.taskId, blocked.taskId].sort());
  assert.equal(storeView.prunedKeys.length, 1);
  assert.equal(storeView.prunedKeys[0].taskId, expired.taskId);
  assert.deepEqual(bytes(home, blocked.taskId), blockedBytes);
  assert.deepEqual(bytes(home, active.taskId), activeBytes, 'index repair does not reconcile unrelated task state');
  const reopened = openTaskStore({ home });
  assert.throws(() => reopened.createTask({ clientId: 'owner', idempotencyKey: 'expires',
    payload: { ...payload, objective: 'expires' }, now: DEFAULT_RETENTION_MS + 102 }), e => e.code === 'unavailable');
  assert.throws(() => reopened.createTask({ clientId: 'owner', idempotencyKey: 'expires',
    payload: { ...payload, objective: 'changed' }, now: DEFAULT_RETENTION_MS + 103 }), e => e.code === 'idempotency_conflict');
  assert.equal(reopened.listTasks().length, 2);
  assert.equal(bytes(home, blocked.taskId), blockedBytes);
  assert.deepEqual(bytes(home, active.taskId), activeBytes);
});

test('B18-03: process death after prune intent but before record removal preserves the record and replay mapping', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const expired = create(store, 'before-delete', 0);
  store.updateTask(expired.taskId, d => { d.status = 'running'; d.startedAt = 1; });
  store.updateTask(expired.taskId, d => { d.status = 'failed'; d.finishedAt = 2; });
  const originalBytes = bytes(home, expired.taskId);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import path from 'node:path'; import {syncBuiltinESMExports} from 'node:module';
    import {openTaskMaintenance} from ${JSON.stringify(moduleUrl)};
    const original=fs.unlinkSync;
    fs.unlinkSync=function(file,...args){
      if(path.basename(path.dirname(file))==='tasks' && path.basename(file)===${JSON.stringify(`${expired.taskId}.json`)}) process.exit(74);
      return original.call(this,file,...args);};
    syncBuiltinESMExports();
    const maintenance=openTaskMaintenance({home:process.argv[1],now:${DEFAULT_RETENTION_MS + 100}});
    maintenance.prune({now:${DEFAULT_RETENTION_MS + 100}});
    process.exit(0);`, home], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(child.status, 74, child.stderr);
  assert.equal(bytes(home, expired.taskId), originalBytes);
  const maintenance = openTaskMaintenance({ home, now: DEFAULT_RETENTION_MS + 101,
    recoverStaleOwner: { lockKind: 'maintenance', actor: 'operator', reason: 'resume interrupted prune',
      evidence: 'Confirmed owner PID absent and complete process inventory has no live worker.',
      processTreeChecked: true, inventoryComplete: true,
      inventorySource: 'Windows process inspection fixture', liveWorkerPids: [] } });
  try {
    assert.deepEqual(maintenance.reconcile({ now: DEFAULT_RETENTION_MS + 101 }).conflicts, []);
    assert.equal(bytes(home, expired.taskId), originalBytes);
  } finally { maintenance.close(); }
  assert.equal(store.createTask({ clientId: 'owner', idempotencyKey: 'before-delete',
    payload: { ...payload, objective: 'before-delete' }, now: DEFAULT_RETENTION_MS + 102 }).replay, true);
});

test('B18-04: cancellation recovery retains effectsReverted=false and generic update cannot grant recovery authority', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const task = create(store, 'cancelled');
  block(store, task, { cancel: true });
  const before = bytes(home, task.taskId);
  assert.throws(() => store.updateTask(task.taskId, d => {
    d.status = 'cancelled'; d.finishedAt = 1_400; d.block = null; d.cancel.executionStopped = true;
  }), e => e.code === 'internal');
  assert.equal(bytes(home, task.taskId), before);
  const maintenance = openTaskMaintenance({ home, now: 2_000 });
  try {
    const inspected = maintenance.inspectTask(task.taskId);
    const result = maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'cancelled',
      actor: 'operator', reason: 'cancel confirmed stopped', evidence: evidenceFor(inspected, 'cancelled') });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.cancel.executionStopped, true);
    assert.equal(result.cancel.effectsReverted, false);
  } finally { maintenance.close(); }
});

test('B18-04: recovery rejects unsupported known-failure assessment and missing cancellation request', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const uncertain = create(store, 'uncertain');
  block(store, uncertain); // Dispatch remains unfinished/unknown.
  const noCancel = create(store, 'no-cancel');
  block(store, noCancel, { outcome: 'failed' });
  const maintenance = openTaskMaintenance({ home, now: 2_000 });
  try {
    const uncertainEvidence = evidenceFor(maintenance.inspectTask(uncertain.taskId), 'failed');
    const uncertainBytes = bytes(home, uncertain.taskId);
    assert.throws(() => maintenance.reconcileBlocked({ taskId: uncertain.taskId, decision: 'failed',
      actor: 'operator', reason: 'outcome unknown', evidence: uncertainEvidence }), e => e.code === 'invalid_argument');
    assert.equal(bytes(home, uncertain.taskId), uncertainBytes);
    const cancelEvidence = evidenceFor(maintenance.inspectTask(noCancel.taskId), 'cancelled');
    const cancelBytes = bytes(home, noCancel.taskId);
    assert.throws(() => maintenance.reconcileBlocked({ taskId: noCancel.taskId, decision: 'cancelled',
      actor: 'operator', reason: 'no cancellation request', evidence: cancelEvidence }), e => e.code === 'invalid_argument');
    assert.equal(bytes(home, noCancel.taskId), cancelBytes);
  } finally { maintenance.close(); }
});

test('B18-04: real scheduler crash/restart permits audited unknown administrative failure without replay',
  { timeout: 25_000 }, async t => {
    const home = fixture(t);
    const repo = join(home, 'repo');
    mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    writeFileSync(join(repo, 'README.md'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
    const baseCommit = git('rev-parse', 'HEAD');
    const counter = join(home, 'worker-invocations');
    const request = { clientId: 'owner', idempotencyKey: 'crash-recovery', objective: 'crash fixture',
      acceptanceCriteria: ['no replay'], repository: { path: repo, baseRef: baseCommit, branch: 'task/crash-recovery' },
      authorization: { models: ['fixture/mock'], tools: ['read'], writablePaths: ['README.md'] },
      limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 4096 } };
    const serviceUrl = new URL('../src/service.mjs', import.meta.url).href;
    const config = { clientId: 'owner', authorization: { models: ['fixture/mock'], tools: ['read'], writableRoots: [repo] },
      limits: request.limits };
    const crashScript = `
      import fs from 'node:fs';
      import {createTaskService} from ${JSON.stringify(serviceUrl)};
      const service=createTaskService({home:process.argv[1],config:${JSON.stringify(config)},now:1_100,worker:{prepare(){
        fs.appendFileSync(${JSON.stringify(counter)},'invoked\\n');
        return {executable:process.execPath,args:['-e','process.exit(0)'],cwd:process.cwd(),env:{},timeoutMs:5000,stdoutMaxBytes:1024,stderrMaxBytes:1024};
      }}});
      const update=service.store.updateTask;
      service.store.updateTask=(id,mutate)=>{const task=update(id,mutate);if(task.status==='running')process.exit(71);return task;};
      const result=service.submitTask(${JSON.stringify(request)});
      process.stdout.write(JSON.stringify({taskId:result.taskId,pid:process.pid})+'\\n');
      setInterval(()=>{},1000);`;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', crashScript, home],
      { encoding: 'utf8', timeout: 15_000 });
    assert.equal(crashed.status, 71, crashed.stderr);
    const { taskId, pid } = JSON.parse(crashed.stdout.trim());
    assert.equal(existsSync(counter), false, 'reservation was durable before worker preparation');
    const maintenance = openTaskMaintenance({ home, now: 2_000, recoverStaleOwner: {
      actor: 'operator', reason: 'service process crashed after dispatch reservation',
      evidence: 'No worker preparation occurred; complete temporary-home process inventory is empty.',
      processTreeChecked: true, inventoryComplete: true, inventorySource: 'isolated test process inventory', liveWorkerPids: [],
    } });
    let failed;
    try {
      assert.deepEqual(maintenance.reconcile({ now: 2_001 }).blocked, [taskId]);
      const inspection = maintenance.inspectTask(taskId);
      assert.equal(inspection.task.attempts[0].outcome, null);
      const evidence = { ...evidenceFor(inspection, 'failed'), outcomeAssessment: 'unknown',
        observation: 'Service crashed after reservation; worker stop/effects were reviewed, but attempt outcome remains unknown.' };
      failed = maintenance.reconcileBlocked({ taskId, decision: 'failed', actor: 'operator',
        reason: 'administrative closure of interrupted task with unknown worker outcome', evidence });
      assert.equal(failed.startedAt, 1_100);
      assert.equal(failed.attempts[0].outcome, null);
      assert.equal(failed.attempts[0].finishedAt, null);
      assert.equal(failed.cancel.executionStopped, 'unknown');
      assert.deepEqual(failed.reconciliation.priorBlock, { reason: 'service-restart', requiresReconciliation: true });
    } finally { maintenance.close(); }
    assert.ok(Number.isInteger(pid));
    const restarted = createTaskService({ home, config, worker: { prepare() {
      writeFileSync(counter, 'replayed\\n');
      return { executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: join(home, 'workspaces', taskId),
        env: {}, timeoutMs: 5000, stdoutMaxBytes: 1024, stderrMaxBytes: 1024 };
    } }, now: 2_100 });
    try {
      const replay = restarted.submitTask(request);
      assert.equal(replay.taskId, taskId);
      assert.equal(replay.status, 'failed');
      await restarted.whenIdle();
      assert.equal(existsSync(counter), false, 'restart and same-key replay never invoked a worker');
      const result = restarted.getTaskResult({ taskId });
      assert.ok(result.limitations.some(x => /administrative failure.*outcome remains unknown/i.test(x)));
    } finally { await restarted.close(); }
  });

test('unknown-outcome administrative failure also permits a queued dispatched record with no startedAt', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const task = create(store, 'queued-dispatch');
  const path = join(home, 'tasks', `${task.taskId}.json`);
  const persisted = JSON.parse(readFileSync(path, 'utf8'));
  persisted.attempts.push({ attemptId: 'attempt-reserved', model: 'fixture/mock', startedAt: 1_100,
    finishedAt: null, outcome: null });
  writeFileSync(path, JSON.stringify(persisted));
  const maintenance = openTaskMaintenance({ home, now: 2_000 });
  try {
    assert.deepEqual(maintenance.reconcile({ now: 2_001 }).blocked, [task.taskId]);
    const inspection = maintenance.inspectTask(task.taskId);
    assert.equal(inspection.task.startedAt, null);
    const evidence = { ...evidenceFor(inspection, 'failed'), outcomeAssessment: 'unknown' };
    const result = maintenance.reconcileBlocked({ taskId: task.taskId, decision: 'failed', actor: 'operator',
      reason: 'close queued persisted dispatch with unknown outcome', evidence });
    assert.equal(result.startedAt, null);
    assert.equal(result.status, 'failed');
    assert.equal(result.attempts[0].outcome, null);
  } finally { maintenance.close(); }
});

test('ordinary store updates cannot add a structurally valid maintainer receipt', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const task = create(store, 'forged-receipt');
  const digest = 'a'.repeat(64);
  const evidence = { taskId: task.taskId, fromStatus: 'blocked', decision: 'failed', recordDigest: digest,
    observation: 'Forged ordinary-update receipt.', outcomeAssessment: 'unknown', workerStopped: true, processTreeChecked: true,
    inventoryComplete: true, inventorySource: 'fixture', liveWorkerPids: [], observedAt: 1_400 };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(evidence).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  const receipt = { actor: 'operator', reason: 'forged', decision: 'failed', fromStatus: 'blocked',
    recordDigest: digest, evidenceDigest: createHash('sha256').update(canonical).digest('hex'),
    priorBlock: { reason: 'service-restart', requiresReconciliation: true }, administrativeOutcome: 'unknown',
    evidence, reconciledAt: 1_500 };
  const before = bytes(home, task.taskId);
  assert.throws(() => store.updateTask(task.taskId, draft => {
    draft.status = 'failed'; draft.finishedAt = 1_500; draft.cancel.executionStopped = 'unknown';
    draft.attempts.push({ attemptId: 'attempt-forged', model: 'fixture/mock', startedAt: 1_200,
      finishedAt: null, outcome: null });
    draft.reconciliation = receipt;
  }), e => e.code === 'internal' && /dedicated operation/.test(e.message));
  assert.equal(bytes(home, task.taskId), before);
});

test('stale service lock needs explicit PID-absence and process-tree review before maintenance', t => {
  const home = fixture(t);
  const serviceUrl = new URL('../src/service.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {createTaskService} from ${JSON.stringify(serviceUrl)};
    createTaskService({home:process.argv[1],now:100}); process.exit(0);`, home],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr);
  const lockPath = join(home, 'locks', 'service-owner.lock');
  const lockBytes = readFileSync(lockPath, 'utf8');
  assert.throws(() => openTaskMaintenance({ home }), e => e.code === 'unavailable');
  assert.throws(() => openTaskMaintenance({ home, now: 150,
    recoverStaleOwner: { actor: 'operator', reason: 'uncertain descendant state', evidence: 'not complete',
      processTreeChecked: true, inventoryComplete: false, inventorySource: 'partial process list', liveWorkerPids: [] } }),
  e => e.code === 'unavailable');
  assert.throws(() => openTaskMaintenance({ home, now: 151,
    recoverStaleOwner: { actor: 'operator', reason: 'live worker remains', evidence: 'child PID exists',
      processTreeChecked: true, inventoryComplete: true, inventorySource: 'process list', liveWorkerPids: [4321] } }),
  e => e.code === 'unavailable');
  assert.equal(readFileSync(lockPath, 'utf8'), lockBytes);
  const maintenance = openTaskMaintenance({ home, now: 200,
    recoverStaleOwner: { actor: 'operator', reason: 'recover after verified abrupt exit',
      evidence: 'Confirmed owner PID absent; checked Windows process/descendant state and backups.',
      processTreeChecked: true, inventoryComplete: true,
      inventorySource: 'Windows process inspection fixture', liveWorkerPids: [] } });
  try {
    const audits = readdirSync(join(home, 'locks')).filter(n => n.startsWith('recovery-'));
    assert.equal(audits.length, 1);
    const audit = JSON.parse(readFileSync(join(home, 'locks', audits[0]), 'utf8'));
    assert.equal(audit.lockKind, 'service');
    assert.equal(audit.processTreeChecked, true);
    assert.equal(typeof audit.ownerLockDigest, 'string');
  } finally { maintenance.close(); }
});

test('B18-01: stale service-owner recovery refuses a real surviving detached worker descendant',
  { skip: process.platform !== 'win32', timeout: 15_000 }, async t => {
    const home = mkdtempSync(join(tmpdir(), 'orchestrator-surviving-descendant-'));
    const root = join(home, 'fixture');
    mkdirSync(root);
    const stop = join(root, 'stop-worker');
    const workerInfo = join(root, 'worker-info.json');
    let workerPid;
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    t.after(async () => {
      if (workerPid === undefined && existsSync(workerInfo)) {
        try { workerPid = JSON.parse(readFileSync(workerInfo, 'utf8')).workerPid; } catch {}
      }
      if (Number.isInteger(workerPid) && alive(workerPid)) {
        writeFileSync(stop, 'cleanup exact fixture descendant');
        const deadline = Date.now() + 5_000;
        while (alive(workerPid) && Date.now() < deadline) await delay(25);
      }
      if (Number.isInteger(workerPid) && alive(workerPid))
        throw new Error(`Fixture descendant PID ${workerPid} remains ambiguous; retaining fixture ${home}`);
      rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    });
    const serviceUrl = new URL('../src/service.mjs', import.meta.url).href;
    const script = `
      import {writeFileSync} from 'node:fs';
      import {spawn} from 'node:child_process';
      import {createTaskService} from ${JSON.stringify(serviceUrl)};
      createTaskService({home:process.argv[1]});
      const child=spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('node:fs');const stop=${JSON.stringify(stop)};setInterval(()=>{if(fs.existsSync(stop))process.exit(0)},10)`) }],
        {detached:true,stdio:'ignore',windowsHide:true});
      child.unref();
      writeFileSync(${JSON.stringify(workerInfo)},JSON.stringify({ownerPid:process.pid,workerPid:child.pid}));
      process.stdout.write(JSON.stringify({ownerPid:process.pid,workerPid:child.pid})+'\\n');
      process.exit(0);`;
    const owner = spawnSync(process.execPath, ['--input-type=module', '-e', script, home],
      { encoding: 'utf8', timeout: 10_000 });
    assert.equal(owner.status, 0, owner.stderr);
    const { ownerPid, workerPid: reportedWorkerPid } = JSON.parse(owner.stdout.trim());
    workerPid = JSON.parse(readFileSync(workerInfo, 'utf8')).workerPid;
    assert.equal(reportedWorkerPid, workerPid);
    assert.equal(alive(ownerPid), false, 'service root process is gone');
    assert.equal(alive(workerPid), true, 'detached worker descendant is still live');
    const lockPath = join(home, 'locks', 'service-owner.lock');
    const lockBytes = readFileSync(lockPath);
    assert.throws(() => openTaskMaintenance({ home, recoverStaleOwner: {
      actor: 'operator', reason: 'descendant inventory found active worker', evidence: 'Exact fixture child remains live.',
      processTreeChecked: true, inventoryComplete: true, inventorySource: 'Get-CimInstance fixture inventory',
      liveWorkerPids: [workerPid],
    } }), e => e.code === 'unavailable');
    assert.deepEqual(readFileSync(lockPath), lockBytes);
    assert.equal(alive(workerPid), true);
    writeFileSync(stop, 'stop');
    const deadline = Date.now() + 5_000;
    while (alive(workerPid) && Date.now() < deadline) await delay(25);
    assert.equal(alive(workerPid), false, 'only the exact fixture descendant was stopped');
  });

test('service operations do not expose maintenance authority', t => {
  const home = fixture(t);
  const service = createTaskService({ home });
  t.after(() => service.close());
  assert.equal('reconcileBlocked' in service, false);
  assert.equal('prune' in service, false);
});

test('maintainer CLI inspection uses only the explicitly selected temporary home', t => {
  const home = fixture(t);
  const journal = { schemaVersion: 1, taskId: 'interrupted-task', clientId: 'owner',
    idempotencyKey: 'key', payloadHash: 'a'.repeat(64), indexName: `${'b'.repeat(64)}.json`, startedAt: 1 };
  mkdirSync(join(home, 'locks'));
  writeFileSync(join(home, 'locks', 'prune-interrupted-task.json'), JSON.stringify(journal));
  const script = fileURLToPath(new URL('../scripts/task-maintenance.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'inspect'], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, AI_ORCHESTRATOR_HOME: home },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { tasks: [], prunedKeys: [],
    pruneJournals: [{ name: 'prune-interrupted-task.json', content: journal }] });
});

test('maintenance CLI reads BOM and plain UTF-8 input files, rejects invalid forms and preserves store bytes', t => {
  const home = fixture(t);
  const store = openTaskStore({ home });
  const task = create(store, 'cli-input-file');
  const taskPath = join(home, 'tasks', `${task.taskId}.json`);
  const indexPaths = readdirSync(join(home, 'idempotency')).map(name => join(home, 'idempotency', name));
  const before = [readFileSync(taskPath), ...indexPaths.map(path => readFileSync(path))];
  const inputPath = join(home, 'input file with spaces.json');
  writeFileSync(inputPath, `\uFEFF${JSON.stringify({ taskId: task.taskId, note: 'a value with spaces' })}`, 'utf8');
  const cli = fileURLToPath(new URL('../scripts/task-maintenance.mjs', import.meta.url));
  const env = { ...process.env, AI_ORCHESTRATOR_HOME: home };
  const run = (...args) => spawnSync(process.execPath, [cli, 'inspect', ...args],
    { encoding: 'utf8', env, timeout: 10_000 });
  const valid = run('--input-file', inputPath);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).task.taskId, task.taskId);
  const plainUtf8Path = join(home, 'plain UTF-8 input.json');
  writeFileSync(plainUtf8Path, JSON.stringify({ taskId: task.taskId }), 'utf8');
  const plainUtf8 = run('--input-file', plainUtf8Path);
  assert.equal(plainUtf8.status, 0, plainUtf8.stderr);
  assert.equal(JSON.parse(plainUtf8.stdout).task.taskId, task.taskId);

  const malformed = join(home, 'malformed input.json');
  const array = join(home, 'array input.json');
  const nullInput = join(home, 'null input.json');
  writeFileSync(malformed, '{"taskId":', 'utf8');
  writeFileSync(array, JSON.stringify([task.taskId]), 'utf8');
  writeFileSync(nullInput, 'null', 'utf8');
  for (const args of [
    ['--input-file'], ['--input-file', join(home, 'missing private path.json')],
    ['--input-file', malformed], ['--input-file', array], ['--input-file', nullInput],
    ['--input-file', inputPath, 'extra'], ['--unknown-option'],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2, `expected invalid arguments to fail: ${args[0]}`);
    assert.match(result.stderr, /Input (file could not be read|must be one JSON object)|Usage:/);
    assert.doesNotMatch(result.stderr, /missing private path/);
  }
  assert.deepEqual([readFileSync(taskPath), ...indexPaths.map(path => readFileSync(path))], before);
});

test('Windows PowerShell 5.1 passes BOM JSON files with spaces to the maintenance CLI without changing native argument bytes',
  { skip: process.platform !== 'win32', timeout: 20_000 }, t => {
    const home = fixture(t);
    const store = openTaskStore({ home });
    const task = create(store, 'powershell-cli-input');
    const taskPath = join(home, 'tasks', `${task.taskId}.json`);
    const indexPaths = readdirSync(join(home, 'idempotency')).map(name => join(home, 'idempotency', name));
    const before = [readFileSync(taskPath), ...indexPaths.map(path => readFileSync(path))];
    const cli = fileURLToPath(new URL('../scripts/task-maintenance.mjs', import.meta.url));
    const env = { ...process.env, AI_ORCHESTRATOR_HOME: home, TASK_MAINTENANCE_CLI: cli,
      TASK_MAINTENANCE_TASK_ID: task.taskId, TASK_MAINTENANCE_TEST_HOME: home };
    const powershell = String.raw`
$ErrorActionPreference = 'Continue'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { exit 24 }
$inputFile = Join-Path $env:TASK_MAINTENANCE_TEST_HOME 'PowerShell input with spaces.json'
@{ taskId = $env:TASK_MAINTENANCE_TASK_ID; note = 'JSON value with spaces' } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $inputFile -Encoding UTF8
& node $env:TASK_MAINTENANCE_CLI inspect --input-file $inputFile
if ($LASTEXITCODE -ne 0) { exit 21 }

function Assert-Refusal([string[]]$arguments, [string]$forbiddenText) {
    $errorFile = Join-Path $env:TASK_MAINTENANCE_TEST_HOME 'cli stderr.txt'
    $output = & node $env:TASK_MAINTENANCE_CLI inspect @arguments 2> $errorFile
    $exit = $LASTEXITCODE
    if ($exit -eq 0) { exit 22 }
    $text = ($output -join [Environment]::NewLine) + [IO.File]::ReadAllText($errorFile)
    if ($forbiddenText -and $text.Contains($forbiddenText)) { exit 23 }
}
$malformed = Join-Path $env:TASK_MAINTENANCE_TEST_HOME 'malformed input.json'
$array = Join-Path $env:TASK_MAINTENANCE_TEST_HOME 'array input.json'
Set-Content -LiteralPath $malformed -Value '{"taskId":' -Encoding UTF8
Set-Content -LiteralPath $array -Value ('["' + $env:TASK_MAINTENANCE_TASK_ID + '"]') -Encoding UTF8
Assert-Refusal @('--input-file', $malformed) ''
Assert-Refusal @('--input-file', $array) ''
Assert-Refusal @('--input-file') ''
$missing = Join-Path $env:TASK_MAINTENANCE_TEST_HOME 'missing path must stay private.json'
Assert-Refusal @('--input-file', $missing) $missing
exit 0
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershell],
      { encoding: 'utf8', env, timeout: 15_000, windowsHide: true });
    assert.equal(result.status, 0, `PowerShell exit ${result.status}; stdout=${result.stdout}; stderr=${result.stderr}`);
    const validOutput = result.stdout.trim().split(/\r?\n/).join('\n');
    assert.match(validOutput, new RegExp(`"taskId":\\s*"${task.taskId}"`));
    assert.deepEqual([readFileSync(taskPath), ...indexPaths.map(path => readFileSync(path))], before);
  });

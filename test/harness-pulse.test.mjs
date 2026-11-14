import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runPulse, readHistory, runPosix } from '../integration/harness-pulse.mjs';
import { openTaskStore, openTaskMaintenance } from '../src/tasks.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'b19-pulse-test-'));
const opts = () => ({ binary: process.execPath, version: '2.2.5', timeoutMs: 15_000 });
const slots = report => { assert.equal(report.originals.length, 8); assert.deepEqual(report.originals.map(x => x.index), [1,2,3,4,5,6,7,8]); };
const snapshot = root => {
  const values = [];
  const walk = path => { for (const name of readdirSync(path).sort()) {
    const full = join(path, name); const stat = lstatSync(full); values.push(`${full}:${stat.isDirectory() ? 'd' : 'f'}`);
    if (stat.isDirectory()) walk(full); else values.push(readFileSync(full).toString('base64'));
  } };
  walk(root); return values;
};
const taskPayload = objective => ({ objective, authorization: { models: ['fixture/mock'] } });
const createRecord = (store, key, now = Date.now()) => store.createTask({ clientId: 'test-client',
  idempotencyKey: key, payload: taskPayload(key), now }).task;
const testArtifact = (exitCode = 0) => ({ baseCommit: 'a'.repeat(40), branch: 'task/history', headCommit: null,
  diff: null, diffTruncated: false, changedFiles: [],
  testRuns: [{ command: 'node --test', exitCode, durationMs: 1, summary: 'tests', outputTail: '', outputTruncated: false }],
  logsTruncated: false, limitations: [], cost: { known: false, amount: null, currency: 'USD', note: 'fixture' }, evidenceLevel: 'unit' });
function makeSucceeded(store, key, now = Date.now()) {
  const task = createRecord(store, key, now);
  store.updateTask(task.taskId, draft => {
    draft.status = 'running'; draft.startedAt = now + 1;
    draft.attempts.push({ attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', model: 'fixture/mock', startedAt: now + 1, finishedAt: null, outcome: null });
  });
  return store.updateTask(task.taskId, draft => {
    draft.status = 'succeeded'; draft.finishedAt = now + 2;
    draft.attempts[0].finishedAt = now + 2; draft.attempts[0].outcome = 'succeeded';
    draft.artifact = testArtifact();
  });
}

test('B19-01: eight real child invocations retain original failure and separately count retry', async () => {
  const root = temp();
  const gate = join(root, 'gate.mjs');
  writeFileSync(gate, `import { writeFileSync } from 'node:fs';
const failed=Boolean(process.env.MCP_GATE_INJECT_FAILURE_PHASE);
try { if (failed) { console.error('Injected diagnostic failure'); process.exitCode=7; }
else { console.log('{"gate":"pass"}'); } }
finally { writeFileSync(process.env.MCP_GATE_PHASE_FILE, JSON.stringify({phase:failed?'failure:probe':'probe',cleanupPhase:'cleanup',cleanupStatus:failed?'failed':'complete'})); }
`);
  try {
    const report = await runPulse({ ...opts(), injectFailureIndex: 3, retryFailed: true }, { gate });
    slots(report); assert.equal(report.summary.denominator, 8);
    assert.equal(report.summary.fail, 1, JSON.stringify({ summary: report.summary, originals: report.originals, retries: report.retries }));
    assert.equal(report.summary.pass, 7); assert.equal(report.originals[2].status, 'fail');
    assert.equal(report.originals[2].phase, 'failure:probe'); assert.equal(report.originals[2].cleanupPhase, 'cleanup');
    assert.equal(report.originals[2].cleanupStatus, 'failed'); assert.equal(report.retries.length, 1);
    assert.equal(report.retries[0].originalIndex, 3); assert.equal(report.retries[0].status, 'pass');
    assert.equal(report.summary.success, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('B19-02: host preflight, descendant teardown, uncertain-stop halt and bounded output', async () => {
  const root = temp();
  let timedScratch;
  try {
    const missing = await runPulse({ ...opts(), binary: join(root, 'missing.exe') });
    slots(missing); assert.equal(missing.summary.not_run, 8); assert.equal(missing.summary.success, false);
    const directory = await runPulse({ ...opts(), binary: root });
    slots(directory); assert.equal(directory.summary.not_run, 8);
    const noVersion = await runPulse({ ...opts(), version: undefined });
    slots(noVersion); assert.equal(noVersion.summary.not_run, 8); assert.match(noVersion.originals[0].reason, /pinned version/);
    const wrongVersion = await runPulse({ ...opts(), version: 'Bearer secret-version-marker', output: join(root, 'wrong-version.json') });
    slots(wrongVersion); assert.equal(wrongVersion.summary.not_run, 8);
    assert.equal(wrongVersion.version, null);
    assert.doesNotMatch(readFileSync(join(root, 'wrong-version.json'), 'utf8'), /secret-version-marker/);
    const timeoutGate = join(root, 'timeout.mjs'); const pidFile = join(root, 'descendant.pid');
    writeFileSync(timeoutGate, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
writeFileSync(process.env.MCP_GATE_PHASE_FILE,JSON.stringify({phase:'wait',cleanupPhase:'pending',cleanupStatus:'pending'}));
const child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{stdio:'ignore'}); writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
setInterval(()=>{},1000);`);
    const timed = await runPulse({ ...opts(), timeoutMs: 5_000, retryFailed: true, output: join(root, 'timeout-report.json') }, { gate: timeoutGate });
    slots(timed); assert.equal(timed.originals[0].reason, 'timeout'); assert.equal(timed.originals[0].status, 'fail');
    assert.equal(timed.originals[0].containment.cleanupVerified, true);
    assert.equal(timed.originals[0].phase, 'wait');
    assert.equal(timed.summary.fail, 1); assert.equal(timed.summary.not_run, 7);
    assert.ok(timed.originals.slice(1).every(item => item.status === 'not_run'));
    assert.equal(timed.retries.length, 0); assert.equal(timed.cleanup.status, 'retained_uncertain_process_outcome');
    timedScratch = join(root, timed.cleanup.scratchName); assert.equal(existsSync(timedScratch), true);
    const descendantPid = Number(readFileSync(pidFile, 'utf8'));
    const deadline = Date.now() + 3000;
    let descendantAlive = true;
    while (descendantAlive && Date.now() < deadline) {
      try { process.kill(descendantPid, 0); await new Promise(resolveWait => setTimeout(resolveWait, 25)); }
      catch (error) { if (error.code === 'ESRCH') descendantAlive = false; else throw error; }
    }
    assert.equal(descendantAlive, false, JSON.stringify(timed.originals[0]));

    const uncertain = await runPulse({ ...opts(), retryFailed: true }, { executeSample: async () => ({ status: 'fail',
      phase: 'probe', cleanupPhase: 'unknown', cleanupStatus: 'unknown', exitCode: null, signal: null,
      termination: { reason: 'deadline', rootExitObserved: false, descendantsStopped: false },
      containment: { strategy: 'injected-uncertain-test-stop', cleanupVerified: false }, durationMs: 20,
      transcript: '', transcriptBytes: 0, transcriptTruncated: false, sanitized: true, reason: 'process_cleanup_uncertain' }) });
    slots(uncertain); assert.equal(uncertain.originals[0].status, 'fail');
    assert.equal(uncertain.summary.not_run, 7); assert.equal(uncertain.retries.length, 0);
    const hugeGate = join(root, 'huge.mjs');
    writeFileSync(hugeGate, `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.MCP_GATE_PHASE_FILE,'transcript'); process.stdout.write('x'.repeat(20000));`);
    const huge = await runPulse(opts(), { gate: hugeGate });
    slots(huge); assert.equal(huge.originals[0].status, 'pass', JSON.stringify(huge.originals[0]));
    assert.ok(huge.originals[0].transcriptBytes <= 8192); assert.equal(huge.originals[0].transcriptTruncated, true);
    assert.match(huge.originals[0].transcript, /stdout omitted: raw capture cap reached/);
  } finally { if (timedScratch) rmSync(timedScratch, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('B19-02: uncertainty anywhere in originals suppresses all retries and each diagnostic slot is unique', async () => {
  const root = temp();
  const known = { status: 'fail', phase: 'probe', cleanupPhase: 'cleanup', cleanupStatus: 'complete',
    termination: { reason: 'exited', rootExitObserved: true, descendantsStopped: false },
    containment: { strategy: 'fixture', cleanupVerified: true }, exitCode: 7, transcript: '', transcriptBytes: 0,
    transcriptTruncated: false, sanitized: true };
  const uncertain = { status: 'fail', phase: 'probe', cleanupPhase: 'cleanup', cleanupStatus: 'unknown',
    termination: { reason: 'deadline', rootExitObserved: false, descendantsStopped: false },
    containment: { strategy: 'fixture', cleanupVerified: false }, exitCode: null, transcript: '', transcriptBytes: 0,
    transcriptTruncated: false, sanitized: true, reason: 'timeout' };
  try {
    let calls = 0;
    const originalsUncertain = await runPulse({ ...opts(), retryFailed: true, output: join(root, 'original-uncertain.json') }, {
      executeSample: async () => ++calls === 3 ? uncertain : known,
    });
    assert.equal(calls, 3, JSON.stringify({ calls, originals: originalsUncertain.originals, retries: originalsUncertain.retries }));
    assert.equal(originalsUncertain.summary.fail, 3);
    assert.equal(originalsUncertain.summary.not_run, 5);
    assert.deepEqual(originalsUncertain.retries, [], 'an uncertain original suppresses replay of earlier known failures');
    rmSync(join(root, originalsUncertain.cleanup.scratchName), { recursive: true, force: true });

    calls = 0;
    const retryUncertain = await runPulse({ ...opts(), retryFailed: true, output: join(root, 'retry-uncertain.json') }, {
      executeSample: async () => ++calls === 9 ? uncertain : known,
    });
    assert.equal(calls, 9, JSON.stringify({ calls, retries: retryUncertain.retries }));
    assert.equal(retryUncertain.originals.filter(item => item.status === 'fail').length, 8);
    assert.equal(retryUncertain.retries.length, 8, JSON.stringify(retryUncertain.retries));
    assert.deepEqual(retryUncertain.retries.map(item => item.originalIndex), [1,2,3,4,5,6,7,8]);
    assert.equal(retryUncertain.retries[0].status, 'fail');
    assert.ok(retryUncertain.retries.slice(1).every(item => item.status === 'not_run'));
    rmSync(join(root, retryUncertain.cleanup.scratchName), { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('B19-02: POSIX signal failure has bounded uncertain settlement and no lingering test process',
  { timeout: 15_000 }, async () => {
    const root = temp(); const done = join(root, 'self-exited'); const gate = join(root, 'self-exit.mjs');
    let pulse;
    writeFileSync(gate, `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.MCP_GATE_PHASE_FILE, JSON.stringify({phase:'wait',cleanupPhase:'pending',cleanupStatus:'pending'}));
setTimeout(() => { writeFileSync(${JSON.stringify(done)}, 'done'); process.exit(0); }, 5000);
    setInterval(() => {}, 1000);`);
    try {
      pulse = await runPosix(process.execPath, {
        timeoutMs: 100,
        phaseFile: join(root, 'phase.json'),
        gate,
        processOps: {
          graceMs: 20,
          waitMs: 100,
          probe: () => true,
          signal() { const error = new Error('injected group signal failure'); error.code = 'EPERM'; throw error; },
        },
      });
      assert.equal(existsSync(done), false, 'settlement must not wait for the gate root to exit naturally');
      assert.equal(pulse.reason, 'deadline', JSON.stringify(pulse));
      assert.equal(pulse.rootExitObserved, false);
      assert.equal(pulse.containment.cleanupVerified, false);
      assert.equal(pulse.containment.scope, 'process-group-members-only');
      assert.equal(pulse.containment.escapedDescendantsMayRemain, true);
    } finally {
      const deadline = Date.now() + 5_000;
      while (!existsSync(done) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 20));
      assert.equal(existsSync(done), true, 'the self-exiting fixture must be gone before the test returns');
      if (pulse?.cleanup?.scratchName) rmSync(join(root, pulse.cleanup.scratchName), { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
});

test('B19-03: history-only CLI is read-only, lifecycle-safe and does not run the capability gate', async () => {
  const root = temp(); const home = join(root, 'home');
  const store = openTaskStore({ home });
  const succeeded = makeSucceeded(store, 'successful-with-test');
  const blocked = createRecord(store, 'blocked-unknown');
  store.updateTask(blocked.taskId, draft => {
    draft.status = 'running'; draft.startedAt = Date.now();
    draft.attempts.push({ attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', model: 'fixture/mock', startedAt: draft.startedAt, finishedAt: null, outcome: null });
  });
  store.updateTask(blocked.taskId, draft => { draft.status = 'blocked'; draft.finishedAt = Date.now(); draft.cancel.executionStopped = 'unknown'; draft.block = { reason: 'service-restart', requiresReconciliation: true }; });
  const administrativeUnknown = createRecord(store, 'administrative-unknown');
  store.updateTask(administrativeUnknown.taskId, draft => {
    draft.status = 'running'; draft.startedAt = 30_001;
    draft.attempts.push({ attemptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', model: 'fixture/mock', startedAt: 30_001, finishedAt: null, outcome: null });
  });
  store.updateTask(administrativeUnknown.taskId, draft => {
    draft.status = 'blocked'; draft.finishedAt = 30_002; draft.cancel.executionStopped = 'unknown';
    draft.block = { reason: 'service-restart', requiresReconciliation: true };
  });
  const unknownMaintenance = openTaskMaintenance({ home, now: 30_010 });
  try {
    const inspected = unknownMaintenance.inspectTask(administrativeUnknown.taskId);
    const evidence = { taskId: administrativeUnknown.taskId, fromStatus: 'blocked', decision: 'failed',
      recordDigest: inspected.recordDigest, observation: 'Uncertainty explicitly retained.', outcomeAssessment: 'unknown',
      workerStopped: true, processTreeChecked: true, inventoryComplete: true, inventorySource: 'fixture process inventory',
      liveWorkerPids: [], observedAt: 30_010 };
    unknownMaintenance.reconcileBlocked({ taskId: administrativeUnknown.taskId, decision: 'failed', actor: 'test',
      reason: 'administrative unknown outcome', evidence });
  } finally { unknownMaintenance.close(); }
  const unknownCancel = createRecord(store, 'cancel-corruption');
  store.updateTask(unknownCancel.taskId, draft => { draft.status = 'cancelled'; draft.finishedAt = Date.now(); draft.cancel.requestedAt = Date.now(); draft.cancel.executionStopped = true; draft.artifact = testArtifact(); });
  const unknownPath = join(home, 'tasks', `${unknownCancel.taskId}.json`);
  const corruptedCancel = JSON.parse(readFileSync(unknownPath, 'utf8'));
  corruptedCancel.cancel.executionStopped = 'unknown'; writeFileSync(unknownPath, JSON.stringify(corruptedCancel));
  const unknownBefore = readFileSync(unknownPath);
  const queuedWithAttempt = JSON.parse(readFileSync(join(home, 'tasks', `${succeeded.taskId}.json`), 'utf8'));
  queuedWithAttempt.status = 'queued'; queuedWithAttempt.startedAt = null; queuedWithAttempt.finishedAt = null;
  const incoherentPath = join(home, 'tasks', `${queuedWithAttempt.taskId}.json`);
  writeFileSync(incoherentPath, JSON.stringify(queuedWithAttempt));
  const incoherentBefore = readFileSync(incoherentPath);

  const failed = createRecord(store, 'known-failure-reconciliation');
  store.updateTask(failed.taskId, draft => {
    draft.status = 'running'; draft.startedAt = 20_001;
    draft.attempts.push({ attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', model: 'fixture/mock', startedAt: 20_001, finishedAt: 20_002, outcome: 'failed' });
  });
  store.updateTask(failed.taskId, draft => {
    draft.status = 'blocked'; draft.finishedAt = 20_003; draft.cancel.executionStopped = 'unknown';
    draft.block = { reason: 'service-restart', requiresReconciliation: true }; draft.artifact = testArtifact(1);
  });
  const maintenance = openTaskMaintenance({ home, now: 20_010 });
  try {
    const inspected = maintenance.inspectTask(failed.taskId);
    const evidence = { taskId: failed.taskId, fromStatus: 'blocked', decision: 'failed', recordDigest: inspected.recordDigest,
      observation: 'Observed a completed nonzero worker exit.', outcomeAssessment: 'known-failure', workerStopped: true,
      processTreeChecked: true, inventoryComplete: true, inventorySource: 'fixture process inventory', liveWorkerPids: [], observedAt: 20_010 };
    maintenance.reconcileBlocked({ taskId: failed.taskId, decision: 'failed', actor: 'test', reason: 'known failed attempt', evidence });
  } finally { maintenance.close(); }
  const before = snapshot(home);
  const marker = join(root, 'gate-started');
  const gate = join(root, 'marker-gate.mjs');
  writeFileSync(gate, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');`);
  const outputObserved = join(root, 'history-observed.json');
  const validCli = spawnSync(process.execPath, [fileURLToPath(new URL('../integration/harness-pulse.mjs', import.meta.url)),
    '--history-home', home, '--task-id', failed.taskId, '--output', outputObserved],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(validCli.status, 0, validCli.stderr);
  const observedReport = JSON.parse(readFileSync(outputObserved, 'utf8'));
  assert.equal(observedReport.mode, 'task-history'); assert.equal(observedReport.history.status, 'observed');
  assert.equal(observedReport.history.taskStatus, 'failed'); assert.equal(observedReport.history.attempts[0].attemptId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(observedReport.summary, undefined);
  assert.equal(readHistory({ home, taskId: administrativeUnknown.taskId }).status, 'not_run');

  const blockedOutput = join(root, 'history-blocked.json');
  const blockedCli = spawnSync(process.execPath, [fileURLToPath(new URL('../integration/harness-pulse.mjs', import.meta.url)),
    '--history-home', home, '--task-id', blocked.taskId, '--output', blockedOutput],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(blockedCli.status, 1, blockedCli.stderr); assert.equal(JSON.parse(readFileSync(blockedOutput, 'utf8')).history.status, 'not_run');
  assert.equal(readHistory({ home, taskId: unknownCancel.taskId }).status, 'not_run');
  assert.equal(readHistory({ home, taskId: succeeded.taskId }).status, 'not_run', 'queued records retaining attempts are incoherent');
  assert.equal(readHistory({ home, taskId: queuedWithAttempt.taskId }).status, 'not_run');
  assert.deepEqual(readFileSync(unknownPath), unknownBefore); assert.deepEqual(readFileSync(incoherentPath), incoherentBefore);
  assert.deepEqual(snapshot(home), before, 'history-only reads leave every home path and byte unchanged');
  assert.equal(existsSync(marker), false, 'history-only mode never launches the supplied gate');
  await assert.rejects(runPulse({ historyHome: home, taskId: failed.taskId, output: join(home, 'forbidden.json') }), /outside the selected task home/);
  assert.deepEqual(snapshot(home), before, 'an in-home report path is refused without a write');

  const apiOutput = join(root, 'history-api.json');
  const apiReport = await runPulse({ historyHome: home, taskId: blocked.taskId, output: apiOutput }, { gate });
  assert.equal(apiReport.mode, 'task-history'); assert.equal(apiReport.history.status, 'not_run');
  assert.equal(existsSync(marker), false, 'the API history mode also ignores the gate executable');
  const mixedOutput = join(root, 'mixed-mode.json');
  const mixedMode = spawnSync(process.execPath, [fileURLToPath(new URL('../integration/harness-pulse.mjs', import.meta.url)),
    '--binary', process.execPath, '--version', '2.2.5', '--history-home', home, '--task-id', failed.taskId, '--output', mixedOutput],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(mixedMode.status, 1); assert.match(mixedMode.stderr, /Pulse-only options are invalid/);
  assert.equal(existsSync(mixedOutput), false, 'mixed pulse/history mode is refused before writing a report');

  const project = join(root, 'pre-b17-project');
  mkdirSync(join(project, 'integration'), { recursive: true }); mkdirSync(join(project, 'src'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('../integration/harness-pulse.mjs', import.meta.url)), join(project, 'integration', 'harness-pulse.mjs'));
  copyFileSync(fileURLToPath(new URL('../src/tasks.mjs', import.meta.url)), join(project, 'src', 'tasks.mjs'));
  copyFileSync(fileURLToPath(new URL('../src/redaction.mjs', import.meta.url)), join(project, 'src', 'redaction.mjs'));
  const preB17Output = join(root, 'pre-b17-history.json');
  const preB17 = spawnSync(process.execPath, [join(project, 'integration', 'harness-pulse.mjs'),
    '--history-home', home, '--task-id', failed.taskId, '--output', preB17Output],
  { encoding: 'utf8', timeout: 10_000 });
  assert.equal(preB17.status, 1, preB17.stderr);
  const preB17Report = JSON.parse(readFileSync(preB17Output, 'utf8'));
  assert.equal(preB17Report.history.status, 'not_run'); assert.match(preB17Report.history.reason, /B17 evidence missing/);
  assert.deepEqual(snapshot(home), before, 'pre-B17 refusal also performs no history-home writes');
});

test('B19-04: output is sanitized, UTF-8 bounded, exclusive, manual and non-ranking', async () => {
  const root = temp();
  const gate = join(root, 'secret.mjs');
  writeFileSync(gate, `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.MCP_GATE_PHASE_FILE,'probe'); process.stdout.write('Bearer '); setTimeout(()=>process.stdout.write('split-secret-value-123456789'), 5);`);
  try {
    const output = join(root, 'pulse.json');
    const report = await runPulse({ ...opts(), output }, { gate });
    slots(report); assert.equal(report.originals[0].sanitized, true);
    assert.equal(report.originals[0].transcriptTruncated, false);
    const persisted = readFileSync(output, 'utf8'); assert.doesNotMatch(persisted, /split-secret-value/);
    assert.match(report.originals[0].transcript, /\[REDACTED\]/i);
    await assert.rejects(runPulse({ ...opts(), output }, { gate }), /already exists/);
    const hugeGate = join(root, 'huge.mjs');
    writeFileSync(hugeGate, `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.MCP_GATE_PHASE_FILE,'transcript'); process.stdout.write('😀'.repeat(2500));`);
    const huge = await runPulse(opts(), { gate: hugeGate });
    slots(huge); assert.equal(huge.originals[0].transcriptTruncated, true);
    assert.ok(huge.originals[0].transcriptBytes <= 8192); assert.equal(huge.originals[0].transcriptBytes % 4, 0);
    assert.doesNotMatch(huge.originals[0].transcript, /\uFFFD/);
    const invocation = readFileSync(fileURLToPath(new URL('../integration/harness-pulse.mjs', import.meta.url)), 'utf8');
    assert.doesNotMatch(invocation, /setInterval\s*\(/); assert.doesNotMatch(invocation, /ranking|rankModels|providerCredential/i);
    assert.doesNotMatch(invocation, /task\.(?:executable|command|script)/i);
    assert.doesNotMatch(invocation, /replaceAll\(ROOT/); assert.match(invocation, /redactSecrets/);
    assert.match(invocation, /manual, opt-in B19 pulse/i); assert.match(invocation, /descendantsStopped:false|descendantsStopped/);
    assert.match(invocation, /child\.stdin\?\.on\('error'/);
    const noOutput = spawnSync(process.execPath, [fileURLToPath(new URL('../integration/harness-pulse.mjs', import.meta.url)),
      '--binary', process.execPath, '--version', '2.2.5'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(noOutput.status, 1); assert.match(noOutput.stderr, /--output is required/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

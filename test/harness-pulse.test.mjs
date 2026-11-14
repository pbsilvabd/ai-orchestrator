import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runPulse, readHistory } from '../integration/harness-pulse.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'b19-pulse-test-'));
const opts = () => ({ binary: process.execPath, version: '2.2.5', timeoutMs: 1000 });
const slots = report => { assert.equal(report.originals.length, 8); assert.deepEqual(report.originals.map(x => x.index), [1,2,3,4,5,6,7,8]); };

test('B19-01: eight real child invocations retain original failure and separately count retry', async () => {
  const root = temp();
  const gate = join(root, 'gate.mjs');
  writeFileSync(gate, `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.MCP_GATE_PHASE_FILE, 'probe');
if (process.env.MCP_GATE_INJECT_FAILURE_PHASE) { console.error('Injected diagnostic failure'); process.exitCode=7; }
else { console.log('{"gate":"pass"}'); }
`);
  try {
    const report = await runPulse({ ...opts(), injectFailureIndex: 3, retryFailed: true }, { gate });
    slots(report); assert.equal(report.summary.denominator, 8); assert.equal(report.summary.fail, 1);
    assert.equal(report.summary.pass, 7); assert.equal(report.originals[2].status, 'fail');
    assert.equal(report.originals[2].phase, 'probe'); assert.equal(report.retries.length, 1);
    assert.equal(report.retries[0].originalIndex, 3); assert.equal(report.retries[0].status, 'pass');
    assert.equal(report.summary.success, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('B19-02: missing binary leaves eight not_run slots and timeout/oversized output are bounded', async () => {
  const root = temp();
  let timedScratch;
  try {
    const missing = await runPulse({ ...opts(), binary: join(root, 'missing.exe') });
    slots(missing); assert.equal(missing.summary.not_run, 8); assert.equal(missing.summary.success, false);
    const directory = await runPulse({ ...opts(), binary: root });
    slots(directory); assert.equal(directory.summary.not_run, 8);
    const noVersion = await runPulse({ ...opts(), version: undefined });
    slots(noVersion); assert.equal(noVersion.summary.not_run, 8); assert.match(noVersion.originals[0].reason, /pinned version/);
    const wrongVersion = await runPulse({ ...opts(), version: '2.2.4' });
    slots(wrongVersion); assert.equal(wrongVersion.summary.not_run, 8);
    const timeoutGate = join(root, 'timeout.mjs');
    writeFileSync(timeoutGate, `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.MCP_GATE_PHASE_FILE,'wait'); setInterval(()=>{},1000);`);
    const timed = await runPulse({ ...opts(), timeoutMs: 50 }, { gate: timeoutGate });
    slots(timed); assert.equal(timed.originals[0].reason, 'timeout'); assert.equal(timed.originals[0].status, 'fail');
    assert.equal(timed.cleanup.status, 'retained_uncertain_process_outcome');
    timedScratch = join(tmpdir(), timed.cleanup.scratchName); assert.equal(existsSync(timedScratch), true);
    const hugeGate = join(root, 'huge.mjs');
    writeFileSync(hugeGate, `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.MCP_GATE_PHASE_FILE,'transcript'); process.stdout.write('x'.repeat(20000));`);
    const huge = await runPulse(opts(), { gate: hugeGate });
    slots(huge); assert.equal(huge.originals[0].status, 'pass');
    assert.ok(huge.originals[0].transcriptBytes <= 8192); assert.equal(huge.originals[0].transcriptTruncated, true);
    assert.match(huge.originals[0].transcript, /stdout omitted: raw capture cap reached/);
  } finally { if (timedScratch) rmSync(timedScratch, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('B19-03: pre-B17 refusal and blocked/uncertain task history have no child effects or writes', async () => {
  const root = temp(); const home = join(root, 'home'); mkdirSync(join(home, 'tasks'), { recursive: true });
  const marker = join(root, 'child-started');
  const gate = join(root, 'gate.mjs'); writeFileSync(gate, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'started');`);
  const blocked = { id: 'uncertain', status: 'blocked', attempts: [{ attemptId: 'a', outcome: 'unknown' }], block: { reason: 'service-restart' } };
  blocked.request = { executable: marker };
  writeFileSync(join(home, 'tasks', 'uncertain.json'), JSON.stringify(blocked));
  const admin = { id: 'admin-unknown', status: 'failed', attempts: [{ attemptId: 'b', outcome: 'unknown' }],
    reconciliation: { decision: 'failed', reason: 'administrative closure' } };
  writeFileSync(join(home, 'tasks', 'admin-unknown.json'), JSON.stringify(admin));
  const noTests = { id: 'status-only', status: 'succeeded', attempts: [], testRuns: [], limitations: [] };
  writeFileSync(join(home, 'tasks', 'status-only.json'), JSON.stringify(noTests));
  const evidence = { id: 'observed-failure', status: 'failed', attempts: [{ attemptId: 'c', outcome: 'failed' }],
    testRuns: [{ command: 'node --test', exitCode: 1, outputTail: 'Bearer split-secret-value-123456789' }], limitations: [] };
  writeFileSync(join(home, 'tasks', 'observed-failure.json'), JSON.stringify(evidence));
  const before = readFileSync(join(home, 'tasks', 'uncertain.json'));
  const adminBefore = readFileSync(join(home, 'tasks', 'admin-unknown.json'));
  try {
    const project = join(root, 'pre-b17-project');
    mkdirSync(join(project, 'integration'), { recursive: true }); mkdirSync(join(project, 'src'), { recursive: true });
    copyFileSync(fileURLToPath(new URL('../integration/harness-pulse.mjs', import.meta.url)), join(project, 'integration', 'harness-pulse.mjs'));
    copyFileSync(fileURLToPath(new URL('../src/subprocess.mjs', import.meta.url)), join(project, 'src', 'subprocess.mjs'));
    const preB17Report = join(root, 'pre-b17-report.json');
    const preB17 = spawnSync(process.execPath, [join(project, 'integration', 'harness-pulse.mjs'),
      '--binary', join(root, 'missing-host.exe'), '--version', '2.2.5', '--output', preB17Report,
      '--history-home', home, '--task-id', 'uncertain'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(preB17.status, 1, preB17.stderr);
    const preB17Evidence = JSON.parse(readFileSync(preB17Report, 'utf8'));
    slots(preB17Evidence); assert.equal(preB17Evidence.history.status, 'not_run');
    assert.match(preB17Evidence.history.reason, /B17 evidence missing/);
    const uncertain = readHistory({ home, taskId: 'uncertain' }); assert.equal(uncertain.status, 'not_run');
    assert.match(uncertain.reason, /never replayed/);
    assert.equal(readHistory({ home, taskId: 'admin-unknown' }).status, 'not_run');
    assert.equal(readHistory({ home, taskId: 'status-only' }).status, 'not_run');
    const observed = readHistory({ home, taskId: 'observed-failure' });
    assert.equal(observed.status, 'observed'); assert.equal(observed.testRuns[0].exitCode, 1);
    assert.doesNotMatch(JSON.stringify(observed), /split-secret-value/);
    const report = await runPulse({ ...opts(), binary: join(root, 'does-not-exist.exe'), historyHome: home, taskId: 'uncertain' }, { gate });
    slots(report); assert.equal(report.history.status, 'not_run'); assert.equal(report.summary.not_run, 8);
    assert.deepEqual(readFileSync(join(home, 'tasks', 'uncertain.json')), before);
    assert.deepEqual(readFileSync(join(home, 'tasks', 'admin-unknown.json')), adminBefore);
    assert.equal(await import('node:fs').then(fs => fs.existsSync(marker)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
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
    assert.match(report.originals[0].transcript, /Bearer \[redacted\]/);
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
    assert.match(invocation, /manual, opt-in B19 pulse/i); assert.match(invocation, /descendantsStopped:false|descendantsStopped/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

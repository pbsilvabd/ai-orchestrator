import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSubprocess } from '../src/subprocess.mjs';

function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-child-'));
  // A deliberately unverified descendant may hold its inherited cwd briefly
  // after the root exits on Windows. Retry cleanup within a bounded interval;
  // persistent locks still fail the test rather than hiding leaked fixtures.
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { executable: process.execPath, cwd, env: {}, timeoutMs: 3000, killGraceMs: 500 };
}

test('B10-01: ENOENT, pre-abort, immediate exit and nonzero exit are truthful', async t => {
  const options = setup(t);
  const missing = await runSubprocess({ ...options, executable: join(options.cwd, 'missing.exe') });
  assert.equal(missing.termination.reason, 'spawn-error');
  assert.equal(missing.spawnErrorCode, 'ENOENT');
  assert.equal(missing.termination.rootExitObserved, false);

  const controller = new AbortController();
  controller.abort();
  const beforeSpawn = await runSubprocess({ ...options, signal: controller.signal });
  assert.equal(beforeSpawn.termination.reason, 'aborted-before-spawn');
  assert.equal(beforeSpawn.termination.rootExitObserved, false);
  assert.deepEqual(Object.keys(beforeSpawn.termination).sort(),
    ['reason', 'rootExitObserved', 'descendantsStopped'].sort());

  const immediate = await runSubprocess({ ...options, args: ['-e', 'process.exit(7)'] });
  assert.equal(immediate.code, 7);
  assert.equal(immediate.termination.rootExitObserved, true);
});

test('B10-02: stdout and stderr are drained while separate byte tails stay bounded', async t => {
  const result = await runSubprocess({ ...setup(t), stdoutMaxBytes: 17, stderrMaxBytes: 11,
    args: ['-e', "process.stdout.write('😀'.repeat(100000));process.stderr.write('e'.repeat(100000))"] });
  assert.equal(result.code, 0);
  assert.equal(result.stdoutBytes, 400000);
  assert.equal(result.stderrBytes, 100000);
  assert.equal(Buffer.byteLength(result.stdout), 16);
  assert.equal(Buffer.byteLength(result.stderr), 11);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
});

test('B10-02: tails trim across chunks and preserve UTF-8 boundaries', async t => {
  const result = await runSubprocess({ ...setup(t), stdoutMaxBytes: 10,
    args: ['-e', "process.stdout.write('abcdef');setTimeout(()=>process.stdout.write('ghijkl'),80)"] });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'cdefghijkl');
  assert.equal(result.stdoutBytes, 12);
  assert.equal(result.stdoutTruncated, true);

  const utf8 = await runSubprocess({ ...setup(t), stdoutMaxBytes: 7,
    args: ['-e', "process.stdout.write('ab😀');setTimeout(()=>process.stdout.write('xy'),80)"] });
  assert.equal(utf8.stdout, 'b😀xy');
  assert.equal(Buffer.byteLength(utf8.stdout), 7);
});

test('B10-03: deadline and abort settle once with partial output and clean up', async t => {
  const deadline = await runSubprocess({ ...setup(t), timeoutMs: 500, args: ['-e',
    "process.stdout.write('partial');setInterval(()=>process.stdout.write('x'),10)"] });
  assert.equal(deadline.termination.reason, 'deadline');
  assert.equal(deadline.stdout.startsWith('partial'), true);
  assert.equal(typeof deadline.termination.rootExitObserved, 'boolean');
  assert.equal(deadline.termination.descendantsStopped, false);

  const controller = new AbortController();
  const pending = runSubprocess({ ...setup(t), signal: controller.signal, args: ['-e',
    "process.stdout.write('before');setInterval(()=>{},1000)"] });
  setTimeout(() => controller.abort(), 150);
  const aborted = await pending;
  assert.equal(aborted.termination.reason, 'aborted');
  assert.equal(aborted.stdout, 'before');
});

test('B14-02: a real root exit racing its deadline settles with one immutable outcome', async t => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await Promise.race([
      runSubprocess({ ...setup(t), timeoutMs: 100, killGraceMs: 100,
        args: ['-e', "setTimeout(()=>{process.stdout.write('exit');process.exit(0)},100)"] }),
      delay(1500).then(() => { throw new Error('deadline/exit race did not settle'); }),
    ]);
    assert.ok(['exited', 'deadline'].includes(result.termination.reason));
    assert.equal(typeof result.termination.rootExitObserved, 'boolean');
    assert.equal(result.termination.descendantsStopped, false);
  }
});

test('B10-04: Windows process termination reports root exit and leaves descendants unverified', async t => {
  const options = setup(t);
  const marker = join(options.cwd, 'descendant-ready');
  const survived = join(options.cwd, 'descendant-survived-root');
  const controller = new AbortController();
  const descendant = `const fs=require('node:fs');fs.writeFileSync(process.argv[1],String(process.pid));setTimeout(()=>{fs.writeFileSync(${JSON.stringify(survived)},'alive');process.exit(0)},500)`;
  const pending = runSubprocess({ ...options, signal: controller.signal, args: ['-e',
    `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)},${JSON.stringify(marker)}],{stdio:'ignore',detached:true}).unref();setInterval(()=>{},1000)`] });
  let result;
  try {
    const readinessDeadline = Date.now() + 2500;
    while (!existsSync(marker) && Date.now() < readinessDeadline) await delay(10);
    assert.equal(existsSync(marker), true, 'descendant must actually start before root termination');
  } finally {
    controller.abort();
    result = await pending;
  }
  assert.equal(result.termination.reason, 'aborted');
  assert.equal(typeof result.termination.rootExitObserved, 'boolean');
  assert.equal(result.termination.descendantsStopped, false);
  const survivalDeadline = Date.now() + 2500;
  try {
    while (!existsSync(survived) && Date.now() < survivalDeadline) await delay(10);
    assert.equal(existsSync(survived), true, 'detached descendant must remain active after root termination');
  } finally {
    if (existsSync(marker)) {
      const pid = Number(readFileSync(marker, 'utf8'));
      try { process.kill(pid, 'SIGKILL'); } catch { /* descendant already exited */ }
    }
  }
});

test('B10-03: ignored SIGTERM is escalated within the grace bound', { skip: process.platform === 'win32' }, async t => {
  const started = Date.now();
  const result = await runSubprocess({ ...setup(t), timeoutMs: 100, killGraceMs: 100,
    args: ['-e', "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"] });
  assert.equal(result.termination.reason, 'deadline');
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.termination.rootExitObserved, true);
  assert.equal(result.termination.descendantsStopped, false);
  assert.ok(Date.now() - started < 1500);
});

test('synchronous spawn failures preserve their original code without a child', async t => {
  for (const invalid of [{ executable: 'invalid\u0000path' }, { args: ['invalid\u0000arg'] },
    { env: { FIXTURE: 'invalid\u0000value' } }]) {
    const result = await runSubprocess({ ...setup(t), ...invalid });
    assert.equal(result.spawnErrorCode, 'ERR_INVALID_ARG_VALUE');
    assert.deepEqual(result.termination, { reason: 'spawn-error', rootExitObserved: false,
      descendantsStopped: false });
    assert.equal(result.code, null);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('Windows command-line overflow returns the original spawn error', { skip: process.platform !== 'win32' }, async t => {
  const result = await runSubprocess({ ...setup(t), args: ['-e', ' '.repeat(100000)] });
  assert.equal(result.spawnErrorCode, 'ENAMETOOLONG');
  assert.deepEqual(result.termination, { reason: 'spawn-error', rootExitObserved: false,
    descendantsStopped: false });
});

test('rejects invalid executable, args, env and bounds', async t => {
  const options = setup(t);
  for (const invalid of [{ executable: '' }, { args: ['ok', 1] }, { env: { SECRET: 1 } },
    { stdoutMaxBytes: -1 }, { timeoutMs: Infinity }]) {
    assert.throws(() => runSubprocess({ ...options, ...invalid }), TypeError);
  }
});

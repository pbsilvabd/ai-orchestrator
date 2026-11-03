import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSubprocess } from '../src/subprocess.mjs';

function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-child-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { executable: process.execPath, cwd, env: {}, timeoutMs: 3000, killGraceMs: 500 };
}

test('B10-01: ENOENT, pre-abort, immediate exit and nonzero exit are truthful', async t => {
  const options = setup(t);
  const missing = await runSubprocess({ ...options, executable: join(options.cwd, 'missing.exe') });
  assert.equal(missing.termination.reason, 'spawn-error');
  assert.equal(missing.spawnErrorCode, 'ENOENT');
  assert.equal(missing.termination.rootExitObserved, true);

  const controller = new AbortController();
  controller.abort();
  const beforeSpawn = await runSubprocess({ ...options, signal: controller.signal });
  assert.equal(beforeSpawn.termination.reason, 'aborted-before-spawn');
  assert.equal(beforeSpawn.termination.rootExitObserved, false);

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

test('B10-03: deadline and abort settle once with partial output and clean up', async t => {
  const deadline = await runSubprocess({ ...setup(t), timeoutMs: 80, args: ['-e',
    "process.stdout.write('partial');setInterval(()=>process.stdout.write('x'),10)"] });
  assert.equal(deadline.termination.reason, 'deadline');
  assert.equal(deadline.stdout.startsWith('partial'), true);
  assert.equal(typeof deadline.termination.rootExitObserved, 'boolean');
  assert.equal(deadline.descendantsStopped, undefined);

  const controller = new AbortController();
  const pending = runSubprocess({ ...setup(t), signal: controller.signal, args: ['-e',
    "process.stdout.write('before');setInterval(()=>{},1000)"] });
  setTimeout(() => controller.abort(), 150);
  const aborted = await pending;
  assert.equal(aborted.termination.reason, 'aborted');
  assert.equal(aborted.stdout, 'before');
});

test('B10-04: Windows process termination reports root exit and leaves descendants unverified', async t => {
  const result = await runSubprocess({ ...setup(t), timeoutMs: 100, args: ['-e',
    "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),500)'],{stdio:'ignore'});process.stdout.write('child-started');setInterval(()=>{},1000)"] });
  assert.equal(result.termination.reason, 'deadline');
  assert.equal(typeof result.termination.rootExitObserved, 'boolean');
  assert.equal(result.termination.descendantsStopped, false);
});

test('rejects invalid executable, args, env and bounds', async t => {
  const options = setup(t);
  for (const invalid of [{ executable: '' }, { args: ['ok', 1] }, { env: { SECRET: 1 } },
    { stdoutMaxBytes: -1 }, { timeoutMs: Infinity }]) {
    assert.throws(() => runSubprocess({ ...options, ...invalid }), TypeError);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runSamples } from '../scripts/repeat-default-suite.mjs';

test('FIX48-05: repeated-suite runner retains every original and fails if any sample fails', () => {
  const results = [
    { status: 0, signal: null },
    { status: 1, signal: null },
    { status: 0, signal: null },
    { status: null, signal: null, error: { code: 'ENOENT' } },
    { status: 0, signal: null },
  ];
  const calls = [];
  const outcome = runSamples({
    count: 5,
    revision: 'fixture-sha',
    worktreeClean: true,
    inspect: () => ({ revision: 'fixture-sha', worktreeClean: true }),
    execute: (...args) => {
      calls.push(args);
      return results.shift();
    },
  });

  assert.equal(calls.length, 5, 'a failing original must not suppress later samples');
  assert.ok(calls.every(([, args]) => args.length === 1 && args[0] === '--test'),
    'every sample must retain Node’s default test concurrency');
  assert.deepEqual(outcome.outcomes.map(sample => sample.sample), [1, 2, 3, 4, 5]);
  assert.deepEqual(outcome.outcomes.map(sample => sample.exitCode), [0, 1, 0, null, 0]);
  assert.equal(outcome.outcomes[3].signal, null);
  assert.equal(outcome.outcomes[3].errorCode, 'ENOENT');
  assert.equal(outcome.exitCode, 1);
});

test('FIX48-05: repeated-suite runner rejects zero or more than five samples', () => {
  assert.throws(() => runSamples({ count: 0, revision: 'sha', worktreeClean: true }), TypeError);
  assert.throws(() => runSamples({ count: 6, revision: 'sha', worktreeClean: true }), TypeError);
});

test('FIX48-05: repeated-suite runner fails if the checked-out revision changes', () => {
  let currentRevision = 'fixture-sha';
  const outcome = runSamples({
    count: 1,
    revision: 'fixture-sha',
    worktreeClean: true,
    execute: () => {
      currentRevision = 'other-sha';
      return { status: 0, signal: null };
    },
    inspect: () => ({ revision: currentRevision, worktreeClean: true }),
  });
  assert.equal(outcome.outcomes[0].worktreeUnchanged, false);
  assert.equal(outcome.exitCode, 1);
});

test('FIX48-05: repeated-suite runner does not certify a dirty checkout', () => {
  const outcome = runSamples({
    count: 1,
    revision: 'fixture-sha',
    worktreeClean: false,
    execute: () => ({ status: 0, signal: null }),
    inspect: () => ({ revision: 'fixture-sha', worktreeClean: false }),
  });
  assert.equal(outcome.outcomes[0].worktreeUnchanged, true);
  assert.equal(outcome.exitCode, 1);
});

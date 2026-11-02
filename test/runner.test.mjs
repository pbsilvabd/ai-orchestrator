import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOperation } from '../src/runner.mjs';
import { openSession } from '../src/ledger.mjs';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'orchestrator-runner-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, sessionId: 's', models: ['mock/a', 'mock/b'], budgetMs: 2000 };
}
function read(options) {
  const ledger = openSession(options.directory, options.sessionId);
  try { return ledger.snapshot(); } finally { ledger.close(); }
}
const safe = { ok: false, error: { status: 429, effects: 'none', responseStarted: false } };

test('runner persists dispatch and falls back within one operation', async t => {
  const options = setup(t);
  const seen = [];
  const result = await runOperation({ ...options, invoke: async ({ dispatch }) => {
    assert.throws(() => openSession(options.directory, 's'), { code: 'EEXIST' });
    seen.push(dispatch.model);
    if (dispatch.model === 'mock/a') return safe;
    dispatch.operationId = 'tampered'; // Does not corrupt the runner identity.
    return { ok: true, value: 'done' };
  } });
  assert.deepEqual(seen, options.models);
  assert.equal(result.value, 'done');
  assert.equal(read(options).completed, true);
});

test('pre-cancelled operation invokes no provider', async t => {
  const options = setup(t);
  const controller = new AbortController(); controller.abort();
  const result = await runOperation({ ...options, signal: controller.signal, invoke: () => assert.fail() });
  assert.equal(result.reason, 'cancelled');
});

test('cancellation blocks replay even when provider completes later', async t => {
  const options = setup(t);
  const controller = new AbortController();
  let resolveLate;
  let adapterSignal;
  const result = await runOperation({ ...options, signal: controller.signal, invoke: ({ signal }) => {
    adapterSignal = signal;
    const pending = new Promise(resolve => { resolveLate = resolve; });
    controller.abort();
    return pending;
  } });
  assert.equal(result.reason, 'cancelled');
  assert.equal(adapterSignal.aborted, true);
  resolveLate({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(read(options).blocked, true);
  const rerun = await runOperation({ ...options, invoke: () => assert.fail() });
  assert.equal(rerun.reason, 'blocked');
});

test('deadline bounds wait when provider ignores abort; late rejection is consumed', { timeout: 3000 }, async t => {
  const options = setup(t);
  let rejectLate;
  const result = await runOperation({ ...options, budgetMs: 100, invoke: () =>
    new Promise((_, reject) => { rejectLate = reject; }) });
  assert.equal(result.reason, 'deadline');
  if (rejectLate) rejectLate(new Error('late private error'));
  await new Promise(resolve => setImmediate(resolve));
  // If disk IO exhausted budget before invoking, pending was still conservatively blocked.
  const state = read(options);
  if (state.attempts.length) assert.equal(state.blocked, true);
});

test('exceptions and malformed responses never trigger fallback', async t => {
  for (const invoke of [() => { throw new Error('private'); }, () => undefined]) {
    const options = setup(t);
    const result = await runOperation({ ...options, invoke });
    assert.equal(result.reason, 'unsafe-replay');
    assert.equal(read(options).attempts.length, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('attempt budget terminates safe repeated failures; invalid budget rejected', async t => {
  const options = setup(t);
  const result = await runOperation({ ...options, invoke: () => safe });
  assert.equal(result.reason, 'attempt-limit');
  assert.equal(read(options).attempts.length, 2);
  await assert.rejects(runOperation({ ...options, budgetMs: Infinity, invoke: () => safe }));
});

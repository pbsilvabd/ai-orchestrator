import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createState, select, failure, nextOperation } from '../src/policy.mjs';

const models = ['mock/a', 'mock/b'];
const safe = { status: 429, responseStarted: false, effects: 'none' };
const first = () => select(createState('session-1'), models, { now: 0 });

test('429 switches to B without changing session or mutating input', () => {
  const a = first();
  const snapshot = JSON.stringify(a.state);
  const result = failure(a.state, a.model, safe, { now: 0 });
  const b = select(result.state, models, { now: 0 });
  assert.equal(b.model, 'mock/b');
  assert.equal(b.state.sessionId, 'session-1');
  assert.equal(JSON.stringify(a.state), snapshot);
});

test('two failed models terminate within budget', () => {
  let state = createState('session-1');
  for (let i = 0; i < 2; i++) {
    const choice = select(state, models, { now: 0 });
    state = failure(choice.state, choice.model, { ...safe, status: 503 }, { now: 0 }).state;
  }
  assert.equal(select(state, models, { now: 100_000 }).reason, 'attempt-limit');
  assert.equal(select(state, models, { now: 100_000, maxAttempts: 3 }).reason, 'exhausted');
});

test('checkpoint survives a new process without automatically replaying A', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-orchestrator-'));
  try {
    const path = join(dir, 'checkpoint.json');
    const a = first();
    const checkpoint = { state: failure(a.state, a.model, safe, { now: 0 }).state, history: [{ role: 'user', text: 'fixture' }] };
    writeFileSync(path, JSON.stringify(checkpoint));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { readFileSync } from 'node:fs';
       import { select } from ${JSON.stringify(new URL('../src/policy.mjs', import.meta.url).href)};
       const c = JSON.parse(readFileSync(process.argv[1], 'utf8'));
       console.log(JSON.stringify({ choice: select(c.state, ['mock/a','mock/b'], { now: 0 }), history: c.history }));`, path],
      { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const restored = JSON.parse(child.stdout);
    assert.equal(restored.choice.model, 'mock/b');
    assert.equal(restored.choice.state.sessionId, checkpoint.state.sessionId);
    assert.deepEqual(restored.history, checkpoint.history);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failure after file write stops and does not dispatch another model', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-orchestrator-'));
  try {
    const path = join(dir, 'effect.txt');
    writeFileSync(path, 'one write');
    const a = first();
    const stopped = failure(a.state, a.model, { ...safe, effects: 'possible' }, { now: 0 });
    assert.equal(stopped.reason, 'unsafe-replay');
    assert.equal(select(stopped.state, models, { now: 99_999 }).action, 'stop');
    assert.equal(readFileSync(path, 'utf8'), 'one write');
    assert.throws(() => nextOperation(stopped.state, { previousCompleted: true }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('preferred returns only in a new completed operation after cooldown/Retry-After', () => {
  const a = first();
  const failed = failure(a.state, a.model, { ...safe, retryAfterMs: 120_000 }, { now: 0 });
  const b = select(failed.state, models, { now: 0 });
  const fresh = nextOperation(b.state, { previousCompleted: true });
  assert.equal(select(fresh, models, { now: 119_999 }).model, 'mock/b');
  assert.equal(select(fresh, models, { now: 120_000 }).model, 'mock/a');
  assert.throws(() => nextOperation(b.state));
});

for (const status of [400, 401, 403, 404, 402]) test(`HTTP ${status} never falls back`, () => {
  const a = first();
  assert.equal(failure(a.state, a.model, { ...safe, status }, { now: 0 }).action, 'stop');
});
for (const error of [{ status: 429 }, { ...safe, responseStarted: true }, { ...safe, effects: 'unknown' },
  { ...safe, kind: 'quota' }, { ...safe, retryAfterMs: -1 }]) test(`fail closed: ${JSON.stringify(error)}`, () => {
  const a = first();
  assert.equal(failure(a.state, a.model, error, { now: 0 }).action, 'stop');
});

test('timeout with proven safe boundary can fall back', () => {
  const a = first();
  assert.equal(failure(a.state, a.model, { kind: 'timeout', responseStarted: false, effects: 'none' }, { now: 0 }).action, 'fallback');
});

test('authorization, cooldown wait, budget, malformed checkpoint and no repeated models', () => {
  const state = { ...createState('s'), cooldowns: { 'mock/b': 100 } };
  assert.equal(select(state, ['mock/b'], { now: 0 }).until, 100);
  assert.equal(select(state, ['mock/b'], { now: 100 }).model, 'mock/b');
  assert.throws(() => select(state, models, { now: 0, maxAttempts: Infinity }));
  assert.throws(() => select(state, ['mock/a', 'mock/a'], { now: 0 }));
  assert.throws(() => select({ ...state, version: 9 }, models, { now: 0 }));
  assert.throws(() => failure(first().state, 'mock/b', safe, { now: 0 }));
  assert.equal(select(first().state, ['mock/a'], { now: 0 }).reason, 'in-flight-or-unknown');
});

test('restart during dispatch blocks all replay until explicit reconciliation', () => {
  const restored = JSON.parse(JSON.stringify(first().state));
  assert.equal(select(restored, models, { now: 999_999 }).reason, 'in-flight-or-unknown');
  assert.throws(() => nextOperation(restored));
});

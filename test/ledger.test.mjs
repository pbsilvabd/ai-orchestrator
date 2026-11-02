import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openSession } from '../src/ledger.mjs';

const moduleUrl = new URL('../src/ledger.mjs', import.meta.url).href;
const models = ['mock/a', 'mock/b'];
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const file = (dir, suffix) => join(dir, readdirSync(dir).find(name => name.endsWith(suffix)));
const child = (dir, code) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { openSession } from ${JSON.stringify(moduleUrl)}; ${code}`, dir],
  { encoding: 'utf8', timeout: 5000 });

test('dispatch is persisted before return; restart remains pending; success survives reopening', t => {
  const dir = fixture(t);
  let ledger = openSession(dir, 's');
  const dispatch = ledger.select(models, { now: 0 });
  assert.equal(JSON.parse(readFileSync(file(dir, '.json'))).pending, true);
  dispatch.state.pending = false; // Returned state cannot mutate the ledger.
  assert.equal(ledger.snapshot().pending, true);
  ledger.close();
  ledger = openSession(dir, 's');
  try {
    assert.equal(ledger.select(models, { now: 0 }).reason, 'in-flight-or-unknown');
    ledger.success(dispatch);
  } finally { ledger.close(); }
  ledger = openSession(dir, 's');
  try {
    assert.equal(ledger.select(models, { now: 0 }).reason, 'completed');
    ledger.nextOperation();
    const next = ledger.select(models, { now: 0 });
    assert.throws(() => ledger.success(dispatch));
    ledger.success(next);
  } finally { ledger.close(); }
});

test('lock excludes another process and allows independent sessions', t => {
  const dir = fixture(t);
  const ledger = openSession(dir, 's');
  try {
    const result = child(dir, `try { openSession(process.argv[1], 's'); process.exit(2); }
      catch(e) { if(e.code !== 'EEXIST') throw e; }`);
    assert.equal(result.status, 0, result.stderr);
    const other = openSession(dir, 'other');
    other.close();
  } finally { ledger.close(); }
  assert.throws(() => ledger.snapshot());
  ledger.close(); // Idempotent.
});

test('process death leaves lock; explicit reconciliation preserves pending checkpoint', t => {
  const dir = fixture(t);
  const result = child(dir, `const l = openSession(process.argv[1], 's');
    l.select(['mock/a'], {now:0}); process.exit(17);`);
  assert.equal(result.status, 17, result.stderr);
  assert.throws(() => openSession(dir, 's'), { code: 'EEXIST' });
  // Test operator knows this child exited; production never removes stale locks automatically.
  unlinkSync(file(dir, '.lock'));
  const ledger = openSession(dir, 's');
  try { assert.equal(ledger.select(models, { now: 0 }).reason, 'in-flight-or-unknown'); }
  finally { ledger.close(); }
});

test('corrupt checkpoint is never replaced or silently reinitialized', t => {
  const dir = fixture(t);
  openSession(dir, 's').close();
  const path = file(dir, '.json');
  for (const content of ['{broken', JSON.stringify({ version: 1 }), 'null']) {
    writeFileSync(path, content);
    assert.throws(() => openSession(dir, 's'));
    assert.equal(readFileSync(path, 'utf8'), content);
    assert.equal(readdirSync(dir).some(name => name.endsWith('.lock')), false);
  }
});

test('rename failure prevents dispatch and poisons handle', t => {
  const dir = fixture(t);
  const ledger = openSession(dir, 's');
  const path = file(dir, '.json');
  // Fault injection in isolated fixture: a directory cannot be replaced with the checkpoint.
  unlinkSync(path);
  mkdirSync(path);
  try {
    assert.throws(() => ledger.select(models, { now: 0 }));
    assert.throws(() => ledger.select(models, { now: 0 }), /requires reopening/);
    assert.equal(readdirSync(dir).some(name => name.endsWith('.tmp')), false);
  } finally { ledger.close(); }
});

test('safe fallback and fatal failure are committed', t => {
  const dir = fixture(t);
  const ledger = openSession(dir, 's');
  try {
    const a = ledger.select(models, { now: 0 });
    ledger.failure(a, { status: 429, responseStarted: false, effects: 'none' }, { now: 0 });
    const b = ledger.select(models, { now: 0 });
    assert.equal(b.model, 'mock/b');
    ledger.failure(b, { status: 503, effects: 'unknown' }, { now: 0 });
    assert.equal(JSON.parse(readFileSync(file(dir, '.json'))).blocked, true);
  } finally { ledger.close(); }
});

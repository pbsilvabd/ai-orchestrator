import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { B17_REQUIRED_ITEM_IDS, classifyHostAvailability, classifyTapRun, extractContractCriteria,
  summarizeMatrix, validateContractCriteria } from '../integration/acceptance-matrix.mjs';

const tap = ({ tests = 1, passed = 1, failed = 0, skipped = 0, cancelled = 0, todo = 0,
  title = 'required scenario' } = {}) =>
  `TAP version 13\n# Subtest: ${title}\nok 1 - ${title}\n1..1\n# tests ${tests}\n# pass ${passed}\n# fail ${failed}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n`;

test('B17 runner passes only an observed, executed and passing named test', () => {
  assert.equal(classifyTapRun({ exitCode: 0, stdout: tap(), expectedTitle: 'required scenario' }).status, 'pass');
});

test('B17 runner reports failed assertions as fail', () => {
  const output = tap({ passed: 0, failed: 1 }).replace('ok 1 - required scenario', 'not ok 1 - required scenario');
  assert.equal(classifyTapRun({ exitCode: 1, stdout: output, expectedTitle: 'required scenario' }).status, 'fail');
  assert.equal(classifyTapRun({ exitCode: 1, stdout: '' }).status, 'fail');
});

test('B17 runner preserves assertion failure when TAP also reports a skipped child', () => {
  const mixed = tap({ tests: 2, passed: 0, failed: 1, skipped: 1 });
  assert.equal(classifyTapRun({ exitCode: 1, stdout: mixed, expectedTitle: 'required scenario' }).status, 'fail');
});

test('B17 runner classifies mixed real Node test failures, skips, TODOs and nonzero exits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b17-tap-child-'));
  const runNodeTest = source => {
    const file = join(dir, 'fixture.test.mjs');
    writeFileSync(file, source);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env });
  };
  try {
    const mixed = runNodeTest(`import test from 'node:test';
import assert from 'node:assert/strict';
test('required failure', () => assert.fail('expected fixture failure'));
test('required skip', { skip: 'fixture' }, () => {});
test('required TODO', { todo: 'fixture' }, () => assert.fail('TODO fixture'));
`);
    assert.equal(mixed.status, 1, mixed.stderr);
    const mixedResult = classifyTapRun({ exitCode: mixed.status, stdout: mixed.stdout,
      expectedTitle: 'required failure' });
    assert.equal(mixedResult.status, 'fail');
    assert.equal(mixedResult.counts.failed, 1);
    assert.equal(mixedResult.counts.skipped, 1);
    assert.equal(mixedResult.counts.todo, 1);

    const todoTap = tap({ passed: 0, todo: 1, title: 'required TODO' });
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const todoWithNonzero = spawnSync(process.execPath, ['-e',
      `process.stdout.write(${JSON.stringify(todoTap)}); process.exitCode = 1;`], { encoding: 'utf8', env });
    assert.equal(todoWithNonzero.status, 1, todoWithNonzero.stderr);
    const todoResult = classifyTapRun({ exitCode: todoWithNonzero.status, stdout: todoWithNonzero.stdout,
      expectedTitle: 'required TODO' });
    assert.equal(todoResult.status, 'fail');
    assert.equal(todoResult.counts.failed, 0);
    assert.equal(todoResult.counts.todo, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B17 runner reports a skipped required test or a missing test as not_run', () => {
  const skipped = tap({ passed: 0, skipped: 1 })
    .replace('ok 1 - required scenario', 'not ok 1 - required scenario # SKIP platform gate');
  assert.equal(classifyTapRun({ exitCode: 0, stdout: skipped, expectedTitle: 'required scenario' }).status, 'not_run');
  assert.equal(classifyTapRun({ exitCode: 0, stdout: '', expectedTitle: 'required scenario' }).status, 'not_run');
  assert.equal(classifyTapRun({ exitCode: 0, stdout: tap(), expectedTitle: 'missing scenario' }).status, 'not_run');
  assert.equal(classifyTapRun({ exitCode: null, error: { code: 'ENOENT' } }).status, 'not_run');
  assert.deepEqual(classifyHostAvailability({ binarySupplied: false, binaryExists: false }),
    { status: 'not_run', reason: 'pinned_client_binary_not_supplied' });
  assert.deepEqual(classifyHostAvailability({ binarySupplied: true, binaryExists: false }),
    { status: 'not_run', reason: 'pinned_client_binary_missing' });
});

test('B17 overall result rejects missing, duplicate, failed and not_run matrix items', () => {
  const allPassing = B17_REQUIRED_ITEM_IDS.map(id => ({ id, status: 'pass' }));
  assert.equal(summarizeMatrix(allPassing).success, true);
  assert.equal(summarizeMatrix(allPassing.slice(0, -1)).success, false);
  assert.equal(summarizeMatrix([...allPassing.slice(0, -1), allPassing[0]]).success, false);
  assert.equal(summarizeMatrix(allPassing.map((item, index) =>
    index === 4 ? { ...item, status: 'fail' } : item)).success, false);
  assert.equal(summarizeMatrix(allPassing.map((item, index) =>
    index === 12 ? { ...item, status: 'not_run' } : item)).success, false);
});

test('B17 mapping extracts all thirteen numbered contract criteria in order', () => {
  const markdown = readFileSync(resolve('docs/task-contract.md'), 'utf8');
  const criteria = extractContractCriteria(markdown);
  assert.equal(validateContractCriteria(criteria), true);
  assert.deepEqual(criteria.map(item => item.number), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.match(criteria[12].text, /real client run through the transport returns a result/);
  assert.equal(validateContractCriteria(criteria.slice(0, -1)), false);
  assert.equal(validateContractCriteria([...criteria, { number: 14, text: 'new criterion' }]), false);
  assert.equal(validateContractCriteria(criteria.map((item, index) =>
    index === 0 ? { ...item, text: `${item.text} changed` } : item)), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSchema, exportEnum, validate } from '../src/contracts/validate.mjs';
import { ERROR_CODES, EVIDENCE_LEVELS, SCHEMA_VERSION, TASK_STATUSES } from '../src/service.mjs';
import { openTaskStore } from '../src/tasks.mjs';

const ROOT = join(import.meta.dirname, '..');
const loadSchema = name => JSON.parse(readFileSync(join(ROOT, 'src/contracts/schemas', name), 'utf8'));
const submitSchema = loadSchema('task-submit-request.schema.json');
const artifactSchema = loadSchema('worker-artifact.schema.json');
const recordSchema = loadSchema('task-record.schema.json');
const errorSchema = loadSchema('error-envelope.schema.json');

// The checker reports relative paths; the root path is the empty string.
const paths = result => result.errors.map(error => error.path);

const submitRequest = (overrides = {}) => ({
  idempotencyKey: 'goal-2026-11-02-01',
  clientId: 'opencode-primary',
  objective: 'Add a regression test for the retry budget',
  acceptanceCriteria: ['node --test passes'],
  repository: { path: '/abs/repo', baseRef: 'main', branch: 'task/retry-budget' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src/**'] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
  ...overrides,
});

const workerArtifact = (overrides = {}) => ({
  attempts: [
    { attemptId: 'attempt-1', model: 'mock/a', startedAt: 1_000, finishedAt: 2_000, outcome: 'succeeded' },
  ],
  testRuns: [
    { command: 'node --test', exitCode: 0, durationMs: 1_200, summary: '83 passed', outputTail: 'ok', outputTruncated: false },
  ],
  diff: 'diff --git a/src/service.mjs b/src/service.mjs',
  diffTruncated: false,
  changedFiles: ['src/service.mjs'],
  baseCommit: '3f30114',
  branch: 'task/retry-budget',
  headCommit: 'deadbee',
  logsTruncated: false,
  limitations: [],
  cost: { known: false, amount: null, currency: 'unknown', note: 'cost is unknown until a provider is authorized' },
  evidenceLevel: 'unit',
  ...overrides,
});

// Shape written by openTaskStore().createTask (src/tasks.mjs:192-208).
const taskRecord = (overrides = {}) => ({
  schemaVersion: 1,
  taskId: '9a1f0c4e-3b7d-4a52-9f1e-2c8d5b6a7e90',
  clientId: 'opencode-primary',
  idempotencyKey: 'goal-2026-11-02-01',
  payloadHash: 'a'.repeat(64),
  request: submitRequest(),
  status: 'queued',
  createdAt: 1_000,
  acceptedAt: 1_000,
  startedAt: null,
  finishedAt: null,
  attempts: [],
  cancel: { requestedAt: null, executionStopped: null, effectsReverted: false },
  block: null,
  progress: [{ at: 1_000, event: 'accepted', detail: null }],
  ...overrides,
});

test('validate accepts a value for every supported keyword', () => {
  const cases = [
    ['objects with properties', { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, { a: 'x' }],
    ['arrays with items and bounds', { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer' } }, [1, 2]],
    ['strings with bounds', { type: 'string', minLength: 1, maxLength: 3 }, 'abc'],
    ['numbers', { type: 'number' }, 1.5],
    ['integers', { type: 'integer' }, 2],
    ['booleans', { type: 'boolean' }, false],
    ['null', { type: 'null' }, null],
    ['nullable unions', { type: ['string', 'null'], minLength: 1 }, null],
    ['enums', { type: 'string', enum: ['queued', 'running'] }, 'running'],
    ['enum null entry', { type: ['boolean', 'string', 'null'], enum: [null, true, 'unknown'] }, null],
    ['patterns', { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' }, 'goal-1'],
    ['strict objects with no extras', { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } }, { a: 'x' }],
    ['annotations are ignored', { type: 'string', description: 'ignored', meta: { title: 'x', source: 'y' } }, 'x'],
    ['dialect declarations are ignored', { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' }, 'x'],
  ];
  for (const [name, schema, value] of cases) {
    const result = validate(schema, value);
    assert.deepEqual(result, { ok: true }, name);
  }
});

test('validate reports the flat path of the failing property', () => {
  const result = validate({
    type: 'object',
    properties: { objective: { type: 'string', minLength: 1 } },
  }, { objective: '' });

  assert.deepEqual(result, {
    ok: false,
    errors: [{ path: 'objective', message: 'must be at least 1 character' }],
  });
});

test('validate reports array index paths', () => {
  const result = validate({
    type: 'object',
    properties: {
      acceptanceCriteria: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
  }, { acceptanceCriteria: ['ok', 'ok', 3] });

  assert.deepEqual(result, {
    ok: false,
    errors: [{ path: 'acceptanceCriteria[2]', message: 'expected string, received integer' }],
  });
});

test('validate reports nested object paths for missing required keys', () => {
  const result = validate(submitSchema, (() => {
    const request = submitRequest();
    delete request.repository.baseRef;
    return request;
  })());

  assert.deepEqual(result, {
    ok: false,
    errors: [{ path: 'repository.baseRef', message: 'required property is missing' }],
  });
});

test('validate rejects unknown keys and names them once', () => {
  const result = validate({
    type: 'object',
    additionalProperties: false,
    properties: { taskId: { type: 'string' } },
  }, { taskId: 't', extra: 1 });

  assert.deepEqual(result, {
    ok: false,
    errors: [{ path: 'extra', message: 'unknown property' }],
  });
});

test('negative keyword cases carry path and message', () => {
  const cases = [
    ['root type', { type: 'object' }, [], '', 'expected object, received array'],
    ['nullable union type', { type: ['string', 'null'] }, 4, '', 'expected string or null, received integer'],
    ['enum', { type: 'string', enum: ['a', 'b'] }, 'c', '', 'expected one of "a", "b"'],
    ['pattern', { type: 'string', pattern: '^[a-z]+$' }, 'A', '', 'must match /^[a-z]+$/'],
    ['maxLength', { type: 'string', maxLength: 2 }, 'abc', '', 'must be at most 2 characters'],
    ['minItems', { type: 'array', minItems: 2 }, ['a'], '', 'must contain at least 2 items'],
    ['maxItems', { type: 'array', maxItems: 1 }, ['a', 'b'], '', 'must contain at most 1 item'],
    ['items', { type: 'array', items: { type: 'integer' } }, [1, 'x'], '[1]', 'expected integer, received string'],
    ['integer vs number', { type: 'integer' }, 1.5, '', 'expected integer, received number'],
    ['boolean', { type: 'boolean' }, 'true', '', 'expected boolean, received string'],
  ];
  for (const [name, schema, value, path, message] of cases) {
    const result = validate(schema, value);
    assert.equal(result.ok, false, name);
    assert.deepEqual(result.errors, [{ path, message }], name);
  }
});

test('validate collects every error instead of stopping at the first', () => {
  const request = submitRequest({ acceptanceCriteria: [], objective: '' });
  request.clientId = 'not a valid identifier';
  const result = validate(submitSchema, request);

  assert.equal(result.ok, false);
  assert.deepEqual(paths(result), ['clientId', 'objective', 'acceptanceCriteria']);
  assert.deepEqual(result.errors.map(error => error.message), [
    'must match /^[A-Za-z0-9._:-]{1,128}$/',
    'must be at least 1 character',
    'must contain at least 1 item',
  ]);
});

test('validate output is deterministic', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } };
  const first = validate(schema, { a: 1, b: 2 });
  const second = validate(schema, { a: 1, b: 2 });
  assert.deepEqual(first, second);
  assert.equal(first.errors.length, 2);
});

test('validate truncates instance data and never echoes secret-shaped values', () => {
  const secretKey = `Bearer ${'s'.repeat(80)}-key`;
  const result = validate({
    type: 'object',
    additionalProperties: false,
    properties: {},
  }, { [secretKey]: 1 });

  assert.equal(result.ok, false);
  const [error] = result.errors;
  assert.equal(error.message, 'unknown property');
  assert.ok(error.path.length <= 34, `path is bounded: ${error.path}`);
  assert.ok(error.path.endsWith('…'));
  assert.ok(!error.path.includes('-key'));

  const enumResult = validate({ type: 'string', enum: ['ok'] }, `Bearer ${'s'.repeat(200)}`);
  assert.deepEqual(enumResult, {
    ok: false,
    errors: [{ path: '', message: 'expected one of "ok"' }],
  });
  assert.ok(!JSON.stringify(enumResult).includes('ssssssssssssssss'));
});

test('validate throws on malformed schema nodes instead of accepting them', () => {
  assert.throws(() => validate({ type: 'float' }, 1), /unknown type "float"/);
  assert.throws(() => validate({ type: 'string', pattern: '(' }, 'x'), /not a valid regular expression/);
  assert.throws(() => validate({ type: 'object', additionalProperties: {} }, {}), /only additionalProperties: false is supported/);
  assert.throws(() => validate({ type: 'object', additionalProperties: true }, {}), /only additionalProperties: false is supported/);
  assert.throws(() => validate({ type: 'string', enum: [{ a: 1 }] }, 'x'), /enum entries must be primitives/);
  assert.throws(() => validate({ type: 'array', minItems: -1 }, []), /minItems must be a non-negative integer/);
  assert.throws(() => validate('object', {}), /schema must be an object/);
  assert.throws(() => validate({ type: 'string', minlength: 5 }, 'ab'), /unknown keyword "minlength"/);
  assert.throws(() => validate({ enum: ['a'] }, 'a'), /type is required/);
  assert.throws(() => validate({ type: 'object', properties: { a: { enum: [1] } } }, { a: 1 }), /type is required/);
  assert.throws(() => validate({ type: 'object', required: 'a' }, {}), /required must be an array of strings/);
  assert.throws(() => validate({ type: 'object', properties: [] }, {}), /properties must be an object/);
  assert.throws(() => validate({ type: 'object', $comment: 1 }, {}), /\$comment must be a string/);
  assert.throws(() => validate({ type: 'string', $schema: 1 }, 'x'), /\$schema must be a string/);
});

test('every shipped schema passes the strict keyword whitelist walk', () => {
  const directory = join(ROOT, 'src/contracts/schemas');
  const files = readdirSync(directory).filter(name => name.endsWith('.schema.json'));
  assert.ok(files.length >= 4, `expected the shipped schemas, found ${JSON.stringify(files)}`);
  for (const file of files) {
    const schema = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', `${file} declares its dialect`);
    assert.doesNotThrow(() => assertSchema(schema), `${file} must pass assertSchema`);
  }
});

test('exportEnum returns a frozen copy of the schema enum', () => {
  const source = { type: 'string', enum: ['a', 'b'] };
  const values = exportEnum(source);
  assert.deepEqual(values, ['a', 'b']);
  assert.ok(Object.isFrozen(values));
  assert.throws(() => values.push('c'), TypeError);
  assert.deepEqual(source.enum, ['a', 'b']);
  assert.throws(() => exportEnum({ type: 'string' }), /must declare a non-empty enum array/);
});

test('submit request schema accepts the contract example', () => {
  assert.deepEqual(validate(submitSchema, submitRequest()), { ok: true });
  assert.deepEqual(validate(submitSchema, submitRequest({ clientSessionId: 'correlation-1' })), { ok: true });
});

test('submit request schema rejects the documented invalid shapes', () => {
  const cases = [
    ['unknown field', submitRequest({ authority: 'everything' }), 'authority'],
    ['objective too long', submitRequest({ objective: 'x'.repeat(4001) }), 'objective'],
    ['too many criteria', submitRequest({ acceptanceCriteria: Array.from({ length: 21 }, () => 'x') }), 'acceptanceCriteria'],
    ['empty criterion', submitRequest({ acceptanceCriteria: [''] }), 'acceptanceCriteria[0]'],
    ['bad branch', submitRequest({ repository: { path: '/abs/repo', baseRef: 'main', branch: 'task with spaces' } }), 'repository.branch'],
    ['missing authorization field', submitRequest({ authorization: { models: [], tools: [] } }), 'authorization.writablePaths'],
    ['non-integer budget', submitRequest({ limits: { maxAttempts: 2, budgetMs: 1.5, maxOutputBytes: 1_048_576 } }), 'limits.budgetMs'],
  ];
  for (const [name, value, path] of cases) {
    const result = validate(submitSchema, value);
    assert.equal(result.ok, false, name);
    assert.ok(paths(result).includes(path), `${name}: ${JSON.stringify(paths(result))}`);
  }
});

test('worker artifact schema accepts complete evidence and rejects unvalidated fields', () => {
  assert.deepEqual(validate(artifactSchema, workerArtifact()), { ok: true });

  const numericOutcome = workerArtifact();
  numericOutcome.attempts[0].outcome = 42;
  assert.deepEqual(validate(artifactSchema, numericOutcome), {
    ok: false,
    errors: [{ path: 'attempts[0].outcome', message: 'expected string or null, received integer' }],
  });

  const stringExit = workerArtifact();
  stringExit.testRuns[0].exitCode = '0';
  assert.deepEqual(validate(artifactSchema, stringExit), {
    ok: false,
    errors: [{ path: 'testRuns[0].exitCode', message: 'expected integer, received string' }],
  });

  // The runtime tolerates a run reported without a command (test/task-service.test.mjs:53-56);
  // the artifact schema must accept that shape while still requiring the exit code.
  const missingCommand = workerArtifact();
  missingCommand.testRuns = [{ exitCode: 0, outputTail: 'partial', outputTruncated: true }];
  assert.deepEqual(validate(artifactSchema, missingCommand), { ok: true });

  const unknownEvidence = workerArtifact({ evidenceLevel: 'vibes' });
  assert.equal(validate(artifactSchema, unknownEvidence).ok, false);

  const nullDiff = workerArtifact({ diff: null, diffTruncated: true });
  assert.deepEqual(validate(artifactSchema, nullDiff), { ok: true });
});

test('task record schema accepts a persisted record and rejects drift', () => {
  assert.deepEqual(validate(recordSchema, taskRecord()), { ok: true });
  assert.deepEqual(validate(recordSchema, taskRecord({ branch: 'task/head-x' })), { ok: true });
  assert.deepEqual(validate(recordSchema, taskRecord({ branch: null })), { ok: true });

  const cases = [
    ['unknown status', taskRecord({ status: 'paused' }), 'status'],
    ['reverted effects', taskRecord({ cancel: { requestedAt: null, executionStopped: null, effectsReverted: true } }), 'cancel.effectsReverted'],
    ['bad payload hash', taskRecord({ payloadHash: 'nope' }), 'payloadHash'],
    ['block reason missing', taskRecord({ block: { requiresReconciliation: true } }), 'block.reason'],
    ['unknown record field', taskRecord({ replay: true }), 'replay'],
    ['non-string branch', taskRecord({ branch: 7 }), 'branch'],
  ];
  for (const [name, value, path] of cases) {
    const result = validate(recordSchema, value);
    assert.equal(result.ok, false, name);
    assert.ok(paths(result).includes(path), `${name}: ${JSON.stringify(paths(result))}`);
  }
});

test('task record schema matches a record the store actually writes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-contracts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = openTaskStore({ home: dir });
  const { task } = store.createTask({
    clientId: 'opencode-primary',
    idempotencyKey: 'goal-2026-11-02-01',
    payload: submitRequest(),
    now: 1_000,
  });
  assert.deepEqual(validate(recordSchema, store.readTask(task.taskId)), { ok: true });
});

test('task record schema accepts the artifacts updateTask adds', t => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-contracts-artifacts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = openTaskStore({ home: dir });
  const { task } = store.createTask({
    clientId: 'opencode-primary',
    idempotencyKey: 'goal-artifacts',
    payload: submitRequest(),
    now: 1_000,
  });
  // Mirrors test/task-service.test.mjs:255-265, including a test run without a command.
  store.updateTask(task.taskId, draft => {
    draft.status = 'succeeded';
    draft.finishedAt = 1_500;
    draft.startedAt = 1_000;
    draft.attempts.push({ attemptId: 'attempt-1', model: 'mock/a', startedAt: 1_000, finishedAt: 1_500, outcome: 'success' });
    draft.testRuns = [
      { command: 'node --test', exitCode: 0, durationMs: 5, summary: 'ok', outputTail: 'ok' },
      { exitCode: 0, outputTail: 'partial', outputTruncated: true },
    ];
    draft.changedFiles = ['test/example.test.mjs'];
    draft.headCommit = 'abc123def456';
    draft.baseCommit = 'def456abc123';
    draft.diff = 'diff --git a/test/example.test.mjs';
    draft.diffTruncated = true;
  });

  assert.deepEqual(validate(recordSchema, store.readTask(task.taskId)), { ok: true });
});

test('error envelope schema accepts contract errors and rejects unknown codes', () => {
  assert.deepEqual(validate(errorSchema, { error: { code: 'invalid_argument', message: 'objective must be 1..4000 characters' } }), { ok: true });
  assert.deepEqual(validate(errorSchema, { error: { code: 'eventual_consistency', message: 'x' } }), {
    ok: false,
    errors: [{ path: 'error.code', message: `expected one of ${ERROR_CODES.map(code => `"${code}"`).join(', ')}` }],
  });
  assert.equal(validate(errorSchema, { error: { code: 'internal' } }).ok, false);
  assert.equal(validate(errorSchema, { error: { code: 'internal', message: 'x' }, detail: 'y' }).ok, false);
});

// Drift guard: the schema files are the proposed single source of truth, so today's
// runtime literals must equal them exactly. Comparison is set-strict: same entries and
// same length, order-insensitive (sorted on both sides). Order is not part of the
// contract; membership is.
const sorted = values => [...values].sort();
const tasksSource = readFileSync(join(ROOT, 'src/tasks.mjs'), 'utf8');
const sourceLiteral = (pattern, what) => {
  const match = tasksSource.match(pattern);
  assert.ok(match, `${what} literal not found in src/tasks.mjs`);
  return match[1];
};

test('drift: task status enum equals the runtime status literals', () => {
  const schemaStatuses = exportEnum(recordSchema.properties.status);
  assert.deepEqual(sorted(schemaStatuses), sorted(TASK_STATUSES));

  // STATUSES in src/tasks.mjs is module-private and the store is not changed by this
  // RFC, so the literal is read from the source that validateTask uses. Quote-generic
  // matching keeps the guard working if the literal is reformatted.
  const literal = sourceLiteral(/const STATUSES\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/, 'STATUSES');
  const storeStatuses = [...literal.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.equal(storeStatuses.length, TASK_STATUSES.length, 'store status literal moved; update the drift guard');
  assert.deepEqual(sorted(storeStatuses), sorted(schemaStatuses));
});

test('drift: schemaVersion enum equals the runtime schema version', () => {
  // service.mjs exports SCHEMA_VERSION; tasks.mjs keeps its copy private, so that
  // literal is read from source. Both must agree with the schema's singleton enum.
  const sourceVersion = Number(sourceLiteral(/const SCHEMA_VERSION\s*=\s*(\d+)\s*;/, 'SCHEMA_VERSION'));
  assert.ok(Number.isInteger(sourceVersion), 'SCHEMA_VERSION literal is not an integer');
  assert.equal(sourceVersion, SCHEMA_VERSION);
  assert.deepEqual(exportEnum(recordSchema.properties.schemaVersion), [SCHEMA_VERSION]);
});

test('drift: evidence level enum equals EVIDENCE_LEVELS', () => {
  const schemaLevels = exportEnum(artifactSchema.properties.evidenceLevel);
  assert.deepEqual(sorted(schemaLevels), sorted(EVIDENCE_LEVELS));
});

test('drift: error code enum equals ERROR_CODES', () => {
  const schemaCodes = exportEnum(errorSchema.properties.error.properties.code);
  assert.deepEqual(sorted(schemaCodes), sorted(ERROR_CODES));
});

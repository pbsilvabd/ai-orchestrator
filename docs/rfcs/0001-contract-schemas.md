# RFC-0001: Declarative contract schemas and a dependency-free checker

Date: 2026-11-02. Status: Proposed.

Follow-up (unmerged, ships in the sibling PR): docs/rfcs/0002-lifecycle-state-machine.md

## Status

Proposed. This RFC ships a skeleton only: schemas under `src/contracts/schemas/`, a
checker in `src/contracts/validate.mjs` and tests in `test/contracts.test.mjs`. Nothing
in `src/service.mjs` or `src/tasks.mjs` consumes them yet, so behaviour is unchanged.

RFC-0002 (`docs/rfcs/0002-lifecycle-state-machine.md`, lifecycle state machines) builds
on this document: it keeps lifecycle legality out of the schema subset and models
transitions with a status-keyed dispatch table. It does **not** add combinators to the
checker.

## Context

The task contract is normative in [docs/task-contract.md](../task-contract.md), but it
is implemented as hand-rolled imperative checks spread over two modules. The same
facts are written down three times and validated in two different styles.

1. **Duplicated enums.** The six task statuses exist as a private `Set` in
   `src/tasks.mjs:18`, as an exported array in `src/service.mjs:16`, and in prose in
   `docs/task-contract.md:101` and the lifecycle diagram at
   `docs/task-contract.md:179-188`. Evidence levels
   (`src/service.mjs:20`) and error codes (`src/service.mjs:21-22`,
   `docs/task-contract.md:163-173`) repeat the same pattern. Nothing fails when one
   copy changes and the others do not.
2. **Deep artifacts are unvalidated at persistence.** `validateTask`
   (`src/tasks.mjs:348-409`) checks the attempt identity, model and timestamps
   (`src/tasks.mjs:366-378`) but never `attempt.outcome`, `testRuns`, `diff`,
   `changedFiles` or `limitations`. Those fields are produced by the executor adapter
   and read back by `getTaskResult` (`src/service.mjs:192-263`), where they are only
   coerced by optional chaining and `Array.isArray` guards. A malformed artifact is
   persisted as-is and surfaces later as a broken response.
3. **Responses are hand-constructed and never schema-checked.** `getTaskStatus`
   (`src/service.mjs:151-176`), `getTaskResult` (`src/service.mjs:240-263`),
   `submitTask` (`src/service.mjs:139-145`) and `cancelTask`
   (`src/service.mjs:273-296`) build objects field by field. Unknown or missing fields
   are caught only if a test happens to assert them.
4. **Imperative checking everywhere.** `validateSubmitRequest`
   (`src/service.mjs:302-392`) is 90 lines of sequential `fail()` calls, backed by
   `hasExactKeys` (`src/service.mjs:72-80`) and `validateOperationInput`
   (`src/service.mjs:394-398`). The rules are correct, but reviewers must re-derive
   the contract from control flow, and a client cannot discover the shape without
   reading the implementation. The only existing JSON Schema in the repository is the
   MCP fixture tool `inputSchema` (`integration/mcp-fixture.mjs:37-48`), which shows
   the shape the real operations will need later.

The cost is drift, not crashes: the code is right today, and the wording that future
changes are measured against lives in three unrelated places.

## Decision

Adopt a **curated JSON Schema subset** as the single declarative source of truth for
contract shapes, with a **dependency-free checker** in `src/contracts/`.

- `src/contracts/validate.mjs` exports `assertSchema(schema)`,
  `validate(schema, value)` and `exportEnum(schema)`. It has no imports at all; the
  project declares no runtime dependencies and requires no `npm install` (`AGENTS.md`,
  Root rules and [ADR-007](../adr/007-task-contract.md), which forbids a third-party
  runtime dependency for the contract/service layer).
- `src/contracts/schemas/*.schema.json` hold the shapes: `task-submit-request`,
  `worker-artifact`, `task-record` and `error-envelope`. Each file declares its dialect
  with `$schema` so it stays a valid JSON Schema document that editors can assist, and
  carries a `meta` block (`title`, `source`) recording the `file:line` it was derived
  from; the checker treats `$schema` and `meta` as annotations, exactly like
  `description`.
- `test/contracts.test.mjs` is the immediate guard: it exercises every supported
  keyword and asserts the enums in the schemas equal the runtime literals
  (`TASK_STATUSES`, the `STATUSES` and `SCHEMA_VERSION` literals in `src/tasks.mjs`,
  `EVIDENCE_LEVELS`, `ERROR_CODES`) as sorted, order-insensitive sets with equal
  length. A second test reads the schema directory and runs `assertSchema` over every
  file, so a typo in any shipped schema fails the suite.

**Format ruling.** Schemas are `.schema.json`, not `.schema.yaml`. Node has no
standard-library YAML parser, and the project may not add a dependency for this;
JSON is a valid YAML subset, so the files stay readable and editable with any YAML
tooling while `JSON.parse` reads them without a dependency. YAML would only win on
comments and multi-line strings, and neither is needed by the shapes we derive.

The subset is deliberately small so the checker stays auditable in one file. Every
schema node is walked strictly before validation: an unknown keyword, a missing
`type` or a malformed keyword value is a hard error, so a typo such as `minlength`
cannot fail open.

## Supported subset

`validate()` enforces exactly these keywords, and `assertSchema()` rejects everything
else, so the whitelist is closed rather than open to unknown annotations.

| Keyword | Support |
| --- | --- |
| `type` | `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`, or an array of those names for nullable fields (`["string", "null"]`) |
| `properties` | per-key subschemas |
| `required` | missing property names are reported at the property path |
| `additionalProperties` | only `false` is enforced (strict key check); `true` or a schema is rejected as unsupported |
| `enum` | primitive entries compared with `Object.is` |
| `pattern` | ECMAScript source applied as an unanchored search, like JSON Schema; an invalid regex throws. The shipped patterns spell out `^...$` wherever they must be anchored |
| `minLength` / `maxLength` | string length in UTF-16 code units (JavaScript `.length`) |
| `minItems` / `maxItems` | array length |
| `items` | one subschema applied to every element |
| `description` | annotation, ignored |
| `meta` | project convention: `{ title, source }` annotation at the schema root, ignored |
| `$comment` | annotation, ignored; schema files use it for provenance notes tools may strip |
| `$schema` | dialect declaration, ignored; accepted so the files remain valid JSON Schema documents and editors offer intellisense |

Behaviour rules:

- `validate(schema, value)` returns `{ ok: true }` or
  `{ ok: false, errors: [{ path, message }] }`. It collects **all** errors depth first:
  declaration order for required and property checks, instance order for unknown keys.
  The same input always produces deep-equal errors.
- Paths are relative and dot/bracket joined (`repository.baseRef`,
  `acceptanceCriteria[2]`, `attempts[0].outcome`). The root path is the empty string.
- Messages never echo instance strings. Only schema-side values (enum entries,
  patterns) and type names appear. Instance previews are cut to 32 UTF-16 code units;
  objects and arrays are named by type and never serialized. Unknown property names
  never appear in diagnostic paths: each is represented by the fixed `<unknown>` path
  segment, while paths for known schema properties remain intact.
- `assertSchema(schema)` walks the whole schema and throws `TypeError` on an unknown
  keyword, a missing or malformed `type`, or a malformed keyword value. `validate()`
  and `exportEnum()` both run it first: fail-closed, and cheap because schema nodes are
  small.
- `exportEnum(schemaNode)` returns a frozen copy of a node's `enum` (the caller names
  the node, so no guessing which nested enum is meant).

Deliberately **not** implemented: `oneOf`/`anyOf`/`allOf`, `if`/`then`/`else`,
`$ref`/`definitions`, `const`, `minimum`/`maximum`/`exclusiveMinimum`, `format`,
`patternProperties`, `dependencies`, `dependentRequired`. RFC-0002 review declined
combinators: lifecycle legality is modelled in a status-keyed dispatch table instead.
Numeric bounds were declined for the same reason and stay imperative (see Open
questions 2).

**Producer contract, not a result envelope.** `worker-artifact` describes the record
fields the future executor adapter must write before `getTaskResult` reads them; it is
not a `get_task_result` envelope (no `taskId`, `status`, `schemaVersion` or `sanitized`
flag). It is stricter than the runtime on three points: unknown keys are rejected,
`testRuns[].exitCode` is required evidence, and `attempts[].outcome` must be a non-empty
string when present. `testRuns[].command` stays optional because the runtime tolerates
a run reported without one (`src/service.mjs:192-199`,
`test/task-service.test.mjs:53-56`) and reports that as a limitation. `task-record` is
stricter than `validateTask` at three points: unknown keys rejected, `taskId` checked
against the runtime identifier pattern (UUIDv4 remains a submit-time rule), and
`attempts[].outcome` non-empty when present. It also permits an optional `branch`
string, which `src/service.mjs:207` reads from the record and no runtime writer sets
today.

## Few-shots

Each pair shows the input and the actual `validate()` output produced on this branch.

**Valid submit request** (`task-submit-request.schema.json`):

```js
const request = {
  idempotencyKey: 'goal-2026-11-02-01',
  clientId: 'opencode-primary',
  objective: 'Add a regression test for the retry budget',
  acceptanceCriteria: ['node --test passes'],
  repository: { path: '/abs/repo', baseRef: 'main', branch: 'task/retry-budget' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src/**'] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
};
validate(submitSchema, request);
// { ok: true }
```

**Invalid submit request** — number criterion, branch with spaces and a fractional
budget:

```js
const invalidRequest = {
  idempotencyKey: 'goal-2026-11-02-01',
  clientId: 'opencode-primary',
  objective: 'Add a regression test for the retry budget',
  acceptanceCriteria: ['node --test passes', 'demo still works', 3],
  repository: { path: '/abs/repo', baseRef: 'main', branch: 'task with spaces' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src/**'] },
  limits: { maxAttempts: 2, budgetMs: 0.5, maxOutputBytes: 1_048_576 },
};
validate(submitSchema, invalidRequest);
// {
//   ok: false,
//   errors: [
//     { path: 'acceptanceCriteria[2]', message: 'expected string, received integer' },
//     { path: 'repository.branch', message: 'must match /^[A-Za-z0-9._/-]{1,128}$/' },
//     { path: 'limits.budgetMs', message: 'expected integer, received number' }
//   ]
// }
```

**Valid worker artifact** (`worker-artifact.schema.json`) — the producer contract for
the future executor adapter:

```js
const artifact = {
  attempts: [{ attemptId: 'attempt-1', model: 'mock/a', startedAt: 1_000, finishedAt: 2_000, outcome: 'succeeded' }],
  testRuns: [{ command: 'node --test', exitCode: 0, durationMs: 1_200, summary: '83 passed', outputTail: 'ok', outputTruncated: false }],
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
};
validate(artifactSchema, artifact);
// { ok: true }
```

A run reported without a command is still valid (the runtime turns it into a
limitation): `{ testRuns: [{ exitCode: 0, outputTail: 'partial', outputTruncated: true }] }`
passes once the other required fields are present.

**Invalid worker artifact** — numeric outcome and an unknown evidence level:

```js
const invalidArtifact = {
  ...artifact,
  attempts: [{ ...artifact.attempts[0], outcome: 42 }],
  evidenceLevel: 'vibes',
};
validate(artifactSchema, invalidArtifact);
// {
//   ok: false,
//   errors: [
//     { path: 'attempts[0].outcome', message: 'expected string or null, received integer' },
//     { path: 'evidenceLevel', message: 'expected one of "unit", "local-http", "opencode-integration", "use-on-project"' }
//   ]
// }
```

**Valid task record** (`task-record.schema.json`) — the shape `createTask` writes
(`src/tasks.mjs:192-208`); the suite also validates a record produced by a real store in
a temporary directory, before and after `updateTask` adds artifacts:

```js
const record = {
  schemaVersion: 1,
  taskId: '9a1f0c4e-3b7d-4a52-9f1e-2c8d5b6a7e90',
  clientId: 'opencode-primary',
  idempotencyKey: 'goal-2026-11-02-01',
  payloadHash: 'a'.repeat(64),
  request,
  status: 'queued',
  createdAt: 1_000,
  acceptedAt: 1_000,
  startedAt: null,
  finishedAt: null,
  attempts: [],
  cancel: { requestedAt: null, executionStopped: null, effectsReverted: false },
  block: null,
  progress: [{ at: 1_000, event: 'accepted', detail: null }],
};
validate(recordSchema, record);
// { ok: true }
```

**Invalid task record** — status outside the enum and reversible effects:

```js
const invalidRecord = {
  ...record,
  status: 'paused',
  cancel: { ...record.cancel, effectsReverted: true },
};
validate(recordSchema, invalidRecord);
// {
//   ok: false,
//   errors: [
//     { path: 'status', message: 'expected one of "queued", "running", "succeeded", "failed", "blocked", "cancelled"' },
//     { path: 'cancel.effectsReverted', message: 'expected one of false' }
//   ]
// }
```

## Adoption path

Three minimal, separately revertible PRs. Only step 1 is in this RFC.

1. **Shadow (this PR).** Add the schemas, the checker and the drift test. No runtime
   import. Reviewers can diff the schema against `validateSubmitRequest` and against
   `validateTask` without risking behaviour.
2. **Wire the `submit_task` boundary.** Replace the structural checks in
   `validateSubmitRequest` (`src/service.mjs:302-392`) with `validate(submitSchema,
   request)`, mapping `errors[]` to `invalid_argument` with sanitized messages.
   Configuration-relative rules stay imperative: `clientId` equality, allowlist
   membership, writable-root containment, budget ceilings and positivity. The result
   must keep `hasExactKeys` behaviour (unknown keys rejected) and the existing error
   codes; `node --test` plus `examples/fallback-demo.mjs` guard the change.
3. **Derive duplicated literals.** Replace `TASK_STATUSES`, `EVIDENCE_LEVELS`,
   `ERROR_CODES` and `SCHEMA_VERSION` with `exportEnum(...)` of the schema nodes, and
   make the private `STATUSES` set in `src/tasks.mjs:18` be built from the schema. At
   that point the drift test can compare runtime to schema trivially; it stays as the
   guard against a future hand-edit.

The `worker-artifact` and `task-record` schemas join step 2 as soon as the executor
adapter exists: validate the artifact before persisting it, validate the record inside
`validateTask`.

## Non-goals

- Status transitions, lifecycle legality and conditional rules (allowed transitions,
  `blocked` requiring reconciliation, `cancel` effects). RFC-0002 covers these with a
  status-keyed dispatch table; combinators are declined, not deferred.
- Any third-party dependency, runtime or dev. No `ajv`, no `jsonschema`, no YAML
  parser, no test-only schema library.
- Changing the npm-install-free rule: `npm install` must stay unnecessary.
- Full JSON Schema conformance, `$ref` reuse, generated TypeScript types, or a schema
  registry server.
- Any change to `docs/task-contract.md` or an ADR; those are amended deliberately in
  their own review.

## Later reuse

- The four MCP operations can publish these files as their `inputSchema`, following the
  fixture precedent at `integration/mcp-fixture.mjs:37-48`. That gives clients the
  contract without reading `validateSubmitRequest`.
- One checker path for envelope validation: `error-envelope.schema.json` already
  mirrors `errorEnvelope` (`src/service.mjs:63-66`).
- `exportEnum()` becomes the generator for runtime constants in adoption step 3, so the
  same enum is the wire contract, the validation rule and the code literal.

## Open questions

1. **YAML vs JSON for the schema files.** Recommendation: keep `.schema.json`. Node has
   no standard-library YAML parser, so YAML would force a dependency or a hand-written
   parser; JSON is valid YAML and stays editable in YAML tooling. Commenters who want
   YAML need to say what compensates for the dependency rule.
2. **Numeric bounds — declined.** `limits.maxAttempts`/`budgetMs`/`maxOutputBytes` and
   timestamp non-negativity cannot be expressed without `minimum`. RFC-0002 review
   declined adding numeric keywords, so these bounds stay imperative and the subset
   stays structural. Closed unless a later RFC reopens it with a concrete need.
3. **Strictness of `task-record`.** The schema rejects unknown top-level fields and
   requires a non-empty `attempts[].outcome` when present, while `validateTask` today
   ignores both. If adoption would break a persisted record from an older build, the
   schema should relax to a warning contract instead.
4. **Where evidence levels live.** They are in `worker-artifact` because that is where
   the runtime uses them; a future `get_task_result` response schema may need the same
   enum in two places, which the subset cannot express without `$ref`.
5. **Worker-artifact strictness.** The prospective producer contract requires
   `testRuns[].exitCode` while `getTaskResult` today accepts a run without one and
   downgrades it to a limitation. Should adoption tighten the result path too, or keep
   the runtime tolerant and let only the adapter be strict?

## References

- [docs/task-contract.md](../task-contract.md) — normative contract.
- [ADR-007: task contract](../adr/007-task-contract.md) — transport, trust boundary, no
  third-party runtime dependency.
- [ADR-008: task store](../adr/008-task-store.md) — record persistence and startup
  reconciliation.
- [AGENTS.md](../../AGENTS.md) — toolchain rules, documentation duties, no
  `npm install`.
- `src/contracts/validate.mjs`, `src/contracts/schemas/`, `test/contracts.test.mjs`.

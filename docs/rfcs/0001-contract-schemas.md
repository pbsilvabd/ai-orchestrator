# RFC-0001: Declarative contract schemas and a dependency-free checker

Date: 2026-11-02. Status: Proposed.

Referenced-by: docs/rfcs/0002-lifecycle-state-machine.md (follow-up)

## Status

Proposed. This RFC ships a skeleton only: schemas under `src/contracts/schemas/`, a
checker in `src/contracts/validate.mjs` and tests in `test/contracts.test.mjs`. Nothing
in `src/service.mjs` or `src/tasks.mjs` consumes them yet, so behaviour is unchanged.

RFC-0002 (lifecycle state machines and conditional rules) will build on this document
and is expected to widen the checker with combinators. The exact follow-up path is
listed as a placeholder above so the two proposals stay linked.

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

- `src/contracts/validate.mjs` exports `validate(schema, value)` and
  `exportEnum(schema)`. It has no imports at all; the project keeps
  `"dependencies": {}` and requires no `npm install` (`AGENTS.md`, Root rules and
  [ADR-007](../adr/007-task-contract.md), which forbids a third-party runtime
  dependency for the contract/service layer).
- `src/contracts/schemas/*.schema.json` hold the shapes: `task-submit-request`,
  `worker-artifact`, `task-record` and `error-envelope`. Each file carries a `meta`
  block (`title`, `source`) recording the `file:line` it was derived from; the checker
  treats `meta` as an annotation, exactly like `description`.
- `test/contracts.test.mjs` is the immediate guard: it exercises every supported
  keyword and asserts the enums in the schemas equal the runtime literals
  (`TASK_STATUSES`, the `STATUSES` literal in `src/tasks.mjs`, `EVIDENCE_LEVELS`,
  `ERROR_CODES`) as sorted, order-insensitive sets with equal length.

**Format ruling.** Schemas are `.schema.json`, not `.schema.yaml`. Node has no
standard-library YAML parser, and the project may not add a dependency for this;
JSON is a valid YAML subset, so the files stay readable and editable with any YAML
tooling while `JSON.parse` reads them without a dependency. YAML would only win on
comments and multi-line strings, and neither is needed by the shapes we derive.

The subset is deliberately small so the checker stays auditable in one file. It is
also the reason RFC-0002 exists: conditional state transitions need keywords this RFC
refuses to half-implement.

## Supported subset

`validate()` enforces exactly these keywords. Anything else in a schema file is an
annotation and is ignored, never silently enforced.

| Keyword | Support |
| --- | --- |
| `type` | `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`, or an array of those names for nullable fields (`["string", "null"]`) |
| `properties` | per-key subschemas |
| `required` | missing property names are reported at the property path |
| `additionalProperties` | only `false` is enforced (strict key check); `true` or a schema is rejected as unsupported |
| `enum` | primitive entries compared with `Object.is` |
| `pattern` | ECMAScript source; an invalid regex throws |
| `minLength` / `maxLength` | string length in UTF-16 code units (JavaScript `.length`) |
| `minItems` / `maxItems` | array length |
| `items` | one subschema applied to every element |
| `description` | annotation, ignored |
| `meta` | project convention: `{ title, source }` annotation at the schema root, ignored |

Behaviour rules:

- `validate(schema, value)` returns `{ ok: true }` or
  `{ ok: false, errors: [{ path, message }] }`. It collects **all** errors, depth first
  in declaration order, so the same input always produces deep-equal errors.
- Paths are relative and dot/bracket joined (`repository.baseRef`,
  `acceptanceCriteria[2]`, `attempts[0].outcome`). The root path is the empty string.
- Messages never echo full instance values. Strings are previewed to 32 characters
  with an ellipsis, object and array previews are type names only, and unknown-key
  paths are truncated the same way. Enum messages list only schema-side values.
- A malformed schema node that the checker reaches throws `TypeError`; it is never
  treated as permissive.
- `exportEnum(schemaNode)` returns a frozen copy of a node's `enum` (the caller names
  the node, so no guessing which nested enum is meant).

Deliberately **not** implemented: `oneOf`/`anyOf`/`allOf`, `if`/`then`/`else`,
`$ref`/`definitions`, `const`, `minimum`/`maximum`/`exclusiveMinimum`, `format`,
`patternProperties`, `dependencies`, `dependentRequired`. Combinators and conditional
schemas are RFC-0002 territory; numeric bounds stay imperative for now (see Open
questions).

## Few-shots

Outputs below are actual `validate()` output from this branch.

**Valid submit request** (`task-submit-request.schema.json`):

```js
validate(submitSchema, {
  idempotencyKey: 'goal-2026-11-02-01',
  clientId: 'opencode-primary',
  objective: 'Add a regression test for the retry budget',
  acceptanceCriteria: ['node --test passes'],
  repository: { path: '/abs/repo', baseRef: 'main', branch: 'task/retry-budget' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src/**'] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
});
// { ok: true }
```

**Invalid submit request** — third criterion is a number and the branch contains
spaces:

```js
validate(submitSchema, {
  /* same as above */
  acceptanceCriteria: ['node --test passes', 'demo still works', 3],
  repository: { path: '/abs/repo', baseRef: 'main', branch: 'task with spaces' },
  limits: { maxAttempts: 2, budgetMs: 0.5, maxOutputBytes: 1_048_576 },
});
// {
//   ok: false,
//   errors: [
//     { path: 'acceptanceCriteria[2]', message: 'expected string, received integer' },
//     { path: 'repository.branch', message: 'must match /^[A-Za-z0-9._/-]{1,128}$/' },
//     { path: 'limits.budgetMs', message: 'expected integer, received number' }
//   ]
// }
```

**Valid worker artifact** (`worker-artifact.schema.json`) — the fields that today are
persisted unvalidated:

```js
validate(artifactSchema, {
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
});
// { ok: true }
```

**Invalid worker artifact** — numeric outcome and an unknown evidence level:

```js
// {
//   ok: false,
//   errors: [
//     { path: 'attempts[0].outcome', message: 'expected string or null, received integer' },
//     { path: 'evidenceLevel', message: 'expected one of "unit", "local-http", "opencode-integration", "use-on-project"' }
//   ]
// }
```

**Valid task record** (`task-record.schema.json`) is the record `createTask` writes
(`src/tasks.mjs:192-208`); the test suite validates a record produced by a real store
in a temporary directory:

```js
// { ok: true }
```

**Invalid task record** — status outside the enum and reversible effects:

```js
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
3. **Derive duplicated literals.** Replace `TASK_STATUSES`, `EVIDENCE_LEVELS` and
   `ERROR_CODES` with `exportEnum(...)` of the schema nodes, and make the private
   `STATUSES` set in `src/tasks.mjs:18` be built from the schema. At that point the
   drift test can compare runtime to schema trivially; it stays as the guard against
   a future hand-edit.

The `worker-artifact` and `task-record` schemas join step 2 as soon as the executor
adapter exists: validate the artifact before persisting it, validate the record inside
`validateTask`.

## Non-goals

- Status transitions, lifecycle legality and conditional rules (allowed transitions,
  `blocked` requiring reconciliation, `cancel` effects). Those need `if`/`then` or
  combinators and belong to RFC-0002.
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
2. **Numeric bounds.** `limits.maxAttempts`/`budgetMs`/`maxOutputBytes` and timestamp
   non-negativity cannot be expressed without `minimum`, so they remain imperative.
   Should the subset gain `minimum`/`maximum` in RFC-0002, or stay structural forever?
3. **Strictness of `task-record`.** The schema rejects unknown top-level fields while
   `validateTask` today ignores them. If adoption would break a persisted record from
   an older build, the schema should relax to a warning contract instead.
4. **Where evidence levels live.** They are in `worker-artifact` because that is where
   the runtime uses them; a future `get_task_result` response schema may need the same
   enum in two places, which the subset cannot express without `$ref`.

## References

- [docs/task-contract.md](../task-contract.md) — normative contract.
- [ADR-007: task contract](../adr/007-task-contract.md) — transport, trust boundary, no
  third-party runtime dependency.
- [ADR-008: task store](../adr/008-task-store.md) — record persistence and startup
  reconciliation.
- [AGENTS.md](../../AGENTS.md) — toolchain rules, documentation duties, no
  `npm install`.
- `src/contracts/validate.mjs`, `src/contracts/schemas/`, `test/contracts.test.mjs`.

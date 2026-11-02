# RFC-0002: Declarative lifecycle state machine and transition table

Date: 2026-11-02. Status: Proposed.

Depends on: [RFC-0001](0001-contract-schemas.md) (contract schemas and the
dependency-free checker; shipped in the sibling PR, so that file is not on this
branch). This RFC is documentation only: no schema file, no source change, no test.

## Status

Proposed. This document specifies one transition table and one small checker entry
point; nothing here is implemented. It builds on RFC-0001, which deliberately left
status transitions and lifecycle legality to this follow-up and whose Status section, as
corrected in review on the sibling branch, already records that they are modelled as a
status-keyed dispatch table rather than as combinators.

RFC-0002 must not be applied before RFC-0001 adoption step 2 (the `submit_task`
boundary wiring). Until then there is no schema-driven validation path to attach a
transition guard to, and this proposal would add a second validation style next to the
imperative one.

## Context

The lifecycle is normative prose, and the rules that enforce it are scattered.

1. **The transitions exist only as ASCII.** The authoritative statement is the diagram
   at [task-contract.md:179-192](../task-contract.md) plus the cancellation rules at
   [task-contract.md:154-159](../task-contract.md) and the restart rule at
   [task-contract.md:202-204](../task-contract.md). Nothing parses it, so a code path
   can implement a transition the document does not describe and nothing fails.
2. **The store accepts any status change `validateTask` allows.**
   `updateTask` (`src/tasks.mjs:235-244`) clones the record, runs the caller's `mutate`,
   then calls `validateTask`, which only checks that `status` is a member of the
   `STATUSES` set (`src/tasks.mjs:358`, set at `src/tasks.mjs:18`). A caller can move
   `queued` straight to `succeeded` and the store persists it; there is no notion of a
   legal edge anywhere in the module.
3. **Transition rules are applied ad hoc by callers.** `cancelTask`
   (`src/service.mjs:266-297`) decides terminality with `RESULT_STATUSES`
   (`src/service.mjs:272-274`), cancels a `queued` task inline
   (`src/service.mjs:275-285`) and blocks everything else as `cancelled-uncertain`
   (`src/service.mjs:287-296`). `reconcile` (`src/tasks.mjs:249-304`) blocks a
   `running` task and a `queued` task that already dispatched an attempt
   (`src/tasks.mjs:278-289`). Both encode lifecycle knowledge; neither shares it with
   the other, and neither shares it with the diagram.
4. **The read side duplicates the same knowledge again.** `get_task_status` decides
   `resultAvailable` and the `block` section from the status
   (`src/service.mjs:171-176`), and `get_task_result` re-checks terminality
   (`src/service.mjs:190`). Two modules, five places, one prose diagram.
5. **The diagram is already narrower than the code.** `reconcile` blocks a `queued`
   task that has an attempt (`src/tasks.mjs:279`), which the lifecycle block at
   `docs/task-contract.md:179-192` does not draw — the ASCII fence ends at `:188` —
   relying on prose at `docs/task-contract.md:203-204` instead. And the diagram's
   `running --cancel (proven stop, no effects)--> cancelled` has no implementation:
   `cancelTask` unconditionally blocks a running task
   (`src/service.mjs:288-296`). Both are recorded below as open questions, not fixed
   here.

The cost is the same as in RFC-0001: the code is defensible today, but the rule that
future changes are measured against exists only in a code fence that no test reads.

## Decision

Move the state machine into **data**: one transition table that owns the legal
`(from, to)` pairs for one record, and one guard that evaluates the table whenever a
persisted record changes `status`.

- **The table is the source of truth for edges**, not for the rest of the record shape.
  It lists, for each current status, the statuses it may become. Every row cites its
  evidence below, so review can diff the table against the contract instead of
  re-deriving it from control flow.
- **One evaluation point.** The guard runs in the store, at the mutation boundary:
  before `writeTask` is called, compare the record's previous `status` with the next
  one and reject the edge when the table forbids it. The mutation is rejected, not
  coerced, and the persisted record is untouched.
- **Three write sites, one guard.** `createTask` (`src/tasks.mjs:212`) establishes the
  initial state and is not a transition; `updateTask` (`src/tasks.mjs:242`) and
  `reconcile` (`src/tasks.mjs:287`) both persist a status change. The proposal is one
  `assertTransition(previous, next)` used by the latter two, not a rule inside
  `updateTask`'s callback, because a callback is caller-supplied
  (`src/tasks.mjs:238-239`) and can replace the whole draft.
- **No self-transitions required.** The guard only evaluates when `status` changes.
  Idempotent cancel returns `already_terminal` without writing (`src/service.mjs:272-274`),
  and reconcile skips tasks whose status it does not rewrite (`src/tasks.mjs:279`), so
  no legal flow depends on `X → X`.
- **Violations are internal errors, not client errors.** A rejected edge means service
  code attempted something the contract does not allow; the guard reports
  `TaskStoreError('internal', 'illegal task status transition')`. Reusing
  `invalid_argument` was rejected: it would attribute a service-side bug to the client,
  and the contract's error table (`docs/task-contract.md:163-173`) gains no new code.

### The transition table

Derived from the lifecycle block (`docs/task-contract.md:179-192`), the cancellation rules
(`docs/task-contract.md:154-159`), the restart rule
(`docs/task-contract.md:202-204`) and the code that implements them today.

| # | From | To | Event | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `queued` | `running` | start | diagram `task-contract.md:180`; no code path yet (executor adapter pending) |
| 2 | `queued` | `cancelled` | cancel before start | diagram `:181`; contract `:155`; `src/service.mjs:275-285` |
| 3 | `queued` | `blocked` | restart, attempt already dispatched | contract `:203-204`; `src/tasks.mjs:279-289`; **not in the diagram** |
| 4 | `running` | `succeeded` | success | diagram `:180`; no code path yet |
| 5 | `running` | `failed` | safe failure | diagram `:182`; no code path yet |
| 6 | `running` | `blocked` | uncertain failure | diagram `:183`; no code path yet |
| 7 | `running` | `cancelled` | cancel, proven stop, no effects | diagram `:184`; contract `:156-157`; **not implemented** — `src/service.mjs:288-296` always blocks |
| 8 | `running` | `blocked` | cancel, unproven stop | diagram `:185`; contract `:158`; `src/service.mjs:287-296` |
| 9 | `running` | `blocked` | service restart | diagram `:186`; contract `:202`; `src/tasks.mjs:279-289` |
| 10 | `blocked` | `failed` | maintainer reconciliation | diagram `:187`; contract `:190-192`; no code path yet |
| 11 | `blocked` | `cancelled` | maintainer reconciliation | diagram `:187`; contract `:190-192`; no code path yet |

`succeeded`, `failed` and `cancelled` have no outgoing edges: the ASCII fence
(`docs/task-contract.md:179-188`) draws none for them, and "a terminal task returns
`already_terminal` and is never reopened" (`docs/task-contract.md:159`). `blocked` is
terminal in one direction and not the other: `RESULT_STATUSES` already treats it as
terminal "until a human reconciles it" (`src/service.mjs:17-19`), which is why
`cancel_task` answers `already_terminal` for it without writing
(`src/service.mjs:272-274`), while rows 10 and 11 are the *maintainer* path that
`docs/task-contract.md:187` allows and `docs/task-contract.md:190` keeps manual ("no
automatic transitions out of `blocked`") — no operation implements it. The store's
`TERMINAL` set (`src/tasks.mjs:19`) matches the three hard terminal states and leaves
`blocked` out, which is what the contract wants for pruning: `blocked` records are never
deleted automatically (`docs/task-contract.md:205-206`).

This table changes no behaviour: every row is either already reachable or already
documented, and rows that no code performs stay unreachable until their producer
exists.

## Few-shot

### Proposed file shape

Proposed path `src/contracts/transitions/task-status-transitions.yml`, written below as
YAML because a table with comments reads better in review. **Format ruling follows
RFC-0001**: the shipped file is `task-status-transitions.json` with identical content,
because the project has no standard-library YAML parser and may not add a dependency
(RFC-0001, "Format ruling"; `AGENTS.md`). JSON is a valid YAML subset, so this shape
stays readable in any YAML tooling.

```yaml
# PROPOSED — not created by this RFC.
meta:
  title: task status transitions
  source: docs/task-contract.md:179-192
values:
  queued:    { type: string, enum: [running, cancelled, blocked] }      # rows 1-3
  running:   { type: string, enum: [succeeded, failed, blocked, cancelled] }  # rows 4-9
  succeeded: { type: string, enum: [] }                                 # terminal
  failed:    { type: string, enum: [] }                                 # terminal
  blocked:   { type: string, enum: [failed, cancelled] }                # rows 10-11
  cancelled: { type: string, enum: [] }                                 # terminal
```

Each `values` entry is an ordinary RFC-0001 schema node, so the enum formatting,
primitive comparison with `Object.is` and 32-character previewing are reused unchanged.
Every row declares `type: "string"` because RFC-0001's schema walk requires an explicit
type on every node (`assertSchema` on the sibling branch); without it, delegating the row
would throw before it could report the transition.
An empty enum means "no successor"; it is the one place where RFC-0001's non-empty
`enum` rule is relaxed, and only inside `validateTransition` (see below).

### Worked example

Proposed output — not executed on this branch (RFC-0001's identically-titled section
reports real output from its own branch; these three are the shape this RFC asks for).

```js
// transitions = parsed task-status-transitions.json
validateTransition(transitions, 'queued', 'succeeded');
// {
//   ok: false,
//   errors: [
//     {
//       path: 'status',
//       message: 'transition is not allowed (expected one of "running", "cancelled", "blocked")'
//     }
//   ]
// }

validateTransition(transitions, 'queued', 'cancelled');
// { ok: true }

validateTransition(transitions, 'succeeded', 'running');
// {
//   ok: false,
//   errors: [
//     { path: 'status', message: 'transition is not allowed (no successor declared)' }
//   ]
// }
```

Messages keep RFC-0001's rule that instance values are never echoed: the allowed list
comes from the schema side, the current status is not quoted, and the path is the field
that would change (`status`). Reusing the table entry directly with
`validate(table.values.queued, nextStatus)` would report the stock enum message at the
empty path; `validateTransition` exists to wrap that into the pinned error above, so the
rule is named, the failure is attributed to `status`, the terminal row stays
distinguishable, and an empty enum cannot satisfy the check.

## Checker extension required

RFC-0001's checker walks every schema against a closed keyword whitelist
(`assertSchema`, on the sibling branch): an unknown keyword such as `if` or `then` throws,
it is not treated as an annotation. Lifecycle rules therefore cannot be smuggled into a
schema file, and supporting them there would mean widening the shared keyword set. This
RFC adds no keyword; it adds one entry point whose table rows are ordinary subset nodes.

**Divergence from RFC-0001's earlier forward references, resolved.** RFC-0001's Status
section, paragraph 2, as corrected in review, states that RFC-0002 "does not add
combinators to the checker"; the pre-review draft of that document had expected RFC-0002
to widen the checker with combinators, and its open-question 2 had asked whether
`minimum`/`maximum` join the subset. This RFC declines both, and says why:

- **Combinators: declined.** A status-keyed dispatch table replaces `oneOf`/`if`/`then`.
  Each call selects exactly one row and validates one value, so there is no branch
  ordering, no backtracking and no new keyword in the shared subset.
- **Numeric bounds: declined.** `limits.maxAttempts`/`budgetMs`/`maxOutputBytes` and
  timestamp non-negativity stay imperative. They are request-shape and configuration
  concerns, not lifecycle edges, and `src/contracts/` gains no numeric keyword.

RFC-0001's Status section and its numeric-bounds open question were corrected to match
in the sibling PR (`f7c8db7` there). The two documents agree; this RFC supplies the
reasoning review asked for.

Required from `src/contracts/validate.mjs`, in the same dependency-free file:

1. `export function validateTransition(table, from, to)` returning
   `{ ok: true }` or `{ ok: false, errors: [{ path, message }] }`, identical in shape to
   `validate()` so callers already have one error handling path. A forbidden edge returns
   exactly one error, as in the worked example:
   `{ path: 'status', message: 'transition is not allowed (expected one of "running", "cancelled", "blocked")' }`,
   with the successor list taken from the schema side. Requirement 5 is what normalizes
   the delegated result into this form, so `path` is never the empty string and the
   message is never the bare enum text.
2. **Dispatch by current status**: the row selected from `table.values` by `from` (the
   lookup is defined in requirement 4) constrains `to`. This is a lookup table keyed by
   enum value, not a combinator — deterministic, one node per call, no ordering or
   backtracking, and no `oneOf`/`if`/`then` in the subset. It is the mechanism recommended
   here precisely because JSON Schema's `if`/`then` would need a `const`-per-status block
   duplicated six times and would introduce the combinator surface RFC-0001 refused.
3. **Table checks take the known-status set as an argument.** The contracts layer keeps
   zero imports (RFC-0001's decision), so it must not import `src/service.mjs`. An
   import there would also complete a cycle once adoption step 2 adds
   `src/tasks.mjs` → `src/contracts/validate.mjs`: contracts → service → tasks →
   contracts. The zero-import rule stands on its own even without that third edge.
   `export function assertTransitionTable(table, knownStatuses)`
   therefore receives the set: tests derive it with
   `exportEnum(taskRecordSchema.properties.status)` (RFC-0001 step 3 makes that enum the
   runtime source), and the store never needs it because the table is static and checked
   once. It throws `TypeError` when `meta` or `values` is missing, when a key of `values`
   is not in `knownStatuses`, when an entry of any row's `enum` is not in `knownStatuses`
   (a row `{ enum: ["running", "bogus"] }` must fail), and when an entry of
   `knownStatuses` is not a key.
4. **Fail closed on an unknown source status.** `from` is looked up with
   `Object.hasOwn(table.values, from)`; when it is absent, `validateTransition` throws
   `TypeError`. A record in a status the table does not know is a malformed table or a
   bug, never a soft "no transition is allowed". `Object.hasOwn` is load-bearing: a plain
   `table.values[from]` would resolve `from = 'constructor'`, `'toString'` or
   `'__proto__'` to an inherited value and derive a row out of `Object.prototype`. The
   same rule governs the `knownStatuses` membership checks in requirement 3.
5. **Empty enum, then delegation with the result wrapped.** The function checks
   `Array.isArray(row.enum) && row.enum.length === 0` itself and returns requirement 6's
   error. Otherwise it calls `validate(row, to)`. A success is returned unchanged as
   `{ ok: true }`. A failure is rewritten into the pinned form of requirement 1:
   `path` becomes `'status'` (the delegated path is the empty string) and the stock
   message is prefixed with `transition is not allowed (`, closed with `)`. The raw
   delegated error is never returned, so callers see one contract whichever branch
   rejected the edge, and no keyword logic is duplicated.
   `assertSchema()`/`walkSchema` — and therefore `validate()` — keep rejecting `enum: []`.
   The relaxation lives in this one function and touches no shared keyword code.
6. **Empty-enum message.** `{ path: 'status', message: 'transition is not allowed (no
   successor declared)' }`, because RFC-0001's stock enum message would render as
   `expected one of ` with nothing after it.
7. **Any `to` outside the row's enum is a validation result, not a throw** — including
   `to = 'constructor'` or another `Object.prototype` key, which the enum comparison
   rejects like any other non-member, returned in requirement 1's pinned form via
   requirement 5. Only the `from` lookup (requirement 4) and the table shape
   (requirement 3) throw.
8. **No new dependency and no new file layout beyond `src/contracts/transitions/`.**

Compatibility with RFC-0001's open questions: none is reopened. Its YAML ruling (open
question 1) is followed — `task-status-transitions.json`; its numeric-bounds question
stays closed as declined; `task-record` strictness (open question 3) and the `$ref`
question (open question 4) are untouched. Each row is validated through RFC-0001's
existing `validate()`, so this extension adds an entry point, not a keyword.

`validateTransition` is not the place for per-transition invariants such as
`executionStopped: true` on `queued → cancelled` (`docs/task-contract.md:155`;
`src/service.mjs:280`) or `block.reason` values (`docs/task-contract.md:158`;
`src/service.mjs:293`). Those stay in `validateTask`
(`src/tasks.mjs:380-397`). A later RFC can make them conditional on the status; this
one keeps the table to edges only.

## Acceptance alignment

The 13 M2b acceptance tests (`docs/task-contract.md:227-247`) and which ones actually
gate the state machine:

| # | Test | Relation to the table |
| --- | --- | --- |
| 1 | Submit returns a stable ID, record exists before the worker starts | Establishes the initial state `queued` (`src/tasks.mjs:199`); not a transition, but the table's coverage check must know it |
| 2 | Duplicate submit creates no second workspace or attempt | No status change: replay returns the stored record (`src/tasks.mjs:183-188`). Must keep passing unguarded |
| 3 | Same key, different payload → `idempotency_conflict` | Rejected before any write; not a transition |
| 4 | Second process observes `queued → running → succeeded` | **Gates rows 1 and 4.** Currently unsatisfiable: nothing in `src/` sets `running` or `succeeded` |
| 5 | Result contains diff, changed files, exit codes, attempts, limitations | Artifacts only; not gated |
| 6 | Cancel before start → `cancelled`, no worker spawned | **Gates row 2** (`src/service.mjs:275-285`) |
| 7 | Cancel during a write ends in `blocked`, no replay, `effectsReverted: false` | **Gates row 8** (`src/service.mjs:287-296`) |
| 8 | Restart with a `running` task marks it `blocked`, no resume | **Gates row 9**, and row 3 for the variant `reconcile` already handles (`src/tasks.mjs:279-289`) |
| 9 | Unauthorized client, model, tool, path or budget rejected without side effects | Rejected in `validateSubmitRequest`; no record, no transition |
| 10 | Non-owner read or cancel → `not_owner` | Ownership check before any status read (`src/service.mjs:114-123`) |
| 11 | Oversized diff and log truncated with explicit flags | Artifacts only |
| 12 | Credential-shaped request text rejected; returned artifacts redacted | Input/artifact boundary |
| 13 | One real client run returns a result; mock-only labelled | Evidence level, not lifecycle |

Four tests (4, 6, 7, 8) are the direct guards for the table; rows 1 and 4 are the ones
without a producer, so test 4 becomes the acceptance signal that the executor adapter
routes its transitions through the store rather than writing records itself.

## Adoption path

Three steps, each a small revertible PR, mirroring RFC-0001's shape. All of them are
**after RFC-0001 step 2** (wire the `submit_task` boundary), which is what makes a
schema-driven guard credible; RFC-0001 step 3 (derive `TASK_STATUSES` from the schema)
should land before step A below, because step A's table-coverage test compares the
transition keys against that same enum.

1. **Shadow.** Add `src/contracts/transitions/task-status-transitions.json`, the
   `validateTransition` and `assertTransitionTable` entry points, and
   `test/contracts.test.mjs` coverage for six cases: accepts a legal edge; rejects a
   forbidden edge; rejects any successor of a terminal row; throws on an unknown source
   status; throws on a table that misses a status key or declares an unknown status as
   an entry; rejects a successor that collides with an `Object.prototype` key
   (`'constructor'`). No runtime import; the existing suite and demo are untouched and
   this RFC's table can be reviewed against the lifecycle block without risk.
2. **Guard the store.** Add `assertTransition(previous, next)` in `src/tasks.mjs` and
   call it from `updateTask` (`src/tasks.mjs:235-244`) and `reconcile`
   (`src/tasks.mjs:278-289`), before `writeTask`. Map the failure to
   `TaskStoreError('internal', ...)`. Rows 2, 8 and 9 are exercised by existing tests
   (`test/task-service.test.mjs`, "cancel_task cancels queued work and blocks uncertain
   running work", "service startup blocks an interrupted running task before reads");
   `node --test` and `examples/fallback-demo.mjs` are the gate. Revert restores the
   previous permissive `updateTask`.

   **Known breakage this step must fix in the same PR.** Eight existing tests seed
   records straight through `updateTask` with edges the table forbids, because they need
   terminal artifacts without running a worker: `test/task-store.test.mjs:180-183` and
   `:284-288` (the `make()` helper invoked for `succeeded`, `failed`, `cancelled` and
   `blocked`), plus `test/task-service.test.mjs:53-56`, `:220`, `:255`, `:294`, `:305`,
   `:323` and `:337` — `queued → succeeded`, `queued → failed`, and one
   `succeeded → failed` (`test/task-service.test.mjs:294`, which reuses a task the same
   test just marked `succeeded`). With the guard in
   place those calls throw immediately and the suite fails for the wrong reason.
   Fixtures must either traverse legal edges (`queued → running → succeeded`, which needs
   an attempt and `startedAt`) or go through one documented seed helper that bypasses the
   guard at a single reviewed place. A guard that silently tolerates queued-to-terminal
   writes is not this proposal.
3. **Align the document.** Once the table is enforced, update the ASCII fence at
   `docs/task-contract.md:179-188` (the diagram inside the lifecycle block `:179-192`) to
   match it: add `queued → blocked` and settle rows 7 and 10-11 by resolving the open
   questions. This is a normative document change with its own review; it is explicitly
   out of scope for steps 1 and 2.

## Non-goals

- **Schema shapes.** Record, artifact, request and error shapes are RFC-0001 territory;
  this RFC adds no `.schema.json` file and no keyword to the subset.
- **Third-party dependencies.** No state-machine library, no validator, no YAML parser.
- **New statuses or lifecycle changes.** The table is derived from the current diagram
  and code. Rows 3, 7, 10 and 11 are listed because the contract already states them,
  not because this RFC invents them.
- **Behaviour changes.** Nothing here makes an unreachable transition reachable or a
  reachable one illegal. Where the diagram and the code disagree, the disagreement is
  recorded as an open question instead of being "fixed" by picking a side.
- **Per-transition field invariants** (`executionStopped`, `block.reason`,
  `finishedAt`), which stay in `validateTask` (`src/tasks.mjs:348-409`).
- **Amending `docs/task-contract.md` or an ADR** in this PR.
- **Executor, MCP transport and retry semantics.**

## Open questions

1. **`queued → blocked` is missing from the diagram.** `reconcile` blocks a `queued`
   task with a dispatched attempt (`src/tasks.mjs:279`), and prose at
   `docs/task-contract.md:203-204` describes it, but the lifecycle block at `:179-192`
   does not draw it (the fence ends at `:188`). The contract decides precedence for
   exactly this case: "where this document and code disagree, the document is wrong until
   this document is updated deliberately in the same change"
   (`docs/task-contract.md:7-8`), so the omission is a document defect, not a licence to
   drop the row. Adoption step 3 is that deliberate update; the question narrows to the
   row's wording (`queued --restart with a dispatched attempt--> blocked`) and whether it
   lands with the executor adapter or before it.
2. **`running → cancelled` on a proven stop has no implementation.** The fence (`:184`)
   and the contract (`:156-157`) allow it; `cancelTask` always blocks a running task and
   records `cancelled-uncertain` (`src/service.mjs:288-296`). By the same precedence rule
   (`:7-8`) the document wins, so the row stays and the service is the incomplete side.
   Step 3 records it as implemented only when the executor adapter can prove the stop;
   until then it is legal but unreachable — the same situation as the rows in open
   question 4.
3. **`blocked → failed | cancelled` has no operation.** The diagram (`:187`) requires a
   maintainer reconciliation that no code implements, and `store.reconcile`
   (`src/tasks.mjs:249`) is startup reconciliation — same name, different concept. The
   table lists both rows; naming and ownership are unresolved.
4. **Rows 1, 4, 5, 6 have no producer.** Searching `src/` shows only four status
   writes: `queued` on creation (`src/tasks.mjs:199`), `blocked` in reconcile
   (`src/tasks.mjs:281`), `cancelled` and `blocked` in cancel
   (`src/service.mjs:277`, `:290`). A guard in step 2 will therefore permit transitions
   that no code performs yet, and acceptance test 4 cannot pass until the executor
   adapter exists. Is a guard against unreachable-but-legal edges acceptable, or should
   step 2 land only with the adapter?
5. **Should the guard run at read time too?** The proposal deliberately does not:
   `readTask` keeps structural validation only (`src/tasks.mjs:138-147`), so a record
   persisted by an older build stays readable. A read-time check would turn a
   historical anomaly into an outage; a write-time check keeps the invariant going
   forward. Confirm this asymmetry is intended.

## References

- [docs/task-contract.md](../task-contract.md) — normative lifecycle, cancellation and
  restart rules.
- [RFC-0001](0001-contract-schemas.md) — schema subset, checker, error format and
  adoption path this RFC extends (sibling PR).
- [ADR-008](../adr/008-task-store.md) — durable task store, idempotency index and
  startup reconciliation; the boundary where the guard belongs.
- [ADR-007](../adr/007-task-contract.md) — task contract, no third-party runtime
  dependency.
- [AGENTS.md](../../AGENTS.md) — no `npm install`, documentation duties, evidence
  levels.
- `src/tasks.mjs`, `src/service.mjs`, `test/task-store.test.mjs`,
  `test/task-service.test.mjs` — the code the table and the fixture-breakage note were
  derived from.

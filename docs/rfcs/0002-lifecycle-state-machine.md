# RFC-0002: Declarative lifecycle state machine and transition table

Date: 2026-11-02. Status: Proposed.

Depends on: [RFC-0001](0001-contract-schemas.md) (contract schemas and the
dependency-free checker; shipped in the sibling PR, so that file is not on this
branch). This RFC is documentation only: no schema file, no source change, no test.

## Status

Proposed. This document specifies one transition table and one small checker entry
point; nothing here is implemented. It builds on RFC-0001, which deliberately left
status transitions, lifecycle legality and conditional rules to this follow-up ("the
reason RFC-0002 exists: conditional state transitions need keywords this RFC refuses to
half-implement").

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
   (`src/service.mjs:190`). Three modules, four places, one prose diagram.
5. **The diagram is already narrower than the code.** `reconcile` blocks a `queued`
   task that has an attempt (`src/tasks.mjs:279`), which the diagram at
   `docs/task-contract.md:179-188` does not draw, relying on prose at
   `docs/task-contract.md:203-204` instead. And the diagram's
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

Derived from the diagram (`docs/task-contract.md:179-188`), the cancellation rules
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

`succeeded`, `failed` and `cancelled` have no outgoing edges (diagram `:190`; "a
terminal task returns `already_terminal` and is never reopened", contract `:159`).
The terminal set at `src/tasks.mjs:19` matches, with `blocked` deliberately left out
because rows 10 and 11 exist — a difference worth keeping visible, since the store uses
`TERMINAL` for pruning (`src/tasks.mjs:314`) and the contract keeps blocked records
forever (`docs/task-contract.md:205-206`).

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
  queued:    { enum: [running, cancelled, blocked] }      # rows 1-3
  running:   { enum: [succeeded, failed, blocked, cancelled] }  # rows 4-9
  succeeded: { enum: [] }                                 # terminal
  failed:    { enum: [] }                                 # terminal
  blocked:   { enum: [failed, cancelled] }                # rows 10-11
  cancelled: { enum: [] }                                 # terminal
```

Each `values` entry is an ordinary RFC-0001 schema node, so the enum formatting,
primitive comparison with `Object.is` and 32-character previewing are reused unchanged.
An empty enum means "no successor"; it is the one place where RFC-0001's non-empty
`enum` rule is relaxed, and only inside `validateTransition` (see below).

### Worked example

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
that would change (`status`). The same table entry used with `validate(table.values.queued, nextStatus)`
yields RFC-0001's stock message (`expected one of "running", "cancelled", "blocked"`),
which is why `validateTransition` exists: it names the rule, keeps the terminal row
distinguishable, and cannot be satisfied by an empty enum.

## Checker extension required

RFC-0001's `validate()` treats every keyword it does not know as an annotation and
ignores it (RFC-0001, "Supported subset"). That matters here: writing `if`/`then` or a
`status`-conditional block into a schema file today would be **silently unenforced**.
This RFC therefore does not add schema keywords. It adds one entry point.

Required from `src/contracts/validate.mjs`, in the same dependency-free file:

1. `export function validateTransition(table, from, to)` returning
   `{ ok: true }` or `{ ok: false, errors: [{ path, message }] }`, identical in shape to
   `validate()` so callers already have one error handling path.
2. **Dispatch by current status**: `table.values[from]` selects the node that constrains
   `to`. This is a lookup table keyed by enum value, not a combinator — deterministic,
   one node per call, no ordering or backtracking, and no `oneOf`/`if`/`then` in the
   subset. It is the mechanism recommended here precisely because JSON Schema's
   `if`/`then` would need a `const`-per-status block duplicated six times and would
   introduce the combinator surface RFC-0001 refused.
3. **Fail closed on schema shape.** `meta` and `values` must exist; every key of
   `values` must be a known status; every status in `TASK_STATUSES`
   (`src/service.mjs:16`) must be a key, so a new status cannot silently gain no row.
   A violation throws `TypeError`, matching RFC-0001's rule that a malformed schema node
   is never treated as permissive.
4. **Allow `enum: []` only inside `validateTransition`.** RFC-0001 requires a non-empty
   enum (`src/contracts/validate.mjs`, `validateKeywordShapes`, on the sibling branch);
   that stays true for
   `validate()`. A transition row needs to express "terminal" *explicitly* rather than
   by omitting the key, which would be indistinguishable from a forgotten row.
   Duplicating the machinery is rejected: the new entry point calls the existing
   keyword logic for the selected node.
5. **Empty-enum message.** `{ path: 'status', message: 'transition is not allowed (no
   successor declared)' }`, because RFC-0001's stock enum message would render as
   `expected one of ` with nothing after it.
6. **No new dependency and no new file layout beyond `src/contracts/transitions/`.**

Compatibility with RFC-0001's open questions: this extension does not touch
`minimum`/`maximum` (RFC-0001 open question 2), does not change the schema format
ruling (open question 1) and does not need `$ref` (open question 4). It is additive and
revertible: without the table file, nothing calls it.

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
should land before step B below so the table's status keys come from the same source.

1. **Shadow.** Add `src/contracts/transitions/task-status-transitions.json`, the
   `validateTransition` entry point and `test/contracts.test.mjs` coverage for the six
   worked cases (valid edge, forbidden edge, terminal row, unknown status, missing
   status key, empty table). No runtime import; the existing suite and demo are
   untouched and this RFC's table can be reviewed against the diagram without risk.
2. **Guard the store.** Add `assertTransition(previous, next)` in `src/tasks.mjs` and
   call it from `updateTask` (`src/tasks.mjs:235-244`) and `reconcile`
   (`src/tasks.mjs:278-289`), before `writeTask`. Map the failure to
   `TaskStoreError('internal', ...)`. Rows 2, 8 and 9 are exercised by existing tests
   (`test/task-service.test.mjs`, "cancel_task cancels queued work and blocks uncertain
   running work", "service startup blocks an interrupted running task before reads");
   `node --test` and `examples/fallback-demo.mjs` are the gate. Revert restores the
   previous permissive `updateTask`.
3. **Align the document.** Once the table is enforced, update the diagram at
   `docs/task-contract.md:179-188` to match it (adding `queued → blocked` and deciding
   rows 7 and 10-11 by resolving the open questions). This is a normative document
   change with its own review; it is explicitly out of scope for steps 1 and 2.

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
   `docs/task-contract.md:203-204` describes it, but the diagram at `:179-188` does not.
   The table includes the row; should the diagram be amended in adoption step 3?
2. **`running → cancelled` on a proven stop has no implementation.** The diagram
   (`:184`) and the contract (`:156-157`) allow it; `cancelTask` always blocks a running
   task and records `cancelled-uncertain` (`src/service.mjs:288-296`). Which is
   authoritative today, and does the executor adapter own the proof that makes the row
   reachable?
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
- `src/tasks.mjs`, `src/service.mjs`, `test/task-service.test.mjs` — the code the table
  was derived from.

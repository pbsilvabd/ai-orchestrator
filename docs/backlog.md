# Agent backlog — execution contracts

Baseline: `origin/main` at `488e57a` (PR #24 merged). Fetch before choosing work.
The earlier [review](review-2026-11-02.md) remains historical evidence, not current
acceptance. Test counts are observations, never a fixed target future agents should
preserve instead of testing changed behavior.
No M2b/M3 completion is implied.

## Delivery rule

Current task: [B12](tasks/B12.md), on `task/B12-durable-scheduler`, implemented and
validated locally, now authorized for publication and merge after final checks.
FIX23/#24 merged; main CI passed. A fresh local source/host review passed its
hard-link/environment regressions, but no published independent review was found.
The maintainer accepted this agent's completed review for the B12 merge decision;
do not claim a separate independent reviewer.

**One executable task ID = one branch = one PR.** Read
[task-execution.md](task-execution.md) and the linked card. Continue from implementation
through testing, review during development, corrections, another review of the completed
diff, revalidation, documentation, commit, push, PR creation and remote-head verification.
Do not stop after planning, creating a branch or passing initial tests.

Each card defines purpose, prerequisites, files, excluded scope, implementation
sequence and numbered acceptance scenarios. In the PR map **every row** to a named
test/experiment, observed result/exit and evidence. Required missing evidence means
incomplete work, even with a green unit suite. Completed work is published ready for
review; externally blocked partial work follows the protocol's draft procedure.
A later reviewer is an additional check, not a substitute for either self-review.

## Verified status and task selection

- B01: [PR #8](https://github.com/pbsilvabd/ai-orchestrator/pull/8) is merged;
  differential runtime adoption remains B08. Do not create another B01 PR.
- B02: merged through [PR #11](https://github.com/pbsilvabd/ai-orchestrator/pull/11).
- B04a: ordinary lifecycle/identity guards merged through
  [PR #13](https://github.com/pbsilvabd/ai-orchestrator/pull/13).
  The old broad B04 is retired as an implementation assignment; dispatch, stop proof
  and maintainer reconciliation belong to B12, B14 and B18 respectively.
- B05: service ownership merged through
  [PR #14](https://github.com/pbsilvabd/ai-orchestrator/pull/14), including closed-handle
  refusal, real process contention and abrupt-death tests.
- B22 is an **umbrella only** and must not become one oversized PR. Its executable
  children B22a, B22b and B22c each deliver one PR in order.

Ready choices: publish/verify and merge B12 under the maintainer's authorization;
B13 has merged B09/B10
prerequisites. B06/#20 and FIX17-18/#22 are merged. Prerequisites below describe
ready-for-review acceptance; fixture-only preparatory work is not full delivery
of a gated card.

## Queue and detailed cards

P1: required for trustworthy M2b; P2: supporting/M3 work; P3: later decision/gate.
A merged card is retained as regression/review guidance, not new work.

| ID and detailed contract | Priority | State at baseline | Prerequisites |
| --- | --- | --- | --- |
| [B01 — Safe schema diagnostics](tasks/B01.md) | P1 | Merged #8 | Existing #8 |
| [B02 — Practical documentation templates](tasks/B02.md) | P2 | Merged / history | Merged #11 |
| [B03 — Repository identity before task acceptance](tasks/B03.md) | P1 | Merged #16 | B04a/B05 merged |
| [B04 — Ordinary lifecycle and immutable identity](tasks/B04.md) | P1 | Merged / history | B04a merged #13 |
| [B05 — Single service owner per state home](tasks/B05.md) | P1 | Merged / history | Merged #14 |
| [B06 — Diagnose MCP capability gate instability](tasks/B06.md) | P1 | Merged #20; 8 pinned-host runs passed | Pinned host |
| [B07 — Credential-free Windows and Linux CI](tasks/B07.md) | P2 | Merged #19 | None |
| [B08 — Differential submit-schema adoption](tasks/B08.md) | P2 | Gated | #8 accepted/merged; B03 |
| [B09 — Isolated Git workspace lifecycle](tasks/B09.md) | P1 | Merged #18; FIX17-18 merged #22 | B03 |
| [B10 — Bounded subprocess primitive](tasks/B10.md) | P1 | Merged #17; FIX17-18 merged #22 | None |
| [B11 — Authorized OpenCode invocation](tasks/B11.md) | P1 | Merged #23 and FIX23/#24; independent review pending | B09, B10, pinned host |
| [FIX23 — Post-merge B11 corrections](tasks/FIX23.md) | P1 | Merged #24; main CI passed; independent review unrecorded | Merged #23 |
| [B12 — Single-worker scheduler with durable dispatch](tasks/B12.md) | P1 | Locally validated; publication/merge authorized, pending final CI | B04a, B05, B09–B11 |
| [B13 — Verifiable bounded artifacts](tasks/B13.md) | P1 | Ready | B09, B10 |
| [B14 — Cancellation, deadlines and late events](tasks/B14.md) | P1 | Gated | B12, B13 |
| [B15 — Four-operation MCP stdio adapter](tasks/B15.md) | P1 | Gated | B06; B12/B14 for execution acceptance |
| [B16 — Pinned-client task workflow](tasks/B16.md) | P1 | Gated | B12–B15 |
| [B17 — Executable thirteen-item acceptance matrix](tasks/B17.md) | P1 | Gated | B16 |
| [B18 — Explicit human recovery and retention](tasks/B18.md) | P2 | Gated | B04a, B05, B14 |
| [B19 — Opt-in harness pulse](tasks/B19.md) | P2 | Gated | B06; track 2 after B17 |
| [B20 — First supervised use on this project](tasks/B20.md) | P2 | Gated | B17, B18, authorized model |
| [B21 — SQLite RFC refinement and capability gate](tasks/B21.md) | P3 | Gated | B17; #6 gate scope |
| [B22a — Transactional store engine](tasks/B22a.md) | P3 | Gated | B21 pass + design approval |
| [B22b — Offline verified JSON import](tasks/B22b.md) | P3 | Gated | B22a |
| [B22c — Controlled storage rollout](tasks/B22c.md) | P3 | Gated | B22b + switch approval |
| [B23 — Safe worker fallback](tasks/B23.md) | P3 | Gated | B17 + two authorized models |
| [B24 — Memory reuse evaluation](tasks/B24.md) | P3 | Gated | B20 |
| [B25 — Offline routing advisor evaluation](tasks/B25.md) | P3 | Gated | B20, B23 |

## Review workflow task

| Additional task | Priority | State | Prerequisites |
| --- | --- | --- | --- |
| [B26 — PR feedback protocol](tasks/B26.md) | P2 | Merged #21 | Existing execution protocol |

B26 defines developer/reviewer instructions and records the automation gap. The
future sequential two-model controller needs separate design/implementation cards
after B20; it is not delivered by B26 or the B25 routing evaluation.

## Shared safety and integration rules

- Read AGENTS and ordered normative sources before editing. Preserve user changes;
  inspect current PR/branch heads and dependencies rather than trusting this snapshot.
- No paid calls, provider activation, credentials, automatic merge, uncertain replay
  or scope expansion is authorized by a card. Task-specific authorization controls
  any real model/provider use.
- Use temporary homes, Git repositories/worktrees and controlled subprocesses/providers.
  Fixtures, real Node/Git processes, pinned OpenCode integration and use on this
  project are distinct evidence; never promote one into another.
- Do not merge the old `feat/m2b-executor-adapter`,
  `feat/m2b-client-integration` or `feat/m2b-acceptance` unchanged or reuse their
  evidence claims. Their defects are recorded in the earlier review.
- Existing API: `createTaskService({ store, config })`, camelCase methods,
  `openTaskStore({ home })`, accepted request at `task.request`.
  Close services explicitly; stale service handles cannot perform operations.
- Future card changes must preserve normative requirements and add discovered failure
  cases. Do not relax a row to make incomplete work appear delivered.

## Coordination and dispatch

B03/B06/B07/B10 can use distinct branches. Serialize B03/B08 submit-boundary edits,
B12/B14 executor changes and shared lifecycle/store changes. Preserve both append-only
worklog/validation entries when resolving documentation conflicts.
This is scheduling guidance for human dispatch, not permission to spawn agents.

Use the [copyable dispatch prompt](task-execution.md#copyable-task-dispatch) with one
ready ID. For lower-cost models, assign one card at a time and require its full evidence
matrix and both review passes. Complex permission/persistence/process work still merits
independent review; detailed contracts reduce omissions, not the need for review.

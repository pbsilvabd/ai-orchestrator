# Agent backlog — execution contracts

Verified 2026-11-14: current main `c268239` includes B18/#41; its post-merge check
passed in Actions run `43589015912`. B17/#40 is included and its Windows/Ubuntu PR
checks passed; post-merge Windows run `43568386630` passed. B19 implementation is
published in [PR #42](https://github.com/pbsilvabd/ai-orchestrator/pull/42) from
`task/B19-opt-in-harness-pulse`; supervisor review/corrections are verified.
At publication the PR is open and CI pending; consult the PR for subsequent exact-head
CI/merge receipts rather than treating this snapshot as the current remote state.
The earlier [review](review-2026-11-02.md) remains historical evidence, not current
acceptance. Test counts are observations, never a fixed target future agents should
preserve instead of testing changed behavior.
No M2b/M3 completion is implied.

## Delivery rule

Current implementation task: [B19 — Opt-in harness pulse](tasks/B19.md).
B12–B18 are merged. M2b and M3 remain open milestones.

B11/#23, FIX23/#24 and B12/#25 were reviewed locally, and the maintainer accepted
the implementing agent's review for the B12 merge. No separate independent review
is claimed. That authorization applied to B12; future merges require their own
task-specific authorization.

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

Delivered foundations: B01–B07 (B04a for lifecycle), B09–B12 and B26, plus
FIX17-18/#22 and FIX23/#24. B12/#25 adds durable single-worker dispatch, canonical
workspace receipts, duplicate/restart protection and conservative shutdown.
It does not collect task artifacts or implement the MCP task endpoint.

Current delivery: **B19 PR #42; reviewed and published**. Its remote state and checks
are authoritative on GitHub.
B08 remains supporting work whose B01/#8 and B03 prerequisites are merged. B19 adds
the manual capability-gate pulse and read-only task-history acceptance; B17 is merged.
Prerequisites below describe complete card acceptance; preparatory work does not
complete a gated card.

## Remaining milestone work

| Milestone | Pending tasks and acceptance |
| --- | --- |
| M2b — One-worker delegation MVP | B12–B18 are merged. The M2b acceptance gates still require their published evidence/review cycle. |
| M3 — First supervised development task | B20: one real authorized worker develops a small approved repository task through the service, returning a scoped diff and real test evidence for human review. B20 waits for B17/B18 and an available authorized real-model execution path. The current OpenCode adapter supports only a loopback fixture provider. |
| Supporting work | B08 differential submit-schema adoption; B19 opt-in diagnostic pulse. Neither replaces M2b/M3 acceptance. |
| Later milestones/decisions | B21 and B22a–c storage evaluation/rollout; B23 safe fallback (M2c); B24 memory (M4); B25 routing evaluation (M5). These are not prerequisites for completing basic one-worker delegation and first use. |

Recommended M2b order: **B14 → B15 → B16 → B17**. B18 can proceed after
B14 without waiting for B17; B20 requires both B17 and B18 plus explicit model,
provider and budget authorization. B13/B14 must preserve the existing task contract
and safety boundaries. No fallback, memory, multi-worker controller or automatic
merge is required to prove M3.

## Queue and detailed cards

P1: required for trustworthy M2b; P2: supporting/M3 work; P3: later decision/gate.
A merged card is retained as regression/review guidance, not new work.

| ID and detailed contract | Priority | Verified status | Prerequisites / remaining gate |
| --- | --- | --- | --- |
| [B01 — Safe schema diagnostics](tasks/B01.md) | P1 | Merged #8 | Existing #8 |
| [B02 — Practical documentation templates](tasks/B02.md) | P2 | Merged / history | Merged #11 |
| [B03 — Repository identity before task acceptance](tasks/B03.md) | P1 | Merged #16 | B04a/B05 merged |
| [B04 — Ordinary lifecycle and immutable identity](tasks/B04.md) | P1 | Merged / history | B04a merged #13 |
| [B05 — Single service owner per state home](tasks/B05.md) | P1 | Merged / history | Merged #14 |
| [B06 — Diagnose MCP capability gate instability](tasks/B06.md) | P1 | Merged #20; 8 pinned-host runs passed | Pinned host |
| [B07 — Credential-free Windows and Linux CI](tasks/B07.md) | P2 | Merged #19 | None |
| [B08 — Differential submit-schema adoption](tasks/B08.md) | P2 | Pending; ready supporting task | B01/#8 and B03 merged; corpus/adoption still to implement |
| [B09 — Isolated Git workspace lifecycle](tasks/B09.md) | P1 | Merged #18; FIX17-18 merged #22 | B03 |
| [B10 — Bounded subprocess primitive](tasks/B10.md) | P1 | Merged #17; FIX17-18 merged #22 | None |
| [B11 — Authorized OpenCode invocation](tasks/B11.md) | P1 | Merged #23; corrected by #24; loopback fixture only | B09/B10 merged; pinned-host evidence recorded |
| [FIX23 — Post-merge B11 corrections](tasks/FIX23.md) | P1 | Merged #24; CI and repeated host regressions passed | Merged #23; review provenance described above |
| [B12 — Single-worker scheduler with durable dispatch](tasks/B12.md) | P1 | Merged #25 at 68d3ea5; PR and main CI passed | B04a/B05/B09–B11 delivered; no remaining B12 gate |
| [B13 — Verifiable bounded artifacts](tasks/B13.md) | P1 | Merged #35 at `254b5b9`; post-merge CI passed | B09/B10 merged |
| [B14 — Cancellation, deadlines and late events](tasks/B14.md) | P1 | Merged #37 at `dc757c1`; Windows/Ubuntu checks passed | B10/B12/B13 merged |
| [B15 — Four-operation MCP stdio adapter](tasks/B15.md) | P1 | Merged #38 at `491de18`; correction and CI verified | B06/B12/B14 merged; B13 artifacts available |
| [B16 — Pinned-client task workflow](tasks/B16.md) | P1 | Merged #39 at `681f0a6`; Windows/Ubuntu CI passed | B12–B15 merged; trusted OpenCode 2.2.5 available |
| [B17 — Executable thirteen-item acceptance matrix](tasks/B17.md) | P1 | Merged #40 at `190370f`; PR checks passed Windows/Ubuntu | B16/#39 merged |
| [B18 — Explicit human recovery and retention](tasks/B18.md) | P2 | Merged #41 at `c268239`; post-merge CI passed | B14 delivered |
| [B19 - Opt-in harness pulse](tasks/B19.md) | P2 | PR #42 published after verified supervisor corrections; open at publication, subsequent CI/merge receipts on PR | B06 and B17 delivered |
| [B29 - Prepare one anonymous free OpenCode worker](tasks/B29.md) | P2 | Merged #44 at `11fcb42`; fixture-only, live closed. Local pinned MCP fixture passed; Windows/Ubuntu CI green at `113e926`; redirect-307 egress recorded as the B30 gate | B17/B19 evidence; B30 owns live redirect/egress gate |
| [B20 — First supervised use on this project](tasks/B20.md) | P2 | Pending; M3 acceptance task | B17/B18 and available authorized model/provider/budget pending |
| [B30 - Contain the live free route behind a trusted relay](tasks/B30.md) | P2 | Fixture-only implementation on `task/B30-free-relay`: relay, egress gateway, SSHSIG approval/admission, an isolated WSL2 netns/veth containment observation, and a pinned OpenCode 2.2.5 host-through-relay fixture (normal succeeds; 301/302/303/307/308 fail the task with zero alternate-origin bytes). Draft PR; live, catalog, firewall (nftables), bare-metal/VM and hardware-key signing gates `not_run` | B29/#44 merged; ADR-009 reconciliation; deployment egress proof and separate approvals |
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

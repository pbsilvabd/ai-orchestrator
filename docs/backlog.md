# Agent backlog — execution contracts

Verified 2026-11-24: remote main `f61e5e1` includes B12–B19, B29/#44 and the
2026-11-22 reassessment. B30/#45 is draft and merged with main; the fixture-only
implementation is not accepted. B20/#43 remains the single blocked M3 draft. See the
[reassessment](project-reassessment-2026-11-22.md) for the full inventory and
GitHub disposition; do not treat a merged fixture task as live-provider support.

Historical checkpoints (superseded, not current remote state): on 2026-11-22 main
`11fcb42` included B12–B19 and B29/#44, and B30/#45 was draft at `a4f3954` with
successful exact-head Windows/Ubuntu CI `43806088953` — that green run is historical,
not current-head acceptance. On 2026-11-14 main `c268239` included B18/#41 and its
post-merge run `43589015912` passed; B17/#40's Windows/Ubuntu PR checks passed and
post-merge Windows run `43568386630` passed; B19 implementation was published in
[PR #42](https://github.com/pbsilvabd/ai-orchestrator/pull/42) from
`task/B19-opt-in-harness-pulse`.
The earlier [review](review-2026-11-02.md) remains historical evidence, not current
acceptance. Test counts are observations, never a fixed target future agents should
preserve instead of testing changed behavior.
No M2b/M3 completion is implied.

## Delivery rule

Current critical path: implement the maintainer-selected software SSH approval profile
in B31/#47 on top of draft B30/#45; in parallel specify compartment-aware composition
#46 and resolve test stability #48. B20/#43 remains blocked afterward. B12–B19 and B29
are merged; do not implement them again. M2b milestone reconciliation and M3 acceptance
remain open.

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

Current delivery: **B30 PR #45; incomplete draft**. Its remote state and checks
are authoritative on GitHub. A private bind option is implemented; actual
cross-compartment service composition is not established.
B08 remains supporting work whose B01/#8 and B03 prerequisites are merged. B19 adds
the manual capability-gate pulse and read-only task-history acceptance; B17 is merged.
Prerequisites below describe complete card acceptance; preparatory work does not
complete a gated card.

## Remaining milestone work

| Milestone | Pending tasks and acceptance |
| --- | --- |
| M2b — One-worker delegation MVP | B12–B19 are merged; reconcile published B17 technical fixture evidence with the DoD explicitly, without claiming new milestone sign-off. |
| M3 — First supervised development task | B20/#43: one real authorized worker develops an approved repository task through the service. B29 is fixture preparation only; B30/#45 still needs composition, approval and deployment gates (#46/#47). |
| Supporting work | #48 test stability, #30 output bounds/diagnostics, #32/#33 CI foundation; B08 differential schema adoption. B19 diagnostics is already delivered. |
| Later milestones/decisions | B21 and B22a–c storage evaluation/rollout; B23 safe fallback (M2c); B24 memory (M4); B25 routing evaluation (M5). These are not prerequisites for completing basic one-worker delegation and first use. |

Recommended remaining order: **approval/composition design (#47/#46) → bounded
implementation and test stability (#48) → one controlled deployment campaign →
B30 final review/acceptance → B20**. Explicit B17/M2b fixture acceptance
reconciliation can proceed independently now, not as a hardware/live gate. B17/B18 are
merged prerequisites, not future implementations. B20 still requires exact model,
objective, privacy and budget approval. No fallback, memory, multi-worker
controller or automatic merge is required to prove M3.

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
| [B19 - Opt-in harness pulse](tasks/B19.md) | P2 | Merged #42 at `688da04` | No remaining B19 implementation |
| [B29 - Prepare one anonymous free OpenCode worker](tasks/B29.md) | P2 | Merged #44 at `11fcb42`, fixture-only | B30 owns live redirect/egress gate |
| [B30 - Relay, gateway and signed approval](tasks/B30.md) | P1 | Draft #45; fixture-only; all independent review findings closed at `7660b39`; docs-only head `67acd78` confirmed; still not accepted | Stacked B31 profile work, #46 composition, #48 test races and deployment gates |
| [B31 - Explicit software SSH approval profile](tasks/B31.md) | P1 | Draft PR #51 at `cc6f97c`; Windows/Ubuntu CI passed; independent review found no B31 blocker at that SHA. Draft remains incomplete because default-concurrency B10-03 failure in #48 is unresolved | #48 test stability; #46 must establish signer/worker isolation before any live use |
| [B20 - First supervised use on this project](tasks/B20.md) | P2 | Blocked draft #43; no real worker diff | M2b reconciliation and supported authorized real path; no duplicate PR |
| B27 - CI foundation ([#33](https://github.com/pbsilvabd/ai-orchestrator/pull/33)) | P2 | Unmerged; conflicts with main; old green checks are not current-base acceptance | Refresh RFC #32 and implementation on current main |
| B28 - Expanded CI gates ([#34](https://github.com/pbsilvabd/ai-orchestrator/pull/34)) | P3 | Blocked; conflicts; macOS cancelled and smoke skipped at inspected head | B27 merged first; narrow to declared platform/coverage goals |
| [B21 - SQLite RFC refinement and capability gate](tasks/B21.md) | P3 | Parked; obsolete #6 retired, not adopted | Measured need, fresh design identity and explicit gate scope |
| [B22a - Transactional store engine](tasks/B22a.md) | P3 | Parked | Measured need + B21 pass + new design approval |
| [B22b - Offline verified JSON import](tasks/B22b.md) | P3 | Parked | B22a |
| [B22c - Controlled storage rollout](tasks/B22c.md) | P3 | Parked | B22b + switch approval |
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

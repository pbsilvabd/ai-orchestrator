# Roadmap — delegated workers, tested through our own development

Updated 2026-11-14. Milestones follow dependencies and evidence, not promised dates.
The maintainer owns scope and permissions; the primary LLM supervises delegated work.

## Product objective

AI Orchestrator is a pluggable worker service for a primary LLM running in a
compatible local or web client. The primary LLM plans, delegates, checks progress
and reviews results. AI Orchestrator executes authorized tasks through workers and
returns artifacts and evidence. The primary LLM need not perform each execution step.

The first and primary end-to-end test is development of AI Orchestrator itself:
the primary LLM delegates a small backlog task, a worker changes an isolated branch,
runs tests, and returns a diff and report for review. No automatic merge.

OpenCode 2.2.5 is the selected first worker executor and supervising client.
ADR-007 selects MCP over stdio as the first transport; the loopback HTTP fallback
was not selected. B15's stdio adapter and B16's pinned-client workflow are merged.
B17 implements the thirteen-item acceptance matrix and merged as #40 at `190370f`;
PR checks passed on Windows and Ubuntu. M2b remains incomplete.
See [ADR-006](adr/006-worker-service.md).

## Where we are

M0/M1a/M1b remain complete within their original local scope: policy, HTTP
normalization, ledger, runner and 43 local tests. The real OpenCode smoke passed
for context/session continuity, explicit model switching and denied writes.
M2a is complete as documentation: the normative [task contract](task-contract.md)
and [ADR-007](adr/007-task-contract.md) select MCP over stdio with OpenCode 2.2.5 as
the first client and record the reuse/build decision. The B06 MCP capability gate
corrections passed eight isolated runs against the pinned host; the failure was
readiness timing, not protocol incompatibility. The task store and service-surface
corrections are complete. FIX17-18/#22 corrected hidden workspace output and spawn
error handling. B11/#23 is merged; FIX23 corrects post-merge hard-link/environment
authorization findings and a Windows test-cleanup failure. FIX23/#24 is merged and
main CI passed; no published independent review was found. B12 adds a locally
validated opt-in durable single-worker scheduler connected to the B11 builder,
merged through PR #25. B13 artifact collection and its post-merge corrections are
included in main `a147d13`; Windows/Ubuntu checks passed for the merge/follow-up
deliveries. B14 cancellation/deadline handling merged in PR #37 at `dc757c1`, with
Windows and Ubuntu checks passed on the reviewed head. B15 implements the four-tool
MCP stdio server; OpenCode 2.2.5 discovered all four tools and submitted a fixture
task whose queued result reached the model context. B15/#38 is merged at `491de18`.
B16's pinned-client integration checks correlated MCP replies, replay IDs, active
worker cancellation, dispatch-enabled restart and Git isolation. The Windows gate
uses a Job Object for host cleanup. B16/#39 is merged at `681f0a6`; Windows/Ubuntu CI
passed. B17/#40 is merged at `190370f`; its post-merge Windows check passed in
Actions run `43568386630`. B18/#41 is merged at `c268239`; its post-merge Windows
check passed in Actions run `43589015912`. B19's manual opt-in pulse and local
supervisor corrections are on `task/B19-opt-in-harness-pulse`; focused correction
tests and final pinned-host evidence are complete locally. GPT-6.1 Sol independently
verified the corrections, all four rows, the full suite and current-code B17 matrix;
delivery is published as [PR #42](https://github.com/pbsilvabd/ai-orchestrator/pull/42),
which carries the authoritative reviewed-head CI/merge/post-merge receipts.
B20 preflight fetched and independently confirmed main `688da04`: B19/#42 is
merged and its reviewed-head/post-merge Windows/Ubuntu checks succeeded. B20 is a
blocked checkpoint on `task/B20-first-supervised-use`; real submission and human
diff review are not_run. The adapter remains fixture-only, credentials/effort and
real-model financial limits are unsupported/unapproved, and the stock MCP entry
point is passive. See [the exact blocker and unapproved proposal](evidence/B20-preflight.md).
No production provider is enabled.
There is no production provider, integrated fallback, semantic memory or completed
self-development workflow yet.

The existing runner executes an operation; it is not a durable task scheduler.
Its budget is per invocation, and its ledger does not persist task artifacts or
authenticate clients. The new objective does not imply these features already exist.

## Milestones

| Milestone | Status | Delivery and exit criterion |
| --- | --- | --- |
| M0 — Verifiable foundation | Complete | Policy, pinned plugin audit, ADRs and local tests without AI APIs |
| M1a — HTTP boundary | Complete | Retry-After normalization and conservative loopback failure tests |
| M1b — Operational safety | Complete locally | Correlation, checkpoint, lock, runner cancellation and per-invocation budget; ADR-004/005 limits apply |
| M2a — Contract and reuse decision | Complete (2026-11-02) | Normative [task contract](task-contract.md), [ADR-007](adr/007-task-contract.md), pinned reuse table and a bounded M2b plan |
| M2b — One-worker delegation MVP | In progress; B12–B18 merged | A real compatible client submits a task, receives an ID, polls status and retrieves a result from one worker; duplicate submission, cancellation and uncertain restart tested |
| M2c — Safe model fallback in a worker | Pending; depends on M2b | Controlled 429, two failing models, restart, failure after effects and safe return to preferred model validated in the executor |
| M3 — First self-development task | Blocked/incomplete; B20-01/B20-04 not_run; B17/B18 merged, real-provider support and specific objective/model/budget approval missing | Primary LLM delegates a real repository task; one authorized worker returns a scoped diff, test evidence and report; human review before merge |
| M4 — Memory and continuity | Planned; depends on M3 | Evaluate ai-memory reuse; retrieve decisions and pending work across sessions without using semantic memory as execution authority |
| M5 — Routing and multiple workers | Planned; depends on M3 and M2c | Capability/cost routing, bounded concurrency, task-level budgets, isolated workspaces and review workers validated against a baseline |
| M6 — Broader clients and release | Future; depends on M4/M5 | Tested client/platform matrix, authenticated remote access where supported, reproducible installation and release evidence |

M2 is now split into M2a/M2b/M2c; its earlier host smoke remains useful evidence.
M3 may start with one authorized model and fallback disabled. Two models are
required for M2c, not for proving basic delegation. This changes sequencing without
waiving safety: ambiguous outcomes still block automatic replay.
See [Definition of Done](definition-of-done.md).

## M2b plan (bounded, in order)

Execution tracking: [backlog](backlog.md) now indexes detailed per-task contracts.
Every executable ID delivers one PR after acceptance testing, implementation review,
completed-diff review and correction/revalidation under [task-execution.md](task-execution.md).
B04a/#13, B05/#14, B03/#16, B07/#19, B06/#20, B26/#21, B10/#17, B09/#18 and
FIX17-18/#22 are merged. Eight real pinned-host B06 gate runs passed after bounded
readiness and cleanup handling. B11's launch builder and denied-write experiment are
merged through #23/#24. B12 service dispatch is merged through PR #25 and is
present in main `68d3ea5`, including canonical workspace receipts.
Both PR and post-merge CI passed. B14 follows the B13 post-merge corrections.
B22 is split into sequential B22a/B22b/B22c PRs. These workflow
requirements do not satisfy a runtime or host-integration gate.

B04a hardening checkpoint (2026-11-02): ordinary store transitions, immutable task
identity/request fields and state-dependent metadata are guarded, with 126 local
tests passing at that checkpoint. Process ownership, dispatch, stop proof and
maintainer reconciliation are delivered or under B18 review as detailed in backlog.
This checkpoint does not advance an M2b exit gate.

B05 ownership checkpoint (2026-11-03): service startup acquires an exclusive per-home lock before reconciliation and releases it on close or failed initialization. Stale crash locks fail closed. 129 local tests pass. Executor and M2b acceptance remain pending.


The normative contract is [task-contract.md](task-contract.md); these steps implement
it and nothing beyond it.

1. **Capability gate — passed after B06/#20.** Eight isolated pinned-host runs
   passed after readiness and cleanup corrections. The earlier failure was startup
   timing. MCP remains selected; the HTTP fallback is not selected.
2. **Task store.** JSON records with atomic writes, an idempotency index and startup
   reconciliation; tests for duplication, crash and restart behavior. **Complete
   (2026-11-02).**
3. **Service surface.** The four operations with strict validation, ownership,
   allowlist clamping, limits and sanitized errors. **Fixes locally validated (2026-11-02):**
   83 suite tests and nine review reproductions passed.
4. **Executor adapter.** One OpenCode CLI subprocess in an isolated worktree and
   branch, collecting diff, changed files and test evidence; cancellation is advisory.
   B12 scheduling/dispatch is merged through #25, with real Node/Git fixtures,
   a pinned OpenCode service-dispatch fixture and passing Windows/Ubuntu CI.
   B13 artifacts are merged. B14 covers cancellation and stop evidence.
5. **Client integration.** One real submission, poll and result retrieval through the
   pinned client.
6. **M2b acceptance run.** Execute the acceptance tests in the contract plus one real
   task on a scratch branch, and record the evidence.

The remaining M2b work includes the final acceptance evidence/review cycle; B18
maintainer recovery is merged. M3/B20 then needs
B17/B18, an authorized available real-model execution path and a real approved
repository task. The current adapter is fixture-only, so provider/model support
and authorization must be established before that experiment. B08 schema adoption
and B19 diagnostics are supporting work; later storage, fallback, memory and
routing tasks do not block basic M2b/M3 acceptance.

Do not add routing, memory, remote access, automatic fallback or an automatic merge in
M2b. Do not install candidate dependencies because they appear in the reuse table.

## Primary acceptance experiment: develop this repository

The maintainer's intended next workflow is a simpler implementation model followed
by a more capable review model, PR findings, correction and re-review. The
[PR feedback protocol](pr-review.md) defines today's manual process (B26).
After B20 proves real delegation, scope a sequential two-model controller with
durable phase/feedback receipts, exact-commit review and bounded correction rounds.
This remains planned: it needs a workflow contract/ADR and separate task cards.
It can run one role at a time before general M5 routing/concurrency; it does not
require failure-driven fallback to alternate developer and reviewer tasks.

- Choose a small real backlog item, such as a fixture and regression test.
- First validate the service contract and failures with a simulated worker/provider.
- Configure one real authorized model and an isolated branch with a recorded base.
- The primary LLM submits through the integration and receives a task ID promptly.
- Execution continues between status queries without one long-running client call.
- The primary LLM queries progress and retrieves the worker's diff, changed files,
  test commands/results, attempts, limitations and known or explicitly unknown cost.
- Review the result against the original acceptance criteria; the maintainer
  approves any merge. The worker cannot grant itself broader permissions.
- Repeat submission/reconnect must not silently launch duplicate work. Uncertain
  execution after a crash must remain blocked until reconciled.
- Direct edits or test execution by this development chat do not count as M3.

## Supervision and access boundaries

The primary LLM supervises when its client invokes it. Continuous background
monitoring or notifications need explicit client/runtime support and are not
promised by the service. Polling is sufficient for the first MVP.
A web client must support the interface and reach the service; localhost is not
automatically reachable from the web. Remote exposure and authentication require
an explicit design and authorization, not an implicit tunnel.

Workers receive scoped repository/tool/model permissions. Task text and returned
artifacts cannot enlarge them. Cancellation is a request, not proof that effects
were undone. Agents may propose policy changes but cannot change their own
allowlist, budget, credentials or permissions during the affected run.
Authorization to commit during this development session is not permission for
future workers to merge autonomously.

## Risks and reuse references

| Risk | Response |
| --- | --- |
| Building another general framework | Prefer a small integration; test existing components before custom implementation |
| Client/transport incompatibility | Select one supported client first and document a tested compatibility matrix |
| Duplicate work or uncertain side effects | Stable task identity, persisted lifecycle and conservative reconciliation |
| Concurrent repository edits | Fixed base/runtime and isolated workspace per task; bounded concurrency later |
| Unavailable free models or unknown costs | Simulation first, explicit provider authorization and reported limits |
| Sensitive artifacts or remote access | Task ownership, scoped artifact access and sanitized reports |

Evaluate [Yuri Oliveira's repository](https://github.com/yurioliveira3/ia-hands-on-agents)
for agent-loop/MCP, evaluation and token-accounting ideas in M3/M5. Nothing has
been imported. Pin a SHA and verify licenses, dependencies and compatibility before reuse.
Evaluate [ai-memory](https://github.com/akitaonrails/ai-memory) for M4 rather than
recreating semantic memory. Other candidates are evaluation options, not approved
dependencies or established compatibility claims.

Update evidence at each milestone. See [handoff](handoff.md) for continuation.

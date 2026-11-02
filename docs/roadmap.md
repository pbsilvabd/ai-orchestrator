# Roadmap — developing AI Orchestrator using itself

Updated 2026-11-02. Ordering follows dependencies and evidence; dates are not
promised before integration is validated. Initial owner: the maintainer assisted
by agents. Approval of external effects remains with the maintainer.

## Destination

Use AI Orchestrator on OpenCode to select a task from its own backlog, make changes
on an isolated branch, test, review and deliver a diff with evidence. Switch only
between authorized models when safe; preserve history and decisions across
sessions; minimize costs without bypassing limits. The system should improve
itself without granting itself permissions.

## Where we are

Pure policy with allowlist, cooldown, attempt limits and uncertain-replay blocking;
in-memory demo; static audit of two plugins; local ledger and runner. A real
OpenCode smoke test passed for session/context, explicit model switching and
denied writes. The fallback adapter, integrated memory and autonomous task cycle
are still missing. The project has NOT yet been used to develop itself.

## Milestones

| Milestone | Status | Delivery and exit criterion |
| --- | --- | --- |
| M0 — Verifiable foundation | Complete | Policy, pinned audit, ADR and local suite without APIs |
| M1a — HTTP boundary | Complete | Normalized Retry-After, invalid cases blocked, loopback 429/503 to B and auth/effects to stop |
| M1b — Operational safety | Complete within local scope | Tested runner cancellation/budget, checkpoint, lock and correlation; limits in ADR-004/005 |
| M2 — OpenCode 2.2.5 bootstrap | In progress: real smoke passed | Fallback adapter and five host failure scenarios remain; session/context/explicit switching/deny-write validated |
| M3 — First use on this project | Priority; depends on M2 | One small real task, two configured authorized models, branch, diff, tests and report; human review before merge |
| M4 — Memory and continuity | Planned; depends on M3 | Evaluate/integrate ai-memory; a new session retrieves decisions and pending work without confusing memory with execution state |
| M5 — Capability/cost routing | Planned; depends on M3 | Catalog separate from authorization, tool/context compatibility, metrics and limits measured against a baseline |
| M6 — Multi-agent work and public release | Future; depends on M4/M5 | Bounded delegation, cross-review, global budget, installation docs and reproducible release |

Complete always means within the row's scope: M1a does not establish M2.
See the [Definition of Done](definition-of-done.md) for common and release gates.

## Completed foundation: M1b; next cycle: M2

1. Complete: operation/attempt identity and success/failure events; stale events rejected.
2. Locally complete: persistence before dispatch, atomic updates and a single-writer lock.
3. Complete in local tests: blocking after crashes, corruption, concurrent locks and duplicate events.
4. Locally complete: timeout/cancellation without assuming effects are undone; per-invocation budget.
5. Write the adapter ADR before connecting public hooks in the pinned OpenCode version.

## M2 to M3 bootstrap experiment

- Select a low-impact task, such as adding a fixture and regression test.
- First run with a simulated provider in OpenCode and inject a 429 failure.
- Configure local/free/subscription models only after verifying authorization and availability.
- Run the same workflow with a real model, bounded budget and no repository credentials.
- Record task ID, base/head, chosen model, attempts, commands and sanitized results.
- Success means a useful reviewed diff, passing tests, no out-of-scope changes, a recoverable session and no duplicated effects. Failure must leave an explainable state.
- Running tests directly in this chat does NOT count as the project's first self-development task.

## Limits on self-improvement

Agents may propose code and policy changes, but cannot change their own allowlist,
budget, credentials or permissions during execution. Such changes require review
outside the affected run. Autonomous merge is outside the first-use scope;
maintainer authorization for commits in this session is not permanent permission
for the future runtime.

## Risks and pending decisions

| Risk/decision | Response before proceeding |
| --- | --- |
| Incompatible SDK/plugins or unsafe replay | Test the pinned host; adapt only what is needed, without automatic activation |
| Free provider unavailable | Require a simulator; local fallback depends on available hardware and models |
| Concurrent changes to its own code | Fix the branch/base per task and runtime during execution |
| Tests approve the wrong implementation | Observable acceptance cases and human diff review |
| Privacy/cost | Per-task allowlist and metrics without sensitive content; no implicit billing activation |

Update this document with validation evidence at each milestone.
Low-cost continuation point: [handoff](handoff.md).

## Reuse reference: ia-hands-on-agents

Evaluate [Yuri Oliveira's repository](https://github.com/yurioliveira3/ia-hands-on-agents)
in M3/M5: agent loop/MCP, evaluations, token measurement and confidence routing in
Demo 3. Preliminary documentation inspection only; no code/dependency imported.
Before reuse, pin a SHA and check file licenses/attribution, dependencies, cost and
OpenCode 2.2.5 compatibility. Measure on our task set; educational results do not
replace operational tests. Favor reuse where appropriate without changing the
architecture now.

For M4, evaluate [ai-memory](https://github.com/akitaonrails/ai-memory) rather than
recreating its semantic memory features.

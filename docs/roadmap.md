# Roadmap — delegated workers, tested through our own development

Updated 2026-11-02. Milestones follow dependencies and evidence, not promised dates.
The maintainer owns scope and permissions; the primary LLM supervises delegated work.

## Product objective

AI Orchestrator is a pluggable worker service for a primary LLM running in a
compatible local or web client. The primary LLM plans, delegates, checks progress
and reviews results. AI Orchestrator executes authorized tasks through workers and
returns artifacts and evidence. The primary LLM need not perform each execution step.

The first and primary end-to-end test is development of AI Orchestrator itself:
the primary LLM delegates a small backlog task, a worker changes an isolated branch,
runs tests, and returns a diff and report for review. No automatic merge.

OpenCode 2.2.5 is the first candidate worker executor, not the mandatory interface
for the supervising LLM. MCP is the preferred interface to evaluate for compatible
clients; an API is an alternative. Neither interface is implemented yet.
See [ADR-006](adr/006-worker-service.md).

## Where we are

M0/M1a/M1b remain complete within their original local scope: policy, HTTP
normalization, ledger, runner and 43 local tests. The real OpenCode smoke passed
for context/session continuity, explicit model switching and denied writes.
There is no task service, MCP/API endpoint, worker adapter, integrated fallback,
semantic memory or completed self-development workflow.

The existing runner executes an operation; it is not a durable task scheduler.
Its budget is per invocation, and its ledger does not persist task artifacts or
authenticate clients. The new objective does not imply these features already exist.

## Milestones

| Milestone | Status | Delivery and exit criterion |
| --- | --- | --- |
| M0 — Verifiable foundation | Complete | Policy, pinned plugin audit, ADRs and local tests without AI APIs |
| M1a — HTTP boundary | Complete | Retry-After normalization and conservative loopback failure tests |
| M1b — Operational safety | Complete locally | Correlation, checkpoint, lock, runner cancellation and per-invocation budget; ADR-004/005 limits apply |
| M2a — Contract and reuse decision | Next | Specify task lifecycle, ownership, authorization, artifacts and interface; compare existing components against acceptance cases and record a pinned reuse/build decision |
| M2b — One-worker delegation MVP | Planned; depends on M2a | A real compatible client submits a task, receives an ID, polls status and retrieves a result from one worker; duplicate submission, cancellation and uncertain restart tested |
| M2c — Safe model fallback in a worker | Pending; depends on M2b | Controlled 429, two failing models, restart, failure after effects and safe return to preferred model validated in the executor |
| M3 — First self-development task | Primary acceptance target; depends on M2b | Primary LLM delegates a real repository task; one authorized worker returns a scoped diff, test evidence and report; human review before merge |
| M4 — Memory and continuity | Planned; depends on M3 | Evaluate ai-memory reuse; retrieve decisions and pending work across sessions without using semantic memory as execution authority |
| M5 — Routing and multiple workers | Planned; depends on M3 and M2c | Capability/cost routing, bounded concurrency, task-level budgets, isolated workspaces and review workers validated against a baseline |
| M6 — Broader clients and release | Future; depends on M4/M5 | Tested client/platform matrix, authenticated remote access where supported, reproducible installation and release evidence |

M2 is now split into M2a/M2b/M2c; its earlier host smoke remains useful evidence.
M3 may start with one authorized model and fallback disabled. Two models are
required for M2c, not for proving basic delegation. This changes sequencing without
waiving safety: ambiguous outcomes still block automatic replay.
See [Definition of Done](definition-of-done.md).

## Next increment: specify before implementing

1. Define a small task contract: objective, acceptance criteria, repository/base,
   allowed actions/models, execution limits and a duplicate-submission key.
2. Specify proposed submit_task, get_task_status, get_task_result and cancel_task
   operations. Choose and record the first supported client and transport.
3. Define persisted task IDs, lifecycle, client ownership, restart behavior, result
   retention and artifact access. Distinguish cancellation requested from work stopped.
4. Compare reuse options with synthetic fixtures before adding dependencies:
   OpenCode as executor; LiteLLM as a routing candidate; OpenHands as an alternative
   executor; LangGraph only if task durability warrants it. Do not combine all of them.
5. Pin versions/licenses and test compatibility, operational limits and maintenance
   cost. Implement only demonstrated gaps; preserve useful existing acceptance tests.
6. Produce the M2a decision and a bounded M2b implementation plan. Do not install or
   enable candidate plugins merely because they appear in the roadmap.

## Primary acceptance experiment: develop this repository

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

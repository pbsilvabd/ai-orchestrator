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
M2a is complete as documentation: the normative [task contract](task-contract.md)
and [ADR-007](adr/007-task-contract.md) select MCP over stdio with OpenCode 2.2.5 as
the first client, behind a capability gate, and record the reuse/build decision.
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
| M2a — Contract and reuse decision | Complete (2026-11-02) | Normative [task contract](task-contract.md), [ADR-007](adr/007-task-contract.md), pinned reuse table and a bounded M2b plan |
| M2b — One-worker delegation MVP | Next; depends on M2a (complete) | A real compatible client submits a task, receives an ID, polls status and retrieves a result from one worker; duplicate submission, cancellation and uncertain restart tested |
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

## M2b plan (bounded, in order)

The normative contract is [task-contract.md](task-contract.md); these steps implement
it and nothing beyond it.

1. **Capability gate.** Configure one local stdio MCP server in the pinned OpenCode
   2.2.5 host; prove tool discovery and one `tools/call`; record the transcript. If it
   fails, switch only the transport adapter to loopback HTTP and amend ADR-007.
2. **Task store.** JSON records with atomic writes, an idempotency index and startup
   reconciliation; tests for duplication, crash and restart behavior.
3. **Service surface.** The four operations with strict validation, ownership,
   allowlist clamping, limits and sanitized errors.
4. **Executor adapter.** One OpenCode CLI subprocess in an isolated worktree and
   branch, collecting diff, changed files and test evidence; cancellation is advisory.
5. **Client integration.** One real submission, poll and result retrieval through the
   pinned client.
6. **M2b acceptance run.** Execute the acceptance tests in the contract plus one real
   task on a scratch branch, and record the evidence.

Do not add routing, memory, remote access, automatic fallback or an automatic merge in
M2b. Do not install candidate dependencies because they appear in the reuse table.

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

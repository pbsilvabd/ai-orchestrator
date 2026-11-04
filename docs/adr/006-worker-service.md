# ADR-006 — A worker service supervised by the primary LLM

Date: 2026-11-02. Status: accepted product direction; transport and dependencies pending evaluation.

## Context

The maintainer wants to connect a primary LLM to AI Orchestrator as a team of
workers. The primary LLM delegates and monitors; workers execute development or
other tasks and return evidence. Our own repository is the primary acceptance
workload. A general-purpose model router alone does not fulfill this objective.

## Decision

Build a small pluggable worker service, reusing existing execution infrastructure.
OpenCode 2.2.5 is the first executor candidate. It is not the required client for
the primary LLM. Evaluate MCP first for a compatible client, with an API as an
alternative; this ADR does not select a concrete transport or promise support
for every local/web application.

The proposed task interface has submit_task, get_task_status, get_task_result
and cancel_task. Submission returns a stable task ID; execution is independent
of a single waiting client call. The contract must specify duplicate requests,
persisted lifecycle, ownership, scoped permissions/budgets, cancellation,
reconciliation and artifacts before implementation.

Start with one worker and one authorized model. Deliver a real self-development
task with an isolated branch, diff, test evidence and human review. Add safe
in-worker fallback separately; uncertain outcomes must block even without fallback.
M2 is split into contract/reuse (M2a), delegation (M2b) and fallback (M2c).
M3 depends on M2b; it need not wait for automatic model switching.

Reuse before building: evaluate execution and routing components against our
tests, record versions/licenses and implement only missing behavior. Existing
policy, ledger and runner remain useful, but may be adapted or replaced if a
tested component satisfies their requirements.

## Consequences

The README, roadmap, requirements and DoD now describe delegated workers.
ADR-001 through ADR-005 remain records of the local foundation; this decision
changes the product boundary and implementation order, not their safety limits.

A task service needs more than the current operation ledger: task identity,
ownership, persistent task status/results and task-level limits remain unimplemented.
The current per-invocation deadline is not a durable task budget.

Supervision requires the primary client's next invocation; background monitoring
is not automatic. Web access requires compatible tools, reachability and an
authenticated deployment design. No public endpoint or tunnel is authorized by
this decision. Neither workers nor result text can grant permissions, override
limits or merge their own changes without authorized review.

Acceptance is actual delegation through the interface followed by a useful,
reviewed change to this repository. Mock tests and edits made directly in the
development chat do not establish that acceptance.

### Amendment — 2026-11-03: B11 launch boundary

The OpenCode launch builder consumes the persisted task plus trusted service
configuration, checks for one exact model and supported tools, verifies task limits
and writable globs, then emits a deny-by-default permission ruleset. The initial
supported tool set is `read` and `edit`; shell access is rejected because OpenCode's
shell permission resource is command text rather than a filesystem path. Prompt text
is passed as one positional JSON-data message and cannot add CLI switches or alter the
generated configuration. The host receives an explicitly constructed environment and
isolated config/data/state paths; plugins, MCP servers, instructions and skills are
disabled for this launch.

The B11 implementation currently allows only a local loopback fixture provider. This
is enough to test the actual pinned host without paid calls or credentials, but it is
not production provider support. The builder is not yet called by the durable task
service or scheduler. OpenCode permission rules do not provide an OS sandbox or an
outbound network boundary; remaining ambient OS variables needed by the host, including
`PATH`, require a later deployment review.

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

The launch builder rejects a workspace containing symbolic links or junctions because
OpenCode's path permissions match lexical workspace paths; a link under an allowed glob
could otherwise redirect a write outside the authorized workspace. This preflight
check does not protect against concurrent filesystem changes, so a production worker
still requires OS-level isolation.

### Amendment — 2026-11-03: FIX23

Symbolic-link checks alone do not detect hard links. Refuse regular workspace files
whose link count is not one, preserving private file instances for host edits. The
current loopback fixture provider accepts only the credential variable FIXTURE_API_KEY;
an explicit allowlist replaces the incomplete environment denylist. Further providers
need deliberate credential-name support. These are launch checks, not protection
against concurrent filesystem mutation or a replacement for OS isolation.

### Amendment — 2026-11-14: B19 manual diagnostic pulse boundary

The optional B19 harness is a manually invoked CLI outside the task service, MCP
operations and scheduler. It runs exactly eight isolated capability-gate subprocesses
against an explicitly supplied trusted OpenCode 2.2.5 binary and records every
original outcome, phase and bounded sanitized transcript. A retry is a separately
identified diagnostic record and cannot replace an original failure or alter its
denominator. It uses only the gate's local loopback fixture provider; it adds no
provider configuration, scheduling, model ranking or task executable surface.

The optional task-history track is available only when tracked B17 evidence passes.
It is a distinct read-only report mode: it reads one explicit regular task record
without opening the store or invoking reconciliation, writes, scheduling, gate launch
or task replay. It uses the pure store record validator plus conservative lifecycle
checks. Blocked/uncertain work, including administrative closure with unknown
outcomes, remains refused; coherent known-failure reconciliation may be observed.
Terminal state is not substituted for missing test evidence. Returned text is
sanitized/bounded before persistence, and the exclusive report must be outside the
selected task home.

Pulse launches are contained independently of the B10 root-only subprocess primitive.
Windows uses the existing B16 creation-time Job Object helper and verifies an empty
job; POSIX uses a dedicated process group with bounded TERM/KILL teardown and
empty-group verification. POSIX verification covers only members remaining in the
group; a `setsid`/otherwise escaped descendant may remain and is not claimed stopped.
Root exit is recorded separately and never proves the tree stopped. Timeout or
unverified cleanup halts samples, suppresses all pulse retries, marks the remaining
original slots `not_run`, and retains scratch. The gate preserves original phase and
cleanup phase/status independently even if both probe and cleanup fail. This
diagnostic evidence does not establish M2b/M3 completion or production-provider
behavior.

### Amendment — 2026-11-22: delivery sequencing after fixture preparation

This is a planning decision, not a change to runtime authority. B12–B19 and B29
are merged; B30/#45 and B20/#43 remain incomplete. Prioritize one deployable
single-worker path, explicit approval-profile design and reliable evidence before
SQLite migration, semantic memory, expanded platforms, fallback or general routing.
Use the existing B30/B20 PRs instead of replacing them with competing checkpoints.
Reconcile B17/M2b fixture acceptance independently; that documentation decision
need not wait for hardware, live-provider use or B30 deployment.

One declared deployment path is sufficient for its own acceptance; it does not
establish other platforms. A Linux test host may itself be virtual. The hardware
FIDO2 requirement is specific to B30's selected approval design, not an intrinsic
product requirement; evaluating a software-signature profile in #47 does not
replace that design. Any replacement must deliberately update ADR, code, tests
and normative contract before changing activation gates, with a separate threat
model and positive cryptographic evidence. No UP/UV equivalence is inferred.

See [the reassessment](../project-reassessment-2026-11-22.md) and issues
[#46](https://github.com/pbsilvabd/ai-orchestrator/issues/46),
[#47](https://github.com/pbsilvabd/ai-orchestrator/issues/47) and
[#48](https://github.com/pbsilvabd/ai-orchestrator/issues/48).
No live run, key enrollment, network change or merge is authorized here.

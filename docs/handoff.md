# Continuation point — 2026-11-02

M0/M1a/M1b are complete within the local scope of the ADRs. M2a is complete as
documentation: the normative [task contract](task-contract.md) and
[ADR-007](adr/007-task-contract.md) fix the operations, lifecycle, ownership, limits,
artifacts, the first transport and the reuse decision. M2b step 1 (MCP capability
gate) had one pass and one later failure on 2026-11-02; the root cause is unresolved
and the gate is not considered consistently validated. M2b step 2 (durable task store
and idempotency index) is complete. Step 3 service-surface fixes passed independent review: 83 suite tests and nine
regression reproductions passed. There is no transport adapter or self-development use yet.

## Next action: resolve MCP gate instability before executor integration

Review checkpoint (2026-11-02): see [PR review](review-2026-11-02.md) and
[agent backlog](backlog.md). The review baseline is main `a4cae9c`; its 83 local
tests pass. The old executor/client/acceptance branches are incomplete and must
not be merged as completed steps. Pick an unblocked backlog task from current
main. No milestone, MCP gate result or maintainer decision changed in this review.

1. The MCP capability gate had one pass and one failure during the probe on
   2026-11-02. Discovery/cataloguing/call were observed in a passing run, but the
   inconsistent outcome is unresolved. Do not rely on it as a stable CI gate. Details
   are in [validation](validation.md).
2. The durable task store was implemented and validated (`src/tasks.mjs`, ADR-008):
   atomic records, client-scoped idempotency and startup reconciliation.
3. Review the service fixes in `src/service.mjs` and regression tests. Rerun
   `node --test` and `node examples/fallback-demo.mjs`. The separate PR review
   reproductions and their result are recorded in [validation](validation.md). Only
   then decide whether step 3 is complete.
4. After service acceptance, proceed with one executor adapter (OpenCode CLI in an
   isolated worktree). **Next implementation step after the gate is stable.**

Do not add routing, memory, remote access, fallback or automatic merge in M2b. The
HTTP fallback is not selected; change transport only through a new ADR-007 amendment.

## Contract rules that must not drift

- Persist the task before any worker starts; a persistence failure accepts no task.
- Same idempotency key and payload returns the same task ID; a different payload is a
  conflict. No silent duplicate work.
- `blocked` is terminal until a human reconciles it; nothing resumes automatically
  after a restart, and a persisted dispatch is never replayed.
- Cancellation is a request. `executionStopped` is `unknown` after abort/crash and
  `effectsReverted` stays `false`.
- Task text and artifacts never grant permissions; authorization is clamped to the
  configured allowlist.
- Success claims need a recorded command and exit code; otherwise report a limitation.
- Result and status access are owner-only; `clientId` comes from configuration.

## Run and validate

`node --test` and `node examples/fallback-demo.mjs` (Node 24.22.1, via fnm). No
dependency installation or credentials are required. Tests must use temporary state
directories, never the developer's real `AI_ORCHESTRATOR_HOME`.

The real smoke harness remains useful as the executor reference:
`node integration/opencode-smoke.mjs <absolute-path-to-opencode.exe>`. The verified
2.2.5 binary lives outside the repository (see integration/README.md). The MCP
capability gate runs separately:
`node integration/mcp-gate.mjs <absolute-path-to-opencode.exe>`.

## Existing API (reuse, do not bypass)

`createState(sessionId)`, `select(state, models, options)`, `success(state, dispatch)`,
`failure(state, dispatch, error, options)`, `nextOperation(state)` in
`src/policy.mjs`. `openSession(directory, sessionId)` in `src/ledger.mjs` provides the
exclusive lock and atomic checkpoint. `runOperation` in `src/runner.mjs` adds
cancellation and the per-invocation budget (ADR-005). Dispatch identity is the original
object from `select`; never rebuild it from current state. State version 1 is rejected
without migration.

The smoke test proved session/context continuity, explicit model switching and denied
writes against the pinned host. SDK retry changes retry/delay, not the readonly model.
Close `child.stdin` because the run waits for EOF. Abort does not undo effects.
Locks left by a crash require manual reconciliation and are never removed automatically.

There is no event authentication, exactly-once guarantee or power-loss guarantee.
Ledger scope is a trusted local directory with cooperative writers; network
filesystems are unsupported.

## Workflow

Work on a branch, open a PR and never force push. Every change appends an entry to
[worklog](worklog.md), updates [roadmap](roadmap.md) and this handoff when the next
action changes, and records commands/results in [validation](validation.md). Decisions
and dependency changes need an ADR amendment. Documentation is maintained in English.

Evidence levels stay separate: unit, local HTTP, OpenCode integration and use on this
project. Mocks do not satisfy an integration gate, and direct edits in a development
chat do not count as M3.

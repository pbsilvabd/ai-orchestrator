# Continuation point — 2026-11-02

M0/M1a/M1b are complete within the local scope of the ADRs. M2a is complete as
documentation: the normative [task contract](task-contract.md) and
[ADR-007](adr/007-task-contract.md) fix the operations, lifecycle, ownership, limits,
artifacts, the first transport and the reuse decision. M2b step 1 (MCP capability
gate) had one pass and one later failure on 2026-11-02; the root cause is unresolved
and the gate is not considered consistently validated. M2b step 2 (durable task store
and idempotency index) is complete. Step 3 service-surface fixes passed independent review: 83 suite tests and nine
regression reproductions passed. There is no transport adapter or self-development use yet.

## Next action: review B05 service ownership and proceed with B03/B06

B05 checkpoint (2026-11-03), branch `task/B05-service-owner`: service ownership uses an exclusive lock file created before reconciliation. A second owner fails closed; call `service.close()` on graceful shutdown. Initialization failures release the lock. Crash leaves a stale lock for maintainer inspection; no automatic deletion. 127 tests and fallback demo pass.

Review the B05 PR, then proceed with B03 repository identity or B06 MCP gate diagnosis. Executor integration still depends on the MCP gate.
## Next action: review lifecycle guards and establish service ownership

B04a implementation checkpoint (2026-11-02), branch `task/B04-lifecycle-guards`:
the store rejects illegal ordinary transitions, immutable identity/request edits,
incoherent state metadata and late terminal lifecycle rewrites. 126 local tests
pass; the fallback demo prints 429 then 200. See the task contract's Store
enforcement section and ADR-008 amendment. This is not completion of M2b.

Next: review B04a, then implement B05 (one service owner per state directory)
before connecting the executor. B03 repository validation and B06 MCP diagnosis
can be developed independently with fixtures; real transport/executor integration
still requires resolving the gate. For a small independent continuation, B01
(safe unknown-key diagnostics on the schemas branch) is ready to implement with
regression tests. Do not merge the old executor/client/acceptance branches.

Remaining B04-related work is scoped to B12 dispatch production, B14 stop proof
and B18 maintainer-only reconciliation. No generic callback may leave blocked.

Review checkpoint (2026-11-02): see [PR review](review-2026-11-02.md) and
[agent backlog](backlog.md). The review baseline is main `a4cae9c`; its 83 local
tests pass. The old executor/client/acceptance branches are incomplete and must
not be merged as completed steps. Pick an unblocked backlog task from current
main. No milestone, MCP gate result or maintainer decision changed in this review.

1. Review B04a against its tests and contract. This branch is an implementation
   checkpoint, not a merged or end-to-end acceptance claim.
2. Implement B05 process ownership before startup reconciliation and executor
   connection. A second service must not rewrite the first service's running tasks.
3. B03 repository validation and B06 gate diagnosis can proceed independently. The
   MCP gate still has one recorded pass and one failure; resolve the cause before
   real transport integration. B01 is a smaller independent task for a fresh agent.
4. Build the executor with isolated workspaces and fixture subprocesses; real host
   acceptance follows only when the prerequisites and MCP gate are verified.

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

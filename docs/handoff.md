# Continuation point — 2026-11-04

Remote main is `488e57ad817dbdf19496a2eb07c09be66c18c2aa`, including FIX23/#24,
B11/#23 and FIX17-18/#22. Main CI run 41759929003 passed. No open PRs were found.
The mirrored ChatGPT project snapshot is older and is not a Git checkout. This
branch uses the actual repository checkout; fetch again before editing.
M2a is complete; ADR-007 still selects OpenCode 2.2.5 and MCP stdio revision
`2026-07-28`. B06 passed eight isolated pinned-host runs; HTTP was not selected.

## Current task: B12 — publication and merge authorized

Branch `task/B12-durable-scheduler` starts at remote main `488e57a`. The opt-in
single-worker scheduler persists running/attempt/workspace identity before setup
and spawn, serializes new submissions, never requeues duplicates or preexisting
records, and blocks uncertain results. Active shutdown retains ownership because
abort is not stop proof. The real OpenCode fixture now covers service-to-worker
dispatch as well as the original authorization regressions.

Local validation after the CI correction: 209 passed, zero failed, one POSIX-only skip; host fixture and
fallback demo passed. Read the current validation entry and B12 card for evidence
and both self-reviews. No paid/external provider was used. M2b/M3 remain incomplete.

The maintainer subsequently authorized publication and merge based on this agent's
completed review (2026-11-04). That supersedes the earlier publication hold; no new
confirmation is needed for B12. Verify the published head, feedback and Windows/Linux
CI before merging the same PR. PR #25 is published. Its first Windows CI run
exposed B12-01 failure; a directory-alias regression reproduced mismatched planned
and canonical workspace receipt paths. The scheduler now canonicalizes the root
before reservation. The regression failed before the fix; focused/full/host/demo
checks pass after it. Verify fresh Windows/Linux CI on the corrected head before
merging; the original `69aa920` validation is not the latest runtime evidence.

FIX23/#24 has no independently published review; local source review and repeated
pinned-host regressions passed. The maintainer accepted this implementing-agent
review for the merge decision; do not relabel it as independent review. Once the
authorized B12 PR is merged, proceed to B13 artifacts; B14 requires both B12/B13.
Do not add transport, providers, fallback or automatic merge capabilities to B12.

## Historical FIX23 checkpoint before PR #24 merged

Review `task/FIX23-authorization` under [FIX23](tasks/FIX23.md). It rejects multiply
linked files before host launch, restricts provider environment to FIXTURE_API_KEY,
and gives subprocess-test cleanup bounded retries for transient Windows cwd locks.
Local validation: 193 passed, one POSIX-only skip; pinned OpenCode 2.2.5 harness
passed hard-link/config-override rejection and original denied/allowed writes.
Independent review and current-head CI are required before merging this correction.
Proceed to B12 only after FIX23 is reviewed and merged. No merge is authorized by
this handoff. The original B11 checkpoint below is historical context.

## B11 checkpoint before FIX23 review

Branch: `task/B11-authorized-opencode`, base `093e050`. The B11 builder and test
fixture implement one exact configured model, `read`/`edit` only, exact relative
writable globs, bounded time/output and an isolated OpenCode environment. `bash` is
rejected. The pinned OpenCode 2.2.5 fixture denied a write outside `src/**` while
ambient configuration and a credential sentinel were present in the parent process.
All model requests went to the loopback fixture provider; no paid or external request
was made. Unit, full-suite, demo, diff and review evidence is recorded in
[validation](validation.md).

The B11 builder is not integrated with `createTaskService` or the scheduler. It only
accepts a loopback fixture provider today, is not an OS sandbox/network firewall, and
does not support production provider credentials. B11 is published as [PR #23](https://github.com/pbsilvabd/ai-orchestrator/pull/23);
review and CI are pending. Do not claim B11/M2b complete until required review,
acceptance and checks are satisfied. PR CI run 41756163116 passed on Windows and
Ubuntu at head `8eb9ac0`; review is pending. Proceed to B12 only after PR #23 is
reviewed and merged by a maintainer. Follow [the feedback protocol](pr-review.md).

The planned two-model development/review cycle requires B11–B20 delegation work,
then a scoped controller design. See the protocol and roadmap. These instructions
do not advance a runtime milestone or authorize merge.

## B03 checkpoint (2026-11-03, branch `task/B03-repo-identity`)

Repository identity validation is enforced on new task submissions. `src/repository.mjs` executes Git commands
via argument arrays without a shell. `baseRef` commit-ish resolves to a full commit SHA stored as immutable
metadata `task.baseCommit`. Branches are checked against Git ref rules, local existence and linked worktrees.
Idempotent replays bypass repository inspection and return the original record. Sibling paths and symlink escapes
fail closed with `authorization_denied`. Dirty parent working trees are accepted with user files unchanged.
141 tests pass; fallback demo returns 429 then 200.

## Earlier B05 checkpoint (merged through PR #14)

B05 checkpoint (2026-11-03), branch `task/B05-service-owner`: service ownership uses an exclusive lock file created before reconciliation. A second owner fails closed; call `service.close()` on graceful shutdown. Initialization failures release the lock. Crash leaves a stale lock for maintainer inspection; no automatic deletion. 129 tests and fallback demo pass.

Proceed with the detailed B03/B06/B07/B10 cards. Executor integration still depends
on the MCP gate and the declared executor prerequisites.
## Earlier B04a checkpoint (merged through PR #13)

B04a implementation checkpoint (2026-11-02), branch `task/B04-lifecycle-guards`:
the store rejects illegal ordinary transitions, immutable identity/request edits,
incoherent state metadata and late terminal lifecycle rewrites. 126 local tests
pass; the fallback demo prints 429 then 200. See the task contract's Store
enforcement section and ADR-008 amendment. This is not completion of M2b.

B01 diagnostics were corrected on the schemas branch (#8). B03 repository identity
and B06 MCP diagnosis are the next independent development items.

Remaining B04-related work is scoped to B12 dispatch production, B14 stop proof
and B18 maintainer-only reconciliation. No generic callback may leave blocked.

Review checkpoint (2026-11-02): see [PR review](review-2026-11-02.md) and
[agent backlog](backlog.md). The review baseline is main `a4cae9c`; its 83 local
tests pass. The old executor/client/acceptance branches are incomplete and must
not be merged as completed steps. Pick an unblocked backlog task from current
main. No milestone, MCP gate result or maintainer decision changed in this review.

1. B04a was merged through PR #13.
2. B05 ownership is implemented and reviewed in PR #14; service handles become
   unavailable after close, and crash locks require maintainer inspection.
3. B03 repository validation and B06 gate diagnosis can proceed independently. The
   MCP gate still has one recorded pass and one failure; resolve the cause before
   real transport integration. B01's existing correction remains on open #8.
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

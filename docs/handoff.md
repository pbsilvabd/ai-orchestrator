# Continuation point — 2026-11-14

B30 fixture-only implementation on `task/B30-free-relay` (base `688da04`, merged
with B29 main `11fcb42`). The relay, egress gateway, SSHSIG approval/admission and
an isolated WSL2 netns/veth containment observation are implemented and tested;
live composition remains closed and no merge is authorized.

- `src/relay.mjs` — fixed single-upstream relay, redirect refusal (301/302/303/
  307/308), independent request/byte/time bounds, fail-closed lifecycle.
- `src/egress-gateway.mjs` — L7 egress gateway, CONNECT/redirect/unapproved-path
  refusal, sanitized logs, policy digest.
- `src/live-approval.mjs` — canonical SSHSIG live approval with `ssh-keygen -Y
  verify`, FIDO2 presence/verification flag enforcement, policy/metadata binding
  and a durable single-use approval ledger.
- `integration/b30-egress-namespaces.sh` — isolated WSL2 worker/relay netns + veth
  fixture with real socket probes (worker→relay reachable, worker→gateway/Internet
  denied, relay→Internet denied, relay→gateway reachable), fail-closed teardown.

`not_run` / still closed (ADR-009/010): nftables/iptables default-drop filtering
(absent, install not authorized — containment is routing-based); bare-metal Ubuntu
or two-VM Hyper-V deployment (WSL2 observation only); a real FIDO2 hardware-key
signing dry run; public catalog GET; live inference and B20/#43. The live route
stays closed until a platform provides verified firewall-filtered isolation and a
separately signed live approval.

Remote `main` is `11fcb422de47c2a9b79389de8470802d48ead730` (B29/#44 merged).
B12–B19 are merged; B29 is merged as fixture-only preparation. B20 remains draft
PR #43 and unmerged. M2b/M3 remain incomplete; the worker provider is fixture-only.

## Next action

1. Review the B30 draft PR at its current head, answer any findings, then the
   maintainer decides draft-to-ready. The draft PR lists the unmet criteria:
   firewall-filtered isolation, hardware-key signing dry run, catalog read and
   live activation are `not_run`, not passed.
2. Remaining B30 gates are platform/hardware, not code: nftables (or an approved
   alternative), a real FIDO2 `-sk` signing dry run, and a separately authorized
   catalog read before any live experiment.

## Historical B29 checkpoint (merged as PR #44)

B29 (`task/B29-opencode-free-provider`, base `688da04`) prepares one anonymous free route,
`opencode/deepseek-v4.1-flash-free`, with zero-price metadata validation, expiring
payload-bound operator approval, a service-owned guard plugin and the B11 launch
builder. On the pinned host a 307 from the model endpoint is followed and the prompt
body reaches the alternate origin; the guard cannot prevent or detect it, so live
composition is refused by `createConfiguredTaskService` and
[ADR-009](adr/009-free-anonymous-worker.md) is accepted only for fixture
preparation. `integration/opencode-free.mjs` exits 1 on this scenario by design.
B20 remains unexecuted.

## Historical B19 checkpoint (merged as PR #42)

The B19 manual pulse implementation is on `task/B19-opt-in-harness-pulse`, based on
`c268239`, with correction work on top of supervisor checkpoint `91e43e4`. It uses
Windows creation-time Job Object or POSIX process-group containment, halts on timeout
or unverified cleanup, and records original and cleanup phases separately. Retry
eligibility now requires the whole originals run to remain certain; an uncertain retry
produces one `not_run` result for each remaining candidate. POSIX settlement is bounded
and explicitly limited to process-group members (escaped descendants may remain).
History is a distinct B17-gated read-only mode using store validation and an exclusive
report outside the selected home. R5 focused tests passed twice, the full suite and
demo passed, B16's shared-helper workflow was rerun successfully, and the new
`docs/pulses/B19-r5-final.json` pinned-host artifact passed its assertions. The earlier
pinned-host artifacts remain unchanged. The supervisor's earlier focused-test failure
is recorded with its cause still unconfirmed because termination details were not
provided.
GPT-6.1 Sol verified the Luna high corrections and reviewed the complete diff and all
four acceptance rows. Independent final checks: six focused tests passed; full suite
290 passed with one existing POSIX-only skip; demo, syntax and diff checks passed.
Current-code B17 passed 13/13, including the changed shared Windows helper. The
supervisor pulse is `docs/pulses/B19-supervisor-final.json`: 7 pass, 1 injected original
fail, 0 not_run, one separate passing retry, denominator eight. No all-pass gate or
real provider/project service use is claimed.

## Next action: close B29 feedback and re-review the new fixture head

2026-11-14 fixture correction: `integration/mcp-free-workflow.mjs` now ran with
the pinned OpenCode 2.2.5 client through real MCP stdio and loopback-only
fixture composition. It observed queued/running/succeeded, a scoped diff and
passing test exit, a denied out-of-scope write and two duplicate submissions
without extra attempts/workspaces/model requests. New pinned fixtures preserved
partial effects after a drop and blocked/retained ownership after an uncertain
deadline. One local `node --test` run at `3c30866` passed 303 with one Windows
platform skip; later default-concurrency runs failed the pre-existing B10-03
timing case, while a serial run at `762c133` passed 304 with one skip. The
historical 307 still failed, delivering 7121 body bytes to a second loopback
origin. See the validation entries for native exits. Production `mcp-server.mjs` remains
passive/live-closed; no catalog, real provider, B20, relay or merge was run.
At `113e926`, PR #44's description and remote head were verified and Actions run
`43630565937` passed on Windows (305 tests/304 pass/0 fail/1 skip) and Ubuntu
(305 tests/301 pass/0 fail/4 skip), with the demo returning 429 then 200 on both. This is a green
rerun, not a repair of the create-then-write race in
`test/task-maintenance.test.mjs`: Windows run `43628743462` at `762c133`
failed and the test file is unchanged. Local default-concurrency runs can fail
on pre-existing B10-03 output timing and on five MCP-server output-wait
timeouts (B15-01c/01d/01e/01f/03b); the serial suite passed 304/1 skip.
Next, reply to the three P3 findings at `113e926`, verify the new head and
its CI, and obtain re-review before the maintainer decides draft-to-ready for
the fixture-only PR. Keep PR #44 draft until that decision, not because the
previous head's Windows check was red; neither a green rerun nor a developer
reply establishes deterministic default-concurrency stability or approval.
B30's separate branch cannot implement live use until
B29 is merged and verifiable deployment infrastructure exists; this Windows
host currently reports the required Hyper-V feature disabled. The following
decision checkpoint is historical and remains a live safety gate.

Review follow-up at `3c30866`: an independent reviewer reproduced the pinned
fixture MCP path and the 307 failure; Windows/Ubuntu CI passed at that head.
Four non-blocking P3 findings were published. This correction clarifies ADR-009
and the CLI header, exercises the real service outcome when approval expires
after admission, and records an independent full-suite run that failed the
pre-existing B10-03 timing case before a passing rerun. Revalidate the
correction head and reply to all four review threads before changing draft
status. No B30 gateway or live approval has been exercised.

Re-review at `762c133` verified those four replies, but reported three new
findings: Windows CI run `43628743462` failed in
`test/task-maintenance.test.mjs:183` (`Unexpected end of JSON input` while a
competing process was writing the file); Ubuntu passed. PR #44's body still
named `3c30866` and a green default suite, and the earlier status lines above
were misleading without their historical scope. The PR remains draft. Do not
interpret the independent local fixture-only verdict as a passing CI receipt
or redirect containment; the 307 still sent 7121 body bytes to another origin.

2026-11-14 decision update: ADR-009 is accepted **for fixture-only preparation**;
the live route remains closed. B29 is narrowed without rewriting its original
FAIL: complete B29-04 with an actual fixture MCP client, then re-review the new
head of draft PR #44. B30 is the separate live relay plus independently
verified worker-egress gate; the B30 card is prepared on its own branch, not
implemented in B29. Require pinned-host redirect and WebSocket-negative tests,
fresh authorized catalog evidence, and a maintainer-signed live approval bound
to the relay/egress policy before any real inference. The historical steps below
record the pre-decision state and do not supersede this update.

Historical pre-decision instructions (superseded by the update above):

1. Choose one option in [ADR-009](adr/009-free-anonymous-worker.md): a trusted loopback
   relay owned by the service (new trust boundary, needs its own card), a worker-host
   egress allowlist, a pinned host change exposing redirect control, or recorded
   acceptance of the redirect egress risk. Until a decision is recorded, keep the live
   composition closed and the B29 PR as draft.
2. Do not run the free route, a catalog GET, or B20 without a separate approval naming the
   model, privacy acknowledgement, objective and budget. Real inference is `not_run`.
3. B20 [PR #43](https://github.com/pbsilvabd/ai-orchestrator/pull/43) remains a draft and
   unmerged; its proposed `test/redaction-regression.test.mjs` was not implemented in B29.
   B19 is merged; its supporting diagnostics are not M3 evidence.

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
- Only the dedicated B18 maintenance path can reconcile `blocked`; generic updates and
  transports have no override. Recovery evidence, retention and lock limits are in
  [ADR-008](adr/008-task-store.md) and the [maintenance procedure](task-maintenance.md).
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
`openTaskMaintenance({ home })` in `src/tasks.mjs` provides exclusive local maintenance,
evidence-bound blocked recovery and journaled pruning; use the CLI/procedure instead of
direct file edits. Locks left by a crash require explicit PID/process-tree inspection
and audited recovery; PID absence alone does not prove descendants stopped.

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

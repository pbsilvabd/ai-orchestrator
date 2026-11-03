# Agent backlog — reviewed 2026-11-02

Baseline: `origin/main` at `a4cae9c`. See [review](review-2026-11-02.md) for evidence,
PR verdicts and limitations. These are proposed, unassigned task contracts, not
GitHub issues and not claims of implementation. No M2b completion is implied.

## How an agent picks up a task

Read AGENTS and its ordered sources. Fetch and inspect the remote, choose one task
whose dependencies are merged and verified, and create `task/<ID>-<short-slug>` from
current main. Check open PRs before duplicating Yuri's work. Record ID, base SHA and
owned files in the PR. One task per PR; split further when necessary.

Each task below requires focused behavior/failure tests, `node --test`, the fallback
demo, worklog and validation entries, and handoff/ADR/contract updates when their
rules trigger. Record actual Node/platform and exit codes. Use temporary state,
no paid calls, no credentials, no automatic merge or replay of uncertain outcomes.
Docs-only tasks need relevant link/content verification rather than new unit tests.
Evidence must distinguish fixtures, a real host and actual use on this project.

Do not merge `feat/m2b-executor-adapter`, `feat/m2b-client-integration` or
`feat/m2b-acceptance` unchanged. They are reference material with reproduced defects.
Do not reuse their test/evidence claims. Runtime integration must use
`createTaskService({ store, config })`, its camelCase methods and
`openTaskStore({ home })`; persisted input is `task.request`.

## Queue and dependencies

P1 = required for trustworthy M2b; P2 = supporting improvement; P3 = later milestone.
S = narrow PR; M = several coupled behaviors; L = integration task, may need splitting.

| ID | Priority/size | Task | Depends on | Main ownership |
| --- | --- | --- | --- | --- |
| B01 | P1/S | Correct checker diagnostics in PR #8 | none; work on #8 | contracts validator/tests |
| B02 | P2/S | Refine templates in PR #11 | none; work on #11 | docs/templates |
| B03 | P1/M | Git identity and canonical path validation | none | service + repository helper |
| B04 | P1/M | Lifecycle guards and state invariants | refine #9; no submit-schema dependency | tasks + lifecycle helper |
| B05 | P1/M | Single service owner and restart exclusion | none | startup + lock helper |
| B06 | P1/M | Diagnose MCP gate instability | none | integration/mcp-gate |
| B07 | P2/S | Deterministic Windows/Linux CI | none | .github/workflows |
| B08 | P2/M | Differential schema adoption | B01, accepted #8 | service + contracts |
| B09 | P1/M | Isolated Git workspace lifecycle | B03 | workspace helper/tests |
| B10 | P1/M | Bounded subprocess runner | none | subprocess helper/tests |
| B11 | P1/M | Authorized OpenCode launch configuration | B09, B10 | executor configuration |
| B12 | P1/M | Single-worker scheduler and durable dispatch | B04, B05, B09–B11 | scheduler/executor |
| B13 | P1/M | Honest artifact collection and result mapping | B09, B10 | artifacts + service results |
| B14 | P1/M | Cancellation, deadline and late completion | B12, B13 | executor + cancellation |
| B15 | P1/M | Four-operation MCP stdio server | B04, B05, B06 | transport/entry point |
| B16 | P1/M | Real-client task workflow | B12–B15 | client integration harness |
| B17 | P1/L | Executable 13-item acceptance matrix | B16 | acceptance harness/docs |
| B18 | P2/M | Maintainer reconciliation and cleanup | B04, B05, B14 | maintenance command |
| B19 | P2/S | Opt-in harness pulse | B06; track 2 after B17 | pulse harness/docs |
| B20 | P2/M | First supervised self-development task | B17, B18 + authorized model | M3 evidence |
| B21 | P3/M | Refine SQLite RFC and run capability gate | #6 amendments; after B17 | storage-gate fixtures/ADR |
| B22 | P3/L | Transactional store and offline migration | B21 passes + maintainer decision | storage/migration |
| B23 | P3/M | Safe worker fallback | B17 | executor + policy integration |
| B24 | P3/M | Memory reuse evaluation | B20 | research spike/docs |
| B25 | P3/M | Routing advisor evaluation | B20, B23 | offline eval fixtures/docs |

## Acceptance contracts

B04a checkpoint (2026-11-02, branch `task/B04-lifecycle-guards`): ordinary transition
guards, immutable identity/request fields and state metadata checks implemented;
126 local tests pass. The broader B04 objective is split: dispatch production stays
in B12, stop proof in B14 and the maintainer-only reconciliation operation in B18.
B05 process ownership remains required before real executor integration. B01 is a
small independent continuation task; check its current branch before editing.

### B01 — Safe schema diagnostics
Fix R5 in existing #8. Unknown keys never appear in paths/messages/logs; known
schema paths remain useful. Test short/long credential-shaped keys, control
characters and deep objects. Preserve the 106 existing tests and no runtime wiring.
Also document the checker's UTF-16 string-length convention before publishing
schemas as tool inputs; avoid claiming full JSON Schema conformance.

### B02 — Practical documentation templates
Amend #11 to represent proposed/accepted/superseded decisions and distinguish
unmerged PR records from merged history. Examples cannot claim a current gate
result or next step. Verify links at destination paths. Keep normative precedence;
do not rewrite historical entries or add mandatory boilerplate without a reason.

### B03 — Repository identity before acceptance
Validate a real repository under canonical allowed roots, a resolvable commit and
a legal unused branch using argument arrays. Reject nonexistent repositories,
missing refs, `a..b`, leading-option refs and escaped symlink/junction targets with
no record/workspace side effects. Store the resolved base SHA; moving refs cannot
change the execution base. Duplicate identical submits still replay after their
branch exists; changed payloads still conflict. Amend the contract for SHA storage
and replay ordering explicitly. No executor implementation in this PR.

### B04 — Enforce lifecycle and state coherence
Use #9 as design input. Cover all allowed and forbidden pairs at update/reconcile,
including queued-with-attempt → blocked. Require block metadata for blocked state,
coherent timestamps/cancel evidence and immutable task/client/key/hash identity.
Rejected writes leave bytes unchanged. Prove terminal resurrection is rejected and
late success cannot overwrite cancellation. Define a separately authorized human
reconciliation path. Do not equate an allowed pair with proven stop/no effects.
Explicitly handle older structurally valid records; do not silently rewrite them.

### B05 — One owner for one state home
Acquire service-instance ownership before reconciliation or submit. A second
process must fail without blocking the first process's running tasks or writing
records. Crash leaves an inspectable lock; no automatic stale-lock deletion/replay.
Test two processes and abrupt death in temporary homes. Scope is single local
service, not a new distributed lock. Document maintenance exclusion too.

### B06 — Reproducible MCP gate diagnosis
Use pinned OpenCode 2.2.5 with isolated fixture provider/config. Preserve failure
transcripts, classify startup/catalogue/call/timeout failures and identify a cause
before changing synchronization. Repeat a bounded set including cold starts;
record every outcome. Missing binary is not_run, not pass. Check password branch
`feat/mcp-gate-env-password` on its merits; an env override alone does not prove a
fix. No external provider calls. Gate stability is an explicit exit criterion.

### B07 — Credential-free CI
Run pinned Node 24.22.1 tests and demo on Windows and Linux for PRs. No provider
secrets/downloaded plugins or paid calls. Fail on actual nonzero exit. Keep host
integration opt-in until pinned and stable. Document that CI proves local behavior,
not M2b/M3. Protect against silently passing a piped test command.

### B08 — Adopt schemas without changing the boundary accidentally
Build a valid/invalid corpus comparing current and shadow validation, including
numeric values, null/unknown fields, error codes, paths and old persisted records.
Resolve discrepancies explicitly before wiring submit. Keep config authorization,
numeric bounds and secret rejection imperative. Derive duplicated constants in a
separate commit/PR if needed. Keep record/artifact tightening out until migration
and producer contracts are agreed. No lifecycle or SQLite work here.

### B09 — Actual isolated worktrees
Create a Git worktree and new task branch from B03's fixed SHA; verify HEAD and
repository identity. Tests include dirty parent, branch collision, partial setup
failure and duplicate task invocation. Preserve user work and uncertain outputs;
cleanup only owned verified paths. Return workspace metadata rather than call a
model. Never substitute an empty temporary directory for a worktree.

### B10 — Robust subprocess primitive
Spawn with arguments and shell disabled. Drain both streams with byte bounds while
running; report truncation, real exit code/signal and duration. Test ENOENT,
pre-abort, stderr flood, multibyte limits, deadline, fast exit and descendant
uncertainty on Windows. Attach listeners before consuming output. No model launch
or invented executionStopped guarantee. Bound memory even for unbounded output.

### B11 — Explicit worker authority
Build pinned-host invocation/config from trusted task authorization: one selected
model, tool allowlist, writable paths and isolated cwd. Task text cannot alter
those settings. Prevent unintended ambient config/plugins/credentials from
expanding authority. Test deny-by-default and malicious prompt fixtures; record a
real-host denied-write experiment before claiming enforcement. Reuse smoke harness
evidence/config patterns. No routing/fallback or paid provider activation.

### B12 — Independent execution with durable dispatch
Submit returns before completion; a service-owned queue starts one task at a time.
Persist running/attempt identity before spawn. A failed write spawns nothing;
duplicate submits and restarts do not duplicate attempts. Exercise two queued
tasks, process crash before/after dispatch and second-process status observation.
Use real store and a subprocess fixture first; task text never drives transitions.

### B13 — Verifiable artifacts
Collect committed, staged, unstaged and untracked scoped changes against the fixed
base, including additions/deletions/renames and a documented binary policy. Record
base/head SHA, branch, changedFiles, command/exit/duration, partial limitations and
unknown cost. Stream byte caps and flag truncation; failed collection is not empty
success. Redact before persistence, not only response projection. Preserve
producer limitations/evidence metadata in getTaskResult under a trusted mapping.
Test failing tests, oversized UTF-8 diff/log and sentinel leakage in all artifacts.

### B14 — Cancellation and deadlines
Queued cancellation spawns nothing; pre-abort, in-flight write, deadline and crash
are distinct cases. Unknown stop/effects result in blocked, effectsReverted false,
and no replay. Late completions cannot reopen/overwrite terminal or blocked state.
Preserve partial artifacts. Only claim stopped when process-tree evidence supports
it. Cover Windows explicitly; no automatic retry or cleanup of uncertain work.

### B15 — Transport adapter
Expose only the four operations over the selected stdio revision, with configured
client identity, structured JSON content and sanitized errors. Keep stdout protocol
only. Test discovery/list/call, malformed/oversized frames, unknown methods/fields,
ownership, disconnect and concurrent polling while a worker runs. No socket or
tunnel. Reuse B01 diagnostics only once safe; record/artifact/error schemas are
not operation input schemas. Contract and real-client compatibility must agree.

### B16 — Client integration that uses the transport
Drive submit → stable ID → poll → terminal result through pinned OpenCode and B15,
with a separate worker fixture process first. Verify real file changes/test evidence,
duplicate submission and cancellation. Do not import nonexistent free functions
or call a same-process service and call it MCP. Missing host is not_run. Record
host-integration evidence separately from model quality and M3 evidence.

### B17 — Thirteen executable acceptance experiments
Map every numbered contract criterion to a named executable scenario and observed
assertions. Return pass/fail/not_run per scenario, with command and exit code; full
acceptance fails if any required item is not_run. Include real child/process
restart, persisted-before-spawn, no duplicate work, actual truncated bytes and
secret sentinels. Item 13 must observe a real transport call/result, not a path.
Publish the evidence matrix and only then propose M2b completion.

### B18 — Human recovery and retention
Provide explicit maintenance inspection/reconciliation with evidence recorded and
no execution side effect. Blocked → failed/cancelled is maintainer-only. Exclude
active service access while maintaining. Test repeated commands, wrong state,
interrupted prune between record/index removal and preservation of blocked work.
Resolve dangling indexes without guessing or silently duplicating tasks. Document
safe recovery on Windows. No automatic task resume or lock removal.

### B19 — Optional harness pulse
Implement discussion #7 as a manual opt-in command, not a scheduled automation.
Capture eight bounded gate outcomes, original failures plus diagnostic retries,
version/platform and redacted transcripts. Put detailed records in docs/pulses and
link from validation. Missing binary is explicit. Track 2 activates only after
B17 and uses actual attempts/testRuns/limitations. Never replay uncertain tasks
to collect samples. No model ranking or provider calls.

### B20 — M3 self-development proof
Choose a small approved fixture/regression task. A supervisor submits it through
the service; the worker changes an isolated branch, runs tests, and returns useful
diff/evidence. Record model authorization and unknown/known cost accurately.
Human reviews the returned change; merge is separate. Direct edits by this chat
or synthetic fixture output do not satisfy M3. Stop if a real model is not
authorized/available; do not reinterpret unit evidence as project use.

### B21 — SQLite decision and capability gate
Refine #6: require a stopped JSON writer during snapshot/import/switch, explicit
crash-safe authority marker, and either revision CAS or complete read/mutate/write
transaction ownership. Reconcile lifecycle authority with B04. Run all seven ADR
gate items on pinned Node, file-backed storage and Windows. Preserve JSON baseline;
no production migration. Gate failure produces evidence and a decision, not a
silent driver substitution. Large datasets/artifact sizes must be bounded.

### B22 — Transactional persistence, then migration
Split into store, migration and rollout PRs. Run the same service/store behavioral
suite against both engines. Atomic task/idempotency/artifact/event updates, legal
transitions, corrupt DB and migration checksum refusal must pass. Offline import
preserves IDs/hashes/status/evidence; interrupted import/switch never produces two
writers or automatic replay. Freeze original JSON history after explicit switch.
Production switch requires the maintainer's concrete migration approval.

### B23 — M2c fallback through the worker
Reuse policy/ledger semantics: 429 before response/effects can switch, ambiguous
effects/auth failures cannot. Preserve context/permissions across two authorized
models; test both failing, restart, late events and return after cooldown only at
a new safe operation. Bound task and invocation budgets. Controlled provider
fixtures first, pinned-host integration separately. No advisor-based safety logic.

### B24 — Memory reuse spike
Evaluate ai-memory against pinned source/license and a small retrieval corpus of
decisions/pending tasks. Measure retrieval usefulness and confidentiality; stored
memories never authorize execution. Deliver comparison and a proposed ADR, not a
new memory framework or adopted dependency. Requires successful M3 first.

### B25 — Routing advisor spike
Evaluate discussion #5 D1/D2 against deterministic first-fit with fixed workload,
authorized candidates and budgets. Pin/verify any Laya/Jev candidate before using
it; local sidecars still count as dependencies. Measure completed-task correctness,
total cost/latency and escalation. Persist versioned, sanitized decision receipts.
D3 replay safety stays deterministic; low confidence cannot widen authorization.
No provider calls without authorization and no deployment implied by a benchmark.

## Suggested parallel batches

Start B01, B02, B03, B06, B07 and B10 independently with distinct owners.
B04 and B05 may proceed after agreeing on the store/startup boundary; avoid two
agents rewriting tasks.mjs at once. Serialize B03/B08 service edits and B12/B14
executor edits. Shared worklog/validation conflicts must preserve both entries.
Transport work can use fixture execution while executor work progresses, but its
real-client acceptance waits for the declared dependencies. Do not issue B21–B25
as immediate implementation work before their gates are met.

For each handoff, include task ID, branch/base SHA, files changed, tests/exit codes,
remaining limitations and the next unblocked task. Medium reasoning is a practical
starting point for narrow tasks; use High for lifecycle, permissions, persistence,
cancellation and independent final review.

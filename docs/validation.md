# Reproducible validation

## B30 review corrections — 2026-11-22 (local, not published)

Worktree: `task/B30-free-relay`, based on PR #45 head
`a4f3954514e2109a5f0112dcea0534d291a9fcf4`. Node.js v24.22.1 was invoked with
`fnm exec --using=24.22.1`; plain `node` is not on this PowerShell session's `PATH`.

- `fnm exec --using=24.22.1 node --test test/free-listeners.test.mjs test/free-listeners-authority.test.mjs test/relay.test.mjs test/egress-gateway.test.mjs`
  -> 57 pass / 0 fail / 0 skip, exit 0. Includes successful fixed-model forwarding through
  the trusted supervised composition and relay/gateway oversized-body 413, latch, zero
  upstream I/O, surviving listener and retained ownership assertions using real local child
  processes and loopback HTTP fixtures.
- First full parallel `fnm exec --using=24.22.1 node --test`
  -> 420 tests, 414 pass / 1 fail / 5 skip, exit 1. The failure was the existing
  timing-sensitive `B10-03` partial-output assertion (`'' !== 'before'`); no B30 test failed.
- Serial rerun `fnm exec --using=24.22.1 node --test --test-concurrency=1`
  -> 420 tests, 415 pass / 0 fail / 5 skip, exit 0. Four TLS-fixture tests skip because
  `openssl` is not on PATH; one other test is platform-gated.
- `fnm exec --using=24.22.1 node examples/fallback-demo.mjs` -> preferred mock 429, local
  mock 200, exit 0. `git diff --check` -> clean.

These are local fixture/process checks, not a pinned OpenCode-host-through-supervised-
composition run or deployed evidence. No provider/catalog call, external network probe, VM,
firewall, hardware key or live inference was used. Outstanding deployment/approval gates remain
unchanged and `not_run`; previously recorded evidence is unchanged. Changes and evidence are
uncommitted; remote state has not changed.

Executed on 2026-11-02 on Windows, Node.js v24.22.1:

```sh
node --test
node examples/fallback-demo.mjs
```

Current result: 43 tests passed, 0 failures (23 policy + 8 HTTP + 6 ledger + 6 runner).
Additionally, the real OpenCode 2.2.5 smoke test passed; run it separately as
described in [integration](../integration/README.md). Two prompts in the same
session preserved context, explicitly switched models and denied a write without
creating the file. Demo: 429 from mock/preferred followed by 200 from mock/local
with sessionId demo-session. No external provider calls; HTTP tests use only 127.0.0.1.

The suite covers limits, allowlists, fatal errors, missing metadata, cooldown,
normalized Retry-After, safe timeout, blocking after effects and checkpoints read
by a new process. Policy timestamps are injected, without sleeping or depending
on a real clock. Tests create temporary files and remove them in finally.
Exception: the runner test uses a real 100 ms deadline and a 3 s outer test limit;
it does not assert exact latency.

M1a: seconds/canonical dates, absent/past/invalid/overflow headers; loopback
429/503 to B and 401/invalid headers/possible effects to stop. The server uses an
ephemeral port, test/call timeouts and cleanup in finally. Payloads are not logged.
The contract was compared with RFC 9110; obsolete dates remain rejected.

M1b: explicit success, duplicate completion/wrong-model blocking, new operations
only after success and conservative legacy checkpoint handling. The demo records
success. Correlation covers stale results from the same model in another operation,
incorrect IDs, duplicate failures and serialized identity. State v1 is rejected
without automatic migration. Local ledger tests cover interprocess exclusion,
crash without close, reopening pending state, corruption, failed rename and result
persistence. Child processes have 5-second timeouts. Power loss, network
filesystems and the ledger inside OpenCode have not been validated; see
[handoff](handoff.md).

Runner coverage: fallback, persisted success, precancellation, in-flight cancellation,
late responses/rejections, providers ignoring abort, unknown errors, malformed
responses and attempt limits. Abort does not establish that external work stopped.

Behavior is tested, documentation/roadmap/ADRs are updated, and no dependencies or
credentials were added. M2/M3 remain incomplete; AI Orchestrator has not executed
a task to develop itself.

Limitations: ledger/runner tests use fixtures. The smoke test uses real host/tools
with a simulated model, proving context across CLI processes rather than recovery
of an in-flight operation. Automatic host fallback, exactly-once execution and
upstream suites have not been validated. M2 remains in progress.

No remote workflow was added at this stage: the commands above suffice without a
CI runner, package installation or AI service. CI can follow once the integration
environment is pinned.

## English documentation update

All maintained Markdown documentation is now in English, including ADRs, the audit,
roadmap, handoff and integration instructions. The README diagram describes the
target architecture and explicitly separates implemented, in-progress and planned
components. This update does not change executable behavior or complete M2/M3.

Validation for this documentation update: reran `node --test` (43 passed, 0 failed)
and `node examples/fallback-demo.mjs` (expected 429 then 200); checked all 21 local
Markdown links and preserved existing source URLs. The real host smoke test was
not rerun for this documentation-only change. Mermaid source was reviewed; visual
rendering was not tested.

## Worker-service roadmap update

Accepted direction recorded in ADR-006: a supervising primary LLM delegates to
workers; this repository is the primary end-to-end workload. Roadmap, README
architecture, requirements, DoD and handoff are aligned. M2a/M2b/M2c distinguish
contract/reuse, delegation and fallback. No task endpoint or worker integration
was implemented, and no new runtime milestone is claimed. Validation for this
documentation-only update: local Markdown links and code-fence balance checked;
existing runtime test results above remain historical and were not rerun.

## M2a task contract and reuse decision

Documentation-only increment; no executable code changed. Commands were rerun on
2026-11-02 with Node.js v24.22.1 from the repository root:

```sh
node --test
node examples/fallback-demo.mjs
```

Result: 43 tests passed, 0 failed; the demo printed the expected 429 from
`mock/preferred` followed by 200 from `mock/local`. A local Markdown link check covered
19 files and 57 relative links with 0 broken targets.

The real OpenCode 2.2.5 smoke test was not rerun; its earlier result remains the only
host evidence and does not validate the new contract. No MCP transcript existed at
that point: the capability gate was M2b step 1 and is now recorded in the next
section.

The reuse evaluation method and its limits are recorded in ADR-007: repository
metadata and license files were retrieved 2026-11-02, and no candidate was installed,
executed or vendored. Passing local tests does not validate any candidate.

## M2b step 1: MCP capability gate

Executed on 2026-11-02 on Windows x64 with Node.js v24.22.1 and the pinned OpenCode
2.2.5 binary from outside the repository:

```sh
node integration/mcp-gate.mjs C:\path\to\opencode-2.2.5\opencode.exe
```

Result (clean run, no debug directory retained):

```json
{"version":"2.2.5","protocol":"2026-07-28","server":"local stdio","transport":"codemode execute","discovered":true,"catalogued":true,"called":true,"resultInContext":true,"legacyHandshake":false,"providerRequests":5}
```

The host started `integration/mcp-fixture.mjs` as a local stdio server configured
with `protocol: "2026-07-28"`. The MCP transcript contained `server/discover`,
`tools/list` and `tools/call`; no `initialize` request was sent, and every request
carried `_meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"`. The fixture
server received exactly one call with `message: "GATE_FIXTURE"` and answered
`probe:GATE_FIXTURE`. The model-facing provider requests contained the Code Mode
catalog entry `tools.orchestrator.probe_echo` and, after the call, the result
`probe:GATE_FIXTURE`. The fixture model drove the default Code Mode path by calling
`execute`.

Harness detail: OpenCode connects MCP servers asynchronously and the CLI snapshots the
tool registry before connection, so the gate starts `opencode serve`, sends one
warm-up prompt and waits for `message="mcp connected" server=orchestrator tools=1`
before the probe prompt. A single `run` without warm-up does not expose the tool.

Intermediate failed runs were harness defects, not host defects: the first probe did
not wait for the connection, then the wait matched stdout only while the log line was
on stderr. Both were corrected before the recorded pass.

Scope of evidence: this validates discovery, cataloguing, invocation and result
delivery for one local stdio MCP server over revision `2026-07-28` with Code Mode
routing. It does not validate the task contract, lifecycle, durability, ownership,
cancellation or the executor adapter. The smoke test above remains the only evidence
for session continuity and denied writes. No MCP task service exists yet, so M2b is
in progress, not complete.

`node --test` and `node examples/fallback-demo.mjs` were rerun for this increment:
43 tests passed, 0 failed; the demo printed 429 from `mock/preferred` followed by 200
from `mock/local`. The gate harness is not part of `node --test` because it requires
the pinned binary; it must be run explicitly as documented in
[integration](../integration/README.md).

## M2b step 3: task service surface

Executed on 2026-11-02 on Windows, Node.js v24.22.1 (fnm-managed install).

```sh
node --test
node examples/fallback-demo.mjs
```

Result: 72 tests passed, 0 failed; the demo printed the expected 429 from `mock/preferred`
followed by 200 from `mock/local`.

Scope of evidence: `src/service.mjs` implements the four operations from
[task-contract.md](task-contract.md) over the store from `src/tasks.mjs` (`submit_task`,
`get_task_status`, `get_task_result`, `cancel_task`) with strict validation, ownership,
allowlist clamping, limits and sanitized errors. The new tests are in
`test/task-service.test.mjs` (task store suite unchanged). This increment is unit
evidence only; the MCP transport adapter, the executor adapter and the OpenCode
integration were not rerun. The M2b step 1 capability gate transcript remains valid for
the transport layer, and no mock-only run is claimed as task evidence.

## M2b step 3 review corrections — 2026-11-02

The PR #4 service implementation was corrected in the `b5aa3e2cf20051321ca51617899c6ca2cf0202fd` snapshot; no remote branch, commit or merge was changed.

```sh
node --test
node --test ../../reviews/pr-4-review.test.mjs
node examples/fallback-demo.mjs
```

Results: full suite 82 passed, 0 failed; review reproductions 9 passed, 0 failed; demo printed 429 from `mock/preferred`, then 200 from `mock/local`. Added coverage includes configured `clientId`, startup repair/blocking and conflict fail-closed behavior, duplicate records without indexes, sensitive input rejection without request mutation, UTF-8 and combined output/log limits, relative path resolution, unknown operation fields and cancel persistence errors. All tests use temporary directories and synthetic values.

The service rejects request fields containing the documented credential-shaped patterns before persistence. Artifact text applies the same bounded redaction patterns; `sanitized: true` describes that policy only and does not claim comprehensive secret discovery. Writable paths are checked against both the task repository and configured roots. Startup reconciliation runs once at service construction; an index conflict prevents service creation and does not change active task records. Multiple service processes are still outside the store's single-process contract.

MCP gate status remains unresolved: this review observed one failed probe (`warm-up-ok` returned instead of `gate-ok`) and a later pass with `MCP_GATE_DEBUG=1` over the same pinned host. The root cause was not established. The gate was not rerun for these service changes and is not claimed as fixed or stable. OpenCode smoke and live task transport/executor integration were not rerun; no paid API or credentials were used.

## Independent final review — 2026-11-02

- Branch: `feat/m2b-task-store`; local corrections accepted for publication and merge.
- Final review preserves existing truncation flags, requires a test command for
  success evidence, and marks uncertain cancellation/restart stop state unknown.
- Independent checks: full suite 83 passed, external reproductions 9 passed,
  demo 429 then 200. Regression cases are covered in the versioned service suite.
- Full M2b remains incomplete. Resolve MCP gate instability before relying on it
  for executor/client integration. No live executor acceptance is claimed.

## Core rules summary and reading order — 2026-11-02

Docs-only change on branch `docs/core-rules-distillation`; commands run from the worktree
on macOS. Recorded environment: Node.js v24.11.1, which is not the pinned 24.22.1
toolchain (`fnm` is not installed on this machine) but is inside `engines: >=24 <25`.

```sh
node --test
node examples/fallback-demo.mjs
```

Result: 83 tests passed, 0 failed, 0 skipped; the demo printed 429 from `mock/preferred`
followed by 200 from `mock/local`.

Scope of evidence: unit suite and demo only. `integration/mcp-gate.mjs` and
`integration/opencode-smoke.mjs` were not rerun; the MCP gate instability recorded above
remains unresolved, and no validation claim beyond the two commands is made.

## Core rules review fix round — 2026-11-02

Documentation only again: `docs/core-rules.md`, `AGENTS.md`, `docs/worklog.md` and this
file; no source, contract or test change. Commands run from the worktree on macOS:

```sh
node --version
node --test
node examples/fallback-demo.mjs
```

Environment: Node.js v24.11.1, reported by `node --version`. The pinned 24.22.1 toolchain
is still unavailable on this machine (`fnm` is not installed, and the other interpreter on
PATH is v26.12.1, outside `engines: >=24 <25`), so the version here is within the engines
range but is not the pinned toolchain.

Result: 83 tests passed, 0 failed, 0 cancelled, 0 skipped; the demo printed 429 from
`mock/preferred` followed by 200 from `mock/local`.

Scope of evidence: unit suite and demo only. `integration/mcp-gate.mjs`,
`integration/opencode-smoke.mjs` and any executor or live-client acceptance were not
rerun; the MCP gate instability recorded above remains unresolved. No paid provider or
credential was used.

## Docs: uniform templates for recurring artifacts — 2026-11-02

Executed on macOS arm64, Node.js v24.22.1 (worktree `.worktrees/templates`).
Date: 2026-11-02.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Full local suite regression after a documentation-only change | 83 tests passed, 0 failed, 0 skipped, 0 cancelled | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo still prints the expected two responses | 429 from `mock/preferred`, then 200 from `mock/local`, sessionId `demo-session` | 0 |
| `git diff --check` | No whitespace errors in the new Markdown | no output | 0 |

Result: the full suite reports 83 passed and 0 failed, the demo prints 429 from
`mock/preferred` followed by 200 from `mock/local`, and `git diff --check` reports no
whitespace error. Relative links in the five template files were checked with a one-off
script (5 files, 0 broken); that script is not versioned in this repository, so it is not a
reproducible command and therefore not a table row.

Evidence level: unit — the suite and the demo exercise policy, ledger, runner, task store
and service behavior in this checkout; they confirm that a documentation-only change left
executable behavior unchanged. No host, network or persistence evidence is added here.

Not rerun: `node integration/opencode-smoke.mjs` (needs the pinned OpenCode 2.2.5 binary
outside the repository; documentation does not affect it); `node integration/mcp-gate.mjs`
(same reason, and the gate outcome remains unresolved); live task transport and executor
integration (no executor adapter exists yet).

Claim: This entry supports that the templates change leaves the local suite and the
fallback demo unchanged, based on `node --test` and `node examples/fallback-demo.mjs`.
It does not support any OpenCode integration, MCP transport or task-execution claim,
which requires the pinned binary outside the repository.

## Docs: uniform templates, review-corrections round — 2026-11-02

Executed on macOS arm64, Node.js v24.22.1 (worktree `.worktrees/templates`).
Date: 2026-11-02.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Full local suite regression after a documentation-only change | 83 tests passed, 0 failed, 0 skipped, 0 cancelled | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo still prints the expected two responses | 429 from `mock/preferred`, then 200 from `mock/local`, sessionId `demo-session` | 0 |
| `git diff --check` | No whitespace errors in the changed Markdown | no output | 0 |

Result: the full suite reports 83 passed and 0 failed, the demo prints 429 from
`mock/preferred` followed by 200 from `mock/local`, and `git diff --check` reports no
whitespace error. Relative links in the five template files were checked with a one-off
script (5 files, 0 broken); that script is not versioned in this repository, so it is not a
reproducible command and therefore not a table row.

Evidence level: Unit — the suite and the demo exercise policy, ledger, runner, task store
and service behavior in this checkout and show that a documentation-only change left them
unchanged. They do not demonstrate the host, the network, production persistence or any new
behavior of the templates.

Not rerun: `node integration/opencode-smoke.mjs` (needs the pinned OpenCode 2.2.5 binary
outside the repository; documentation does not affect it); `node integration/mcp-gate.mjs`
(same reason, and the gate outcome remains unresolved); live task transport and executor
integration (no executor adapter exists yet).

Claim: This entry supports that the templates change leaves the local suite and the
fallback demo unchanged, based on `node --test` and `node examples/fallback-demo.mjs`. It
does not support any OpenCode integration, MCP transport or task-execution claim, which
requires the pinned binary outside the repository.

## Independent PR review and backlog — 2026-11-02

Executed on Windows x64, Node.js v24.22.1. Main baseline: `a4cae9c`.
Review branch: `review/2026-11-02-pr-backlog` (local, not published).

| Command / experiment | Snapshot | Result |
| --- | --- | --- |
| `node --test` | main | 83 passed, 0 failed |
| `node examples/fallback-demo.mjs` | main | 429 then 200, exit 0 |
| `node --test --test-reporter=tap` | PR #8 `f73c495` exported with git archive | 106 passed, 0 failed, exit 0 |
| `node examples/fallback-demo.mjs` | PR #8 | 429 then 200, exit 0 |
| `node --test --test-reporter=tap` | acceptance `2055cf5`, isolated AI_ORCHESTRATOR_HOME | 73 passed, 2 failed, exit 1 |
| `node --input-type=module` boundary fixture | main; temporary store | nonexistent repo/ref and invalid branch accepted; queued-to-succeeded accepted; blocked/null causes TypeError |
| `node --input-type=module -e` unknown-key fixture | PR #8 | returned fake credential-shaped key in errors[0].path |

The initial boundary probe used the wrong snake_case method and failed; the
reported boundary results are from the corrected camelCase probe. The probe's
state was temporary and removed in finally. The acceptance snapshot failed at
client import and its work-directory assertion; it did not run real workers.
Exact findings and reproduction snippets are in review-2026-11-02.md.

Evidence: local tests (including their loopback HTTP fixtures), static review and
isolated reproductions only. No real OpenCode smoke/MCP gate, SQLite capability
gate, paid provider or use-on-project experiment was run. Documentation-only
PR #6/#9/#11 suites were not separately rerun. This entry does not claim M2b/M3
completion or prove the author's previously reported environment/results.

## Docs: template lifecycle and proportionality corrections — 2026-11-02

Executed on Windows x64, Node.js v24.22.1 (existing local toolchain).
Date: 2026-11-02.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap` | Local regression suite after documentation edits | 83 passed, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace verification | no output | 0 |

Result: all 83 existing tests passed, and the fallback demo printed its expected
429 and 200. A one-off Node script checked five template files: 30 prose links
resolved and fences were balanced. Fenced example links remain relative to their
intended destination as documented in the template README. Changes were also
reviewed for status/date guidance and consistency with AGENTS and README.

Evidence level: Unit — confirms unchanged local behavior after documentation edits;
it does not establish host compatibility or new runtime features.

Not rerun: OpenCode smoke, MCP capability gate and SQLite gate (no runtime or
integration changes). No M3 delegation was performed.

Claim: this entry supports the documentation corrections and local regression
results. It does not support M2b completion or acceptance of any proposed ADR.

## M2b: B04a ordinary lifecycle guards — 2026-11-02

Executed on Windows x64, Node.js v24.22.1 (existing local toolchain).
Date: 2026-11-02.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap` | Full suite including the lifecycle matrix and regressions | 126 passed, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback policy behavior | 429 then 200 | 0 |

Result: invalid ordinary edges, mutable request authority, forged unstarted
cancellation, malformed block metadata and late terminal lifecycle writes are
rejected without replacing committed bytes. Startup reconciliation blocks
persisted queued dispatches; repeated reconciliation does not rewrite them.
Historical invalid state fails closed on read and service startup without repair.
Existing tests now construct legal transitions instead of bypassing lifecycle.

Evidence level: Unit — local store/service behavior and existing loopback fixtures.
No worker execution, process ownership or transport compatibility is established.
Not rerun: real OpenCode smoke, MCP capability gate, SQLite gate and M3 delegation.
Claim: this supports the bounded B04a store hardening, not completion of M2b/B04
as a whole. Clock ordering, dispatch production, worker-stop proof and human
reconciliation tooling remain outside this change.

## B04a pre-merge review — 2026-11-03

- `node --test --test-reporter=tap`: 126 passed, 0 failed, exit 0.
- `node examples/fallback-demo.mjs`: expected 429 then 200, exit 0.
- `git diff --check`: passed, exit 0.
- Added a regression assertion rejecting queued-with-persisted-attempt -> running
  without modifying committed bytes. Startup reconciliation still blocks that task.
- Evidence: local store/service unit and existing loopback fixtures only. OpenCode,
  MCP, SQLite and executor gates were not rerun. B05/B12/B14/B18 remain pending.

## B05 — Service ownership — 2026-11-03

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap` | Store/service behavior and owner-lock regressions | 127 passed, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict-marker check | Passed | 0 |

Evidence: local service/store tests only. A service acquires ownership before reconcile, competing service creation returns unavailable, graceful close releases ownership, and initialization failure cleans up. Stale crash locks are fail-closed and require manual inspection. No OpenCode, MCP, SQLite or executor integration gate was rerun.

## B05 pre-merge review — 2026-11-03

- `node --test --test-reporter=tap`: 129 passed, 0 failed, exit 0.
- `node examples/fallback-demo.mjs`: 429 then 200, exit 0.
- `git diff --check`: passed, exit 0.
- Evidence: local store/service and a real Node child process in a temporary home.
  Contention does not rewrite running tasks, abrupt process death leaves a stale
  lock, manual post-death recovery blocks uncertain work, and closed handles reject
  all four operations after a replacement owner starts.
- Real OpenCode, MCP, SQLite and executor integration gates were not rerun.

## M2b: Executable backlog and PR delivery contracts — 2026-11-02

Executed on Windows x64, Node.js v24.22.1 from the Codex bundled primary runtime;
Git 2.55.0.windows.5. Date: 2026-11-02 (America/Sao_Paulo).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap` | Baseline regression suite | 129 passed, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `node "$env:TEMP\ai-orchestrator-task-doc-check.cjs"` | Changed Markdown links/anchors and complete task-card/index/matrix coverage | 27 cards, 107 acceptance rows, 234 relative links/anchors passed | 0 |
| `git diff --check` | Whitespace/conflict-marker validation | Passed | 0 |

Result: every executable task has implementation steps, explicit scope, dependencies,
acceptance IDs and a mandatory route through two review passes and publication.
The checker validates file/anchor existence, card sections, sequential row IDs and
index coverage; manual review also checked preserved requirements and dependency order.
Its temporary script is a documentation verification aid, not a committed runtime test.

Evidence level: Unit — the unchanged local suite (including existing subprocess
fixtures) passes; static documentation verification supports the workflow/cards.
Neither establishes future agents' compliance or completes a pending runtime task.

Not rerun: `integration/opencode-smoke.mjs` and `integration/mcp-gate.mjs` (docs-only
scope; gate diagnosis remains B06). SQLite/migration and real worker/model use remain
gated backlog work, with no validation claimed here.
Claim: the documentation delivery contract is more explicit and internally checked;
the change does not establish M2b/M3 acceptance or eliminate independent PR review.

## B03 — Repository identity before task acceptance — 2026-11-03

Executed on Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5.
Date: 2026-11-03.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Complete test suite including B03 acceptance scenarios | 141 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict-marker validation | Passed (no output) | 0 |

### Acceptance Matrix Evidence

| ID | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| B03-01 | Valid allowed repo, branch and base | PASS | `test/task-service.test.mjs` ("B03-01: valid allowed repo, branch and base persists full commit SHA without worker launch"): record contains 40-character commit SHA, 0 attempts, startedAt null. |
| B03-02 | Same key/payload after branch creation, ref movement or repo removal | PASS | `test/task-service.test.mjs` ("B03-02: same key/payload after branch creation, ref movement or repo removal returns original record", "B03-02: repo removal still returns idempotent replay"): returns original task ID and original baseCommit without revalidating repository; changed payload throws `idempotency_conflict`. |
| B03-03 | Nonexistent repo, missing ref, range a..b or leading-option ref | PASS | `test/task-service.test.mjs` ("B03-03: nonexistent repo, missing ref, range a..b or leading-option ref fails closed"): all four variants fail closed with `invalid_argument`; task files and Git refs unchanged. |
| B03-04 | Path-prefix sibling and symlink/junction escape | PASS | `test/task-service.test.mjs` ("B03-04: path-prefix sibling and symlink/junction escape are denied"): sibling path rejected with `authorization_denied`; symlink escape rejected with `authorization_denied` when symlink privileges permit. |
| B03-05 | Existing branch, invalid branch, linked worktree and dirty parent | PASS | `test/task-service.test.mjs` ("B03-05: existing branch, invalid branch, linked worktree and dirty parent"): existing branch, invalid ref and worktree branch collisions rejected with `invalid_argument`; dirty parent accepted and user files verified intact. |

Evidence level: Unit and local Git subprocess fixtures.
Not rerun: `integration/opencode-smoke.mjs` and `integration/mcp-gate.mjs` (unresolved MCP gate is tracked by B06).
Claim: B03 acceptance criteria are fully met by executable tests covering every matrix row.

## B03 post-review corrections — 2026-11-03

Branch: `task/B03-repo-identity`. Commit: `a1ca8ed`.

Two issues surfaced after the initial commit:

1. `baseCommit` regex was relaxed to `{7,64}` during debugging; restored to `{40,64}` to enforce the full SHA contract in `src/tasks.mjs`.
2. `validRequest` helper used absolute `writablePaths` tied to the outer `dir`, causing `authorization_denied` before repository validation when tests overrode `repository.path`; changed to relative `'src'` so all B03 scenarios reach the intended validation code path. Test `get_task_result` updated to capture `baseCommit` from the real task record rather than a short literal fixture.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Full suite after corrections | 141 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict-marker validation | Passed (no output) | 0 |

Evidence: same 141-test run as B03 initial commit; corrections do not change runtime behavior or acceptance matrix — they restore the originally intended validation strength and fix test fixture accuracy. No integration, MCP or executor gate was rerun.

## B03 post-review correction — authorize the actual Git worktree root — 2026-11-03

- Changed `validateRepositoryIdentity` to resolve `git rev-parse --show-toplevel`, canonicalize that path, and enforce writable-root containment on the Git worktree root before inspecting refs.
- Added a real temporary-repository regression test: allowing only a nested subdirectory now rejects the enclosing Git repository with `authorization_denied`.
- `node --test test/repository.test.mjs`: 7 passed, 0 failed, exit 0.
- `node --test`: 142 passed, 0 failed, exit 0.
- `node examples/fallback-demo.mjs`: 429 then 200, exit 0.
- `git diff --check`: passed, exit 0.
- Environment: Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5. OpenCode/MCP gates not rerun; outside this task's scope.

## B07 — Credential-free Windows and Linux CI — 2026-11-03

Branch: `task/B07-cross-platform-ci`. Base: `origin/main` at `c07b78e`.

| Card row | Test or experiment | Command / evidence location | Result / exit code |
| --- | --- | --- | --- |
| B07-01 | Normal PR matrix: test suite and demo on Windows and Linux | GitHub Actions run #41737541145, jobs #126270492736 (Windows) and #126270493106 (Ubuntu) | PASS: 142/142 tests and demo exit 0 on each OS; run conclusion success |
| B07-02 | Known nonzero command through a formatter pipeline | CI run #41737541145 fixture steps; PowerShell local capture | PASS: Windows fixture step failed (exit 1); Bash fixture failed (exit 7); guarded expected failures; local native code 7 observed |
| B07-03 | Workflow security inspection | `.github/workflows/ci.yml` | PASS: `contents: read`; PR inputs are not interpolated into shell; no secrets, publishing or privileged events |
| B07-04 | Runner unavailable | CI run #41737541145 | N/A: both runners were available, so the draft contingency was not needed |

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Full local suite, Windows x64 / Node v24.22.1 | 142 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| PowerShell exit-7 pipeline fixture | Ensure formatter does not mask the native command failure | Captured `PIPE_NATIVE_EXIT=7` | 0 (assertion passed) |
| `git diff --check` | Whitespace/conflict-marker validation | Passed (no output) | 0 |

Review: both implementation and completed-diff passes inspected workflow trigger scope, permissions, shell behavior, acceptance rows and docs. GitHub runner evidence is recorded below.

### GitHub Actions result — run #41737541145

The pull-request workflow completed successfully on the PR merge ref. Windows Server 2025 (job #126270492736) and Ubuntu 24.04 (job #126270493106) both used Node.js v24.22.1, passed all 142 tests and ran the fallback demo (429 then 200). The expected-failure pipeline fixture returned exit 1 on PowerShell and exit 7 on Bash; the follow-up guard was skipped in both jobs, confirming the fixture outcome was failure as intended. The workflow token log reported Contents: read. Run conclusion: success.

## B07 merge review — 2026-11-03

- Corrected the Bash reproduction in `docs/ci.md` to enable `set -e -o pipefail` and clarified native exit-code capture in PowerShell.
- Git Bash experiment: `set -e -o pipefail`, followed by an absolute Node v24.22.1 binary running `process.exit(7)` piped to `cat`, then an unreachable print. Observed shell exit 7 with no continuation output. Initial standalone shells could not resolve the transient Node path (exit 127); running Bash from the owning PowerShell process resolved it.
- Existing PR-head run `41737897011`: both OS jobs successful. The documentation correction will receive its own PR CI run before merge. OpenCode/MCP gates remain outside scope.

## B06 — Diagnose MCP capability gate instability — 2026-11-03

Branch: `task/B06-mcp-capability-gate`. Base: `origin/main` at `2ff7e5e`.

| Card row | Test or experiment | Command / evidence location | Result / exit code |
| --- | --- | --- | --- |
| B06-01 | Pinned host, eight isolated launches | Eight sequential `node integration/mcp-gate.mjs <pinned-opencode.exe>` invocations; each harness run allocates a fresh temporary tree | PASS: 8/8 exit 0; every JSON result records discovery/catalogue/call/result; protocol transcript checks and one call pass each time |
| B06-02 | Wrong/missing binary or version | Gate invoked with absent path and current Node executable | PASS: both fail closed with harness exit 1; missing path reports spawn error, wrong version is rejected |
| B06-03 | Readiness failure, timeout and cleanup failure | `MCP_GATE_COMMAND_TIMEOUT_MS=1`; `MCP_GATE_READINESS_TIMEOUT_MS=1`; combined readiness timeout + `MCP_GATE_FORCE_CLEANUP_ERROR=1` | PASS: bounded exit 1; combined output retains `Host did not listen` and separately reports cleanup failure; fixture credentials are redacted |
| B06-04 | Fixture error or nonzero child exit | Gate invoked with `cmd.exe` as the supplied child; missing executable experiment | PASS: actual invalid child/version/spawn cases yield nonzero harness exit 1; no false green |

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Full suite, Windows x64 / Node v24.22.1 | 142 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict validation | Passed | 0 |
| Eight-run pinned-host loop | Required cold/fresh-state acceptance matrix | 8 successful JSON transcripts | 0 for each run |

Root cause: OpenCode connects local MCP servers asynchronously; the CLI can snapshot its registry before the fixture is available. The harness now warms the persistent server, waits for the explicit connection marker across stdout and stderr, then probes. The eight cold isolated launches passed. The binary's signed publisher and release ZIP digest were verified before execution. OpenCode smoke and MCP gate are separate; no model/provider credentials or remote calls were used.

### PR #20 follow-up review — 2026-11-03

- GitHub PR #20 was open and mergeable. Its conversation, inline review threads and review submissions were empty during review.
- Fixed a command timeout path that could await `close` indefinitely when an exited host left descendants holding inherited pipes. The timeout now settles independently after bounded stop handling and releases child streams.
- Cleanup failures now preserve the fixture tree for diagnosis, and the PASS JSON is printed only after successful cleanup.
- Revalidated: `npm test` passed 142/142; the fallback demo returned 429 then 200; eight independent pinned OpenCode launches passed; command-timeout and combined readiness/forced-cleanup fixtures both exited 1; syntax and whitespace checks passed.

## Docs: shared PR review feedback (B26) — 2026-11-03

Executed on Windows x64, Node.js v24.22.1 (fnm toolchain).
Date: 2026-11-03. Branch: `task/B26-pr-review-feedback`; base: `2ff7e5e`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Required regression suite | 142 passed, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback demo | 429 then 200 | 0 |
| `git diff --check` | Whitespace validation | No errors | 0 |

Result: content walkthroughs cover B26-01 (PR publication, finding fields and
self-review refusal fallback), B26-02 (all feedback surfaces, replies and same PR),
B26-03 (changed head, unresolved disagreement and verified thread resolution), and
B26-04 (existing modules, open PRs and missing executor/scheduler/MCP/controller).
Relative Markdown links in changed files were checked with a one-off Node script;
none were broken. Both review passes inspected entry points, publication failure,
authority limits and planned-versus-implemented claims. Fixed misplaced section
headings and the handoff's obsolete B07 next action.

Evidence level: Unit — existing local suite/demo regression only. Documentation
walkthroughs establish protocol coverage, not model adherence or integration.

Not rerun: OpenCode smoke and MCP capability gate (runtime unchanged); no live
model or PR-comment fixture was invoked for this documentation-only task.

Claim: these checks support a linked PR feedback protocol with unchanged local
behavior. They do not establish automatic delegation, model switching, GitHub
orchestration or first use on this project; those need runtime implementation and
real acceptance evidence.

## B26 merge review integration — 2026-11-03

- Resolved documentation conflicts with main after PR #20, retaining B06 and B26
  evidence. Reviewed the resulting diff and current PR feedback. Runtime matches
  main; prior suite/demo evidence remains applicable. Content/link and whitespace
  checks are rerun before publication; Windows/Linux CI is required before merge.

## RFC-0001 schema skeleton — 2026-11-02

Branch `rfc/0001-contract-schemas` at `3f30114`. Test-only skeleton: no runtime module
imports `src/contracts/`.

```sh
node --test
node examples/fallback-demo.mjs
node -e "import('./src/contracts/validate.mjs').then(m=>console.log(Object.keys(m)))"
```

Results: `node --test` → 103 passed, 0 failed (83 existing tests unchanged, 20 new in
`test/contracts.test.mjs`); the demo printed the expected 429 from `mock/preferred`
followed by 200 from `mock/local`; the import check printed
`[ 'exportEnum', 'validate' ]`. New tests use only temporary directories and synthetic
values, cover every supported keyword, collect-all-errors ordering, path shapes
(`acceptanceCriteria[2]`, `attempts[0].outcome`), deterministic output, 32-character
truncation of instance data in messages, malformed-schema rejection, conformance of a
record written by `openTaskStore`, and the enum drift guards.

The drift guards compare schema enums to `TASK_STATUSES`, `EVIDENCE_LEVELS` and
`ERROR_CODES` imported from `src/service.mjs`, and to the module-private `STATUSES`
literal extracted from `src/tasks.mjs` source (the store is not modified by this RFC).
Enums are compared as sorted arrays with equal length: membership is contract, order is
not.

Not rerun and not claimed: `integration/opencode-smoke.mjs`, `integration/mcp-gate.mjs`
(the MCP capability gate remains inconsistent and unresolved), the Windows-only
toolchain statement, and any live executor or transport use. No paid provider, network
call or credential was used; no integration evidence is implied by these unit tests.

## RFC-0001 review fixes — 2026-11-02

Branch `rfc/0001-contract-schemas`. Test-only skeleton; no runtime module imports
`src/contracts/`.

```sh
node --test
node examples/fallback-demo.mjs
```

Results: `node --test` → 106 passed, 0 failed (83 existing tests unchanged, 23 in
`test/contracts.test.mjs`); the demo printed the expected 429 from `mock/preferred`
followed by 200 from `mock/local`.

New coverage in this round: an artifact-enriched record (store `createTask` followed by
`updateTask` with attempts, a command-less test run, changed files, commits, diff and
truncation flags) validates against `task-record.schema.json`; `assertSchema` rejects
unknown keywords, a missing `type`, malformed keyword values and
`additionalProperties: true`; a directory walk asserts every shipped `.schema.json`
passes `assertSchema`; the drift guard extracts the `STATUSES` and `SCHEMA_VERSION`
literals with quote- and whitespace-tolerant patterns and compares them to the schema
enums and to the exports from `src/service.mjs`.

Not rerun and not claimed: `integration/opencode-smoke.mjs`, `integration/mcp-gate.mjs`
(the MCP capability gate remains inconsistent and unresolved), the Windows-only
toolchain statement, and any live executor or transport use. No paid provider, network
call or credential was used.

## RFC-0001 re-review fixes — 2026-11-02

Branch `rfc/0001-contract-schemas`. Test-only skeleton; no runtime module imports
`src/contracts/`.

```sh
node --test
node examples/fallback-demo.mjs
```

Results: `node --test` → 106 passed, 0 failed (no new test cases; assertions added to
the existing keyword and directory-walk tests); the demo printed the expected 429 from
`mock/preferred` followed by 200 from `mock/local`. Coverage added: `$schema` is
accepted as an ignored string annotation and rejected when it is not a string, every
shipped schema file declares its dialect, and `task-record` accepts an optional
`branch` string or null. Few-shot outputs in RFC-0001 were regenerated and unchanged.

Not rerun and not claimed: `integration/opencode-smoke.mjs`, `integration/mcp-gate.mjs`
(the MCP capability gate remains inconsistent and unresolved), the Windows-only
toolchain statement, and any live executor or transport use. No paid provider, network
call or credential was used.

## B01 — Safe schema diagnostics — 2026-11-03

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap` | Full suite with unknown-key disclosure regressions | 107 passed, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict-marker check | Passed | 0 |

Evidence: unit-level checker behavior. Diagnostics no longer contain unknown instance
property names, while paths for declared schema fields remain informative. Tests cover
credential-shaped, long and control-character keys at root and nested levels.
Schemas remain proposed and are not wired to service/tool operations. No OpenCode,
MCP, SQLite or live executor gate was rerun.

## B01 integrated schema scaffold review — 2026-11-03

- Integrated main 104e9c1 on rfc/0001-contract-schemas. Original focused tests:
  24 passed. Initial integrated suite: 165 passed, 1 failed (exit 1), exposing an
  obsolete artifact fixture using an abbreviated base SHA and queued-to-succeeded
  transition. Corrected the fixture to initialize an immutable full base SHA and
  persist queued -> running -> succeeded without changing runtime guards.
- Final node --test: 166 passed, 0 failed, exit 0. Fallback demo: 429 then 200,
  exit 0. Markdown local-link check passed; git diff --check follows before commit.
- Both review passes checked schemas, checker keyword rejection, diagnostics and
  current-store compatibility. Unknown-key credentials remain absent from errors.
  Host gates not rerun: no host/service/store runtime changed. Current-head CI
  must pass before merge. Adoption into service/transport remains B08.


## M2b: B09 isolated Git workspace lifecycle — 2026-11-03

Executed on Windows x64, Node.js v24.22.1 (system installation); Git 2.55.0.windows.5.
Date: 2026-11-03.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/workspace.test.mjs` | Exercise B09 acceptance scenarios against real Git worktrees | 5 passed, 0 failed | 0 |
| `node --test` | Full suite regression | 147 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Check whitespace in proposed change | no output | 0 |

Result: tests verified the fixed base and unchanged dirty parent bytes, duplicate receipt-verified reuse after worker commits, branch/path collisions, tampered receipts, a moved Windows junction, retained incomplete output and refusal to delete dirty output. Tests use temporary repositories and workspace roots.

Evidence level: Unit — the suite and the demo exercise policy, ledger, runner, task store and service behavior in this checkout. Real temporary Git repositories and worktrees validate local workspace behavior; they do not demonstrate the host, the network or production persistence.

Not rerun: `node integration/opencode-smoke.mjs` (requires the pinned OpenCode 2.2.5 binary outside the repository; this helper does not add the executor); `node integration/mcp-gate.mjs` (same binary requirement and unresolved gate); executor integration (no executor adapter exists yet).

Claim: This entry supports receipt-bound workspace creation, reuse and conservative cleanup in local Git fixtures, based on `node --test test/workspace.test.mjs`. It does not support worker execution or OpenCode/MCP integration, which require the missing executor and pinned host evidence.

## M2b: B10 bounded subprocess primitive — 2026-11-03

Executed on Windows x64, Node.js v24.22.1 (system installation); Git 2.55.0.windows.5.
Date: 2026-11-03.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/subprocess.test.mjs` | Exercise B10 acceptance scenarios with real Node child processes | 5 passed, 0 failed | 0 |
| `node --test` | Full suite regression | 147 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Check whitespace in proposed change | no output | 0 |

Result: fixtures covered spawn failure, pre-abort without spawn, immediate exit, exit code 7, bounded stdout/stderr tails while both pipes drain, UTF-8 byte boundaries, deadline, abort with partial output and a descendant process whose stop remains unverified.

Evidence level: Unit — the suite and the demo exercise policy, ledger, runner, task store and service behavior in this checkout. Child fixtures demonstrate local subprocess behavior; they do not demonstrate the host, the network or production persistence.

Not rerun: `node integration/opencode-smoke.mjs` (requires the pinned OpenCode 2.2.5 binary outside the repository; this helper does not change that integration); `node integration/mcp-gate.mjs` (same binary requirement and the gate remains unresolved); executor integration (no executor adapter exists yet).

Claim: This entry supports bounded output, exit status and conservative root/descendant stop reporting for local Node child processes, based on `node --test test/subprocess.test.mjs`. It does not support OpenCode integration or task execution, which require the missing executor and pinned host evidence.

## B09 current-main integration — 2026-11-04

- Integrated current main with B09; preserved both append-only histories. Added a
  receipt-backed real Git fixture for ignored worker output. Focused/full tests,
  demo, diff and Windows/Linux CI will be recorded before re-review.
- Windows x64, Node 24.22.1, Git 2.55.0: `node --test test/workspace.test.mjs`
  6/6 passed; `node --test` 172/172 passed; demo returned 429 then 200; diff check
  passed. Regression confirms ignored output bytes and receipt survive refusal;
  after deleting that fixture output, clean workspace removal succeeds. CI run
  remains pending after publication.

## B09 Windows CI fixture correction — 2026-11-04

GitHub Actions run `41748264467` passed on Ubuntu but failed on Windows in the
incomplete-workspace fixture: its manually written receipt used uncanonicalized paths,
so `createTaskWorkspace` correctly rejected it as a mismatched receipt before reaching
the intended Git error. The fixture now writes `realpathSync.native` values for the
repository and workspace paths.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/workspace.test.mjs` | B09-focused Git/worktree tests | 6 passed, 0 failed | 0 |
| `node --test` | Full suite after fixture correction | 172 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict-marker validation | Passed | 0 |

Windows GitHub Actions must rerun on the corrected head before merge. The Ubuntu CI
result from the previous head does not verify this new commit.

## B09 integration with merged B10 — 2026-11-04

After PR #17 merged to main, B09 was updated to that main and both append-only
validation/worklog histories were preserved. The prior B09 CI run `41749352307`
passed on Windows and Ubuntu before this base update; it does not verify the updated
merge head.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/workspace.test.mjs` | B09 workspace regressions | 6 passed, 0 failed | 0 |
| `node --test` | Full suite after integrating B10 | 178 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict-marker validation | Passed | 0 |

Fresh Windows and Ubuntu CI remains required on the updated B09 head before merge.

Result: fixtures covered spawn failure, pre-abort without spawn, immediate exit, exit code 7, bounded stdout/stderr tails while both pipes drain, UTF-8 byte boundaries, deadline, abort with partial output and a descendant process whose stop remains unverified.

Evidence level: Unit — the suite and the demo exercise policy, ledger, runner, task store and service behavior in this checkout. Child fixtures demonstrate local subprocess behavior; they do not demonstrate the host, the network or production persistence.

Not rerun: `node integration/opencode-smoke.mjs` (requires the pinned OpenCode 2.2.5 binary outside the repository; this helper does not change that integration); `node integration/mcp-gate.mjs` (same binary requirement and the gate remains unresolved); executor integration (no executor adapter exists yet).

Claim: This entry supports bounded output, exit status and conservative root/descendant stop reporting for local Node child processes, based on `node --test test/subprocess.test.mjs`. It does not support OpenCode integration or task execution, which require the missing executor and pinned host evidence.

## B10 current-main integration — 2026-11-04

- Integrated current main into B10. Focused subprocess fixtures cover exact byte
  tails across chunks, UTF-8 boundaries, pre-abort evidence shape, descendants, and
  POSIX SIGTERM escalation. The POSIX fixture is skipped on Windows and will run in
  Ubuntu CI. Full suite/demo/diff and Windows/Linux CI follow after publication.

## B10 correction validation — 2026-11-04

Environment: Windows x64, Node.js v24.22.1.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/subprocess.test.mjs` | B10 child process behavior and corrections | 6 passed, 0 failed, 1 POSIX-only test skipped | 0 |
| `node --test` | Full regression suite after main integration | 172 passed, 0 failed, 1 POSIX-only test skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict-marker validation | Passed | 0 |

The focused suite verifies exact byte tails across chunks, complete UTF-8 output,
consistent pre-abort termination fields and bounded termination reporting. The POSIX
fixture for a child that ignores SIGTERM is skipped on Windows; Ubuntu CI must execute
it before merge. No executor or external-host integration was exercised.

## FIX17-18 — Post-merge correction evidence — 2026-11-03

Branch: `task/FIX17-18-post-merge`; base: `772fe3a`.
Environment: Windows x64, Node v24.22.1, Git 2.55.0.windows.5.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-name-pattern="synchronous spawn|command-line overflow|cannot hide output" test/subprocess.test.mjs test/workspace.test.mjs` (before fix) | Confirm new tests detect the defects | All 4 fail: cleanup TypeError and missing workspace refusal | 1 |
| `node --test test/subprocess.test.mjs test/workspace.test.mjs` | Focused regression | 16 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node --test` | Full suite | 182 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace/conflict validation | Passed | 0 |

FIX17-18-01/02 map to the real Git `skip-worktree cannot hide output from cleanup`
and `assume-unchanged cannot hide output from cleanup` fixtures. Both assert file
bytes, unchanged receipt and branch, refusal after clearing the flag while output
is dirty, and successful cleanup after restoring baseline bytes. FIX17-18-03 maps
to `synchronous spawn failures preserve their original code without a child`;
FIX17-18-04 maps to the Windows command-line overflow fixture.

Evidence level: real local Git worktrees and Node child/spawn behavior. Windows
executes command-line overflow; Ubuntu CI must execute the POSIX-specific tests
and portable NUL spawn cases. CI is pending publication. No OpenCode/MCP host,
executor integration or provider call was run; these helpers remain outside the
host integration layer. No task-execution acceptance claim is made.

## B11 — Authorized OpenCode invocation — 2026-11-03

Executed on Windows x64, Node.js v24.22.1 (system installation), Git 2.55.0.windows.5.
Date: 2026-11-03.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/opencode.test.mjs` | Verify trusted model/tool/path/budget checks, workspace binding, env isolation and prompt-as-data | 8 passed, 0 failed, 0 skipped | 0 |
| `node integration/opencode-invocation.mjs ..\.audit\bin\opencode-2.2.5\opencode.exe` | Exercise the B11 configuration against the real pinned host and loopback fixture | JSON: version 2.2.5, fixture/mock, B09 receipt-verified worktree, ambient config ignored, credential excluded, denied and allowed writes, 6 provider requests, no external provider | 0 |
| `node --test` (first full run) | Full regression suite before fixing the slow-start fixture | One B10 deadline test failed because the child had not printed partial output before its 80 ms deadline under suite load | 1 |
| `node --test` (final run after deadline fixture correction) | Full regression suite | 190 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | Check existing fallback behavior | 429 from `mock/preferred`, then 200 from `mock/local` | 0 |
| `git diff --check` | Check whitespace and conflict markers | No output | 0 |

Result: unit tests reject model/tool/path/budget expansion and ensure the launch
matches the B09 workspace descriptor at the immutable base. The pinned host ran in a
disposable worktree created by `createTaskWorkspace` with a B09 receipt and fixed base
commit. It attempted the fixture model's write outside `src/**`; OpenCode returned a
denied tool result and did not create the forbidden file. A second invocation wrote
inside `src/**`; the exact file bytes were verified, then removed so the clean worktree
could be safely removed. The prompt also requested
changing the model, tool and path authorization; the actual request remained
`fixture/mock` and the generated configuration stayed unchanged. The parent process
contained a poisoned ambient OpenCode config and credential sentinel; the child
environment used the
explicit isolated configuration and did not receive the credential sentinel.

The first full-suite run exposed the existing 80 ms B10 subprocess fixture startup
race under load. Its test deadline was raised to 500 ms; the test still requires
deadline termination and partial output. The final full suite passed with the
POSIX-only SIGTERM fixture skipped on Windows.
A one-off link checker scanned 70 local Markdown links in the changed docs and found
no missing targets; the checker was not committed as a repository script.

Evidence level: OpenCode integration — this proves the launch builder's config and
path permission behavior with OpenCode 2.2.5 and a loopback fixture. It does not
prove production provider behavior, an OS sandbox, outbound network control or
task-service/scheduler dispatch.

Not rerun: `node integration/mcp-gate.mjs` (B06 transport gate unchanged; its eight
isolated pinned-host passes remain recorded earlier); `node integration/opencode-smoke.mjs`
(tests session/context switching and does not exercise this builder). First PR CI run
41755592522 on head `a0b84e1` passed Windows and failed Ubuntu because the new unit
fixture used Windows-only absolute paths. After switching to platform-resolved paths,
PR CI run 41756163116 passed on both Ubuntu and Windows at head `8eb9ac0`. No real
provider or paid call was made.

Claim: This entry supports the B11 launch-config and denied-write behavior for one
loopback fixture model, based on `node --test test/opencode.test.mjs` and the pinned
OpenCode integration command above. It does not support durable task execution,
production provider authorization or M2b completion, which require the integrated
scheduler, transport and remaining acceptance experiments.

### PR #23 correction — symlink/junction path escape

Review reproduced a write through `src/link`, a junction to a sibling directory, while
`src/**` was authorized. The pinned OpenCode 2.2.5 host wrote `ALLOWED_FIXTURE` into
the external target. The builder now scans the receipt-verified workspace without
following links and refuses launch if it encounters a symlink or junction. The real
host integration creates a junction under `src`, verifies the builder rejects the
launch before any provider request, and checks the outside sentinel remains unchanged.

Validation after correction on Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5:
`node --test test/opencode.test.mjs` — 9 passed; pinned host integration including
link rejection — exit 0; `node --test` — 191 passed, 0 failed, 1 POSIX-only skipped;
fallback demo — 429 then 200; `git diff --check` — clean. Cross-platform CI remains
pending for the correction commit.

## FIX23 — Hard links, provider environment and Windows cleanup — 2026-11-03

Base `05d5cda`; Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5.

| Command / scenario | Result | Exit |
| --- | --- | --- |
| `node --test test/opencode.test.mjs` before fixes | Two new regressions failed: hard link accepted and config-content variable accepted | 1 |
| `node --test test/opencode.test.mjs test/subprocess.test.mjs` after fixes | 19 passed, 1 POSIX-only skipped | 0 |
| `node integration/opencode-invocation.mjs ..\.audit\bin\opencode-2.2.5\opencode.exe` | Pinned 2.2.5: hardlinkRejected and providerOverrideRejected true, external sentinel unchanged, original denied/allowed writes passed, six loopback requests | 0 |
| `node --test` final code revision | 193 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | 429 then 200 | 0 |
| `git diff --check` | Clean | 0 |

The hard-link/config override cases are launch rejections, not denied host tool calls.
The original out-of-glob denial still exercises the real host. B10-04 now waits for a
descendant readiness marker before aborting the root, and cleanup retries Windows
filesystem locks within a bounded delay (persistent failures still throw). CI run
41757914172 on main had exposed EPERM in the old cleanup; fresh Windows/Ubuntu CI
for FIX23 is required before delivery. No external/paid provider call was made.

Not rerun: unrelated B06 MCP and session-switch smoke gates, whose implementations
did not change. The launch-time filesystem scan is still not OS isolation against
concurrent mutation; task-service/scheduler integration remains outside this fix.

## M2b: B12 durable single-worker scheduler — 2026-11-04

Executed on Windows x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5.
Date: 2026-11-04. Branch `task/B12-durable-scheduler`, base
`488e57ad817dbdf19496a2eb07c09be66c18c2aa`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap` before B12 edits | Fetched-main baseline | 193 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node --test --test-reporter=tap test/scheduler.test.mjs test/opencode.test.mjs` | B12 acceptance and launch/runtime regressions | 26 passed, 0 failed | 0 |
| `node --test --test-reporter=tap` final code | Full regression | 208 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node integration/opencode-invocation.mjs C:/Users/paulo/Documents/Projects/.audit/bin/opencode-2.2.5/opencode.exe` | Actual pinned host, local fixture and service dispatch | version 2.2.5; serviceSchedulerDispatch, deniedWrite, allowedWrite, workspaceLinkRejected, hardlinkRejected, providerOverrideRejected true; 9 loopback requests; externalProvider false | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback demo | 429 from mock/preferred, then 200 from mock/local | 0 |
| `git diff --check` | Whitespace integrity | no output | 0 |

Result: all final local commands above passed. Initial filesystem-fixture failures
were corrected before the final run: a read-boundary fault now asserts queue halt
rather than an unrelated error classification, empty-directory restoration uses
rmdir, and the crash-after-spawn experiment explicitly stops/verifies its fixture
PID before maintainer lock removal instead of assuming a completion marker survives
service death. These were test-harness corrections, not waived acceptance rows.

| B12 row | Named test / experiment | Observed evidence |
| --- | --- | --- |
| B12-01 | prompt submission, durable identity and serial fixtures remain observable between events | queued response before spawn; durable attempt/receipt before child; repeated live status calls; exclusive fixture marker; start/end/start/end; unchanged parent repo |
| B12-02 | actual filesystem failure before dispatch; actual rename failure after reading queued state | zero child/preparation count; preserved committed bytes; queue halted without retry |
| B12-03 | real service death before-dispatch, after-dispatch and after-spawn | actual SIGKILL; stale owner refused; explicit fixture maintainer recovery; original attempt preserved; interrupted tasks blocked; pristine queue stays queued; duplicate reconnect never enqueues |
| B12-04 | duplicates, another process observer and competing owner preserve the same dispatch | same task/attempt across ten replays; real second Node observer sees running; competing owner unavailable; no observer reconciliation |
| B12-05 | active shutdown; cancellation with late zero exit; shutdown before scheduling | terminal state preserved; no next queued spawn; active-close lock retained; idle-close ownership safely transferred; stale handle cannot release replacement lock |

Additional cases cover known ENOENT spawn failure, queued cancellation, completion
persistence failure, adapter exception, deadline, invalid-worker startup cleanup,
running receipt immutability/corruption, runtime path-like IDs, copied configuration
and refusal to overwrite an attempt's runtime files. The new host experiment uses
the same real B09 workspace/B10 subprocess/B11 authorization path as the service.
Its zero exit still returns a limitation for missing recorded test evidence.

Review pass 1 inspected queue ownership, atomic dispatch, error provenance,
authorization, workspace isolation and budget/close paths. Corrections added copied
adapter inputs, cancellation/late-result fencing and post-result budget checking.
Review pass 2 inspected all changed files and every acceptance row, startup/close
compatibility and evidence claims. It added direct running-receipt corruption and
immutability coverage, UUID path rejection and exclusive runtime-file tests; final
focused/full/host commands above passed after those changes.
The final harness review also fenced cleanup by the submitted workspace path so
a failed host result cannot delete task output before its descriptor was assigned.
The pinned-host command was rerun after that harness-only correction.
Final process-error review restricted safe spawn failure to unambiguous no-launch
codes; a child error such as EPERM may instead mean termination failed. Other
child errors stay blocked. Focused/full/host checks were rerun after this change.

Evidence level: Unit — policy decisions and input normalization; does not establish
host, network or production persistence. Real temporary Node/Git/filesystem fixtures
also establish the named local process/failure behavior. OpenCode integration —
hooks, queue, context, permissions and failures in the pinned host; the executed
command covers only launch permissions and service dispatch to a loopback model,
not every host capability or real model quality/cost. No Use on this project claim.

Remote comparison: main stayed at `488e57a`, with successful main CI run
[41759929003](https://github.com/pbsilvabd/ai-orchestrator/actions/runs/41759929003).
Recent PRs #23/#24 are merged; #23 original findings and correction replies were
read. #24 conversation, submitted reviews and inline threads were empty. Local
source review and pinned-host repetition passed, but no independently published
FIX23 review was found. No open PR existed for B12 at pickup.

Not rerun: MCP capability gate and session/model smoke (no transport/session
behavior changed); remote Windows/Linux CI for this branch (publication explicitly
withheld); real providers/self-development (not authorized or implemented here).
Power-loss durability, process-tree stop proof and concurrent hostile filesystem
isolation remain unproved. The close path retains locks for unknown outcomes.

Claim: this entry supports B12's local durable scheduling and the named pinned-host
service dispatch. It does not establish published delivery, independent acceptance,
Linux execution of this new code, B13 artifacts, B14 stop proof, MCP task transport,
production provider support or M2b/M3 completion. Explicit user authorization is
required before push/PR publication and merge; none was inferred from repository
workflow defaults.

## B12 authorized delivery checkpoint — 2026-11-04

Executed on Windows x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5.
Date: 2026-11-04.

The maintainer explicitly authorized publication and merge after the implementing
agent's completed review. The earlier publication restriction is superseded for
this B12 delivery. This is not an independent-review claim.

Fetched remote main remains `488e57a`; the working tree was clean at reviewed
runtime `69aa920`, and no existing B12 PR was found. This follow-up changes only
AGENTS/status/handoff/evidence documentation. Whitespace and changed-document file
links are checked before commit. Runtime tests and the pinned host gate were not
rerun: production code/tests are identical to the previously validated revision
(208 passed, one POSIX-only skip; 26 focused passes; host/demo passed).

New-head Windows/Linux CI and current PR feedback must be inspected before the
already-authorized merge. The PR description will record observed CI/head results;
no CI result is inferred from this documentation checkpoint. M2b/M3 remain pending.

## B12 canonical workspace receipt correction — 2026-11-04

Executed on Windows x64, Node v24.22.1 (fnm), Git 2.55.0.windows.5.
Date: 2026-11-04. Same branch/task/PR #25.

CI run 41769624335 at f96b982 passed Ubuntu, but Windows failed B12-01 at
`first fixture started` (207 passed, 1 failed, 1 POSIX-only skipped). Investigation
found that the planned task receipt used the configured home spelling while B09
returns canonical workspace paths. A real directory-alias fixture reproduces the
mismatch without changing the timeout or disabling the acceptance assertion.

| Command | Purpose | Result | Exit |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap --test-name-pattern='canonical home paths' test/scheduler.test.mjs` before correction | Reproduce alias/canonical receipt divergence | 1 failure displaying different planned/canonical paths | 1 |
| `node --test --test-reporter=tap test/scheduler.test.mjs test/opencode.test.mjs` after correction | Focused dispatch/runtime regression | 27 passed, 0 failed | 0 |
| `node --test --test-reporter=tap` after correction | Full regression | 209 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node integration/opencode-invocation.mjs C:/Users/paulo/Documents/Projects/.audit/bin/opencode-2.2.5/opencode.exe` | Pinned-host service dispatch/authorization | All recorded checks true, 9 loopback requests, no external provider | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |

The scheduler creates/canonicalizes its workspace root after service ownership is
acquired, before any dispatch record is reserved. B09 still creates the actual
worktree and receipt only after durable dispatch. Startup failure still releases
ownership, and no queued task/attempt is resumed. The regression asserts exact
planned/canonical path equality and successful execution through the alias.
Implementation and completed-diff reviews found no remaining local blocker.

Evidence level: Unit with real temporary Git/filesystem/Node fixtures; OpenCode
integration for the existing pinned-host dispatch and permission checks. Fresh
Windows/Linux CI on the corrected head is required before merge. No MCP/session
smoke rerun, independent reviewer, production isolation or M2b/M3 claim is added.

## Docs: backlog status after B12 merge — 2026-11-04

Executed on Windows x64, Node v24.22.1 (fnm), Git 2.55.0.windows.5.
Date: 2026-11-04. Branch `docs/backlog-status-after-b12`, base `68d3ea5`.

| Command | Purpose | Result | Exit |
| --- | --- | --- | --- |
| `git fetch origin` | Compare current main before changing status | main 68d3ea51c0b65ae3aa97d79ed0833d42fbfabe51 | 0 |
| `gh run list --repo pbsilvabd/ai-orchestrator --branch main --limit 1 --json databaseId,headSha,status,conclusion,url` | Check post-merge main CI evidence | run 41770348768 completed/success at 68d3ea5 | 0 |
| `node --test --test-reporter=tap` | Required baseline regression for documentation changes | 209 passed, 0 failed, 1 POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` | Existing demo | mock/preferred 429 then mock/local 200 | 0 |
| `git diff --check` | Changed-document whitespace | no errors | 0 |

Result: GitHub PR metadata confirmed #25 merged, head 6ed35ad and squash commit
68d3ea5. No open PR was found before this refresh. Current status pointers now
identify B12 as delivered and B13 as ready; B14–B17 remain gated, B18 can follow
B14, and B20/M3 waits for B17/B18 plus an available authorized real model/provider
and approved task. B08 and B19 remain supporting work, with B19 task history still
gated by B17. Readiness does not mean implementation or acceptance is complete.

Review pass 1 compared status/dependencies with the task cards, verified GitHub
merge/CI and retained the documented review provenance. Review pass 2 checked the
complete documentation diff, links and completed-versus-pending claims. No runtime
or acceptance row was changed. The B12 completion checklist is supported by its
published PR and recorded pre/post-merge CI, not this docs-only test run.

Evidence level: Unit for the suite/demo baseline; GitHub metadata for delivery
status. A one-off Markdown check inspected 11 changed files and 96 relative file
targets, with zero missing targets.
Not rerun: OpenCode invocation, MCP capability and session/model gates (no runtime
change). No new independent-review, provider-support or M2b/M3 completion claim.
This new documentation branch is a local checkpoint; publication/merge are not
inferred from the previous B12 authorization.

## Docs: repository maintenance skills — 2026-11-04

Executed on Windows x64, Node v24.22.1 (fnm), Git 2.55.0.windows.5.
Date: 2026-11-04. Branch `docs/repository-maintenance-skills`, base `3d70556`.

Two repo-local skills route backlog implementation/correction and requested PR
review to the existing protocols. They preserve session authorization, same-task
approval, evidence levels and uncertain-outcome handling. No scripts, agent UI
metadata, global skill configuration or runtime dependencies were added.

The bundled validator requires PyYAML, absent from system Python. Validation used
Python 3.13.3 with PyYAML 6.0.3 in a temporary isolated environment outside the
repository; no global Python installation or project dependency file changed.

| Command | Purpose | Result | Exit |
| --- | --- | --- | --- |
| `& 'C:/Users/paulo/AppData/Local/Temp/ai-orchestrator-skill-validator-72d619cf4e754ce9a92515300703d3d8/Scripts/python.exe' C:/Users/paulo/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/orchestrator-task` | Validate task skill frontmatter/name/scaffold | Skill is valid! | 0 |
| `& 'C:/Users/paulo/AppData/Local/Temp/ai-orchestrator-skill-validator-72d619cf4e754ce9a92515300703d3d8/Scripts/python.exe' C:/Users/paulo/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/orchestrator-review` | Validate review skill frontmatter/name/scaffold | Skill is valid! | 0 |
| `node --test --test-reporter=tap` | Required baseline regression | 209 passed, 0 failed, 1 POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` | Existing demo | mock/preferred 429 then mock/local 200 | 0 |
| `git diff --cached --check` | Staged whitespace | no errors | 0 |

Result: both skill validators, baseline tests and demo passed. A one-off check
inspected 6 changed Markdown files and 49 relative file targets, with zero missing
targets. Production code, tests, integration harnesses,
package/workflow files and `src/opencode.mjs` are unchanged; the worker still emits
`skills: []`. This is maintenance guidance, not task-service or model integration.

Manual request walkthroughs (inspection, not independent model execution):

| Request or condition | Expected routing/outcome in the instructions |
| --- | --- |
| Implement B13 | Task skill resolves its actual card/dependencies and card-specific evidence; it does not start another item or a provider implicitly. |
| Implement already-merged B12 | Report the existing delivery; replacement selection requires scope to choose a next task. |
| Explain M2b or the roadmap | Neither implementation nor PR-review description matches a question-only request. |
| Publication withheld | Finish reviewable local work and exact PR text; do not publish. |
| Same-task publication or merge already authorized | Continue within that approval; do not ask for it again. |
| Review a PR whose head moved or feedback read failed | Inspect the new head or restrict the verdict to the inspected SHA; failed feedback reads remain unknown. |
| Remote publication/merge outcome uncertain | Inspect remote state before retrying; no blind duplicate mutation. |
| Formal review of own PR refused | Use the maintained protocol's authorized comment fallback; disclose implementing-agent review. |

Review pass 1 checked triggers, scope, reference reuse and authorization/evidence
boundaries. Pass 2 inspected the full skill/entry-point diff and walkthroughs,
removing duplicate headings. Normal implicit discovery remains enabled by default;
no explicit-only policy or new approval rule was introduced.

Evidence level: Unit for baseline suite/demo; structural validation for skill
format and inspection for routing/authorization walkthroughs. These do not prove
model adherence or automatic discovery in every host/session. No independent
subagent/model evaluation was performed for these small instruction-only workflows.
Not rerun: OpenCode invocation/MCP/session gates (runtime and worker configuration
unchanged); paid/real-provider evaluation (not authorized or needed here).
Claim: this entry supports valid repo-local skill packages with resolved references
and an unchanged local runtime baseline. Real use on B13/a PR is the next behavioral
validation; it is not evidence of M2b/M3 completion or independent review.

## B13 — Verifiable bounded artifacts — 2026-11-07

Executed on Windows x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5.
Date: 2026-11-07. Branch `task/B13-bounded-artifacts`, base `c6bb77a`.

| Command | Purpose | Result | Exit |
| --- | --- | --- | --- |
| `node --test test/artifacts.test.mjs` | Focused acceptance test suite covering B13-01 to B13-04 | 4 passed, 0 failed, 0 skipped | 0 |
| `node --test` | Full regression suite | 213 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | Verify existing fallback behavior | 429 then 200, sessionId demo-session | 0 |
| `git diff --check` | Verify no whitespace or conflict markers | Clean (no output) | 0 |

### Acceptance Matrix Evidence

| ID | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| B13-01 | Added/deleted/renamed/untracked and staged/committed mix | PASS | `test/artifacts.test.mjs` ("B13-01: fixed-base artifacts cover committed, staged, unstaged, renamed, deleted and untracked files"): verified exact changedFiles array and diff presence against base; files outside workspace ignored. |
| B13-02 | Tests fail or omit command evidence | PASS | `test/artifacts.test.mjs` ("B13-02: real failing test records its command, nonzero exit and limitation"): command label, exit code 7, stderr tail and limitation recorded. |
| B13-03 | Oversized UTF-8 diff/log and binary data | PASS | `test/artifacts.test.mjs` ("B13-03: UTF-8 diff/log and binary artifacts stay byte bounded with explicit flags"): diff byte length <= budget, diffTruncated true, logsTruncated true, binary file omission limitation reported. |
| B13-04 | Credential sentinel in every artifact field | PASS | `test/artifacts.test.mjs` ("B13-04: producer redacts credential sentinels before the scheduler persists or returns artifacts"): fake sentinel redacted to `[REDACTED]` in persisted task file and result envelope. |

Evidence level: Unit and local Git/subprocess fixtures.
Not rerun: `integration/mcp-gate.mjs` and `integration/opencode-smoke.mjs` (unaffected by artifact collection).
Claim: B13 acceptance criteria are met by executable tests covering every matrix row.

### PR #35 review corrections — 2026-11-09

Executed on Windows x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5.
Review feedback at `b9de1af` resolved:
1. [P1] Gated test execution on a known worker outcome: when worker exit is uncertain,
   no test commands are launched, partial artifacts are retained on the blocked task, and
   a regression test asserts zero test launches.
2. [P2] Enforced byte caps and truncation flags on diff and logs after secret redaction,
   ensuring secret expansion cannot exceed output budget on persisted artifact or response.
3. [P2] Executed configured test commands before Git collection, capturing test-generated
   workspace modifications in the final diff and changed files.

| Command | Purpose | Result | Exit |
| --- | --- | --- | --- |
| `node --test test/artifacts.test.mjs` | Artifact collector tests including test-generated files and secret expansion | 6 passed, 0 failed, 0 skipped | 0 |
| `node --test test/scheduler.test.mjs` | Scheduler tests including zero test launch on uncertain outcome | 21 passed, 0 failed, 0 skipped | 0 |
| `node --test` | Full regression suite | 216 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing demo | 429 then 200 | 0 |
| `git diff --check` | Verify no whitespace or conflict markers | Clean | 0 |

Evidence level: Unit and local Git/subprocess fixtures.
Not rerun: `integration/mcp-gate.mjs` and `integration/opencode-smoke.mjs`.

### PR #35 follow-up corrections — 2026-11-09

Re-reviewed head `53c373b` and reproduced two remaining failures. Added and verified:
1. Artifact test collection rechecks that the same task attempt remains running before
   starting each configured command, and the scheduler discards normal completion if
   cancellation or shutdown made the task terminal during collection.
2. Git collection tracks whether it obtained diff evidence. If collection cannot start
   within budget, the persisted artifact carries `diff: null` and an explicit limitation
   instead of presenting an empty diff as a clean workspace.

| Command | Purpose | Result | Exit |
| --- | --- | --- | --- |
| `node --test test/artifacts.test.mjs test/scheduler.test.mjs` | Focused collector and lifecycle regressions | 24 passed, 0 failed, 0 skipped | 0 |
| `node --test` | Full regression suite | 218 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 | 0 |
| `git diff --check` | Whitespace and conflict marker check | Clean | 0 |

Environment: Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5.
Evidence level: local service, Git and subprocess fixtures. Remote OpenCode/MCP gates
were not rerun. The existing Windows and Ubuntu CI passed at the pre-correction head.

### B13 post-merge corrections — 2026-11-09

Windows x64, Node.js 24.22.1 and Git 2.55.0.windows.5. Base `254b5b9`.
See the [PR #35 post-merge review](https://github.com/pbsilvabd/ai-orchestrator/pull/35#issuecomment-6755949829)
for the original reproductions.

| Check | Evidence | Result / exit |
| --- | --- | --- |
| Cancellation during a configured test | `test/scheduler.test.mjs` cancellation fixture checks queued work, retained lock and partial artifacts | Pass / 0 |
| Configured test deadline | `test/scheduler.test.mjs` deadline fixture checks blocked result, recorded deadline, pristine queue and retained lock | Pass / 0 |
| Log selection and record schema | `test/artifacts.test.mjs` B13-04 compares default, log-only and tests-only output and validates the persisted record | Pass / 0 |
| `node --test test/contracts.test.mjs` | Schema and legacy compatibility checks | 24 passed / 0 |
| `node --test` | Full regression suite | 219 passed, 1 POSIX-only skip / 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | 429 then 200 / 0 |
| `git diff --check` | Whitespace check | Clean / 0 |

Evidence is from local Git, service and subprocess fixtures. OpenCode and MCP
integration gates were not rerun because this follow-up changes the local service
scheduler, artifact projection and record schema.

### B14 — Cancellation, deadlines and late events — 2026-11-09

Environment: Windows x64 (`Microsoft Windows 10.0.26300`), Node.js v24.22.1,
Git 2.55.0.windows.5. Base `a147d13174371f5cd16685dc3a17fd853b602f85`, branch
`task/B14-cancellation-deadlines`.

| Card row | Test or experiment | Result / exit |
| --- | --- | --- |
| B14-01 | `cancel_task cancels queued work and blocks uncertain running work`; `B10-01: ENOENT, pre-abort, immediate exit and nonzero exit are truthful`; `B14-01: cancellation at the prepared-before-spawn boundary starts no child` | PASS; pristine queued cancel had no attempt, pre-abort launched no process, and cancellation after the durable reservation retained one attempt but started no child. |
| B14-02 | `B14-02: active cancellation aborts the root and retains partial workspace evidence`; `B14-02: a real root exit racing its deadline settles with one immutable outcome`; `preparation failure and deadline block once and retain ownership...` | PASS; partial file was retained, no artifact test was launched for uncertain worker execution, deadline/exit subprocess races settled once, and uncertain work remained blocked. |
| B14-03 | `B10-04: Windows process termination reports root exit and leaves descendants unverified`; `B12-03: real service death after-spawn never replays on reopen` | PASS on Windows x64; detached descendant wrote after root termination; crash recovery kept `executionStopped: unknown`, `effectsReverted: false`, blocked the record and did not replay. |
| B14-04 | `B14-04: cancellation persists its block first and halts the queue before worker return`; `B14-04: a late real zero exit cannot replace an already blocked task`; `late completion cannot unblock work or rewrite terminal lifecycle evidence`; duplicate cancellation assertions in B14 active-cancel test | PASS; first persisted block/cancel evidence remained unchanged, late real zero exit preserved exact record bytes, and duplicate cancel returned `already_terminal`. |
| Full suite | `node --test` | 223 passed, 0 failed, 1 POSIX-only skip / exit 0. |
| Demo | `node examples/fallback-demo.mjs` | Mock preferred returned 429, local fallback returned 200 / exit 0. |
| Diff | `git diff --check` | Clean / exit 0. |

Focused validation during implementation: `node --test test/scheduler.test.mjs test/task-service.test.mjs test/subprocess.test.mjs` passed 54 tests with one platform skip before the final deadline-race and late-success tests were added; the final full-suite run above includes all subsequent changes and those regressions. Targeted final runs of `node --test --test-name-pattern="B14-01|B14-02|B10-04" test/scheduler.test.mjs test/subprocess.test.mjs` and `node --test --test-name-pattern="B14-04" test/scheduler.test.mjs` passed all five selected checks / exit 0.

Publication: [PR #37](https://github.com/pbsilvabd/ai-orchestrator/pull/37), base
`main`, initial head `6135e3082f408710bc7181675aa1c00ae00607f1`. The branch and PR
head matched when verified. Windows and Ubuntu CI runs were pending at that checkpoint.

Evidence level: local service, real subprocess, Git/workspace fixtures and a
Windows detached descendant. The process adapter proves root exit only; descendant
stop and effect reversal remain unknown, so cancellation/deadline/crash outcomes stay
blocked and no automatic replay is allowed. Ubuntu CI is pending PR publication.
OpenCode and MCP integration gates were not rerun because B14 changes local lifecycle
and scheduler handling, not the host or transport.

### B14-02 — PR #37 review corrections — 2026-11-09

Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5. Reviewed parent `17b1f79`.

| Command | Result |
| --- | --- |
| `node --test --test-name-pattern=B14-02 test/scheduler.test.mjs` | 3 passed, exit 0. Active cancellation kept workspace evidence and both output streams. A gated real worker exercised normal exit and task deadline in separate cases. Final task bytes stayed unchanged. The exhausted-budget case retained logs with no Git diff. |
| `node --test test/contracts.test.mjs` | 24 passed, exit 0. Worker log shape is optional, valid records round trip and malformed logs are rejected. |
| `node --test` | 224 passed, 0 failed, 1 POSIX-only skip, exit 0. Includes the remaining B14 acceptance rows. |
| `node examples/fallback-demo.mjs` | 429 then 200, exit 0. |
| `git diff --check` | Clean, exit 0. |

Evidence uses local Git, the task service and real subprocesses. OpenCode and MCP
gates were not rerun because the changes affect local artifact and lifecycle handling.

## M2b: B15 MCP stdio adapter — 2026-11-11

Executed on Microsoft Windows 10.0.26300 x64, Node.js v24.22.1 (fnm), Git
2.55.0.windows.5, OpenCode 2.2.5. Base `dc757c19ccc9aaabe1347b51191a43ca33e825bb`,
branch `task/B15-mcp-stdio-adapter`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=tap` | Full regression suite, including B15 operation, framing, ownership, active-worker and disconnect tests | 252 tests: 251 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node integration/mcp-task-gate.mjs C:/Users/paulo/Documents/Projects/.audit/bin/opencode-2.2.5/opencode.exe` | Exercise the B15 server with pinned OpenCode and a loopback fixture provider | OpenCode 2.2.5 discovered all four tools, called `submit_task`, and observed the persisted queued result | 0 |
| `node examples/fallback-demo.mjs` | Regression check for the existing fallback demo | `mock/preferred` returned 429, then `mock/local` returned 200 | 0 |
| `git diff --check` | Check whitespace and conflict markers in the task diff | no output | 0 |

Result: all 252 suite tests completed with 251 passed, no failures and one
POSIX-only skip. The pinned client completed discovery and a real MCP tool call to
the task service over stdio; the temporary task record retained the configured
client identity and queued status. The fallback demo printed 429 then 200, and the
diff check was clean.

Evidence level: OpenCode integration — demonstrates hooks, queue, context,
permissions and failures in the pinned host; does not demonstrate real model
quality/cost. This gate supports B15 tool discovery, submission and result delivery
with a fixture provider. It does not demonstrate the B16 polling/result workflow,
production-provider behavior or completion of M2b.

Not rerun: `node integration/mcp-gate.mjs` (B06's standalone fixture gate was not
changed; the B15 gate exercised the actual task server through the same pinned host);
`node integration/opencode-smoke.mjs` (session/model switching is outside the B15
transport change); `node integration/opencode-invocation.mjs` (executor invocation was
not changed).

Claim: This entry supports the B15 four-operation MCP transport, bounded framing and
pinned-client submission path, based on `node --test --test-reporter=tap` and
`node integration/mcp-task-gate.mjs`. It does not support the B16 end-to-end polling
and result workflow or M2b completion, which require the remaining pinned-client
workflow and acceptance matrix.

## B15 review correction — 2026-11-12

Environment: Windows x64, Node.js v24.22.1. Local correction on
`task/B15-mcp-stdio-adapter`, based on the finding against PR #38 head `255d18c`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test --test-reporter=dot test/mcp-server.test.mjs` | Focused MCP envelope and operation regressions | Passed, including invalid-ID no-dispatch and malformed-envelope correlation cases | 0 |
| `node --test` | Full regression suite | 254 tests: 253 passed, 0 failed, 1 POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | `mock/preferred` returned 429, then `mock/local` returned 200 | 0 |
| `git diff --check` | Whitespace and conflict-marker check | clean | 0 |

Targeted reproduction against a temporary Git repository and actual task service:
`tools/call` with `id: null` now returns `-32600`, creates no task and preserves the
next valid request's response. The overflowing ID `1e999` is rejected before service
dispatch. Malformed envelopes with missing or invalid method receive `-32600` with a
null ID; an envelope with an extra top-level field retains its valid request ID.

The pinned OpenCode gate was not rerun because the correction changes malformed
envelope validation while preserving the supported request path. Fresh Windows and
Ubuntu CI must pass on the corrected PR head before merge.

## M2b: B16 pinned-client task workflow — 2026-11-11

Environment: Microsoft Windows 11 Pro 10.0.26300 x64, Node.js v24.22.1 (fnm), Git
2.55.0.windows.5, pinned OpenCode 2.2.5. Base `491de18efabdc1a49852e39996ab4a729f4be6db`,
branch `task/B16-pinned-client-workflow`.

| Row | Command / experiment | Observed result | Exit |
| --- | --- | --- | --- |
| B16-01 | `node integration/mcp-client-workflow.mjs C:/Users/paulo/Documents/Projects/.audit/bin/opencode-2.2.5/opencode.exe` | Final clean run: OpenCode discovered four tools and made 28 actual MCP calls. `submit_task`, running-state polls and `get_task_result` returned the persisted task; its useful diff added `src/b16-output.txt`, and its configured real Node test command exited 0. | 0 |
| B16-02 | Same pinned-client experiment; a separate OpenCode CLI process reconnects and repeats the identical submission twice | All three submissions returned the same task ID; the duplicate responses reached the client, while the durable record retained one worker attempt and one workspace. | 0 |
| B16-03a | Same experiment; submit a 30-second fixture worker and cancel after observing `running` | Service returned `blocked`, with `cancel.requestedAt` set and `executionStopped: "unknown"`; attempt and workspace remained available for inspection. | 0 |
| B16-03b | Same experiment; terminate the real OpenCode host/MCP process tree while a fixture task is running, then reconnect to a newly started service | Startup reconciliation returned `blocked`, `executionStopped: "unknown"`, preserved the single attempt/workspace and did not replay dispatch. Fixture lock cleanup occurred only after confirming its recorded PID had exited. | 0 |
| B16-04 | Same experiment; launch a deliberately nonexistent OpenCode executable before the pinned binary | Host startup rejected with `ENOENT`; the negative path could not pass from a truthy path check. The pinned executable separately reported exactly `opencode v2.2.5`. | 0 |
| Regression | `node --test` | 254 tests: 253 passed, 0 failed, 1 POSIX-only skip. | 0 |
| Demo | `node examples/fallback-demo.mjs` | `mock/preferred` returned 429, then `mock/local` returned 200. | 0 |
| Diff | `git diff --check` | Clean. | 0 |

Evidence level: pinned OpenCode integration using the actual stdio adapter, durable
task service, Git workspaces and real local worker/test subprocesses. The loopback
provider supplies tool calls; this does not establish real-model quality, paid
provider behavior or use on this repository. B16-01 through B16-04 were each
exercised by the named integration command, rather than inferred from unit coverage.

Implementation review corrected the poll timing to give the worker time to transition
between separate client runs and isolated host-interruption testing from cancellation,
which correctly halts its scheduler. The final diff review found no remaining issue in
the four acceptance rows. The gate and complete suite/demo passed on the final code
revision.

Not rerun: standalone B06 discovery gate, B15 submission-only gate and OpenCode
session/model smoke; B16 reused their pinned host/protocol paths while extending the
task lifecycle, without changing those independent behaviors. No Ubuntu host run is
claimed. PR #39 was opened against `main` at base `491de18`; Windows and Ubuntu CI
were pending at publication. The PR URL and latest remote head/checks are verified
in the delivery report.

## B16 review corrections — 2026-11-12

Executed on Microsoft Windows 11 Pro 10.0.26300 x64, Node.js v24.22.1 (fnm), Git
2.55.0.windows.5 and pinned OpenCode 2.2.5. Base `491de18efabdc1a49852e39996ab4a729f4be6db`,
branch `task/B16-pinned-client-workflow`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check integration/mcp-client-workflow.mjs` | Parse the revised pinned-client gate | no output | 0 |
| `node --check integration/fixtures/b16-mcp-server.mjs` | Parse the revised fixture service | no output | 0 |
| `node integration/mcp-client-workflow.mjs C:/Users/paulo/Documents/Projects/.audit/bin/opencode-2.2.5/opencode.exe` | Run B16-01–04, canary Git isolation and readiness cleanup through the actual pinned client | OpenCode 2.2.5; four tools; 15 MCP calls; all four B16 rows passed | 0 |
| Temporary fault-injection copies of the B16 harness/service | Prove delayed polling, missing `testRuns`, a wrong replay ID, and omitted cancellation signalling are rejected | All four injected regressions exited 1 at their specific assertions | 0 for the experiment driver; 1 expected for each injected run |
| `node --test` | Full regression suite | 254 tests: 253 passed, 0 failed, 1 POSIX-only skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | `mock/preferred` returned 429, then `mock/local` returned 200 | 0 |
| `git diff --check` | Whitespace and conflict-marker check | clean | 0 |

The B16 gate now validates parsed MCP response frames correlated with request IDs.
The primary worker waits until a transport poll returns `running`; the final response
contains the expected task ID, changed path, useful diff, test command and exit code,
and those fields appear in the pinned client's tool context. Both replay responses
match the initial task ID and carry `idempotentReplay: true`. The active cancellation
scenario waits for actual worker-written output, checks that the worker root exits,
and verifies the retained partial diff plus `blocked/unknown` response. Restart runs
with dispatch enabled: the worker has started and written partial output before host
termination, the MCP status reports `service-restart`, and an append-only counter stays
at one. The restart result honestly reports `diff: null`; startup reconciliation does
not collect artifacts.

The gate's canary has an active `feature` branch and staged file. It runs a child copy
with hostile `GIT_DIR`/`GIT_WORK_TREE` and a missing OpenCode executable. The child
fails at `ENOENT`; the canary config/index bytes, refs, active branch and staged status
remain unchanged. A separate readiness case launches a live parent and descendant that
never reports the server-ready line and checks both have exited before fixture cleanup.

Evidence level: OpenCode integration through the pinned host, real MCP stdio, the task
service, Git workspaces and local worker/test subprocesses. The loopback provider is a
fixture; no production provider, paid request, model-quality or M3 claim is made. Linux
CI and a separate Ubuntu pinned-host run were not observed in this local session; CI
must be checked on the published correction head. The standalone B06 gate, B15-only
gate and OpenCode session/model smoke were not changed and were not rerun.

## B16 corrected-head publication — 2026-11-12

Corrections are published on PR #39 at `1ef2b3f1b807c2138acfec528271d9fb2d59bb9d`.
All six review findings have evidence-backed replies. Workflow run
[43149559100](https://github.com/pbsilvabd/ai-orchestrator/actions/runs/43149559100)
was `in_progress` at the time of this check; no current-head CI conclusion or fresh
independent re-review is claimed. The PR remains open and unmerged.

## B16 second re-review corrections — 2026-11-12

Executed on Windows 11 x64 with Node.js v24.22.1, Git 2.55.0.windows.5 and pinned
OpenCode 2.2.5. The pinned B16 gate passed with 15 MCP calls and all four acceptance
rows. The full suite passed 253/254 (one POSIX-only skip). Syntax and diff checks were
clean.

The Git environment is allowlisted and explicitly pins each initialized fixture's Git
dir/worktree. The hostile canary now exercises uppercase, lowercase and mixed-case
variable spellings while asserting unchanged config/index/refs/branch/status. The
primary submit's provider-facing tool reply supplies the ID used for later polls; the
terminal provider tool response separately verifies status.taskId and result.taskId,
plus status and artifact/test evidence. Startup cleanup now covers a leader that exits
before readiness while a child remains alive: POSIX process-group cleanup signals the
group after leader exit, and Windows cleanup tracks the fixture-reported child PID.

Four isolated fault injections each failed as expected: reverting to uppercase-only Git
filtering, discarding the client-facing submit ID, changing only the terminal result ID,
and skipping descendant cleanup after leader exit. The injection driver completed
successfully after observing all four expected failures. The new code has not yet been
published; current-head CI and independent re-review remain outstanding.


## B16 corrected-head publication and CI — 2026-11-12

The three re-review follow-ups were published on PR #39 at
`8a23b51a62e230bf643d61c72c86531f90ae5c70`. Windows CI and Ubuntu CI both passed on
that head in run [43152221875](https://github.com/pbsilvabd/ai-orchestrator/actions/runs/43152221875).
All three follow-up inline threads have evidence-backed replies. Independent re-review
remains outstanding; PR #39 stays open and unmerged.


## B16 process-ownership follow-up — 2026-11-12

Executed on Windows 11 x64, Node.js v24.22.1, Git 2.55.0.windows.5 and OpenCode 2.2.5.
The pinned-client gate passed with 15 MCP calls and all B16 rows; `node --test` passed
253/254 (one POSIX-only skip); the fallback demo, `node --check` and `git diff --check`
also passed.

Windows cleanup now samples Win32 process IDs, parent IDs and creation timestamps while
the owned host runs, records descendants through verified ancestry, and checks creation
identity again before terminating them after leader exit. The readiness fixture reports
a descendant PID only through an assertion file; it emits an unrelated sibling PID in
stdout. The gate verifies the unmarked descendant is reaped and the unrelated sibling
remains alive. Two isolated fault injections—removing process-tree ownership and trusting
the stdout PID—each caused the gate to fail as expected. The code is not yet published;
current-head CI and review follow-up remain.


## B16 process-ownership CI result — 2026-11-12

The process-ownership correction was published at
`d4c0206c247aeb207a03f9720045f3c7100d26e2`. Workflow run
[43344816865](https://github.com/pbsilvabd/ai-orchestrator/actions/runs/43344816865)
passed on Windows and Ubuntu. The PR remains open; independent re-review is outstanding.

## B16 Windows host containment — 2026-11-12

Executed on Windows 11 Pro 10.0.26300 x64, Node.js v24.22.1 (fnm),
Git 2.55.0.windows.5 and OpenCode 2.2.5. Base `491de18`.
Date: 2026-11-12.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node integration/mcp-client-workflow.mjs C:/Users/paulo/.codex/.chatgpt-projects/g-p-6ae821acff7081918d46286e2c833b07/.audit/bin/opencode-2.2.5/opencode.exe` | B16-01–04 and Windows startup cleanup | 15 MCP calls. Immediate-exit child reaped and unrelated sibling alive. | 0 |
| `node --test` | Full regression suite | 253 passed, one POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo | 429 then 200 | 0 |
| `node --check integration/mcp-client-workflow.mjs` | Parse the harness | Passed | 0 |
| `node --check integration/fixtures/b16-mcp-server.mjs` | Parse the stdio fixture | Passed | 0 |
| `git diff --check` | Diff whitespace check | Clean | 0 |

Evidence level: OpenCode integration.

The Windows fixture starts a detached child, records its PID for observation,
writes an unrelated sibling PID to stdout, and exits with code 19 immediately.
Removing only the creation-time Job Object attribute in an isolated regression
experiment left the child alive and failed the fast-exit assertion (exit 1). The
experiment terminated its own child. The Ubuntu pinned-client gate was not rerun.


## B17 executable acceptance matrix — 2026-11-12

Executed on Windows 11 Pro 10.0.26300 x64, Node.js v24.22.1 (fnm), Git
2.55.0.windows.5 and the verified OpenCode 2.2.5 binary. Base commit:
`681f0a6cce3c2160c578cc92a0ab038ff5cfce01`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `npm run acceptance -- --opencode C:/Users/paulo/.codex/.chatgpt-projects/g-p-6ae821acff7081918d46286e2c833b07/.audit/bin/opencode-2.2.5/opencode.exe --report docs/evidence/B17-acceptance-matrix.json` | B17-01–04; all 13 normative contract criteria | 13 pass, 0 fail, 0 not_run. Pinned client observed the correlated submit/poll/result lifecycle, duplicate replay, cancellation, restart without replay and result in provider context. | 0 |
| `npm run acceptance -- --report <temporary JSON path>` | Missing-host fault injection for B17-02 | 7 pass, 6 not_run (M2b-02/04/05/07/08/13), success false | 1 |
| `node --test test/acceptance-matrix.test.mjs` | Reporter failures, skipped/missing cases, missing matrix item and contract drift | 5 passed, 0 failed | 0 |
| `node --test` | Full regression suite | 258 passed, 0 failed, 1 POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo | 429 from preferred model, then 200 from local model | 0 |
| `node --check integration/acceptance-matrix.mjs` | Parse the B17 runner | no output | 0 |
| `git diff --check` | Whitespace check | clean | 0 |

One-off relative-link check using the local deliverables checker (not versioned): six
changed Markdown files, 58 relative links, zero missing targets.

The published JSON report maps each item to its contract wording, named test or
experiment, command, exit code and observed status. The reporter fails closed if the
13-item contract text changes, any required test is absent or skipped, the host is
missing, an assertion fails, or an item is missing from the final matrix. The missing
host experiment deliberately returned a nonzero exit and marked all host-dependent
criteria `not_run`.

Evidence level: local test processes and pinned OpenCode integration with the
loopback fixture provider; no external or paid model was used. This supports the B17
acceptance matrix on Windows. It does not support production-provider behavior,
model quality or completion of M2b/M3. The Ubuntu pinned-client workflow was not
rerun; the local suite's one POSIX-only skip is reported above.

Claim: This entry supports the thirteen B17 contract criteria on this Windows
checkout, based on `npm run acceptance` and `node --test`. It does not support M2b
or M3 completion, which requires the remaining milestone gates and supervised use.

Publication: PR [#40](https://github.com/pbsilvabd/ai-orchestrator/pull/40) is open
at `6447b9a9a6e11fd2098946d46e8f3c5777e8c790`, based on `main` at
`681f0a6cce3c2160c578cc92a0ab038ff5cfce01`. CI run #74 was in progress at the
first remote check; no PR comments or reviews were present. Recheck CI against the
final pushed documentation commit before treating this publication record as current.

## M2b: B17 acceptance review corrections — 2026-11-14

Executed on Windows x64, Node.js v24.22.1 (fnm-managed install); Git 2.55.0.windows.5.
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/acceptance-matrix.test.mjs` | Exercise TAP classification, including real Node test children with mixed failure/skip/TODO and nonzero/TODO outcomes | 7 passed, 0 failed, 0 skipped; child fixtures observed the expected nonzero exits and classified them as `fail` | 0 |
| `node --test --test-name-pattern 'foreign client submission is denied without changing task records|credential-shaped request text is rejected without mutating the caller or storing data' test/task-service.test.mjs` | Verify foreign-client denial without record changes and caller-visible secret omission | 2 passed, 0 failed, 0 skipped | 0 |
| `node --test test/acceptance-matrix.test.mjs test/task-service.test.mjs` | Final focused reporter and service regressions | Supervisor log `<temp>/b17-sol-focused-final.log`: 35 passed, 0 failed, 0 skipped | 0 |
| `node --test test/mcp-server.test.mjs` | Independent MCP transport forwarding regression suite | Supervisor log `<temp>/b17-sol-mcp-server.log`: 29 passed, 0 failed, 0 skipped | 0 |
| `node --test test/scheduler.test.mjs` | Independent scheduler/fixture-barrier boundary regressions | Supervisor log `<temp>/b17-sol-scheduler.log`: 23 passed, 0 failed, 0 skipped | 0 |
| `node --test test/artifacts.test.mjs` | Independent artifact/redaction boundary regressions | Supervisor log `<temp>/b17-sol-artifacts.log`: 7 passed, 0 failed, 0 skipped | 0 |
| `node --test test/workspace.test.mjs` | Independent workspace isolation regressions | Supervisor log `<temp>/b17-sol-workspace.log`: 8 passed, 0 failed | 0 |
| `node integration/mcp-client-workflow.mjs ../.audit/bin/opencode-2.2.5/opencode.exe` | Verify the pinned client receives correlated queued/running/succeeded payloads and result context | OpenCode 2.2.5; 16 MCP calls; client-observed statuses `queued, running, running, succeeded`; task `217f5c89-8679-4e8c-9ebc-b0b03da41704` | 0 |
| `node integration/acceptance-matrix.mjs --opencode ../.audit/bin/opencode-2.2.5/opencode.exe --report <temp>/b17-luna-final-client-payload-20261114.json` | Failure experiment while checking returned status payload shape | 7 pass, 6 fail; identified that status was nested in Code Mode's `{ status, result }` payload | 1 |
| `node integration/acceptance-matrix.mjs --opencode ../.audit/bin/opencode-2.2.5/opencode.exe --report <temp>/b17-luna-final-verified-20261114.json` | Final B17-01–04 matrix against final source | 13 pass, 0 fail, 0 not_run; client-observed sequence `queued, running, running, succeeded`; task `b5c2602a-b8c9-4103-9688-4a4d1a1278b9` | 0 |
| `node integration/acceptance-matrix.mjs --opencode ../.audit/bin/opencode-2.2.5/opencode.exe --report <temp>/b17-sol-final-matrix-20261114.json` | Independent final pinned-host matrix confirmation | Supervisor log reports 13 pass, 0 fail, 0 not_run; client sequence `queued, running, running, succeeded`; task `8f7eb36b-1800-4938-8952-a486f514749a` | 0 |
| `node --test` | Full local regression suite after final source change | 262 tests, 261 passed, 1 POSIX-only test skipped on Windows, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Verify the existing fallback demo | `mock/preferred` 429, then `mock/local` 200, session `demo-session` | 0 |
| `node integration/acceptance-matrix.mjs --report <temp>/b17-sol-final-missing-host-20261114.json` | Final missing-host failure injection | Supervisor log reports 7 pass, 6 not_run, process exit 1; no required host items were falsely passed | 1 |
| `node <temp>/b17-negative-client-attribution.mjs <checkout>` | Isolated negative attribution experiment; scratch-copy only | Script changed only the named foreign-client test to `assert.fail`, ran the no-host matrix in a temporary checkout, observed matrix exit 1, M2b-03 `pass`, M2b-09 `fail`, and 6 host-dependent `not_run`; report `<temp>/b17-negative-client-oaWT1h\matrix-report.json`; injector assertions exited 0 | 0 |
| `node -e "const r=require('./docs/evidence/B17-acceptance-matrix.json'); if (!r.summary.success || r.summary.pass !== 13 || r.summary.fail !== 0 || r.summary.not_run !== 0) process.exit(1); for (const item of r.items.filter(x=>x.id==='M2b-02'||x.id==='M2b-04'||x.id==='M2b-05'||x.id==='M2b-07'||x.id==='M2b-08'||x.id==='M2b-13')) { const observed=item.runs.find(run=>run.observed)?.observed; if (!observed || observed.primaryPollStatuses.join(',') !== 'queued,running,running,succeeded') process.exit(1); } console.log('13/13 pass; all tracked pinned-client poll sequences are queued,running,running,succeeded');"` | Verify tracked matrix JSON and client-returned poll sequence | 13/13 pass; all tracked pinned-client poll sequences are queued,running,running,succeeded | 0 |
| `git diff --check` | Check final local code and documentation diff for whitespace errors | Supervisor reran after the final documentation alignment: clean | 0 |

Result: the real Node test children proved a failure remains `fail` when TAP also reports a skip/TODO, and nonzero exit takes precedence over TODO classification. The isolated fault injection proved the foreign-client test maps specifically to M2b-09, not M2b-03. The final pinned workflow returned each correlated status into the client's provider context, including queued and running, and the acceptance runner passed all 13 items. An earlier implementation attempt failed while matching the Code Mode payload shape; unwrapping the nested status fixed the experiment and the final matrix passed.

Evidence level: OpenCode integration — demonstrates hooks, queue, context, permissions and failures in the pinned host; does not demonstrate real model quality/cost. This correction verifies correlated status objects returned to the Code Mode provider context; it does not establish production-provider behavior.

Not rerun: `node integration/mcp-gate.mjs` and `node integration/opencode-smoke.mjs` (these separate gates are unaffected by this B17 correction); Ubuntu pinned-client integration (this checkout's host is Windows x64); real or paid model/provider use (not authorized and not supported by the fixture-only adapter).

Claim: this entry supports the B17 thirteen-item acceptance matrix on Windows x64 with the pinned OpenCode 2.2.5 client, based on the final acceptance-matrix command and the full local suite. It does not support production-provider/model quality, Ubuntu host integration or M2b/M3 completion, which require evidence outside this fixture-only acceptance task.

## M2b: B18 supervisor pass-1 corrections — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5;
branch `task/B18-maintainer-recovery`, base `190370fae1fe44272dbaed22889156397f143c2f`.
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/task-maintenance.test.mjs test/contracts.test.mjs test/task-store.test.mjs test/task-lifecycle.test.mjs test/mcp-server.test.mjs` | Focused B18 maintenance, schema, lifecycle, store and MCP regressions | 137 passed, 0 failed, 0 skipped | 0 |
| `node --test` | Full local regression suite | 282 passed, 0 failed, 1 existing POSIX-only skipped (283 tests) | 0 |
| `node examples/fallback-demo.mjs` | Preserve existing fallback demo behavior | `mock/preferred` returned 429, then `mock/local` returned 200 | 0 |
| `node --check scripts/task-maintenance.mjs` | Parse the maintainer CLI | no output | 0 |
| `git diff --check` | Check final working diff for whitespace errors | no output | 0 |

Result: focused tests passed 137/137 and the full suite passed 282 tests with only
the existing POSIX-only skip. The demo returned 429 then 200; the CLI syntax check
and final diff check passed. A named legacy-v1 regression removes only the optional
`baseCommit` from a valid blocked record, then reads and recovers it without adding
the field. A real CLI subprocess scenario executes stale-owner recovery,
`reconcile-store` to blocked, inspection/digest binding, administrative closure, and
restart/idempotent replay with zero worker preparations. B18-01 coverage includes active service/worker exclusion,
wrong-state byte preservation, a real competing-recovery gate and refusal when a
detached descendant remains alive. B18-02 tests evidence refusal and byte-idempotent
repetition. B18-03 kills a process at both prune boundaries, repairs the journal and
asserts the retained tombstone cannot create a replacement task; the CLI repair also
leaves an unrelated running dispatch byte-identical. B18-04 tests known
and unknown outcome handling, cancellation-request requirements, schema validation,
generic-update/MCP denial and a real scheduler crash/restart without worker replay.
The independent supervisor descendant-survival experiment
`b18-windows-descendant-probe.mjs` is referenced with its path sanitized; it is not
run by this implementation session. The separate supervisor review probes covered
authority, replay and unrecoverable-restart behavior. The descendant experiment
showed why PID absence alone is not treated as proof of process-tree termination.

Evidence level: Unit — demonstrates policy decisions and input normalization; does
not demonstrate the host, the network or production persistence. These tests also
exercise real temporary filesystems and child processes on Windows, including process
death, restart, lock races and a surviving detached descendant; this is local fixture
evidence, not pinned-host integration or machine proof of a complete OS process tree.

Not rerun: `node integration/opencode-smoke.mjs` and `node integration/mcp-gate.mjs`
(require the external pinned OpenCode 2.2.5 binary; these host checks were not run in
this local maintenance validation); `npm run acceptance -- --opencode <path>` (the
host-dependent B17 matrix was unchanged and not rerun); Windows/Ubuntu Actions CI (no
remote workflow was started by this implementation session).

Claim: This entry supports B18's local Windows acceptance scenarios and regression
behavior, based on the focused suite, `node --test`, and the fallback demo. It does
not support pinned OpenCode integration, Ubuntu behavior, production persistence,
independent supervisor approval, publication or merge; those require their respective
external checks and authorization.

## M2b: B18 Windows PowerShell CLI input correction — 2026-11-14

Executed on Windows 11 Pro x64, Windows PowerShell 5.1.26100.9818, Node.js v24.22.1
(fnm), Git 2.55.0.windows.5; branch `task/B18-maintainer-recovery`, base
`190370fae1fe44272dbaed22889156397f143c2f`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/task-maintenance.test.mjs test/contracts.test.mjs test/task-store.test.mjs test/task-lifecycle.test.mjs test/mcp-server.test.mjs` | Focused B18 and adjacent regression suite, including the actual Windows PowerShell 5.1 subprocess case | 139 passed, 0 failed, 0 skipped | 0 |
| `node --test` | Full local regression suite | 284 passed, 0 failed, 1 existing POSIX-only skipped (285 tests) | 0 |
| `node examples/fallback-demo.mjs` | Preserve existing fallback demo behavior | `mock/preferred` returned 429, then `mock/local` returned 200 | 0 |
| `node --check scripts/task-maintenance.mjs` | Parse the maintenance CLI | no output | 0 |
| `git diff --check` | Check final working diff for whitespace errors | no output | 0 |

Result: `--input-file <path>` reads one UTF-8 JSON object with an optional BOM while
retaining the compatible-shell raw JSON form. Node subprocess regressions cover BOM,
plain UTF-8, paths and values with spaces, malformed/missing/null/array input, extra
and unknown argument forms, sanitized missing-file diagnostics, and unchanged task
and index bytes. The Windows-only test invokes actual `powershell.exe` and asserts
PowerShell 5.1; it writes BOM-bearing JSON with `ConvertTo-Json` and
`Set-Content -Encoding UTF8`, passes a path containing spaces as a native argument,
and verifies valid input, missing option/path, malformed and array refusal without
changing committed record/index bytes. The runbook now uses structured JSON files for
PowerShell examples and documents that raw JSON requires compatible native argument
passing or escaping.

Evidence level: Unit/local Windows subprocess — exercises the CLI against temporary
filesystem state and the installed Windows PowerShell 5.1 argument-passing behavior;
it is not service-host integration or production persistence evidence.

Not rerun: pinned OpenCode smoke/MCP gates, Ubuntu CI, and provider-backed acceptance;
this correction is isolated to the local maintenance CLI input transport and runbook.

Claim: this entry supports the Windows PowerShell 5.1 CLI input correction and its
unchanged-byte refusal cases. No publication, independent supervisor approval or
merge is claimed; final review and publication remain with the supervisor.

## M2b: B18 supervisor final review and acceptance — 2026-11-14

Executed on Windows x64 (Windows NT 10.0.26300.0), Windows PowerShell
5.1.26100.9818, Node.js v24.22.1 (fnm 1.39.0), Git 2.55.0.windows.5.
Date: 2026-11-14. Branch: `task/B18-maintainer-recovery`; base:
`190370fae1fe44272dbaed22889156397f143c2f`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/task-maintenance.test.mjs test/contracts.test.mjs test/task-store.test.mjs test/task-lifecycle.test.mjs test/mcp-server.test.mjs` | Independent final focused acceptance, including Windows PowerShell subprocesses | 139 passed; no failures/skips | 0 |
| `node --test` | Independent final full regression after the last CLI code correction | 284 passed, 0 failed, 1 existing POSIX-only skip; 285 total | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | preferred 429, then local 200 | 0 |
| `node --check scripts/task-maintenance.mjs` | Final CLI syntax | no output | 0 |
| `git diff --check` | Final implementation and publication-document whitespace check | no output | 0 |

Result: the supervising GPT-6.1 Sol reran these commands after GPT-6 Luna high's
implementation and correction rounds. Native exits were captured immediately, before
formatting logs. The supervisor separately reproduced the initial service-nonce
prune bypass, pruned-key duplicate creation, unrecoverable restart shape and legacy
optional-field failure in temporary homes. Independent final external probes verified
their corrections, both normal and legacy administrative closure, preserved unknown
attempt evidence and exact-byte repeated decisions (exit 0). The full staged diff,
including new files, was reviewed against the base; no blocking finding remains.
The final one-off relative-link check observed 12 changed Markdown files, 115 local
file targets and zero missing targets. Worklog and validation diffs contain additions
only relative to the base; their pre-existing entries remain in their original order.

| Card row | Observed named evidence | Result |
| --- | --- | --- |
| B18-01 | `service ownership and wrong lifecycle state refuse maintenance without byte changes`; `an actual service worker keeps direct store pruning excluded until it exits`; `stale service-owner recovery refuses a real surviving detached worker descendant`; competing real stale-maintenance recoveries | PASS: records/indexes/owner bytes preserved on refusal; a single recovery winner |
| B18-02 | `missing, forged and conflicting evidence is refused; identical decision is byte-idempotent`; stale-handle and structurally valid forged-receipt refusals | PASS: invalid evidence writes nothing; identical decision rewrites nothing and creates no task/worker |
| B18-03 | `real process death between prune record/index removals is journal-recovered without duplicate acceptance`; `process death after prune intent but before record removal preserves the record and replay mapping` | PASS: actual child exits 73/74 at filesystem boundaries; CLI repair retains blocked bytes/unrelated running state and reserves the old key with a tombstone |
| B18-04 | `real scheduler crash/restart permits audited unknown administrative failure without replay`; `Windows CLI crash workflow explicitly recovers owner, blocks interrupted dispatch, reconciles and replays no worker`; cancellation, legacy-v1 and MCP-wire denial cases | PASS: audited failed/cancelled decisions, original dispatch/block retained, effectsReverted false, generic callback/MCP denied authority |

Review pass 1 returned authority, replay, unsupported real-restart recovery,
stale-lock race, missing CLI repair and evidence/append-only defects to the implementer.
Re-review returned missing legacy-field support, incomplete Windows crash procedure,
unbounded fixture cleanup and actual PowerShell 5.1 JSON argument corruption. All
corrections were re-reviewed and tested. The final runbook uses UTF-8/BOM JSON files,
not fragile inline JSON; its actual PowerShell subprocess case passed. Earlier
in-flight worklog checkpoints record earlier implementations, not the final verdict.

Evidence level: Unit — policy decisions and input normalization; does not demonstrate
host, network or production persistence. Strongest B18 observations are real local
filesystem/Git/process interruption, concurrency and Windows PowerShell 5.1 fixtures.
This is separate-model supervisor review, not an independent human/security audit.

Not rerun: pinned OpenCode smoke/MCP/B16 client gates and the host-dependent B17 matrix
(no new transport operation or provider path; the local MCP wire tests were run).
No production state, paid provider or B20/M3 project task was used. Complete process
inventory remains an explicit trusted human attestation, not machine-proven tree stop;
PID absence, hashes and administrative closure never prove reverted effects. Tombstones
are retained indefinitely. Power-loss durability, hostile writers and remote access
remain outside the contract. Published-head CI and PR feedback are tracked on the one
B18 PR; no merge is authorized.

Claim: these commands and independent review support all four B18 local Windows
acceptance rows. They do not establish production-provider behavior, pinned-host
revalidation, M3 service use, OS authentication, rollback or maintainer merge approval.

## M2b: B19 opt-in harness pulse — 2026-11-14

Executed on Windows 11 Pro 10.0.26300 x64, Node.js v24.22.1 (fnm), Git
2.55.0.windows.5. Branch `task/B19-opt-in-harness-pulse`, base
`c268239b3a15d9e507bee703016f6bbeccb266d7`.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/harness-pulse.test.mjs` | B19-01–04 real temporary child/filesystem acceptance boundaries | 4 passed, 0 failed, 0 skipped | 0 |
| `node integration/harness-pulse.mjs --binary C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe --version 2.2.5 --output docs/pulses/B19-pinned-host.json --inject-failure-index 4 --retry-failed` | Eight isolated original capability-gate runs, injected original failure and separate diagnostic retry | 7 pass, 1 fail, 0 not_run, denominator 8; original slot 4 phase `failure:probe`, exit 1; separate retry for slot 4 pass; command exit 1 is expected because the original failure remains authoritative | 1 (expected) |
| PowerShell `ConvertFrom-Json` assertions on `docs/pulses/B19-pinned-host.json` | Check exact denominator/status/retry mapping, cleanup record and absence of absolute host paths | All assertions passed; emitted “B19 observed 7 pass / 1 original fail / 0 not_run; retry passed separately; denominator 8; transcript sanitized.” | 0 |
| `node --test` | Full local regression suite on changed B19 checkout | 289 tests: 288 passed, 0 failed, 1 existing POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback demo regression | `mock/preferred` returned 429, then `mock/local` returned 200 | 0 |
| `node --check integration/harness-pulse.mjs` | Parse the new manual pulse CLI | no output | 0 |
| `node --check integration/mcp-gate.mjs` | Parse phase and failure-injection instrumentation | no output | 0 |
| `git diff --check` | Check tracked source/documentation changes for whitespace errors | no output | 0 |
| `node --test` in archived snapshot `C:\Users\paulo\AppData\Local\Temp\opencode\b19-supervisor-baseline-351f8e87-f35c-4048-ba98-b2f9bb5b7900` | Supervisor's independent exact-base (`git archive c268239`) baseline | 285 tests: 284 passed, 0 failed, 1 existing POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` in the same archived base snapshot | Supervisor's independent fallback baseline | 429 then 200 | 0 |
| `node integration/acceptance-matrix.mjs --opencode C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe --report C:\Users\paulo\AppData\Local\Temp\opencode\b19-supervisor-baseline-351f8e87-f35c-4048-ba98-b2f9bb5b7900\b17-baseline-report.json` in the same archived base snapshot | Fresh B17 prerequisite verification, separate from B19 | 13 pass, 0 fail, 0 not_run; mapping valid; criterion digest `3319c26cc1d05f2c83d94938872868a142d5f4af9580aaa39becd6a7a8076788`; archive had no `.git`, so its checkout SHA/dirty fields are null | 0 |
| `C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe --version` | Supervisor's supplied pinned-host version check | `opencode v2.2.5`; release ZIP SHA-256 independently matched documented digest `2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8` | 0 |

Result: local tests exercised real Node subprocesses and temporary task files. The
pinned OpenCode host produced seven successful original gate outcomes and one
deliberately injected failure, retained as `failure:probe`; its separately labeled
diagnostic retry passed without changing the denominator. The pulse artifact has eight
original slots and no `not_run` records. The run is intentionally not an all-pass B06
gate. The supervisor's fresh archived-base B17 run independently confirmed the B17
prerequisite. No real/paid/external provider call or task execution was made; the
OpenCode pulse used only the gate's local loopback fixture. `descendantsStopped` stays
false because B10 observes only the root; uncertain-timeout scratch is retained.

Evidence level: OpenCode integration — demonstrates hooks, queue, context, permissions
and failures in the pinned host; does not demonstrate real model quality/cost. Here the
pulse demonstrates the pinned host's local MCP discovery/call gate and truthful
failure/retry reporting, not task-service lifecycle or production-provider behavior.

Not rerun: Ubuntu pinned-host pulse (only this Windows host was available); the full
B17 acceptance matrix on the modified B19 checkout (the supervisor ran it freshly on
the exact archived base; B19 does not change its acceptance runner); OpenCode smoke and
B16 task workflow (not needed for the B19 gate-pulse acceptance); any real or paid
provider use (not authorized).

Claim: This entry supports B19-01–04's local failure-boundary behavior and a pinned
OpenCode 2.2.5 fixture pulse with preserved 7/1/0 outcomes, based on the named B19
tests, the recorded pulse and the report assertions. It does not support an all-pass
eight-run B06 capability gate, M2b/M3 completion, real-provider behavior or use of the
task service on this project; those require separate evidence and authorization.

## M2b: B19 supervisor corrections — 2026-11-14

Executed on Windows 11 x64, Node.js v24.22.1 (fnm).
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/harness-pulse.test.mjs` | Exercise all B19 correction acceptance boundaries | 4 passed, 0 failed, 0 skipped | 0 |
| `node --test` | Full regression suite | 289 tests: 288 passed, 0 failed, 1 existing POSIX-only skip | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback demo regression | `mock/preferred` returned 429, then `mock/local` returned 200 | 0 |
| `node --check integration/harness-pulse.mjs` | Check pulse CLI syntax | no output | 0 |
| `node --check integration/mcp-gate.mjs` | Check gate syntax | no output | 0 |
| `node --check src/tasks.mjs` | Check exported pure record validator syntax | no output | 0 |
| `node --check test/harness-pulse.test.mjs` | Check B19 regression test syntax | no output | 0 |
| PowerShell invocation of `node integration/mcp-gate.mjs C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe` with `MCP_GATE_INJECT_FAILURE_PHASE=probe`, `MCP_GATE_FORCE_CLEANUP_ERROR=1` and `MCP_GATE_PHASE_FILE=<new temp marker>` | Force both probe and cleanup failure to verify independent phase preservation | `failure:probe`, cleanup phase `cleanup`, cleanup status `failed`; expected nonzero gate exit | 1 (expected) |
| `node integration/harness-pulse.mjs --binary C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe --version 2.2.5 --output docs/pulses/B19-final-containment.json --inject-failure-index 4 --retry-failed` | Run the final-code pinned OpenCode 2.2.5 loopback fixture pulse | 7 pass, 1 injected fail, 0 not_run; slot 4 retains `failure:probe`, cleanup is `cleanup/complete`, one separate retry passes; exit 1 is expected for the original failure | 1 (expected) |
| PowerShell assertions on `docs/pulses/B19-final-containment.json` | Check denominator/status/retry, original phase and cleanup metadata, root exit and verified Job Object cleanup | assertions passed: `failure:probe`, `cleanup/complete`, 7/1/0, retry pass | 0 |
| `git diff --check` | Check working diff for whitespace errors | no output | 0 |

Result: B19 focused acceptance and the full suite passed. The final pinned-host artifact
is separate from and does not modify `docs/pulses/B19-pinned-host.json`. The forced
cleanup fixture directly verifies that a probe failure remains `failure:probe` while
cleanup independently records `cleanup/failed`; the pinned pulse validates the Windows
Job Object path and successful cleanup marker. This remains a local fixture-provider diagnostic,
not an all-pass B06 gate, production-provider behavior, M2b/M3 completion or use of the
task service on this project.

Evidence level: OpenCode integration — demonstrates hooks, queue, context, permissions
and failures in the pinned host; does not demonstrate real model quality/cost. Here the
real pinned host demonstrates the local MCP gate and Windows Job Object cleanup;
temporary-filesystem tests cover history read-only boundaries and uncertain-stop
accounting.

Not rerun: POSIX process-group teardown and Ubuntu pinned-host integration (only this
Windows host was available); the OpenCode smoke test and B16 task workflow (not changed
by this correction); real/paid provider use and project task delegation (not authorized).

Claim: The correction tests and new pinned-host report support the B19 containment,
stop-on-uncertainty, history-only and phase-preservation changes. They do not claim
tree termination from root exit alone, an all-pass B06 gate, production-provider
behavior, M2b/M3 completion or task-service use on this project.

## M2b: B19 R5 supervisor corrections — 2026-11-14

Executed on Windows x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5. Local
corrections remain uncommitted and unpublished over checkpoint `91e43e4`.

| Command / experiment | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| Supervisor-reported `node --test test/harness-pulse.test.mjs` on the completed correction snapshot | Preserve the external failing result; diagnose the two reported assertions | FAILED: 2 passed, 2 failed. B19-01 reported `summary.fail` 2 instead of 1; B19-02 oversized-output fixture reported `fail` instead of `pass`. Per-test termination records from that run were not supplied, so its exact cause remains unconfirmed. | 1 |
| Local 1,000 ms child-fixture diagnosis for B19-01-style and oversized-output-style runs | Test the proposed too-tight fixture-budget explanation using captured outcomes | Did not reproduce: all eight originals settled; injected slot had `reason=exit_7`, root exit observed and Windows Job Object empty marker verified; separate retry passed. Oversized output slot passed, cleanup verified, duration 175 ms. This does not establish the cause of the supervisor's distinct run. | 0 |
| `node C:\Users\paulo\AppData\Local\Temp\opencode\b19-supervisor-retry-repro.mjs` | Reproduce both retry-accounting reports | Case A: 3 calls, 3 fail/5 not_run, 0 retries. Case B: 9 calls, 8 original failures, exactly 8 retry records with unique indices 1–8 (first fail, remaining seven not_run). | 0 |
| `node --test test/harness-pulse.test.mjs` (two sequential runs) | Repeat focused B19 coverage including original uncertainty, retry uncertainty, timeout, output, and injected POSIX signal failure | Both runs: 6 tests, 6 passed, 0 failed, 0 skipped. | 0 |
| `node --test` | Full local regression suite | 291 tests: 290 passed, 0 failed, 1 existing POSIX-only skip. | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback behavior | `mock/preferred` returned 429, then `mock/local` returned 200. | 0 |
| `node integration/mcp-client-workflow.mjs C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe` | Revalidate B16 because `integration/fixtures/b16-windows-job.cs` is shared and changed | Passed: OpenCode 2.2.5, four tools, 16 transport calls; submit/poll, duplicate identity, cancellation and interruption checks passed; unavailable-host path diagnosed as `ENOENT`. | 0 |
| `node integration/harness-pulse.mjs --binary C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe --version 2.2.5 --output docs/pulses/B19-r5-final.json --inject-failure-index 4 --retry-failed` | Fresh pinned-host loopback fixture evidence after R5 changes | 7 pass, 1 injected original fail, 0 not_run; original slot 4 phase `failure:probe`, cleanup `cleanup/complete`, root exit and Job Object empty marker observed; separate slot-4 retry passed. Exit 1 is expected because the original failure remains authoritative. Original pinned-host artifacts were not overwritten. | 1 (expected) |
| PowerShell assertions on `docs/pulses/B19-r5-final.json` | Validate counts, phase/cleanup, Job Object evidence and retry mapping | Passed: denominator 8, 7/1/0, cleanup metadata correct, retry pass. | 0 |
| `node --check` for `integration/harness-pulse.mjs`, `integration/mcp-gate.mjs`, `src/tasks.mjs`, and `test/harness-pulse.test.mjs`; `git diff --check` | Syntax and whitespace validation | Passed; no output. | 0 |

The implementation now suppresses all diagnostic retries if any original is uncertain;
after an uncertain retry it records exactly one result for each remaining candidate.
Normal child-test budgets are 15 seconds, while dedicated timeout fixtures use separate
bounded deadlines. POSIX settlement is bounded on signal errors and records uncertainty;
its injectable regression exercised the control flow on this Windows host, not actual
POSIX process-group behavior. Process-group checks cannot prove termination of a
descendant that escaped with `setsid` or otherwise left the group. Windows stdin pipe
errors are consumed, and only the exact pinned version is persisted.

Self-review pass 1 checked both supplied retry reproducers, complete test outcomes,
cleanup/termination states, Windows pipe races, version persistence and POSIX timeout
settlement. Pass 2 reviewed the complete working diff and acceptance map, repeated the
focused suite twice, rechecked B16 because its shared helper changed, and validated the
new pinned-host artifact. No B17 rerun was performed as requested. The supervisor's
failing focused run is preserved above; its exact per-test termination evidence was not
available, and the local 1,000 ms experiment does not confirm its cause.

Evidence level: Unit, local process fixtures and pinned OpenCode 2.2.5 integration with
the local loopback fixture only. No real/paid provider, M2b service use or M3 task was
performed. The pinned-host result is not an all-pass B06 gate.

Not rerun: B17 acceptance matrix and B17 final host work (explicitly not requested),
Ubuntu/POSIX native process-group behavior (not available on this Windows host),
OpenCode smoke (outside the changed shared B16 helper workflow), and any real-provider
or project task use (not authorized).

Claim: The correction suite and new report support B19's retry accounting, bounded
uncertain-stop handling, Windows Job Object fixture, B16 shared-helper compatibility
and phase/cleanup reporting. They do not prove native POSIX teardown, escaped-descendant
termination, an all-pass B06 gate, production-provider behavior or M2b/M3 completion.

## M2b: B19 independent supervisor verification — 2026-11-14

Executed on Windows x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5,
OpenCode 2.2.5. Date: 2026-11-14. Base:
`c268239b3a15d9e507bee703016f6bbeccb266d7`; corrections over checkpoint `91e43e4`.
GPT-6 Luna high implemented; GPT-6.1 Sol reviewed and independently ran these checks.
Native exits were captured immediately in PowerShell before reading/formatting logs.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/harness-pulse.test.mjs` | Every B19-01–04 variant plus both R5 and bounded signal-failure regressions | 6 passed, 0 failed, 0 skipped | 0 |
| `node C:\Users\paulo\AppData\Local\Temp\opencode\b19-supervisor-retry-repro.mjs` | Independently retest the two supervisor retry reproductions | Uncertain original: 3 calls, 3 fail/5 not_run, zero retries; uncertain first retry: 9 calls, exactly 8 unique diagnostic records, first fail/seven not_run | 0 |
| `node integration/acceptance-matrix.mjs --opencode C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe --report C:\Users\paulo\AppData\Local\Temp\opencode\b19-supervisor-b17-final.json` | Current-code B17 and changed shared B16 Windows helper regression | 13 pass, 0 fail, 0 not_run; mapping valid and contract digest unchanged | 0 |
| `node --test` | Full regression on final corrected code | 291 total, 290 passed, 0 failed, 1 existing POSIX-only skip | 0 |
| `node integration/harness-pulse.mjs --binary C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe --version 2.2.5 --output docs/pulses/B19-supervisor-final.json --inject-failure-index 4 --retry-failed` | Independent final-code pinned-host B19-01 evidence | Original 7 pass/1 injected fail/0 not_run; denominator 8; one separate passing retry; all nine Job Objects confirmed empty | 1 (expected) |
| PowerShell assertions on `docs/pulses/B19-supervisor-final.json` | Check original/retry accounting, phase, output cap and containment | Eight original slots; slot 4 `failure:probe`, cleanup complete, retry for slot 4 pass; all transcripts within 8192 UTF-8 bytes and cleanup verified | 0 |
| `node examples/fallback-demo.mjs` | Required demo regression | 429 from `mock/preferred`, then 200 from `mock/local` | 0 |
| `node --check integration/harness-pulse.mjs` | Syntax | no output | 0 |
| `node --check integration/mcp-gate.mjs` | Syntax | no output | 0 |
| `node integration/mcp-gate.mjs C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe` with `MCP_GATE_INJECT_FAILURE_PHASE=probe`, `MCP_GATE_FORCE_CLEANUP_ERROR=1` and an exclusively named temporary `MCP_GATE_PHASE_FILE` | Independent simultaneous original/cleanup failure check | Marker retained `failure:probe`, `cleanup`, `failed`; the forced cleanup fixture retains its temporary tree for diagnosis | 1 (expected) |
| `git diff --check` | Final tracked whitespace check | no output | 0 |

Result: B19-01 PASS (eight originals and separate retry); B19-02 PASS (missing host/
version, real descendant timeout, bounded output, uncertain-stop and unique diagnostic
records); B19-03 PASS (pre-B17 and uncertain history refusal, actual store records,
CLI exit, unchanged home bytes/no gate execution); B19-04 PASS (manual invocation,
sanitization, caps, exclusive output and no ranking/provider activation). A simulated
failure is the expected B19 experiment, not a passing B06 eight-run gate.

Supervisor review pass 1 reproduced four blockers: unbounded descendants/retries,
history launching gates, uncertain cancellation acceptance and original phase loss
on cleanup failure. Pass 2 found two retry-control-flow defects and a failing focused
run. All were returned to Luna. Current-code re-review verified containment, global
halt/no replay, unique retry slots, pure store validation, separate read-only history
and original/cleanup phases. The earlier 2/4 test failure is retained above; its
exact cause was not established. Ordinary fixtures now use a separate 15-second
budget, provide full outcome assertion diagnostics, and passed repeated implementer
runs plus this independent focused/full run. This is not a claim to have diagnosed
the earlier failure's cause. Final CI is a separate required gate.

Evidence level: OpenCode integration — Hooks, queue, context, permissions and failures
in the pinned host; not real model quality/cost. Local Node/Git/filesystem tests and
the pinned loopback fixture establish the scoped B19 behavior, not production use.

Not rerun: native POSIX process-group behavior on this Windows host (Ubuntu CI is
pending; process-group verification cannot cover escaped/setsid descendants);
OpenCode session/model smoke (unrelated to these changes); real-provider or project
task execution (not authorized). Current-code B17/B16 was rerun, superseding the
earlier entry's historical not-rerun note for the shared helper.

Claim: This entry supports all four B19 rows and verified correction of the supervisor
findings for the reviewed code. It does not claim green remote CI before observation,
an all-pass B06 gate, production-provider support, universal tree containment or M3.

## M2b: B19 publication checkpoint — 2026-11-14

Executed on Windows x64 with Git 2.55.0.windows.5 and GitHub CLI.
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `git push -u origin task/B19-opt-in-harness-pulse` | Publish the two scoped commits without force | Remote branch created | 0 |
| `gh pr create --base main --head task/B19-opt-in-harness-pulse --title 'feat: add manual opt-in harness pulse (B19)' --body-file C:\Users\paulo\AppData\Local\Temp\opencode\b19-pr-body.md` | Publish one B19 PR with template/matrix/review/evidence | PR #42, https://github.com/pbsilvabd/ai-orchestrator/pull/42 | 0 |
| `git ls-remote origin refs/heads/task/B19-opt-in-harness-pulse` | Verify published branch identity | `87782d2b192a89ba11cacbbe4e59d31df90ea200` matches intended head | 0 |
| `gh pr view 42 --json number,url,state,baseRefName,baseRefOid,headRefName,headRefOid,statusCheckRollup,mergeable,mergeStateStatus` | Verify PR base/head/checks | Main `c268239`, head `87782d2`, open; Windows/Ubuntu CI in progress | 0 |
| `gh api repos/pbsilvabd/ai-orchestrator/issues/42/comments --paginate` | Read complete conversation | Empty at publication | 0 |
| `gh api repos/pbsilvabd/ai-orchestrator/pulls/42/reviews --paginate` | Read complete submitted reviews | Empty at publication | 0 |
| `gh api graphql --input C:\Users\paulo\AppData\Local\Temp\opencode\b19-pr-threads-query.json` | Read all resolved/outdated/open inline threads with pagination metadata | Empty; `hasNextPage: false`, head `87782d2` | 0 |
| `node C:\Users\paulo\AppData\Local\Temp\opencode\b19-final-content-check.mjs` | Documentation-only correction links and preserved artifact structure/redaction/caps | 12 changed Markdown files, 111 relative links, 4 original pulse reports checked; pass | 0 |
| `git diff --check` | Publication-status whitespace check | no output | 0 |

Result: the single PR was published and remote identity verified. CI was pending,
not passed. The accompanying status edit is documentation-only; no tested code changed.
Evidence level: Unit — publication receipts do not demonstrate new runtime behavior.
Not rerun: runtime tests/host gates for this documentation-only checkpoint (preceding
entry records the final-code runs). Final-head CI/review remain required.
Claim: this entry supports one verified PR publication, not merge or green CI.

## B29 anonymous free worker fixture preparation — 2026-11-14

Executed on Windows x64, Node.js v24.22.1 (fnm, `%APPDATA%\fnm\node-versions\v24.22.1`).
Pinned binary outside the repository: `C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe`.
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check` on `mcp-server.mjs`, `src/opencode.mjs`, `src/service.mjs`, `src/free-provider.mjs`, `src/free-guard.mjs`, `src/configured-service.mjs`, `test/free-provider.test.mjs`, `test/fixtures/free-worker.mjs`, `integration/opencode-free.mjs` | Syntax of every changed module | no output for each | 0 |
| `node --test test/free-provider.test.mjs` | B29 focused cases: metadata, approval, admission, guard, composition | 8 passed, 0 failed, 0 skipped | 0 |
| `node --test` | Full local suite regression | 300 tests: 299 passed, 0 failed, 1 skipped (`B10-03` SIGTERM case, Windows-gated) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo still prints the expected responses | 429 from `mock/preferred`, then 200 from `mock/local` | 0 |
| `node integration/opencode-free.mjs C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe` | Pinned host, loopback fixture only: normal, 401, 402, 429, 307 redirect, connection drop | normal: succeeded, 3 fixture requests, out-of-scope write denied, allowed diff listed; 401/402/429/drop: failed with exactly 1 request each; redirect-307: succeeded, 1 request to the fixture and 1 to the alternate origin with 7121 body bytes and no credential | 1 (redirect-307 failed by design) |
| `node integration/opencode-invocation.mjs <pinned binary>` on a temporary export of base `688da04` (unmodified) | Baseline of the existing B11/B12 harness | host and denied/allowed assertions reached; fails at its limitation-count assertion: observed two limitations (`success without a recorded passing test command…`, `no trusted test command was configured…`) where it expects one | 1 (pre-existing on base) |
| Same harness from a temporary copy of the current `src/` and `integration/` with only that count assertion changed to `>= 1` | Pinned B11/B12 boundary regression on the B29 code | passed: denied write, link and hardlink rejections, config override rejection, allowed write, scheduler dispatch with 9 provider requests | 0 |
| `opencode --version` on the pinned binary | Version of the executable under test | `opencode v2.2.5` | 0 |
| PowerShell `Get-FileHash` on `opencode-windows-x64.zip` | Provenance against `SHA256SUMS` | `2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8`, equal to the published digest | not a process |
| `git diff --cached --check` | Whitespace in staged changes before the commit | no output | 0 |

Result: the focal cases pass, the full suite and demo pass, and the nine changed modules
compile. On the pinned host the guard is loaded through the `plugins` array, the
fixture receives only the fixed model with the public bearer credential, the poisoned
ambient key and configuration are not inherited, and no auxiliary (title, summary or
compaction) request appears. The 401, 402, 429 and connection-drop cases each produce one
request and a failed task, with no fallback or replay. The 307 case fails: the host follows
the redirect and the guard cannot prevent or detect it. A first full-suite run that
overlapped with the B11 harness failed one timing-sensitive subprocess case (`B10-03`); the
isolated subprocess file passed 8 of 8 and the later isolated full run passed. A one-off
script (not versioned) spawned `mcp-server.mjs`: with no worker it stayed alive for 2.5 s;
with a free worker and no approval, and with a missing approval file, it exited 1 at
startup. The exit reflects closed live composition, not approval handling.

Evidence level: OpenCode integration — hooks, plugin loading, provider defaults, the
anonymous credential, request count and failure latching in the pinned host, using only
a loopback fixture and a local metadata copy. Unit covers metadata and approval
validation. It does not demonstrate real model quality, cost, availability, quota or
privacy, and it does not demonstrate redirect control.

Not rerun: `node integration/opencode-smoke.mjs` (standalone smoke with its own
invocation; not affected by these modules); `node integration/mcp-gate.mjs` and the B16
pinned-client workflow (`integration/mcp-client-workflow.mjs`) — `mcp-server.mjs`
composition changed, so these should run before any MCP-level acceptance, and were not run
in this session; `node integration/harness-pulse.mjs` (B19 diagnostics, unaffected); B17
matrix (unaffected); the live free route, the public catalog and any paid or external call
(not authorized); B20 execution and its proposed redaction test (not implemented); the
B11 harness assertion itself (pre-existing drift, not repaired in this change).

Claim: This entry supports that, on the pinned OpenCode 2.2.5 host and a loopback fixture,
the B29 guard loads through `plugins`, the fixed model and anonymous public credential are
used, auxiliary requests are absent, and 401, 402, 429 and a connection drop stop after one
request. It also supports unit and service evidence that free-worker admission refuses
before persistence, workspace or branch creation, and that the passive service is unchanged,
based on `node --test test/free-provider.test.mjs`, `node --test`, and
`node integration/opencode-free.mjs`. It does not support redirect protection, live free-route
availability, quota, zero price or privacy, real inference, MCP-client composition with the
fixture, B20 or M3, which require a redirect decision and a separate approval.

## M3 preparation: B29 redirect-control decision — 2026-11-14

Executed on Windows x64, Node.js v24.22.1 (fnm installation invoked directly,
then prepended to PATH for child PowerShell processes). Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `gh pr view 44 --json number,isDraft,headRefOid,baseRefName,statusCheckRollup,url,comments,reviews` | Inspect pre-decision PR head and CI | draft at `4d28b65`; Windows/Ubuntu completed SUCCESS | 0 |
| `node --test` (absolute fnm `node.exe`; PATH lacked `node`) | Regression, initial run | 300 tests: 297 pass, 2 fail, 1 skip; B10-03 partial output missing and maintenance PowerShell could not find `node` | 1 |
| `node --test` (fnm Node prepended to PATH) | Regression with required child PATH | 300 tests: 298 pass, 1 fail, 1 skip; B10-03 missing `before` output under concurrent load | 1 |
| `node --test test/subprocess.test.mjs` (fnm Node on PATH) | Isolated B10-03 reproduction | 9 tests: 8 pass, 0 fail, 1 Windows skip | 0 |
| `node --test test/free-provider.test.mjs` (fnm Node on PATH) | B29 focal regression | 8 pass, 0 fail, 0 skip | 0 |
| `node examples/fallback-demo.mjs` (absolute fnm `node.exe`) | Existing demo | 429 then 200 | 0 |
| `git diff --check` | Documentation whitespace | no output | 0 |
| `git diff --cached --check` | Staged decision documents | no output | 0 |

Result: the documentation decision does not change runtime behavior. The full
suite did not pass in either run; isolated B10-03 and B29 focused tests passed.
The PowerShell failure in the first run was an environment PATH omission, fixed
for the second; the B10-03 timing failure remains a limitation, not a pass.

Evidence level: Unit — these local tests exercise policy and input
normalization, not pinned-host network containment or live model behavior.

Not rerun: `node integration/opencode-free.mjs` (already documented failure on
the pinned host; no code was changed); MCP-client fixture (B29-04 still missing);
public catalog GET and real inference (not authorized); B20/#43 (out of scope).

Claim: this entry supports a documentation-only architectural decision and
focal B29 unit regression, based on the commands above. It does not support a
passing full suite, redirect containment, fixture MCP acceptance, live route
or M3, which require new evidence and separate authorization.

## M3 preparation: B29 pinned-client fixture MCP correction — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm installation invoked
directly; its directory prepended to PATH for child processes). Pinned host:
`C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe`.
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/free-provider.test.mjs test/b29-cli-composition.test.mjs` | B29 metadata, admission/launch and production CLI boundary | 12 passed, 0 failed, 0 skipped; expiry before prepare creates no runtime directory; default passive and live free startup closed | 0 |
| `node integration/mcp-free-workflow.mjs C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe` | Pinned-client MCP stdio/fixture-worker gate after review fixes | 10 MCP calls; actual poll statuses `queued,running,running,running,succeeded`; one attempt/workspace, three fixture model requests, duplicate ID, denied write, diff and `node --test` exit 0, zero fixture anomalies | 0 |
| `node integration/opencode-free.mjs C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe` | Eight pinned-host failure/guard scenarios after review fixes | Seven scenarios passed; 401/402/429/drop: one request each and failed task; post-write drop: two requests, one attempt, failed task with partial diff; held deadline: one request, blocked `worker-outcome-uncertain`, reconciliation required and `releaseOwnership:false`; `redirect-307` still failed: task succeeded and alternate origin got one unauthenticated request with 7121 body bytes | 1 (intentional negative finding; not a passing safety gate) |
| `node --test` | Full regression on final code revision | 304 tests, 303 passed, 0 failed, 1 Windows platform skip; native exit captured before reading output from `C:\Users\paulo\AppData\Local\Temp\opencode\b29-final-20261114-suite.log` | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `node --check` on `integration/fixtures/b29-free-mcp-server.mjs`, `integration/mcp-free-workflow.mjs`, `test/b29-cli-composition.test.mjs`, `test/free-provider.test.mjs`, `integration/opencode-free.mjs` | Syntax of five changed modules | no errors | 0 |
| `git diff --cached --check` | Complete staged change whitespace after documentation | no errors | 0 |

Result: the pinned client actually exchanged MCP stdio frames with the test-only
configured free-worker service. It observed queued before dispatch, running while
the fixture held the response, and a terminal result including the allowed diff
and a recorded passing test exit. Two duplicate submissions caused no new
attempt/workspace/model request. The production CLI tests and admission cases
passed. The pinned failure harness **exited 1**: the 307 still leaks 7121 body
bytes to an alternate loopback origin and incorrectly succeeds; this is B30's
unmet live egress gate, not a B29 fixture pass for redirect safety. The new
post-effect loss and uncertain deadline cases preserve effects/ownership without
replaying. A reviewer reproduced 9 free-provider and 3 CLI cases separately;
their pinned-host tests were inspection-only, so the commands above are the
independently rerun host evidence. The suite also passed with 303 tests and
one Windows skip; the demo printed 429 then 200.

Evidence level: OpenCode integration — the pinned host and MCP client exercised
real hooks, queue, context, permissions and failures against loopback fixtures.
The focal/full suite provides Unit evidence for policy and input normalization.
Neither level demonstrates production model quality, zero price, external-network
containment or privacy.

Not rerun: `integration/opencode-smoke.mjs` (standalone host smoke, unchanged
production path); `integration/mcp-gate.mjs`, `integration/mcp-client-workflow.mjs`
and B17 matrix (their production fixture adapter was not changed); B19 pulse
(unaffected); Windows/Ubuntu PR CI (requires publication of the final commit);
public catalog GET and real inference (not authorized); B20/#43 (out of scope);
OS network isolation, relay and egress gateway (B30 and not implemented).

Claim: this entry supports B29's fixture-only MCP preparation, production CLI
closure and failure preservation based on the focal, pinned-host and full-suite
commands above. It does not support a passing redirect safety gate, live
provider/cost/privacy claims, B20/M3 or merge; those require B30 deployment
proof, separate approvals and later reviewed evidence.

## M3 preparation: B29 review feedback and launch refusal — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm; Node directory on
child PATH). Date: 2026-11-14. This entry corrects the preceding passing-run
snapshot without rewriting it. The [independent PR review at `3c30866`](https://github.com/pbsilvabd/ai-orchestrator/pull/44#issuecomment-6882305093)
also ran the full suite twice: one B10-03 failure (302 pass/1 fail/1 skip,
exit 1), then 303 pass/0 fail/1 skip, exit 0. Windows/Ubuntu CI passed at
`3c30866`; this is **not** a CI receipt for the following correction head.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/free-provider.test.mjs test/b29-cli-composition.test.mjs` | New service-level launch-expiry consequence and production CLI gate | 13 passed, 0 failed, 0 skipped; post-admission expiry blocked one reserved attempt, retained workspace/owner, stopped scheduler and refused new work while identical replay remained readable | 0 |
| `node --test` | Full suite after the review correction, first run | 305 tests, 303 passed, **1 failed** (`B10-03`, missing `before` output at `test/subprocess.test.mjs:78`), 1 Windows skip; output saved outside repo as `b29-p3-20261114-suite.log` | 1 |
| `node --test test/subprocess.test.mjs` | Isolated reproduction of the pre-existing load-sensitive B10-03 test | 9 tests, 8 passed, 0 failed, 1 Windows skip | 0 |
| `node --test` | Full suite after the review correction, second run | 305 tests, 303 passed, **1 failed** (same B10-03 `'' !== 'before'`), 1 Windows skip; output saved as `b29-p3-20261114-suite-rerun.log` | 1 |
| `node --test --test-concurrency=1` | Full suite without cross-file test contention | 305 tests, 304 passed, 0 failed, 1 Windows skip; output saved as `b29-p3-20261114-serial-suite.log` | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback regression after test/docs correction | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `node --check mcp-server.mjs` and `node --check test/free-provider.test.mjs` | Syntax of changed header/fixture test | no output | 0 each |
| `git diff --cached --check` | Staged review correction whitespace | no output | 0 |

Result: the new service-level test verifies the conservative scheduler behavior
after an approval expires between admission and `prepare`: a single attempt
and workspace remain, the task is blocked and requires reconciliation, new
work refuses while identical replay is readable, and ownership remains held.
No OpenCode child is returned by `prepare`. The full local suite did **not**
pass on either correction run: both failed only B10-03 under concurrent load;
the same test passed in isolation and the complete serial suite (304 passed,
one Windows skip, exit 0). This same case failed in an independent
review run at the preceding head, passed in the next run and passed in
Windows/Ubuntu CI there. A passing local result at the preceding head is
not a deterministic-suite claim for the correction head.

Evidence level: Unit — the new fixture test exercises the real service,
temporary store and Git workspace after a rejected launch. It does not prove
that actual external effects are absent in a production crash. Previous
OpenCode integration evidence remains bound to `3c30866`, where the production
runtime was unchanged by this review correction.

Not rerun: pinned MCP and eight-scenario free harness (this correction changes
only a test and the production entry point's comment, not its executable
logic); standalone smoke, B16/B17, B19 (unchanged); catalog, real inference,
B20/#43 and B30 live containment (not authorized). Final-head CI and re-review
remain pending at this entry.

Claim: this entry supports a new fixture service-level consequence test and
one passing **serial** full-suite run, while reporting **two failed default-concurrency**
full-suite runs due to pre-existing B10-03, based on the commands above. It
does not support deterministic green default-concurrency local runs, redirect
containment, live use, B20/M3 or merge.

## M3 preparation: B29 exact-head CI and status correction — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm). Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `gh run view 43628743462 --json headSha,conclusion,jobs` | Verify PR #44's CI at `762c133` | Run conclusion `failure`; Windows `Run test suite (PowerShell)` failed; Ubuntu job succeeded. The published review links the Windows failure to `test/task-maintenance.test.mjs:183`, `Unexpected end of JSON input`. `gh run view 43628743462 --log-failed` returned no text in this session, so the raw failure detail was not independently retrieved here | 0 |
| `node --test test/task-maintenance.test.mjs` | Check the Windows CI failing test file in isolation | 21 passed, 0 failed, 0 skipped; the competing stale-maintenance recovery test passed in this run | 0 |
| `git diff --check` | Check documentation correction whitespace | no output | 0 |

Result: CI for `762c133` is **not green**: the Windows test-suite step failed
while Ubuntu passed. The isolated maintenance file passed locally, which does
not cancel the CI failure or establish that the race is resolved. The previous
validation entry already records two local default-concurrency B10-03 failures
and a successful serial suite. The handoff now distinguishes historical green
runs from the current PR head rather than silently promoting them.

Evidence level: Unit — the local maintenance test exercises temporary state
and process behavior; it does not prove CI stability or a safe live worker.

Not rerun: full `node --test` (this documentation-only correction does not alter
executable code; default-concurrency failures already recorded), pinned
OpenCode fixture/MCP harnesses (unchanged), B17/B19 gates (unchanged), public
catalog, real inference and B20/#43 (not authorized), and B30 isolation/relay
(not implemented). Exact-head CI for the upcoming documentation commit remains
pending and must be verified separately.

Claim: This entry supports an honest red Windows/green Ubuntu CI status at
`762c133`, based on `gh run view 43628743462 --json headSha,conclusion,jobs`,
and an isolated maintenance pass based on `node --test test/task-maintenance.test.mjs`.
It does not support a passing CI receipt for a later head, deterministic
default-concurrency success, redirect containment, live use or merge.

## M3 preparation: B29 P3 feedback receipts and exact-head CI — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm; Node directory
`C:\Users\paulo\AppData\Roaming\fnm\node-versions\v24.22.1\installation` on the
child PATH). Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `gh run view 43630565937 --json headSha,conclusion,jobs` | Verify PR #44's exact-head CI at `113e926` | Run `success`, head `113e926c08520ce7acd46c9a206d6d49ea89ff53`; Windows job `132556010859` `success`, Ubuntu job `132556011017` `success` | 0 |
| `gh api repos/pbsilvabd/ai-orchestrator/actions/jobs/132556010859/logs` | Read the Windows job raw log | `tests 305 / pass 304 / fail 0 / skipped 1`; demo `429` then `200` | 0 |
| `gh api repos/pbsilvabd/ai-orchestrator/actions/jobs/132556011017/logs` | Read the Ubuntu job raw log | `tests 305 / pass 301 / fail 0 / skipped 4`; demo `429` then `200` | 0 |
| `node --test test/task-maintenance.test.mjs` | Isolate the Windows maintenance recovery test | 21 passed, 0 failed, 0 skipped | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Documentation correction whitespace | no output | 0 |
| `git diff --cached --check` | Staged documentation correction whitespace | no output | 0 |

Result: the exact-head CI for `113e926` is verified green in run `43630565937`:
Windows job `132556010859` passed 305 tests (304 pass/0 fail/1 skip) and the
demo returned 429 then 200; Ubuntu job `132556011017` passed 305 tests (301
pass/0 fail/4 skip) and the demo returned 429 then 200. This supersedes the
preceding entry's statement that the exact-head CI "remains pending". The
isolated maintenance test passed 21/21 and the demo returned 429 then 200, so
this documentation-only change leaves the tested behavior unchanged. The
supervisor provided an independently run serial suite (`node --test
--test-concurrency=1` at `113e926`) of 305 tests / 304 pass / 0 fail / 1 skip,
native exit 0, logged outside the repository; that is supervisor-run evidence,
not a command run here. The independent review at `113e926` additionally
observed a default-concurrency run of 305 tests / 298 pass / 6 fail / 1 skip,
exit 1: five pre-existing `test/mcp-server.test.mjs` output-wait timeouts
(B15-01c/01d/01e/01f and B15-03b) plus the pre-existing B10-03 case. Both test
files are untouched by B29 (`git diff 688da04..113e926 --
test/mcp-server.test.mjs test/subprocess.test.mjs` is empty). No deterministic
green default-concurrency claim is made.

Evidence level: Unit — the isolated maintenance test and the fallback demo
exercise temporary state, process and policy behavior and show that the
documentation-only correction leaves them unchanged. The `gh` commands are an
external observation of GitHub Actions status, reported as the exact-head CI
receipt, not a local test of the code.

Not rerun: full `node --test` default-concurrency (the supervisor supplied the
serial run and the independent review supplied the six-failure observation),
pinned OpenCode free/MCP harnesses (no executable change), standalone smoke,
B16/B17, B19 pulse, public catalog, real inference, B20/#43 and B30
isolation/relay (not authorized or not implemented).

Claim: This entry supports the green exact-head CI receipt at `113e926` (run
`43630565937`) and the isolated maintenance/demo passes, based on `gh run view`
/ `gh api` and `node --test test/task-maintenance.test.mjs` / `node
examples/fallback-demo.mjs`. It does not support deterministic green
default-concurrency runs, redirect containment, live use, B20/M3 or merge.

## M3 preparation: B30 live-boundary card — 2026-11-14

Executed on Windows x64 (Git; Node was not invoked). Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `git diff --check` | Tracked documentation whitespace before staging card | no output; untracked new card was not included in this check | 0 |
| `git diff --cached --check` | Staged documentation including new B30 card | no output; new card included | 0 |

Result: both whitespace checks passed; the staged check includes the new B30
card. Neither code nor runtime behavior was changed. Evidence level: Unit —
no new runtime claim is made by these checks.
Not rerun: `node --test`, demo and pinned-host/MCP harnesses (card-only change);
catalog GET and live inference (not authorized).
Claim: this entry supports only a documented acceptance plan, not relay safety,
egress enforcement, B29 completion, live availability or M3.

## M3 preparation: B30 egress and signing design — 2026-11-14

Executed on Windows x64 (documentation research; no Node or OpenCode host run).
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `git status --short --branch` | Confirm B30 starting branch | clean `task/B30-free-relay` at `551b3f4` before edits | 0 |
| `git diff --cached --check` | Check complete staged design and card | no whitespace errors | 0 |

Result: the design is documented, not deployed or exercised. Research sources:
[Microsoft Hyper-V switch types](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/plan/plan-hyper-v-networking-in-windows-server)
(Internal permits host/VM communication; Default Switch can carry NAT),
[Linux network namespaces](https://man7.org/linux/man-pages/man7/network_namespaces.7.html)
and [ip-netns](https://man7.org/linux/man-pages/man8/ip-netns.8.html)
(separate devices/routes), and
[OpenSSH ssh-keygen](https://man.openbsd.org/ssh-keygen.1) (`-Y sign`, `-Y verify`,
namespace and allowed signers). These are specification references, not
platform deployment observations.

Evidence level: Unit — the staged diff check is documentation-only; it does
not demonstrate network isolation, SSH signatures or actual host behavior.
Not rerun: `node --test`, demo, pinned-host harness and MCP workflow (no code
change); Hyper-V/netns/gateway bypass tests and signature tests (not
implemented); catalog GET and real inference (not authorized).
Claim: this entry supports only a concrete design and acceptance plan, not
relay safety, verifiable egress enforcement, a real maintainer signature,
live-model availability or M3.

## M3 preparation: B30 relay, gateway, SSHSIG admission and WSL2 containment — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), OpenSSH `ssh-keygen`
(Git for Windows `C:\Program Files\Git\usr\bin\ssh-keygen.exe`), and WSL2 Ubuntu
(kernel `6.6.87.2-microsoft-standard-WSL2`, root). Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `git merge origin/main` | Incorporate merged B29 main into `task/B30-free-relay` | Conflicts in `docs/handoff.md`, `docs/validation.md`, `docs/worklog.md` resolved preserving both append-only entry sets; merge committed at `205a1f8` | 0 |
| `node --check` on `src/relay.mjs`, `src/egress-gateway.mjs`, `src/live-approval.mjs` | Syntax of the three new modules | no output for each | 0 each |
| `node --test test/relay.test.mjs test/egress-gateway.test.mjs test/live-approval.test.mjs` | B30 focused relay/gateway/approval cases | 31 passed, 0 failed, 0 skipped | 0 |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh` | Isolated WSL2 worker/relay netns + veth: inventory plus real socket probes | worker→relay reachable; worker→gateway and worker/relay→Internet denied; relay→gateway reachable; "containment verified"; teardown left no `b30-*` netns/veth | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression on the final code | 335 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: the relay forwards exactly the fixed method/path/model with `Bearer public`
and an independent request counter; every 301/302/303/307/308 from the upstream is
refused with the alternate origin receiving zero requests/bytes; the gateway refuses
CONNECT, unapproved paths and redirects with sanitized logs; the SSHSIG plumbing
round-trips and refuses wrong namespace/signer, edited bytes, revoked keys and any
non-hardware signature; the approval ledger refuses a second task for one approval ID.
The WSL2 fixture proves routing-based worker/relay containment with real socket
attempts and fail-closed teardown.

Evidence level: Unit (relay/gateway/approval use temporary loopback processes and
disposable keys); the WSL2 run is a deployment observation of real netns/veth
routing in an isolated distribution, not a bare-metal Ubuntu or Windows Hyper-V
deployment and not a firewall (nftables) proof.

Not rerun / not_run: nftables/iptables default-drop filtering (binaries absent;
installing packages is not authorized); bare-metal Ubuntu or two-VM Hyper-V
deployment; a real FIDO2 `-sk` hardware-key signing dry run (disposable ed25519 keys
and a synthesized sk-signature blob only); public catalog GET and live inference
(prohibited); the pinned-host-through-relay end-to-end run (the relay is not wired
into the closed live composition path). `integration/opencode-free.mjs` and the B29
MCP fixture were not rerun (their production composition path is unchanged).

Claim: this entry supports the B30 relay/gateway/SSHSIG fixture behavior, the
routing-based WSL2 containment observation and the no-replay approval ledger, based
on the commands above. It does not support firewall-filtered isolation, a
bare-metal/VM deployment, a hardware-key signature, catalog availability, live
inference, B20/M3 or merge; those remain `not_run` and the live route stays closed.

## M3 preparation: B30 review corrections (P1 ledger, P2 gateway/bind/WSL scope) — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), OpenSSH `ssh-keygen`
(Git for Windows), WSL2 Ubuntu (kernel `6.6.87.2-microsoft-standard-WSL2`, root).
Date: 2026-11-14. This entry corrects the preceding checkpoint without rewriting it.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check` on `src/relay.mjs`, `src/egress-gateway.mjs`, `src/live-approval.mjs` | Syntax of the three corrected modules | no output for each | 0 each |
| `node --test test/relay.test.mjs test/egress-gateway.test.mjs test/live-approval.test.mjs` | Corrected focused cases: atomic single-use ledger (two-process competition + restart), gateway fixed bearer/request-cap/wildcard-bind, relay→gateway→fixture-origin chain | 40 passed, 0 failed, 0 skipped | 0 |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh` | Corrected 3-namespace fixture (worker/relay/gateway, no host-namespace changes) with real socket probes | worker→relay reachable; worker/relay/gateway→Internet denied; relay→gateway reachable; gateway→worker denied; "containment verified" | 0 |
| `wsl -d Ubuntu -- bash <residue-check>` | Verify teardown leaves no host-namespace residue | no `b30-*` netns/veth, no `10.100.x` address/route in the host namespace | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression on the corrected code | 345 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: the approval ledger now claims atomically with no overwrite (write-then-hard-
link, `EEXIST` collision re-read) and is proven single-use across two competing
processes and across a restart; the gateway forwards the fixed `Bearer public` and
enforces its own request cap; both listeners reject `0.0.0.0`/`::`; the WSL fixture
now confines the gateway to its own disposable namespace and leaves the WSL
initial/host namespace untouched (verified empty after teardown).

Evidence level: Unit (temporary loopback processes, disposable keys, a two-process
claim fixture); the corrected WSL2 run is a routing-only deployment observation in
three disposable namespaces, not a firewall (nftables) proof and not a bare-metal/VM
deployment.

Not rerun / not_run: the earlier out-of-scope host-namespace WSL observation was
corrected, not repeated; nftables/iptables default-drop filtering (absent, install not
authorized); bare-metal Ubuntu / two-VM Hyper-V; pinned OpenCode 2.2.5 through the
relay; a real FIDO2 `-sk` hardware-key signing dry run; public catalog GET and live
inference.

Claim: this entry supports the corrected atomic single-use ledger, gateway credential/
cap/bind enforcement, the relay→gateway→fixture-origin chain and the no-host-change
WSL2 containment observation, based on the commands above. The whole-row `pass`
overclaims in the earlier PR body are corrected to partial/`not_run`; firewall-filtered
isolation, bare-metal/VM deployment, pinned-host relay, hardware signing, catalog and
live inference remain `not_run` and the live route stays closed.

## M3 preparation: B30 re-review correction (in-namespace veth, collision safety, IPv6 aliases) — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), WSL2 Ubuntu (kernel
`6.6.87.2-microsoft-standard-WSL2`, root). Date: 2026-11-14. This entry corrects the
preceding checkpoint without rewriting it.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check` on `src/relay.mjs`, `src/egress-gateway.mjs` | Syntax of the two wildcard-corrected modules | no output for each | 0 each |
| `node --test test/relay.test.mjs test/egress-gateway.test.mjs test/live-approval.test.mjs` | Focused cases incl. compressed all-zero IPv6 aliases | 40 passed, 0 failed, 0 skipped | 0 |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh --self-test` | Collision refusal + owned-only cleanup (disposable namespaces only) | "self-test passed" | 0 |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh` | Corrected in-namespace veth fixture (no `ip link add` in initial namespace) with real socket probes | "containment verified"; "teardown removed all owned objects, no initial-namespace residue" | 0 |
| `wsl -d Ubuntu -- bash <residue-check>` | Verify teardown leaves no host-namespace residue | no `b30-*` netns/veth, no `10.100.x` address/route | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression on the corrected code | 345 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: each veth pair is now created inside a disposable namespace and only the peer
is moved, so `ip link add` never runs in the WSL initial/host namespace; namespaces use
a unique per-run suffix with owned-only collision-safe teardown; the all-zero IPv6
predicate expands `::` compression and rejects compressed aliases (`0:0:0:0:0:0:0::`,
`0:0:0:0:0::`, …) in both listeners. The earlier out-of-scope host-namespace
observation was corrected, not repeated.

Evidence level: Unit (temporary loopback processes, disposable keys, a two-process
claim fixture); the corrected WSL2 run is a routing-only deployment observation with
veth pairs created inside disposable namespaces, not a firewall (nftables) proof and
not a bare-metal/VM deployment.

Not rerun / not_run: nftables/iptables default-drop filtering (absent, install not
authorized); bare-metal Ubuntu / two-VM Hyper-V; pinned OpenCode 2.2.5 through the
relay; a real FIDO2 `-sk` hardware-key signing dry run; public catalog GET and live
inference.

Claim: this entry supports the corrected in-namespace veth creation, collision-safe
owned cleanup and the sound all-zero IPv6 rejection, based on the commands above.
Firewall-filtered isolation, bare-metal/VM deployment, pinned-host relay, hardware
signing, catalog and live inference remain `not_run` and the live route stays closed.

## M3 preparation: B30 re-review correction 2 (cleanup-error reporting + fault injection) — 2026-11-14

Executed on Windows 11 Pro x64, WSL2 Ubuntu (kernel `6.6.87.2-microsoft-standard-WSL2`,
root). Date: 2026-11-14. This entry corrects the preceding checkpoint without rewriting
it. No Node/test code changed in this correction, so the prior focused (40/40) and
serial full-suite (345 pass / 0 fail / 1 skip) results remain valid for the unchanged
modules and were not rerun.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh --self-test` | Collision refusal + owned-only cleanup | "self-test passed" | 0 |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh --self-test-fault` | Controlled partial-failure cleanup via EXIT trap | "SIMULATED: partial configuration failure"; exit nonzero as designed | 1 |
| `wsl -d Ubuntu -- bash -c 'ip netns list \| grep b30-fault'` | Verify fault-injection teardown removed owned namespaces | no `b30-fault-*` residue | 1 (grep no match) |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh` | Full in-namespace veth fixture | "containment verified"; "teardown removed all owned objects, no initial-namespace residue" | 0 |
| `wsl -d Ubuntu -- bash <residue-check>` | Verify no host-namespace residue | no `b30-*` netns/veth, no `10.100.x` address/route | 0 |
| `git diff --cached --check` | Staged change whitespace | no output | 0 |

Result: a failed `ip netns del` is now reported with the owned-name inventory and a
nonzero return on every exit path (the EXIT trap re-runs cleanup), `CREATED_NS` is only
cleared after every owned namespace is confirmed gone, the self-test collision object is
tracked, and `--self-test-fault` proves the EXIT trap removes owned namespaces after a
simulated partial failure.

Evidence level: WSL2 routing-only deployment observation confined to disposable
namespaces; not a firewall (nftables) proof and not a bare-metal/VM deployment. The
fault-injection exit 1 is the intended simulated failure, with the caller-verified empty
residue as the cleanup evidence.

Not rerun / not_run: focused and full Node suite/demo (no Node/test change in this
correction); nftables/iptables filtering (absent, install not authorized); bare-metal
Ubuntu / two-VM Hyper-V; pinned OpenCode 2.2.5 through the relay; a real FIDO2 `-sk`
hardware-key signing dry run; public catalog GET and live inference.

Claim: this entry supports the cleanup-error reporting, owned-only collision-safe
teardown and the fault-injection EXIT-trap cleanup, based on the commands above.
Firewall-filtered isolation, bare-metal/VM deployment, pinned-host relay, hardware
signing, catalog and live inference remain `not_run` and the live route stays closed.

## M3 preparation: B30 re-review correction 3 (EXIT trap status + inventory error) — 2026-11-14

Executed on Windows 11 Pro x64, WSL2 Ubuntu (kernel `6.6.87.2-microsoft-standard-WSL2`,
root). Date: 2026-11-14. This entry corrects the preceding checkpoint without rewriting
it. No Node/test code changed, so the prior focused (40/40) and serial full-suite
(345 pass / 0 fail / 1 skip) results remain valid and were not rerun.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `bash -c 'trap "false" EXIT; exit 0'` | Reproduce the reviewer's Bash trap-status behavior | exit 0 (trap return value does not change status) | 0 |
| `bash -c 'trap "exit 1" EXIT; exit 0'` | Confirm a trap calling `exit` overrides status | exit 1 (no recursion) | 1 |
| `wsl ... b30-egress-namespaces.sh --self-test` | Collision refusal + owned cleanup | "self-test passed" | 0 |
| `wsl ... b30-egress-namespaces.sh --self-test-fault` | Early-failure EXIT-trap cleanup | nonzero as designed; no residue | 1 |
| `wsl ... b30-egress-namespaces.sh --self-test-delete-fault` | Mock `ip netns del` failure | "teardown incomplete" inventory reported, ownership preserved | 0 |
| `wsl ... b30-egress-namespaces.sh --self-test-inventory-fault` | Mock `ip netns list` failure | "inventory unreadable" reported, ownership preserved | 0 |
| `wsl ... b30-egress-namespaces.sh --self-test-trap-status` | Deliberate `exit 0` with a failed delete | EXIT trap overrides to nonzero ("FATAL ... exiting nonzero") | 1 |
| `wsl ... b30-egress-namespaces.sh` | Full in-namespace veth fixture | "containment verified"; "teardown removed all owned objects, no initial-namespace residue" | 0 |
| `wsl ... <cleanup>` + `<residue-check>` | Reconcile the trap-status leftover; verify no residue | no `b30-*` netns/veth, no `10.100.x` address/route | 0 |
| `git diff --cached --check` | Staged change whitespace | no output | 0 |

Result: the EXIT trap now forces a nonzero process status when cleanup or inventory
verification is uncertain (`exit 1` inside the trap overrides an already-decided `exit 0`
without recursion), `namespace_exists` distinguishes "confirmed absent" from "inventory
unreadable", and a failed delete or unreadable inventory is reported with the owned-name
inventory while ownership is preserved for manual reconciliation. The mocked-`ip`
self-test modes exercise each path with a `command ip` pass-through confined to
disposable namespaces.

Evidence level: WSL2 routing-only deployment observation plus mocked-`ip` function tests,
confined to disposable namespaces; not a firewall (nftables) proof and not a bare-metal/
VM deployment.

Not rerun / not_run: focused and full Node suite/demo (no Node/test change); nftables/
iptables filtering (absent, install not authorized); bare-metal Ubuntu / two-VM Hyper-V;
pinned OpenCode 2.2.5 through the relay; a real FIDO2 `-sk` hardware-key signing dry run;
public catalog GET and live inference.

Claim: this entry supports the corrected trap-forces-nonzero status, the inventory-error
discrimination and the mocked-`ip` failed-delete/inventory/trap-status fault injection,
based on the commands above. Firewall-filtered isolation, bare-metal/VM deployment,
pinned-host relay, hardware signing, catalog and live inference remain `not_run` and the
live route stays closed.

## M3 preparation: B30 pinned OpenCode 2.2.5 through the relay — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm). Pinned binary outside the
repository: `C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe`.
Date: 2026-11-14.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check` on `src/relay.mjs`, `src/egress-gateway.mjs`, `integration/opencode-free-relay.mjs` | Syntax of changed/new modules | no output | 0 each |
| `node --test test/relay.test.mjs test/egress-gateway.test.mjs` | Relay/gateway regression after identifier + content-type change | 28 passed, 0 failed, 0 skipped | 0 |
| `node integration/opencode-free-relay.mjs <pinned binary>` | Pinned OpenCode 2.2.5 through relay→gateway→fixture-origin, normal + 301/302/303/307/308 | six scenarios passed: normal `succeeded` (3 `Bearer public` POST origin requests, no WebSocket/upgrade, no non-POST method); each redirect `failed` with 1 attempt, 1 origin request, 0 alternate-origin requests and 0 alternate-origin body bytes | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 345 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: the pinned OpenCode 2.2.5 host's free-route model requests now flow through the
service-owned relay and L7 gateway to the loopback fixture origin; the host no longer
follows a model-endpoint redirect because the gateway refuses the 3xx and returns a
terminal refusal. The B29 307 prompt-leak baseline is therefore closed through the relay:
each of 301/302/303/307/308 made the task `failed` with a single attempt and zero
alternate-origin requests/body bytes, with no replay.

Evidence level: OpenCode integration — the pinned host exercised real hooks, permissions
and failures through the relay against loopback fixtures. The relay→gateway→origin chain
is additionally local-HTTP evidence. Neither level demonstrates live-provider, network
containment, firewall or TLS behavior.

Not rerun / not_run: public catalog GET (maintainer-declined) and live inference
(prohibited); nftables/iptables filtering (absent, install not authorized); bare-metal
Ubuntu / two-VM Hyper-V deployment; real service signing integration and a real FIDO2
`-sk` hardware-key signing dry run; full cross-namespace TLS gateway chain.

Claim: this entry supports the pinned-host-through-relay normal and redirect results,
based on the commands above. Firewall-filtered isolation, bare-metal/VM deployment,
service signing integration, hardware signing, catalog and live inference remain
`not_run` and the live route stays closed.

## M3 preparation: B30 alternate-origin egress counter + WebSocket claim — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm). Pinned binary outside the
repository: `C:\Users\paulo\Documents\Projects\.audit\bin\opencode-2.2.5\opencode.exe`.
Date: 2026-11-14. This entry corrects the preceding checkpoint without rewriting it.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check integration/opencode-free-relay.mjs` | Syntax of the corrected harness | no output | 0 |
| `node integration/opencode-free-relay.mjs --self-test` | Controlled negative: aborted partial body must increment alternate-origin counters | `{connections:1, socketBytes:132, requests:1, bodyBytes:24, aborted:2}` | 0 |
| `node integration/opencode-free-relay.mjs <pinned binary>` | Pinned OpenCode 2.2.5 through relay→gateway→fixture-origin, normal + 301/302/303/307/308, with immediate egress counting | six scenarios passed: normal `succeeded` (3 `Bearer public` origin requests); each redirect `failed` with 1 attempt, 1 origin request, and zero alternate-origin connections / raw socket bytes / requests / body bytes | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: the alternate-origin zero-egress assertion now counts raw connections, raw socket
bytes, request entries and per-chunk body bytes immediately, so an aborted/partial body or
a pre-header connection attempt cannot slip past the assertion. The `--self-test` negative
proves the counter increments on an aborted partial request; the six pinned scenarios then
pass with every alternate-origin counter at zero. The B30-03 WebSocket-bypass negative is
corrected to `not_run` (no `Upgrade` header on normal POSTs is not an attempted direct
WebSocket bypass).

Evidence level: OpenCode integration (pinned host through the relay) plus a local-HTTP
counter negative; not live-provider, network-containment, firewall or TLS evidence.

Not rerun / not_run: focused and full Node suite/demo (no Node/test source changed in this
correction; prior results remain valid for the unchanged modules); public catalog GET
(maintainer-declined) and live inference (prohibited); nftables/iptables filtering;
bare-metal Ubuntu / two-VM Hyper-V; active worker-compartment WebSocket-bypass negative;
real service signing integration; a real FIDO2 `-sk` hardware-key signing dry run; full
cross-namespace TLS gateway chain.

Claim: this entry supports the immediate alternate-origin egress counting, the aborted-
partial-body negative and the corrected six-scenario pinned-host result, based on the
commands above. Firewall-filtered isolation, bare-metal/VM deployment, the active
WebSocket-bypass negative, service signing integration, hardware signing, catalog and
live inference remain `not_run` and the live route stays closed.

## M3 preparation: B30 digest-stability test fix (failing Ubuntu CI) — 2026-11-14

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm). Date: 2026-11-14. This entry
records the exact-head CI failure and its correction.

Failing run (blocking, not green): Actions run `43669588038` at head `6d48763` —
Ubuntu Node 24.22.1 job `132676436112` concluded `failure`: 346 tests / 341 pass / 1
fail / 4 skip; Windows passed. The failure was `test/live-approval.test.mjs:277-280`
(`approval digest is stable over canonical bytes`), which called the `approval()` helper
twice, each call deriving `issuedAt`/`expiresAt` from a separate `Date.now()`; when the
clock crossed a millisecond the canonical bytes differed and the hashes legitimately
differed. Production hash behavior was correct; the test was nondeterministic.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/live-approval.test.mjs` | Focused digest-stability + SSHSIG cases after the fix | 12 passed, 0 failed, 0 skipped | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression (two runs) | run 1: 344 pass / 1 fail (pre-existing `B15-03b` output-wait timeout) / 1 skip; run 2: 345 pass / 0 fail / 1 skip | run 2: 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Correction: `test/live-approval.test.mjs` now builds one `approval()` once, asserts its
digest matches `^[a-f0-9]{64}$`, equals the digest of a spread copy of those same bytes,
and differs from a deliberate `approvalId` change. No production hashing or canonical
behavior changed.

Claim: this entry records the failing Ubuntu CI receipt and the deterministic test fix,
based on the commands above. The exact-head Windows/Ubuntu CI at the corrected head must
be observed green separately.

## M3 preparation: B30 active egress negatives + relay failure/lifecycle fixtures — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), WSL2 Ubuntu (kernel
`6.6.87.2-microsoft-standard-WSL2`, root). Date: 2026-11-15.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `wsl -d Ubuntu -- bash integration/b30-egress-namespaces.sh` | Isolated worker/relay/gateway netns + veth with active IPv4/IPv6/DNS/WebSocket-upgrade negative probes | "containment verified": worker→relay reachable; worker/relay/gateway→Internet denied; worker→IPv6 `rc=7`, worker→DNS `.invalid` `rc=6`, worker→WebSocket-upgrade `rc=7`; no host residue | 0 |
| `node --test test/relay.test.mjs` | Relay failure/lifecycle: port-conflict, upstream failure/timeout latch, partial-body drop (no replay), stop + port release | 16 passed, 0 failed, 0 skipped | 0 |
| `node --test test/relay.test.mjs test/egress-gateway.test.mjs test/live-approval.test.mjs` | Focused B30 regression | 43 passed, 0 failed, 0 skipped | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 348 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: the worker compartment's direct IPv4, IPv6, DNS and WebSocket-upgrade egress to
private/TEST-NET/no-route addresses is denied by routing (no external address contacted,
no nftables filtering). The relay's local HTTP/process fixtures cover a timeout latch with
a terminal 502 and no second request, a partial-body drop that latches without replay, and
a terminal stop that releases the port (no dangling unowned listener).

Evidence level: the WSL2 run is a routing-only deployment observation confined to
disposable namespaces (not firewall-filtered, not a bare-metal/VM deployment); the relay
fixtures are local HTTP/process evidence. The relay is not spawned as a child of the
service, so service-level uncertain-child-stop integration is not proven.

Not rerun / not_run: signed-approval service admission integration and a real FIDO2 `-sk`
hardware-key signing dry run (assessed as requiring hardware + verified egress, neither
available; the SSHSIG verification/no-replay ledger are implemented and tested standalone);
public catalog GET (maintainer-declined); live inference; nftables filtering; bare-metal
Ubuntu / two-VM Hyper-V; full cross-namespace TLS gateway chain.

Claim: this entry supports the active worker IPv4/IPv6/DNS/WebSocket-upgrade negative
probes and the relay timeout/partial-body/port-release fixtures, based on the commands
above. Firewall-filtered isolation, the active provider WebSocket-bypass experiment,
signed-approval service integration, hardware signing, catalog and live inference remain
`not_run` and the live route stays closed.

## M3 preparation: B30 nftables default-drop inside disposable namespaces — 2026-11-15

Executed on Windows 11 Pro x64, WSL2 Ubuntu 24.04.2 LTS (kernel
`6.6.87.2-microsoft-standard-WSL2`, root, CapEff `=ep`), Node.js v24.22.1 (fnm).
Date: 2026-11-15. Maintainer-authorized package install and ephemeral per-namespace
nftables rules.

Preflight (read-only) before install: `nft`/`iptables` absent; host firewall snapshot
empty (`nft list ruleset` and `iptables -S`); `apt-get -s install nftables` planned exactly
`libnftnl11 1.2.6-2build1`, `libnftables1 1.0.9-1build1`, `nftables 1.0.9-1build1`
(3 new, 0 upgraded, 0 removed, no service/host-firewall side effects).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `apt-get install -y nftables` | Install nftables (maintainer-authorized) | 3 packages installed: nftables 1.0.9-1build1, libnftables1 1.0.9-1build1, libnftnl11 1.2.6-2build1; `nftables` systemd unit `disabled` | 0 |
| `nft list ruleset` (host, after install) | Verify no host firewall activated | empty | 0 |
| disposable `nft` namespace probe | Confirm nft works per-namespace and host stays empty | default-drop output chain added inside a disposable namespace; host ruleset empty | 0 |
| `wsl ... integration/b30-egress-namespaces.sh` (persistent log) | Full fixture with per-namespace nftables default-drop + active negatives | "containment verified"; worker `nft` counters: `dport 18081 accept packets 1`, `drop packets 7`; relay: `dport 18082 accept packets 1`, `drop packets 10`; forbidden port `:18099` `rc=28` timeout (nft-dropped); no host residue | 0 |
| `wsl ... <residue-check>` | Verify host nft/netns/veth clean after teardown | host `nft list ruleset` empty; no `b30-*` netns/veth; no `10.100.x` address/route | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 348 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: the worker and relay namespaces each install a per-namespace nftables
default-drop `inet b30fw` table (OUTPUT and FORWARD `policy drop`, allow only
worker→relay:18081 and relay→gateway:18082 via `counter accept`, final `counter drop`).
Combined with no default route, this denies the worker's direct IPv4/IPv6/DNS/WebSocket-
upgrade and a routable-but-not-allowed relay port; the nftables counters record the
accepted/dropped packets, and the WSL initial/host nftables ruleset stays empty before and
after. The forbidden port `:18099` times out (`rc=28`) — a routable address whose SYN is
dropped by the OUTPUT policy — proving the nftables layer, not just routing.

Evidence level: WSL2 routing + nftables deployment observation confined to disposable
namespaces; not a bare-metal/VM deployment, not a pinned-Linux-OpenCode run (unavailable),
and the gateway namespace has no external route (fixture terminal point).

Not rerun / not_run: a bare-metal Ubuntu or two-VM Hyper-V deployment; the active provider
WebSocket-bypass experiment; signed-approval service admission integration; a real FIDO2
`-sk` hardware-key signing dry run; public catalog GET (maintainer-declined); live
inference. The nftables package remains installed in the distribution (rules/namespaces
were removed and verified absent; no unrelated state was removed).

Claim: this entry supports the per-namespace nftables default-drop enforcement, the
counters and the active negative probes, based on the commands above. A bare-metal/VM
deployment, the active provider WebSocket-bypass experiment, signed-approval service
integration, hardware signing, catalog and live inference remain `not_run` and the live
route stays closed.

## M3 preparation: B30 unprivileged worker capability removal + forbidden-port proof — 2026-11-15

Executed on Windows 11 Pro x64, WSL2 Ubuntu 24.04.2 LTS, Node.js v24.22.1 (fnm).
Date: 2026-11-15. Corrects the supervisor P1/P2 findings at `a103ccf`.

Preflight (read-only): `setpriv` (util-linux) present with `--no-new-privs`,
`--bounding-set`, `--reuid/--regid`, `--clear-groups`; `runuser`/`su`/`capsh` present;
`nobody` = uid/gid 65534.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `wsl ... integration/b30-egress-namespaces.sh` (persistent log) | Full fixture: unprivileged worker probes + mutation refusal + forbidden-port proof | "containment verified"; worker probes ran as `nobody`; see inventory below | 0 |
| `ip netns exec <worker> setpriv ... grep Cap* /proc/self/status` | Unprivileged worker capability inventory | `CapInh:0 CapPrm:0 CapEff:0 NoNewPrivs:1`, `CapBnd:000001ffffdfefff` (NET_ADMIN/SYS_ADMIN dropped) | 0 |
| `ip netns exec <worker> setpriv ... nft add table inet b30evil` | Unprivileged nft mutation refusal | "Operation not permitted" | 1 |
| `ip netns exec <worker> setpriv ... ip route add default via <relay>` | Unprivileged route mutation refusal | "RTNETLINK answers: Operation not permitted" | 2 |
| `ss -ltn` (relay) + forbidden probe + drop-counter delta | Forbidden-listener bound + exact `rc=28` + counter increment | listener bound on `:18099`; probe `rc=28`; drop counter incremented | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 348 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: worker-side probes now run as the unprivileged `nobody` identity with `no_new_privs`
and no NET_ADMIN/SYS_ADMIN (`CapEff:0`), and an unprivileged `nft`/`ip` mutation is refused,
so the default-drop observation no longer assumes a network-admin worker. The forbidden-port
proof now verifies the `:18099` listener is bound, requires the exact timeout `rc=28`, and
confirms the nft drop counter incremented for that probe.

Evidence level: WSL2 routing + nftables observation confined to disposable namespaces; not
a bare-metal/VM deployment, not a pinned-Linux-OpenCode run (unavailable).

Not rerun / not_run: bare-metal Ubuntu / two-VM Hyper-V; the active provider WebSocket-
bypass experiment; signed-approval service admission integration; a real FIDO2 `-sk`
hardware-key signing dry run; public catalog GET (maintainer-declined); live inference.
The nftables package remains installed; namespaces/rules removed and verified absent.

Claim: this entry supports the unprivileged worker capability removal, the mutation
refusal and the verified forbidden-port nft drop, based on the commands above. A
bare-metal/VM deployment, the active provider WebSocket-bypass experiment, signed-approval
service integration, hardware signing, catalog and live inference remain `not_run` and the
live route stays closed.

## M3 preparation: B30 fail-closed worker privilege-boundary verdict — 2026-11-15

Executed on Windows 11 Pro x64, WSL2 Ubuntu 24.04.2 LTS, Node.js v24.22.1 (fnm).
Date: 2026-11-15. Corrects the supervisor P1 finding at `42396c9` (capability inventory and
mutation outcomes were logged, not asserted).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `wsl ... b30-egress-namespaces.sh --self-test-capability` | Controlled check that `verify_worker_privileges` accepts good inputs and rejects simulated mutation success / wrong uid / nonzero CapEff / unset NoNewPrivs / unauthorized table / unauthorized default route | "self-test-capability passed" (8 checks) | 0 |
| `wsl ... b30-egress-namespaces.sh` (persistent log) | Full fixture with the fail-closed privilege-boundary verdict | "containment verified"; `PASS worker privilege boundary (uid=65534 CapEff=0000000000000000 NoNewPrivs=1 nft_rc=1 route_rc=2)`; forbidden `:18099` `rc=28`; drop counter incremented; no host residue | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 348 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Complete staged change whitespace | no output | 0 |

Result: the worker privilege boundary is now an enforced verdict, not a log line. The run
asserts the unprivileged identity (UID 65534), empty CapEff (numeric hex comparison), set
NoNewPrivs, both mutation attempts refused (nft rc=1, ip rc=2), and no unauthorized nft
table or default route installed; any of these failing makes `RESULT: containment FAILED`.
A controlled `--self-test-capability` mode proves the check would fail on simulated
mutation success or unexpected capabilities, without WSL netns/nft/ip side effects.

Evidence level: WSL2 routing + nftables observation confined to disposable namespaces; not
a bare-metal/VM deployment, not a pinned-Linux-OpenCode run (unavailable).

Not rerun / not_run: bare-metal Ubuntu / two-VM Hyper-V; the active provider WebSocket-
bypass experiment; signed-approval service admission integration; a real FIDO2 `-sk`
hardware-key signing dry run; public catalog GET (maintainer-declined); live inference.

Claim: this entry supports the enforced worker privilege-boundary verdict and its controlled
self-test, based on the commands above. A bare-metal/VM deployment, the active provider
WebSocket-bypass experiment, signed-approval service integration, hardware signing, catalog
and live inference remain `not_run` and the live route stays closed.

## M3 preparation: B30 fail-closed capability inventory (missing/malformed/retained rejected) — 2026-11-15

Executed on Windows 11 Pro x64, WSL2 Ubuntu 24.04.2 LTS, Node.js v24.22.1 (fnm).
Date: 2026-11-15. Corrects the supervisor P1 re-review finding at `2096d62` (missing CapEff
defaulted to zero; CapInh/CapPrm/CapBnd logged but not asserted; post-mutation read failures
treated as absence).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `wsl ... b30-egress-namespaces.sh --self-test-capability` | Controlled check that `verify_worker_privileges` accepts the observed good inventory and rejects missing/malformed CapEff, nonzero CapEff/CapPrm/CapInh, retained NET_ADMIN/SYS_ADMIN CapBnd, missing CapBnd, wrong uid/gid, unset NoNewPrivs, mutation success, unauthorized table/route, and nft/route read failure | "self-test-capability passed" (1 accept + 17 rejects) | 0 |
| `wsl ... b30-egress-namespaces.sh` (persistent log) | Full fixture with the fail-closed capability inventory + mutation + post-read verdict | "containment verified"; `PASS worker privilege boundary (uid=65534 gid=65534 CapInh=0000000000000000 CapPrm=0000000000000000 CapEff=0000000000000000 CapBnd=000001ffffdfefff NoNewPrivs=1 nft_rc=1 route_rc=2)`; forbidden `:18099` `rc=28`; drop counter incremented; no host residue | 0 |
| `wsl ... wsl-nft-residue.sh` | Host residue verification | `nft list ruleset` empty; no host netns/links/10.100.x addresses | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 348 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Complete change whitespace | no output | 0 |

Result: the worker capability boundary is now fully fail-closed. The verdict requires a
successful, parseable `/proc/self/status` inventory and asserts UID/GID 65534,
`CapInh`/`CapPrm`/`CapEff` all-zero (missing/malformed masks are rejected, never defaulted
to zero), `NoNewPrivs` 1, and NET_ADMIN/SYS_ADMIN absent from `CapBnd` (checked by
nibble-extraction bit test, no 64-bit arithmetic); it asserts both mutation attempts are
refused and that the post-mutation `nft list tables` / `ip route show` reads themselves
succeed before unauthorized state is treated as absent (a read failure is uncertainty).
The `--self-test-capability` mode proves each simulated bad input is rejected without any
WSL netns/nft/ip side effects.

Evidence level: WSL2 routing + nftables observation confined to disposable namespaces; not
a bare-metal/VM deployment, not a pinned-Linux-OpenCode run (unavailable).

Not rerun / not_run: bare-metal Ubuntu / two-VM Hyper-V; the active provider WebSocket-
bypass experiment; signed-approval service admission integration; a real FIDO2 `-sk`
hardware-key signing dry run; public catalog GET (maintainer-declined); live inference.

Claim: this entry supports the enforced fail-closed worker capability inventory, mutation
refusal, post-mutation read and its controlled self-test, based on the commands above. A
bare-metal/VM deployment, the active provider WebSocket-bypass experiment, signed-approval
service integration, hardware signing, catalog and live inference remain `not_run` and the
live route stays closed.

## M3 preparation: B30 CapBnd whole-mask canonical validation — 2026-11-15

Executed on Windows 11 Pro x64, WSL2 Ubuntu 24.04.2 LTS, Node.js v24.22.1 (fnm).
Date: 2026-11-15. Corrects the supervisor P2 re-review finding at `7a10cd3` (`cap_bit_set`
validated only the requested nibble, so a 16-character mask with a non-hex character outside
bits 12/21 — e.g. `z00001ffffdfefff` — was accepted).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `wsl ... bash -n b30-egress-namespaces.sh` | Shell syntax check | clean | 0 |
| `wsl ... b30-egress-namespaces.sh --self-test-capability` | Controlled check incl. two non-hex corruptions outside the checked nibbles (MSB `z00001ffffdfefff`, LSB `000001ffffdfeffz`) | "self-test-capability passed" (1 accept + 19 rejects) | 0 |
| `wsl ... b30-egress-namespaces.sh` (persistent log) | Full fixture with the fail-closed capability inventory verdict | "containment verified"; `PASS worker privilege boundary (uid=65534 gid=65534 CapInh=0000000000000000 CapPrm=0000000000000000 CapEff=0000000000000000 CapBnd=000001ffffdfefff NoNewPrivs=1 nft_rc=1 route_rc=2)`; forbidden `:18099` `rc=28`; drop counter incremented; no host residue | 0 |
| `wsl ... wsl-nft-residue.sh` | Host residue verification | `nft list ruleset` empty; no host netns/links/10.100.x addresses | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 348 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Complete change whitespace | no output | 0 |

Result: `cap_bit_set` now validates the entire mask as 16 hex digits (case
`*[!0-9a-fA-F]*`) before extracting any nibble, so a non-hex character anywhere in `CapBnd`
fails the privilege verdict as uncertain. The `--self-test-capability` mode adds corruption
outside both target nibbles (MSB and LSB) to the existing 1-accept/17-reject set and passes
all 19 rejects; the real observed `CapBnd=000001ffffdfefff` still verifies. This closes the
stated "any malformed inventory is fail-closed" guarantee.

Evidence level: WSL2 routing + nftables observation confined to disposable namespaces; not
a bare-metal/VM deployment, not a pinned-Linux-OpenCode run (unavailable).

Not rerun / not_run: bare-metal Ubuntu / two-VM Hyper-V; the active provider WebSocket-
bypass experiment; signed-approval service admission integration; a real FIDO2 `-sk`
hardware-key signing dry run; public catalog GET (maintainer-declined); live inference.

Claim: this entry supports the whole-mask `CapBnd` validation and its controlled self-test,
based on the commands above. A bare-metal/VM deployment, the active provider WebSocket-
bypass experiment, signed-approval service integration, hardware signing, catalog and live
inference remain `not_run` and the live route stays closed.

## M3 preparation: B30 signed-approval service admission integration (B30-05) — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), OpenSSH `ssh-keygen` (Git for
Windows). Date: 2026-11-15. Binds the standalone SSHSIG verification/atomic ledger to
service admission for new tasks; corrects the prior `not_run` "signed-approval service
admission integration" gap in ADR-010.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/{tasks,service,live-approval,configured-service}.mjs` | Syntax check of changed sources | clean | 0 |
| `node --test test/live-approval.test.mjs test/live-approval-service.test.mjs` | SSHSIG plumbing + new service admission integration (mechanism with a labelled mock, real factory refusal paths, real-ledger single-use) | 23 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 359 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Complete change whitespace | no output | 0 |

Result: `createTaskService` now accepts an optional synchronous `admission` gate that runs
for new tasks after idempotent replay resolution and repository inspection but before task
persistence, workspace or spawn. `createSignedApprovalAdmission` (`src/live-approval.mjs`)
binds the standalone SSHSIG verification, resolved-base-commit binding and atomic no-replace
single-use ledger to that gate; `createConfiguredTaskService` passes a supplied `admission`
through. `submit_task` gains optional `approval`/`signature` fields that are excluded from
the canonical payload/idempotency hash and never persisted. Tests demonstrate: an identical
replay returns the original task without re-running admission; a refusal (missing envelope,
expired, paid, malformed, non-hardware signature) throws `authorization_denied`/`invalid_argument`
with zero task records persisted; one approval ID cannot admit a second task; and error codes
map to the contract without leaking admission internals. The cryptographic positive path
(real FIDO2 presence+verification) is not exercised — no hardware key was used and none is
simulated.

Evidence level: unit + local fixture (disposable non-hardware test keys, a mock verifier over
the real ledger, and real `ssh-keygen -Y verify` refusal paths); not a real hardware-key dry
run, not a live provider run.

Not rerun / not_run: a real FIDO2 `-sk` hardware-key signing dry run (the cryptographic
positive admission path); bare-metal/VM deployment; public catalog GET (maintainer-declined);
live inference; active provider WebSocket-bypass experiment.

Claim: this entry supports the signed-approval service admission wiring and its controlled
self-tests. The hardware positive path, bare-metal/VM deployment, catalog and live inference
remain `not_run` and the live route stays closed.

## M3 preparation: B30 signed-approval pre-spawn revalidation + host/readable binding (B30-05) — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), OpenSSH `ssh-keygen` (Git for
Windows). Date: 2026-11-15. Corrects the two P1 findings at `0f5bbd1` (review comment
`6897307203`): (1) no re-validation immediately before spawn, and (2) the signed host
identity and human-readable approval scope are not bound to the effective task/worker.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/{live-approval,service,scheduler}.mjs` | Syntax check of changed sources | clean | 0 |
| `node --test test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs` | SSHSIG plumbing + service admission + pre-spawn revalidation (positive mock, expiry/drift/missing-receipt negatives) + host-digest/readable-field binding | 28 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 364 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Complete change whitespace | no output | 0 |
| one-shot bounded catalog GET (`redirect:error`, 10s, 2 MiB, no retry) | Public zero-price metadata for the fixed free model (staged authorization) | HTTP 200, 104,821 bytes; `deepseek-v4.1-flash-free` zero-price, endpoint/package match | 0 |
| read-only FIDO2 tooling inventory (`ssh-keygen` version + `ssh-sk-helper` presence) | Non-invasive local check | OpenSSH 9.5p2 `ssh-keygen` and `ssh-sk-helper` present | 0 |

Result: (1) `createSignedApprovalAdmission` now returns a trusted in-memory receipt whose
`revalidate(now)` closure re-checks approval expiry, metadata freshness and the measured host
binary digest; `createTaskScheduler` calls a service-provided `revalidate(taskId, now)`
synchronously **before** the dispatch reservation/workspace/spawn, and on failure records the
queued task as `cancelled` (`executionStopped: true`, `admission-refused` progress, no
attempt) and halts the queue — no spawn, no replay. (2) `verifyApprovalBinding` now also
binds the signed readable `objective`/`repository.branch`/`maxAttempts`/`limits` to the
effective validated request and the signed `hostBinaryDigest` to the measured trusted
executable (`measureHostBinaryDigest`), before the ledger reserve. Tests cover positive
mock spawn, expiry/drift/missing-receipt pre-spawn negatives, host-digest and readable-field
mismatch negatives, with disposable temp executable/config and no external provider calls.
The cryptographic positive path (real FIDO2 presence+verification) remains `not_run` — no
hardware key was used and none is simulated.

Evidence level: unit + local fixture (mock verifier over the real ledger, real
`ssh-keygen -Y verify` refusal paths, a one-shot public catalog read recorded as dated
evidence). Not a real hardware-key dry run, not a live provider run, not a bare-metal/VM
deployment.

Not rerun / not_run: a real FIDO2 `-sk` hardware-key signing dry run; bare-metal Ubuntu /
two-VM Hyper-V deployment; the active provider WebSocket-bypass experiment; live inference.
The catalog GET is a dated evidence snapshot, not perpetual authority and not live activation.

Claim: this entry supports the pre-spawn revalidation and host/readable binding. The hardware
positive path, bare-metal/VM deployment, WebSocket-bypass experiment and live inference
remain `not_run` and the live route stays closed.

## M3 preparation: B30 pre-spawn just-before-runSubprocess + admission result + host-path binding — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), OpenSSH `ssh-keygen` (Git for
Windows). Date: 2026-11-15. Corrects the three P1 findings at `8e358a4` (review comment
`6897600299`): (1) revalidation is before `worker.prepare`, not just before process spawn;
(2) a returned admission value without a callable verifier silently passes; (3) the factory
does not itself measure the configured host executable.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/{live-approval,service,scheduler}.mjs` | Syntax check of changed sources | clean | 0 |
| `node --test test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs` | SSHSIG plumbing + admission result validation + second pre-spawn check (expiry/drift during `worker.prepare` → `blocked`, zero spawn) + host-path measurement | 30 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 366 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Complete change whitespace | no output | 0 |

Result: (1) `createTaskScheduler` now re-checks the receipt synchronously a **second time**
just before `runSubprocess` (after `createTaskWorkspace` + `worker.prepare`); a refusal there
records the already-dispatched task as `blocked` (`executionStopped: unknown`, dispatch
attempt preserved) — never `cancelled`, never replayed. (2) `createTaskService` now requires
an admission result of `{ admitted: true, revalidate }` (a callable verifier bound to the
task); `false`/`true`/`undefined`/`null`/`{admitted:true}` without a verifier are refused
before persistence, and the dispatch hook also fails closed on a missing/invalid receipt.
(3) `createSignedApprovalAdmission` now measures the SHA-256 of the absolute `hostExecutable`
path itself at admission and again at revalidation (no caller-supplied digest/callback); an
unreadable path is refused as `unavailable`. Tests cover drift/expiry during `worker.prepare`
with a marker file asserting zero spawn, and the admission return-value matrix.

Evidence level: unit + local fixture (mock verifier over the real ledger, real
`ssh-keygen -Y verify` refusal paths, a self-measured disposable host executable). The
end-to-end host binding positive path (valid signature → measure → reserve) still requires a
real FIDO2 hardware-key signature and remains `not_run`; the host identity is bound at the
factory interface to the supplied `hostExecutable` path (the caller must pass the configured
worker's executable).

Not rerun / not_run: a real FIDO2 `-sk` hardware-key signing dry run; bare-metal Ubuntu /
two-VM Hyper-V deployment; the active provider WebSocket-bypass experiment; live inference.
The catalog GET remains a dated one-shot snapshot (not repeated here).

Claim: this entry supports the just-before-spawn revalidation, the admission result contract
and the self-measured host-path binding. The hardware positive path, bare-metal/VM
deployment, WebSocket-bypass experiment and live inference remain `not_run` and the live
route stays closed.

## M3 preparation: B30 tie measured host executable to the configured worker — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), OpenSSH `ssh-keygen` (Git for
Windows). Date: 2026-11-15. Corrects the remaining P1 #3 at `9b91845` (review comment
`6898063391`): the measured host path is not tied to the executable the configured worker
actually starts.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/{live-approval,configured-service}.mjs` | Syntax check of changed sources | clean | 0 |
| `node --test test/free-provider.test.mjs test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs` | A/B host-executable composition (negative `A != B` refused, positive `A == B` composes) + prior approval tests | 42 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 368 passed, 0 failed, 1 skipped (Windows-gated platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Complete change whitespace | no output | 0 |

Result: `createSignedApprovalAdmission` exposes the canonical measured executable
(`gate.hostExecutable`, resolved through symlink/junction/alias identity via
`canonicalExecutablePath`), and `createConfiguredTaskService` enforces it equals the
canonical `settings.executable` the configured worker actually starts; a signed admission
measuring A while the worker starts B is refused before any service/task/child exists.
Negative (`A != B`) and positive (`A == B`) composition fixtures are in
`test/free-provider.test.mjs`. The relay/gateway policy-drift and signer-revocation checks at
dispatch remain partial/`not_run` pending a deployed relay/gateway and are not claimed from
the mock fixture.

Evidence level: unit + local fixture (mock signature; no hardware). The full positive
signature path remains `not_run`.

Not rerun / not_run: a real FIDO2 `-sk` hardware-key signing dry run; bare-metal Ubuntu /
two-VM Hyper-V deployment; the active provider WebSocket-bypass experiment; live inference.
The catalog GET remains a dated one-shot snapshot (not repeated here).

Claim: this entry supports tying the measured host executable to the configured worker.
The hardware positive path, deployed relay/gateway policy-drift, bare-metal/VM deployment,
WebSocket-bypass experiment and live inference remain `not_run` and the live route stays
closed.

## M3 preparation: B30 relay/gateway lifecycle symmetry (B30-04) — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm). Date: 2026-11-15. Closes the B30-04
lifecycle gap: the egress gateway previously lacked the failure/lifecycle fixtures the relay
already had (port conflict, terminal stop/restart, port release, upstream timeout, partial
body drop).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/relay.test.mjs test/egress-gateway.test.mjs` | Relay + gateway lifecycle and refusal fixtures | 36 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial local suite regression | 372 passed, 1 failed (pre-existing flaky `mcp-server` B15-03b 3s submit timeout under load; passes in isolation 30/30), 1 skipped | 1 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Complete change whitespace | no output | 0 |

Result: `test/egress-gateway.test.mjs` now covers, with temporary loopback HTTP origins only:
port-conflict refusal, terminal `stop()` with restart refusal, `stop()` releasing the port
(no dangling unowned listener, proven by a second gateway binding it), an upstream timeout
latched to `upstream-unavailable` with exactly one origin request (no replay), and an
upstream partial-body drop that latches `response-stream` without replay. These mirror the
relay's existing B30-04 fixtures, so the gateway is no longer tested only on the green path.
The full serial suite has one pre-existing flaky failure (`test/mcp-server.test.mjs`
`B15-03b`, a 3-second `submit_task` response timeout that intermittently exceeds the bound
under full-suite serial load); it passes 30/30 in isolation and is unrelated to these
gateway-lifecycle changes.

Evidence level: local loopback HTTP fixture (temporary child/process/port fixtures), not a
deployed relay/gateway and not a live provider.

Not rerun / not_run: relay/gateway service-level uncertain-child-stop integration (the relay
and gateway are standalone listeners, not service children, so no uncertain child-stop path
exists in this architecture); upstream DNS failure and TLS-failure latches (DNS requires an
external resolver query; the gateway's live-mode TLS hostname validation requires an HTTPS
real hostname, which is not testable offline without DNS/hosts changes or broadening the
network surface); the full cross-namespace TLS chain (needs a pinned Linux OpenCode binary
and a deployed gateway).

Claim: this entry supports the relay/gateway lifecycle symmetry. Uncertain child stop, DNS/
TLS-failure latches, the cross-namespace TLS chain, bare-metal/VM deployment and live
inference remain `not_run` and the live route stays closed.

## M3 preparation: B30 listener supervision and offline gateway TLS fixtures (B30-04/07) — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm, `%APPDATA%\fnm\node-versions\v24.22.1`), with Git for Windows `usr/bin/openssl` 3.5.7 on PATH for the TLS fixtures. Date: 2026-11-15. Scope: offline loopback fixtures for the supervised relay/gateway listener child (ownership lock, uncertain stop, ready timeout, port conflict, reconciliation, orphan stop) and the gateway's DNS/TLS fail-closed latches with a disposable CA. Base for comparison: `eb4968d` (clone checked out in `%TEMP%`, removed afterwards).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/listener-supervisor.test.mjs test/gateway-tls.test.mjs test/egress-gateway.test.mjs test/relay.test.mjs` | Focused: supervisor (8), offline TLS (6), gateway and relay lifecycle/refusal (36) | 50 pass / 0 fail / 0 skip | 0 |
| `node --test test/gateway-tls.test.mjs` | TLS fixtures alone; confirms each run removes its disposable certificate directory | 6 pass / 0 fail / 0 skip; no `b30-tls-*` directory left | 0 |
| `node --test --test-concurrency=1` | Full serial suite regression on the corrected head | 388 tests: 387 pass, 0 fail, 1 skip (the pre-existing POSIX-only or platform skip) | 0 |
| `node --test` | Full suite at default concurrency (as CI invokes it) | 8 test locations failed with timing assertions: `mcp-server.test.mjs` 146, 164, 188, 207 (B15-01c/d/e/f), 513 (B15-03b), `scheduler.test.mjs` 60 (B12-01), `subprocess.test.mjs` 64 (B10-03), `task-maintenance.test.mjs` 195 (B18-01); the same eight locations fail at base `eb4968d` (below) | 1 |
| `node --test` (base `eb4968d`, separate clone) | Pre-existing comparison for the default-concurrency failures | Same eight test locations fail; exit 1 | 1 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Whitespace in the complete change, including new files | no output | 0 |

Result: the new gateway and supervisor behavior passes in focused and serial runs (50 focused; 388 serial with 387 pass, 0 fail, 1 skip). The default-concurrency run fails at the same eight timing-sensitive locations as the untouched base commit, so those failures are a pre-existing parallel-load flake and not evidence against this change; a serial run is the reproducible baseline. Their names are recorded so that no run is reported as all green. The fallback demo returns 429 then 200, and `git diff --check` is clean.

Mutation check (scratch copy outside the repository, not versioned, so not a table row): releasing the lock on an unconfirmed stop made `test/listener-supervisor.test.mjs` fail the uncertain-stop test (lock file missing), and collapsing DNS and TLS failures into `upstream-unavailable` made four tests fail (untrusted certificate, hostname mismatch, DNS failure, and the classification unit test). Both defects are therefore detected by the new tests.

Evidence level: Local HTTP — demonstrates real HTTP and HTTPS headers, statuses and refusals through controlled loopback fixtures, real child processes with IPC, real lock files and a disposable CA verified by Node's default TLS validation (with a test-only resolver that maps three fixture names to loopback in the child only); does not demonstrate real OpenCode tools or sessions, a deployed relay or gateway, a real DNS resolver, a real trust store, a real origin, or the cross-namespace TLS chain. The relay and gateway remain unwired from `createConfiguredTaskService`.

Not rerun: `integration/b30-egress-namespaces.sh` (privileged WSL netns/nftables fixture; this change does not modify it and it was not rerun here); `integration/opencode-free-relay.mjs` (needs the pinned OpenCode 2.2.5 binary outside the repository; the gateway change touches only failure classification and live-mode gating, and the fixture-mode path is covered by `test/egress-gateway.test.mjs`); `node integration/opencode-smoke.mjs` and `node integration/mcp-gate.mjs` (pinned binary; unrelated); the expired or not-yet-valid certificate case (not covered; the generator uses a fixed two-day window); the deployed cross-namespace TLS chain, a real resolver or origin (`not_run`); the active WebSocket-bypass experiment, bare-metal or two-VM deployment, a real FIDO2 hardware signature, the public catalog GET and live inference (all `not_run`, unchanged); the Ubuntu CI job for this head (pending at the time of writing).

Claim: This entry supports offline, loopback-only evidence that a supervised relay or gateway listener keeps its port and lock on an unconfirmed stop, releases them only after a confirmed exit or an explicit reconciliation, and that the gateway fails closed with distinct DNS and TLS latches, based on `node --test test/listener-supervisor.test.mjs test/gateway-tls.test.mjs` and the serial suite. It does not support any deployed TLS chain, network containment, real DNS or origin behavior, live activation, or an OpenCode integration claim, which require the missing deployment, hardware and pinned-host evidence listed above.

## M3 preparation: B30 catalog-evidence continuity correction — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), Git for Windows `usr/bin` on PATH. Date: 2026-11-15. Documentation-only correction after the supervisor P2 review of `4cdc088` (PR comment `6899620770`). The catalog GET status was carried as `not_run` in new handoff, backlog, roadmap, ADR, task-contract and PR-body text, although one bounded public catalog GET was already performed at `8e358a4` (receipt: the `M3 preparation: B30 signed-approval pre-spawn revalidation + host/readable binding (B30-05) — 2026-11-15` section, row at line 2862: HTTP 200, 104,821 bytes). This correction makes no network request and does not repeat the GET.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test test/listener-supervisor.test.mjs test/gateway-tls.test.mjs test/egress-gateway.test.mjs test/relay.test.mjs` | Source is unchanged; confirms the offline supervisor, TLS and gateway fixtures still pass with the documents corrected | 50 pass / 0 fail / 0 skip | 0 |
| `git diff --check` (staged change) | Whitespace in the documentation-only change | no output | 0 |

Result: the focused offline suite passes unchanged (50 pass, 0 fail), and the whitespace check is clean. A one-off grep of the added lines for `catalog` (not versioned, so not a table row) found that every added catalog line states the `8e358a4` GET as performed once, dated and not repeated, or says a fresh read needs separate narrow authorization. The added catalog text is consistent with the `8e358a4` receipt. The 2026-11-14 bullets that still say "catalog GET not_run" or "catalog read before any live experiment" are historical, and each now carries a dated note or sits under a section marked superseded. Earlier entries in `docs/validation.md` and `docs/worklog.md` are left unchanged, including the `4cdc088` entry's catalog wording, which this entry supersedes for status purposes.

Evidence level: no new evidence level. The focused run re-executes the Local HTTP offline fixtures from `4cdc088` (loopback processes, real child IPC and a disposable CA) without any source change. This entry claims documentation consistency only.

Not rerun: full serial and default-concurrency suites (no source or test file changed since the serial run recorded at `4cdc088`; see that entry); fallback demo (no executable behavior changed); the catalog GET (not repeated by policy, and no network request was made in this correction); live inference, provider calls, FIDO2 hardware signing, WebSocket-bypass experiment, bare-metal/VM deployment and the deployed TLS chain (all `not_run`, unchanged).

Claim: This entry supports that the new handoff, backlog, roadmap, ADR-010 amendment, task-contract and PR text state the catalog GET as performed once at `8e358a4` (dated snapshot, not repeated), based on the static grep above and the `docs/validation.md` receipt. It does not support a fresh catalog read, any live inference authorization, or any deployed or FIDO2 gate, which require their own authorization and evidence.

## M3 preparation: B30 fixture-only supervised composition and second catalog snapshot — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), Git for Windows `usr/bin` (openssl 3.5.7) on PATH. Date: 2026-11-15. Wires the supervised relay → gateway chain into `createConfiguredTaskService` through the fixture-only `freeListeners` option, and records one bounded public catalog GET that the user authorized for this correction. No live, provider, FIDO2, WebSocket, VM, host-network or paid action was taken.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/free-listeners.mjs`, `src/configured-service.mjs`, `src/live-approval.mjs` | Syntax of changed sources | clean | 0 |
| one-shot catalog check (unversioned scratch script that imports `fetchFreeMetadata` and calls it once, with no retry) | Bounded public metadata read of `https://opencode.ai/inference/v1/models` | validated at `2026-11-15T19:14:36.242Z`; selected `deepseek-v4.1-flash-free`, `chat`, `owned_by` `opencode`, tools supported, zero price for text input, text output and cache read, base URL and SDK package equal to the fixed values; HTTP 2xx (`response.ok`), status not separately recorded | 0 |
| `node --test test/free-listeners.test.mjs` | Nine fixture-only composition tests (approval and digest gates, launch refusal, uncertain cleanup with reconciliation, close and restart, crash-to-blocked, task-text isolation) | 9 pass / 0 fail / 0 skip | 0 |
| `node --test test/free-provider.test.mjs test/b29-cli-composition.test.mjs test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs test/free-listeners.test.mjs test/listener-supervisor.test.mjs test/gateway-tls.test.mjs test/egress-gateway.test.mjs test/relay.test.mjs` | Composition, approval, B29 and B30 focused set | 104 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` (first run) | Full serial suite on the final code | 1 fail: `test/mcp-server.test.mjs` `B15-01f` (`cancel_task` output wait, `timeout waiting for 1 output line(s)`), the pre-existing MCP output-wait flake; not caused by this change | 1 |
| `node --test --test-concurrency=1` (rerun, same code) | Full serial suite rerun | 397 tests: 396 pass, 0 fail, 1 skip (the pre-existing platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --cached --check` | Whitespace in the complete change | no output | 0 |

Result: the new composition path passes all nine focused tests, and the composition, approval, B29 and B30 focused set passes 104 of 104. The serial suite failed once on the known MCP output-wait flake (`B15-01f`) and passed on rerun, 396 pass, 0 fail, 1 skip. Both runs are recorded; the first is not hidden. Two development defects were corrected during the work: a test submitted a request whose idempotency key differed from the approved request (the approval binds the canonical request hash, so the worker correctly refused it), and a failed test left listener children alive, which kept the runner waiting. The test now closes its service in `finally`. The first catalog attempt failed at module resolution before any function ran, so it made no network request; the successful attempt is the single GET. The second catalog GET is dated, is not repeated, and authorizes no live inference.

Evidence level: Local HTTP — the composition tests use real child processes with IPC, real loopback ports and lock files, and real git fixtures; the signed-admission gate is a labelled test double that carries the policy digests only, so the cryptographic SSHSIG path is not exercised. The public catalog GET is a dated external metadata observation, not an integration or deployment evidence level; it does not establish any deployed behavior.

Not rerun: `node --test` at default concurrency (the known parallel-load timing failures were recorded at `4cdc088` and at base `eb4968d`; no change in this run was attributed to them); `integration/b30-egress-namespaces.sh` (privileged WSL, unchanged); `integration/opencode-free-relay.mjs` and the pinned OpenCode 2.2.5 harnesses (pinned binary outside the repository); the deployed TLS chain, real resolver, trust store and origin (`not_run`); expired and wrong-host certificates against a real origin (`not_run`); the FIDO2 positive signature (`not_run`); the active provider WebSocket-bypass experiment (`not_run`); bare-metal or two-VM deployment (`not_run`); live inference, paid calls and any further catalog read (not authorized).

Claim: This entry supports that the supervised relay and gateway can be composed into the trusted service only through the fixture-only `freeListeners` option, which refuses without an approved run and matching digests, stops on failure, keeps uncertain locks and blocks dispatch on listener loss, based on the nine focused tests and the serial rerun. It also supports that the 2026-11-15 catalog metadata was validated as zero-price for the fixed model at the recorded time. It does not support deployed relay placement, a real TLS chain, FIDO2 signing, isolation on a separate host, WebSocket-bypass exclusion, live activation, ready-for-review or merge, which require the `not_run` evidence listed above.

## M3 preparation: B30 composition close-path final rerun — 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm), Git for Windows `usr/bin` (openssl 3.5.7) on PATH. Date: 2026-11-15. Records the final code after the second self-review of the composition: `close()` now stops the supervised listeners on a rejected scheduler close as well as on success.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/configured-service.mjs` | Syntax of the changed composition | clean | 0 |
| `node --test test/free-provider.test.mjs test/b29-cli-composition.test.mjs test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs test/free-listeners.test.mjs test/listener-supervisor.test.mjs test/gateway-tls.test.mjs test/egress-gateway.test.mjs test/relay.test.mjs` | Composition, approval, B29 and B30 focused set on the final code | 104 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial suite on the final code | 397 tests: 396 pass, 0 fail, 1 skip | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |

Result: the final code passes the 104-test focused set, the 397-test serial suite (396 pass, 0 fail, 1 skip) and the demo. The rejected-close branch (`listeners.stop()` after a failed scheduler `close()`) is not exercised by a test: forcing the scheduler's close to reject needs a seam that does not exist, so that branch is reviewed by inspection only and is recorded as a limit. The earlier serial run with the MCP `B15-01f` flake is recorded in the preceding entry and is not repeated here.

Evidence level: Local HTTP, unchanged from the preceding entry. Not rerun: default-concurrency suite, WSL fixture, pinned OpenCode host harnesses, deployed TLS, FIDO2, WebSocket-bypass, VM and live gates (`not_run`).

Claim: This entry supports that the final composition code passes the focused, serial and demo checks, based on the commands above. It does not support the rejected-close branch under test, deployed relay placement, a real TLS chain, FIDO2 signing, WebSocket-bypass exclusion, live activation, ready-for-review or merge.

## M3 preparation: B30 listener ownership and startup authority correction – 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm) with Git for Windows `usr/bin` (openssl 3.5.7 and `ssh-keygen`) on PATH.
Date: 2026-11-15.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/service.mjs`, `src/configured-service.mjs`, `src/free-listeners.mjs`, `test/free-listeners-authority.test.mjs`, `integration/listener-fixture-child.mjs` | Syntax of every changed source, test and fixture | clean | 0 |
| `node --test test/free-listeners-authority.test.mjs` | Ownership-before-bind, corrupt store, ownership-held composition, real-gate refusal matrix, close-time uncertainty and failed-startup cleanup uncertainty | 8 pass / 0 fail / 0 skip | 0 |
| `node --test test/free-listeners-authority.test.mjs test/free-listeners.test.mjs test/free-provider.test.mjs test/b29-cli-composition.test.mjs test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs test/listener-supervisor.test.mjs test/gateway-tls.test.mjs test/egress-gateway.test.mjs test/relay.test.mjs` | Composition, approval, B29 and B30 focused set | 112 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial suite on the final code | 405 tests: 404 pass, 0 fail, 1 skip (the pre-existing platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Whitespace in the complete change | no output | 0 |

Result: the ownership/authority test file passes eight of eight, including a competing task-home owner and a corrupt store that each start zero listener children and create zero listener ports or locks, ownership held while listeners run, a real signed-approval gate that refuses a missing signature and (with a disposable non-hardware key) malformed, non-FIDO2 and forged signatures with zero task, workspace or worker effect, a close-time unconfirmable stop that rejects, keeps the task-home and both listener locks, and refuses a second composition, and a failed startup whose cleanup `stop` cannot be confirmed, which also keeps the task-home owner and the started listener's lock. The focused composition/approval/B29/B30 set passes 112 of 112 and the full serial suite passes 404 of 405 with one pre-existing skip. The demo prints 429 then 200 and `git diff --check` is clean.

Evidence level: Local HTTP – real child processes with IPC, real loopback ports and durable lock files, plus the real `ssh-keygen -Y verify` gate with a disposable non-hardware test key. It covers refusals and no-effect assertions only; it does not demonstrate a positive FIDO2/hardware signature, deployed relay/gateway placement, a real TLS chain, OS isolation or live inference.

Exact-head CI for `b9e8483` (workflow run `43760697682`) succeeded on both `windows-latest` and `ubuntu-latest`; the only non-success step annotations are the intentional `continue-on-error` pipeline-exit fixtures (exit 7). The docs-only receipt commit that records this is verified by its own exact-head PR run.

Not rerun: `node --test` at default concurrency (the known parallel-load timing failures were recorded at `4cdc088` and at base `eb4968d`; the serial run above is the claimed result); `integration/b30-egress-namespaces.sh` (privileged WSL, unchanged); `integration/opencode-free-relay.mjs` and the pinned OpenCode 2.2.5 harnesses (pinned binary outside the repository); the deployed TLS chain, real resolver, trust store and origin (`not_run`); expired and wrong-host certificates against a real origin (`not_run`); the FIDO2 positive signature dry run (`not_run`); the active provider WebSocket-bypass experiment (`not_run`); bare-metal or two-VM deployment (`not_run`); live inference, paid calls and any catalog read (not authorized; the dated snapshots were not repeated).

Claim: This entry supports that supervised listener startup now requires exclusive task-home ownership and reconciliation first, holds that ownership through a confirmed stop (including a failed startup whose cleanup cannot be confirmed), and reports a separate trusted-composition startup authority rather than an SSHSIG, based on `node --test test/free-listeners-authority.test.mjs` and the focused set. It also supports that the real gate refuses missing and forged task signatures with zero task/workspace/worker effect. It does not support a positive hardware/FIDO2 signature, deployed containment, the deployed TLS chain, WebSocket-bypass exclusion, live activation, ready-for-review or merge, which require the `not_run` evidence listed above.

## M3 preparation: B30 ownership handoff capability correction – 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm) with Git for Windows `usr/bin` (openssl 3.5.7 and `ssh-keygen`) on PATH.
Date: 2026-11-15.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/service.mjs`, `src/configured-service.mjs`, `test/service-ownership-handoff.test.mjs` | Syntax of every changed source and test | clean | 0 |
| `node --test test/service-ownership-handoff.test.mjs test/service-owner.test.mjs` | Forged/copied/reused/released/mismatched/competing-owner handoff and the existing B12 owner tests | 9 pass / 0 fail / 0 skip | 0 |
| `node --test test/free-listeners-authority.test.mjs test/free-listeners.test.mjs test/free-provider.test.mjs test/b29-cli-composition.test.mjs test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs test/listener-supervisor.test.mjs test/gateway-tls.test.mjs test/egress-gateway.test.mjs test/relay.test.mjs test/service-ownership-handoff.test.mjs test/service-owner.test.mjs` | Composition, approval, B29, B30 and ownership focused set | 121 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial suite on the final code | 412 tests: 411 pass, 0 fail, 1 skip (the pre-existing platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Whitespace in the complete change | no output | 0 |

Result: the new ownership-handoff file passes seven of seven with real store and lock fixtures. A forged `{ store, releaseOwner }` object is refused with `invalid_argument` while service A owns the home, its forged release is never called, A keeps the lock and remains the only writer, and a default second service is still refused. A spread copy, a reconstructed store/release pair and a capability with an extra `store` option are refused without consuming or releasing the real capability. A minted capability is single-use before and after close, a released capability cannot be handed off and leaves the home free, a capability for another home is refused without locking or releasing either home, and a second `openTaskHome` beside an active owner is refused without changing the lock bytes. A throwing `beforeRelease` makes `close()` reject, retains the owner lock, keeps the capability unusable and refuses both handoff and a new legitimate owner; only the test's maintainer-style removal of the retained lock allows recovery. The existing B12 owner tests and the B29/B30 focused set pass (121 of 121) and the full serial suite passes 411 of 412 with one pre-existing skip.

Two earlier serial attempts failed once each on known output-wait/timing flakes (`B15-03b` concurrent status polls and `B10-03` abort partial output) and the third run above passed; the passing run is the claimed result, and the initial failures are not erased. The focused set and the new file passed on every run.

Evidence level: Local process and durable-file evidence. It covers the lock/capability boundary, close/release uncertainty and refusal assertions only; it does not demonstrate deployed relay/gateway placement, a real TLS chain, OS isolation, a positive FIDO2 signature or live inference.

Not rerun: `node --test` at default concurrency locally (the known parallel-load timing failures were recorded at `4cdc088` and base `eb4968d`; CI runs it); `integration/b30-egress-namespaces.sh` (privileged WSL, unchanged); `integration/opencode-free-relay.mjs` and the pinned OpenCode 2.2.5 harnesses (pinned binary outside the repository); the deployed TLS chain, real resolver, trust store and origin (`not_run`); expired and wrong-host certificates (`not_run`); the FIDO2 positive signature dry run (`not_run`); the active provider WebSocket-bypass experiment (`not_run`); bare-metal or two-VM deployment (`not_run`); live inference, paid calls and any catalog read (not authorized; the dated snapshots were not repeated).

Claim: This entry supports that pre-acquired task-home ownership can no longer be forged or replayed through `createTaskService`, that the configured listener path still starts only after the exclusive lock and reconciliation, and that ownership is retained when release cleanup is uncertain, based on `test/service-ownership-handoff.test.mjs`, the existing owner tests and the focused set. It does not support any positive FIDO2 signature, deployed containment, the deployed TLS chain, WebSocket-bypass exclusion, live activation, ready-for-review or merge, which require the `not_run` evidence listed above.

Exact-head CI for `0c90518` (workflow run `43764489116`) succeeded on both `windows-latest` and `ubuntu-latest`; the only non-success step annotations are the intentional `continue-on-error` pipeline-exit fixtures. The docs-only receipt commit that records this is verified by its own exact-head PR run.

## M3 preparation: B30 release-authority transfer correction – 2026-11-15

Executed on Windows 11 Pro x64, Node.js v24.22.1 (fnm) with Git for Windows `usr/bin` on PATH.
Date: 2026-11-15.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --check src/service.mjs`, `src/configured-service.mjs`, `test/service-ownership-handoff.test.mjs` | Syntax of every changed source and test | clean | 0 |
| `node --test test/service-ownership-handoff.test.mjs test/service-owner.test.mjs` | Early creator release, close idempotency, cleanup ordering, failed construction, forged/copied/reused/released/mismatched/competing-owner and the existing B12 owner tests | 13 pass / 0 fail / 0 skip | 0 |
| Standalone reproduction (`cap = openTaskHome`; `service = createTaskService({ ownership: cap })`; `await cap.releaseOwner()`; `createTaskService({ home })`) with a disposable home outside the repository | Exact reviewer trigger | `earlyReleaseRefused=invalid_argument`, `firstServiceStillActive=true`, `lockStillHeld=true`, `secondServiceCreated=false` (error `unavailable`), `lockAfterClose=false`, `afterCloseReleaseRefused=invalid_argument`, restart acquired | 0 |
| `node --test test/free-listeners-authority.test.mjs test/free-listeners.test.mjs test/free-provider.test.mjs test/b29-cli-composition.test.mjs test/live-approval.test.mjs test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs test/listener-supervisor.test.mjs test/gateway-tls.test.mjs test/egress-gateway.test.mjs test/relay.test.mjs test/service-ownership-handoff.test.mjs test/service-owner.test.mjs` | Composition, approval, B29, B30 and ownership focused set | 125 pass / 0 fail / 0 skip | 0 |
| `node --test --test-concurrency=1` | Full serial suite on the final code | 416 tests: 415 pass, 0 fail, 1 skip (the pre-existing platform skip) | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo regression | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Whitespace in the complete change | no output | 0 |

Result: release authority now transfers at consumption. The creator-facing `releaseOwner` is valid only while the capability is minted and unconsumed; after `createTaskService` consumes it, an early or concurrent creator release is refused with `invalid_argument`, the active service keeps its lock and remains the only writer, and a second ordinary service is refused with `unavailable`. The service's private close path releases after scheduler idle and after `beforeRelease` cleanup, which runs while ownership is still held. Repeated `close()` calls share one release operation, a throwing `beforeRelease` still retains the lock and leaves the capability unusable, and a failed construction returns the unconsumed capability to its creator so its documented cleanup (including `beforeRelease`) can release. The existing B12 owner tests and the B29/B30 focused set pass (125 of 125); the full serial suite passes 415 of 416 with one pre-existing skip.

Two earlier serial attempts failed on the known pre-existing timing flakes: the first on `B15-03b` (concurrent status polls) and `B10-03` (abort partial output), the second on `B15-03b` again; the third run above passed. The passing run is the claimed result, and the initial failures are not erased. The focused set and the new file passed on every run.

Evidence level: Local process and durable-file evidence. It covers the release-authority boundary, close/release uncertainty, cleanup ordering and refusal assertions only; it does not demonstrate deployed relay/gateway placement, a real TLS chain, OS isolation, a positive FIDO2 signature or live inference.

Not rerun: `node --test` at default concurrency locally (the known parallel-load timing failures were recorded at `4cdc088` and base `eb4968d`; CI runs it); `integration/b30-egress-namespaces.sh` (privileged WSL, unchanged); `integration/opencode-free-relay.mjs` and the pinned OpenCode 2.2.5 harnesses (pinned binary outside the repository); the deployed TLS chain, real resolver, trust store and origin (`not_run`); expired and wrong-host certificates (`not_run`); the FIDO2 positive signature dry run (`not_run`); the active provider WebSocket-bypass experiment (`not_run`); bare-metal or two-VM deployment (`not_run`); live inference, paid calls and any catalog read (not authorized; the dated snapshots were not repeated).

Claim: This entry supports that the capability creator can no longer release an active service's task-home lock, that only the consuming service's close releases after scheduler idle and `beforeRelease` cleanup, and that failed-construction and uncertain-cleanup behavior is preserved, based on `test/service-ownership-handoff.test.mjs`, the standalone reproduction and the focused set. It does not support any positive FIDO2 signature, deployed containment, the deployed TLS chain, WebSocket-bypass exclusion, live activation, ready-for-review or merge, which require the `not_run` evidence listed above.

Exact-head CI for `352c212` (workflow run `43768061960`) succeeded on both `windows-latest` and `ubuntu-latest`; the only non-success step annotations are the intentional `continue-on-error` pipeline-exit fixtures. The docs-only receipt commit that records this is verified by its own exact-head PR run.

## M3 preparation: B30 two-VM Hyper-V deployment (worker compartment and relay egress) – 2026-11-15

Executed on Windows 11 Pro x64 with Hyper-V and two Ubuntu Server 24.04.5 guests (`B30-Worker`,
`B30-Relay`, kernel `6.8.0-139-generic`). Date: 2026-11-15; the guest logs are stamped
`2026-11-16T01:41:29Z` (relay) and `2026-11-16T01:43:13Z` (worker).

Method and limits of this run: the agent session was **not** elevated, so every Hyper-V and
host-network command was executed by the host operator in an administrator PowerShell, while the
agent read host state through its own tools. No guest was reachable over the network: guest
commands travelled on FAT32 VHDX media hot-attached at SCSI 0/2 (`B30CFG`, netplan) and SCSI
0/3 (`B30PROBE`, probes), and each guest wrote its own log back onto that volume, which the agent
then read from the host. Nothing below was transcribed by hand from a console, and no guest
shell, package installation or copy/paste was used.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `Get-VMSwitch`, `Get-NetNat`, `Get-Service SharedAccess` plus an ICS registry read | Host topology and no-NAT/no-ICS invariants | `B30-Worker-Relay` and `B30-Relay-Gateway`, both `Internal`, `NetAdapterInterfaceDescription` empty; the third switch `WSL (Hyper-V firewall)` is Internal, belongs to WSL and carries no B30 adapter; `Get-NetNat` empty; `SharedAccess` running with `ICS_Private`/`ICS_Public`/`ICS_Configuration` absent, zero `192.168.137.*` addresses and zero `SharedAccess` keys naming a B30 adapter | 0 |
| `Get-VMNetworkAdapter -VMName 'B30-Worker','B30-Relay'` | Adapter-to-switch map | worker `worker-relay` `00:15:5D:64:5F:02` -> `B30-Worker-Relay` (its only adapter); relay `relay-worker` `00:15:5D:64:5F:03` -> `B30-Worker-Relay`; relay `relay-gateway` `00:15:5D:64:5F:04` -> `B30-Relay-Gateway` | 0 |
| `Get-NetIPAddress`, `Get-NetIPInterface`, `Get-NetRoute` on the host | Host-side invariants after guest setup | `10.30.2.1/30` Manual on `vEthernet (B30-Relay-Gateway)` with `Forwarding=Disabled`; `vEthernet (B30-Worker-Relay)` `Disabled` with no IPv4 address; no route to `10.30.1.0/30` | 0 |
| `sudo mount -L B30CFG /mnt && sudo bash /mnt/setup.sh` (operator-typed, one line per console) | Apply the recorded netplan | relay `eth0 10.30.1.1/30`, `eth1 10.30.2.2/30`; worker `eth0 10.30.1.2/30`; no default route, no DNS server, `net.ipv4.ip_forward=0`, `net.ipv6.conf.all.forwarding=0` | 0 |
| `sudo mount -L B30PROBE /media/b30 && sudo bash /media/b30/probe.sh` (relay first, then worker) | Real socket attempts from inside each compartment | two logs of 3,162 B and 2,996 B written by the guests themselves; excerpts below | 0 |
| Key removal inside `probe.sh` | Remove the temporary deployment key | `B30_SSH_KEY_REMOVED=/root/.ssh/authorized_keys` and `/home/b30/.ssh/authorized_keys` on both guests | 0 |

Worker log (`b30-probe-b30-worker.log`, SHA-256
`4C4F0C0548AA512B0D84E606640F28B369F77F13A2F6BBAD2BFDA50632DCB099`), verbatim probe lines:

```
### worker to relay icmp 10.30.1.1 (expect reachable)
1 packets transmitted, 1 received, 0% packet loss, time 0ms   EXIT=0
### tcp 10.30.1.1:22
bash: connect: Connection refused                            EXIT=1
### worker to host gateway icmp 10.30.2.1 (expect denied)
ping: connect: Network is unreachable                        EXIT=2
### tcp 10.30.2.1:443
Network is unreachable                                       EXIT=1
### worker to internet icmp 1.1.1.1, tcp 1.1.1.1:443, 93.184.216.34, dns, ipv6
Network is unreachable (each EXIT=2 or EXIT=1)                denied
```

Relay log (`b30-probe-b30-relay.log`, SHA-256
`53BBA405904A95E82CAF6F5E27C8D4B08FFE3AD5EC0DE6CAC6CFE33108A9712C`), verbatim probe lines:

```
### relay to worker icmp 10.30.1.2 (expect reachable)
1 packets transmitted, 1 received, 0% packet loss, time 0ms   EXIT=0
### relay to internet icmp 1.1.1.1
ping: connect: Network is unreachable                        EXIT=2
### tcp 1.1.1.1:443 and tcp 8.8.8.8:53
Network is unreachable                                       EXIT=1
### relay to alternate origin 93.184.216.34, dns, ipv4 route, ipv6 route
Network is unreachable (each EXIT=2 or EXIT=1)                denied
### forwarding                                             ip_forward = 0
```

The worker reaches the relay on the internal link and has no route to anything else: the host
gateway, two Internet addresses, DNS resolution and IPv6 are all `Network is unreachable`, which
is the routing result, not a filtered timeout. The relay reaches the worker and reaches nothing
off-link. Neither guest has a default route or a DNS server, and both keep forwarding disabled.
The `Connection refused` on relay port 22 is the useful positive control: the packet reached the
relay's stack and got a reset, so the internal link works end to end while no service listens on
it.

**Deviation, recorded rather than explained away:** the relay's ICMP echo to the host gateway
`10.30.2.1` received no reply (`1 packets transmitted, 0 received, 100% packet loss`) although
the host pinged the relay successfully. Read-only host checks show `vEthernet
(B30-Relay-Gateway)` in connection profile `Rede nao identificada` with `NetworkCategory
Public`, the Public firewall profile enabled with `DefaultInboundAction NotConfigured` (block),
the built-in `Solicitacao de Eco (ICMPv4-In)` rules present but not enabled, and no enabled
inbound ICMPv4 allow rule other than destination-unreachable fragmentation. Kaspersky is
registered as both an antivirus and a firewall product, so a third-party filter cannot be
excluded from this evidence alone; separating the two would need an administrator WFP capture,
which was **not** run, and nothing was changed on the firewall. The consequence for the design
is recorded in [deployment-prerequisites.md](deployment-prerequisites.md): a host-side L7
gateway on this adapter needs an explicit inbound allow rule scoped to the relay address,
because the default inbound policy on a Public-profile adapter otherwise drops the relay's
connections.

Evidence level: **deployed two-VM OS-level containment observation**, with the caveats stated
above. It is stronger than the WSL2 netns fixture for the worker compartment because that
compartment is a real VM and the probes ran inside it; it does not become integration evidence
for the relay/gateway TLS chain.

Supported by this entry: B30-03's Windows two-VM topology, its no-Default-switch/no-NAT/no-ICS/
no-forwarding conditions, its single worker NIC and route inventory, and real denied socket
attempts from inside the worker compartment; and B30-07's relay-side direct-egress denial
(IPv4, IPv6, DNS and two alternate origins, with real exits).

Not supported by this entry: the host-side L7 gateway itself. No gateway policy or digest was
deployed, no relay-to-gateway TLS connection was made, and there are no gateway ingress logs
showing zero alternate-origin bytes. The WebSocket-upgrade negative was not repeated inside the
VM; the pinned-host negative fixture recorded in the 2026-11-15 active-egress-negatives entry
stands for that path.

Not rerun: `integration/b30-egress-namespaces.sh` (privileged WSL fixture, unchanged);
`node --test` and the focused sets (this change is documentation only; the last recorded result
remains 415 of 416 with one pre-existing skip at `352c212`); `integration/opencode-free-relay.mjs`
and the pinned OpenCode 2.2.5 harnesses (pinned binary outside the repository); the deployed TLS
chain, real resolver, trust store and origin (`not_run`); expired and wrong-host certificates
(`not_run`); the FIDO2 positive signature dry run (`not_run`); the active provider
WebSocket-bypass experiment (`not_run`); live inference, paid calls and any catalog read (not
authorized).

Claim: this entry supports that a real Windows two-VM compartment with the ADR-010 internal-only
topology denies the worker direct IPv4, IPv6, DNS and alternate-origin egress while the worker
still reaches the relay, and that the relay has no egress of its own, based on guest-written logs
collected from the attached media and on administrator-collected host inventory. It does not
support a deployed gateway policy, a deployed TLS chain, a positive FIDO2 signature,
WebSocket-bypass exclusion, live activation, ready-for-review or merge.

## M3 preparation: B30 two-VM WebSocket-upgrade and unapproved-port probes – 2026-11-15

Executed on the same two Hyper-V guests as the preceding entry (`B30-Worker`, `B30-Relay`, Ubuntu
Server 24.04.5, kernel `6.8.0-139-generic`). Date: 2026-11-15; the guest logs are stamped
`2026-11-16T02:18:46Z` (relay) and `2026-11-16T02:21:03Z` (worker). This entry closes the remaining
B30-03 probe row (WebSocket upgrade and unapproved port from inside the compartment) and says nothing
new about B30-07.

Method: a second FAT32 VHDX round, labelled `B30WS`, carried one `probe2.sh`
(SHA-256 `CF17EB9BF46F40C4A5F91CC95D41D54DB87C19C9383141AEAFFBC0366238D2AE`). It was hot-attached at
SCSI 0/3 on both running guests, and each guest wrote its own log back onto the same volume. The
operator typed one line per console
(`sudo mkdir -p /media/b30 && sudo mount -L B30WS /media/b30 && sudo bash /media/b30/probe2.sh`),
relay first and then worker; nothing was transcribed by hand. The volumes were hot-detached
afterwards and read on the host through WSL `--mount --vhd <path> --partition 1`, copying
`b30-wsprobe-*.log` into `%TEMP%\opencode\b30-collected`; the two VHDX files and the staging
directory were then deleted and `C:\B30-VMs\_media` removed as empty.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `sudo mount -L B30WS /media/b30 && sudo bash /media/b30/probe2.sh` on the relay | Textual WebSocket upgrade to two off-link origins plus TCP to two unapproved ports on the worker link | relay log 741 B; both upgrades `Network is unreachable`; both unapproved ports `Connection refused` | 0 |
| The same line on the worker | Textual WebSocket upgrade to two off-link origins plus TCP to two unapproved ports on the relay link | worker log 939 B; both upgrades `Network is unreachable`; both unapproved ports `Connection refused` | 0 |
| Host detach + `wsl --mount --vhd ... --partition 1` + copy + uninstall | Read the guest-written logs without guest shell or console typing | both logs copied intact and end with `B30_WSPROBE_LOG_END`; media deleted afterwards | 0 |

Relay log (`b30-wsprobe-b30-relay.log`, 741 B, SHA-256
`D4E5188182C3C6036373F9BA54D22340D11E72639257B03F534C1E911587B8FB`), verbatim probe lines:

```
### websocket upgrade attempt: alternate origin, plaintext upgrade (93.184.216.34:80)
bash: connect: Network is unreachable
bash: line 1: /dev/tcp/93.184.216.34/80: Network is unreachable          EXIT=11
### websocket upgrade attempt: internet, plaintext upgrade (1.1.1.1:80)
bash: connect: Network is unreachable
bash: line 1: /dev/tcp/1.1.1.1/80: Network is unreachable                EXIT=11
### tcp 10.30.1.2:18099                                                  EXIT=1
bash: connect: Connection refused
### tcp 10.30.1.2:8080                                                   EXIT=1
bash: connect: Connection refused
```

Worker log (`b30-wsprobe-b30-worker.log`, 939 B, SHA-256
`0F509C9E9E9919298D35F4A2A0C1C64658307394C1A82DE6844E41C1D42C5500`), verbatim probe lines:

```
### websocket upgrade attempt: alternate origin, plaintext upgrade (93.184.216.34:80)
bash: connect: Network is unreachable
bash: line 1: /dev/tcp/93.184.216.34/80: Network is unreachable          EXIT=11
### websocket upgrade attempt: internet, plaintext upgrade (1.1.1.1:80)
bash: connect: Network is unreachable
bash: line 1: /dev/tcp/1.1.1.1/80: Network is unreachable                EXIT=11
### websocket upgrade attempt: relay on the permitted link, unapproved port (10.30.1.1:18099)
bash: connect: Connection refused
bash: line 1: /dev/tcp/10.30.1.1/18099: Connection refused               EXIT=11
### tcp 10.30.1.1:18099                                                  EXIT=1
bash: connect: Connection refused
### tcp 10.30.1.1:8080                                                   EXIT=1
bash: connect: Connection refused
```

Interpretation, kept to what the bytes show: inside the compartment a plaintext WebSocket upgrade
cannot reach the TCP handshake for an off-link origin, because there is no route to it — the refusal
is `ENETUNREACH` at connect time, on the worker and on the relay alike. The same request against a
peer that *is* reachable on the permitted link reaches that peer's stack and is answered with a reset
(`ECONNREFUSED`), so the permitted link stays usable while the tested unapproved ports carry no
listener. The two probes therefore show the compartment cannot open a transport to an origin at all,
and that the only reachable peer answers only on the approved port; they do not exercise an
application-level WebSocket rejection, which remains the pinned-host negative fixture recorded in the
2026-11-15 active-egress-negatives entry.

Two operational deviations are recorded rather than smoothed over. First, the previous probe round
left its volume mounted: `probe2.sh` reported `B30_WSPROBE_UMOUNT=FAILED` on both guests because the
new mount stacked over the stale `B30PROBE` mount, and an explicit `sudo umount /media/b30` on the
worker returned to the prompt without output. Second, hot-detaching the already-removed earlier disk
produced `device offline error, dev sdc` and `Buffer I/O error on dev sdc1, logical block 1, lost
async page write` on the worker console. Neither affected the evidence: both scripts end with
`B30_WSPROBE_LOG_END` followed by two `sync` calls, and both collected logs contain that terminator
and were read back byte-for-byte from the detached volume. The relay's own post-probe `umount` was
never confirmed on its console before the volume was detached; its log is complete for the same
reason.

Evidence level: **deployed two-VM OS-level probe evidence**, the same level as the preceding entry.
It is not integration evidence for the relay/gateway TLS chain.

Supported by this entry: B30-03's in-VM WebSocket-upgrade and unapproved-port negatives on both
sides of the deployment, on top of the routing, DNS, IPv6, alternate-origin and no-NAT/no-ICS
conditions recorded above.

Not supported by this entry: an application-level WebSocket rejection, the host-side L7 gateway and
its policy digest, a deployed TLS chain, gateway ingress logs, the positive FIDO2 signature, the
active provider WebSocket-bypass experiment and any live use.

Not rerun: `integration/b30-egress-namespaces.sh` (privileged WSL fixture, unchanged); `node --test`
and the focused sets (documentation-only change; the last recorded result remains 415 of 416 with one
pre-existing skip at `352c212`); `integration/opencode-free-relay.mjs` and the pinned OpenCode 2.2.5
harnesses (pinned binary outside the repository); the deployed TLS chain, real resolver, trust store
and origin (`not_run`); expired and wrong-host certificates (`not_run`); the FIDO2 positive signature
dry run (`not_run`); live inference, paid calls and any catalog read (not authorized).

Claim: this entry supports that, in the deployed two-VM compartment, a WebSocket upgrade to an
off-link origin has no transport at all and the reachable peer on the permitted link answers only on
the approved port, based on guest-written logs read back from the attached media. It does not support
a deployed gateway policy, a deployed TLS chain, a positive FIDO2 signature, WebSocket-bypass
exclusion at the application layer, live activation, ready-for-review or merge.

## M3 preparation: B30 host-side L7 gateway on the Windows relay link (B30-07) – 2026-11-16

Executed on Windows 11 Pro x64 with Hyper-V, the same two guests and Node.js v24.22.1 (fnm). The
guest log is stamped `2026-11-16T03:13:02Z`. This entry records the first deployed host-side L7
gateway on the `B30-Relay-Gateway` link and the relay VM's socket attempts against it.

Changes made for this run, each authorized or reversible: one inbound firewall rule scoped to the
relay source address and the gateway port (created, used and removed in this entry), and one
temporary Node gateway process on the host. Nothing else on the host network, the switches, the
guests' netplan or `SharedAccess` was changed.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `New-NetFirewallRule -DisplayName 'B30-Relay-Gateway-Inbound' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress 10.30.2.1 -RemoteAddress 10.30.2.2 -LocalPort 18082 -InterfaceAlias 'vEthernet (B30-Relay-Gateway)' -Profile Public` | Open exactly one port for the relay source | rule created; 0 B30 rules before, 712 total rules after; filters read back as `LocalAddress 10.30.2.1`, `RemoteAddress 10.30.2.2`, `Protocol TCP`, `LocalPort 18082`, `Program Any`, `Enabled True`, adapter `Public`/`Up`, port not listening before the run | 0 |
| `node integration/b30-gateway-host.mjs --rounds 6 --max-seconds 1800 --log ... --evidence ...` | Instance the reviewed gateway in fixture mode on the relay link | bound `10.30.2.1:18082`, fixture origin `127.0.0.1:18083`, policy digest `9512dfe8d20d81fa7389538d0fab7c7a9c83fa2217576e5b7c99efe4700dc4e4` | 0 |
| `sudo mount -L B30GW2 /media/b30 && sudo bash /media/b30/probe4.sh` (operator-typed, relay console) | Six raw socket attempts from inside the relay compartment | `GW_CONNECT=OK`; `200`, `404`, `404`, `405`, `401`, `401`; log 1,480 B written by the guest | 0 |
| Host detach + `wsl --mount --vhd ... --partition 1` + copy | Read the guest log without a guest shell | log copied intact, ends with `B30_GWPROBE_LOG_END`; media deleted | 0 |
| `Remove-NetFirewallRule -DisplayName 'B30-Relay-Gateway-Inbound'` | Restore the previous inbound surface | 712 -> 711 total rules, 0 B30 rules remaining, adapter unchanged; the harness still held `10.30.2.1:18082` at that moment (round 5 was waiting for a request), and after the run ended there was no listener on `18082` and no gateway process | 0 |

Gateway policy (the exact values that produce the digest above): mode `fixture`, listen
`10.30.2.1:18082`, origin `http://127.0.0.1:18083`, path `/v1/chat/completions`, limits
`maxRequests 4`, `maxRequestBytes 1048576`, `maxResponseBytes 1048576`, `timeoutMs 120000`. The
controlled fixture origin is loopback and records metadata only — method, path, whether the
authorization header was exactly `Bearer public`, body byte count and whether a canary marker was
present — never a body.

Guest log (`b30-gwprobe2-b30-relay.log`, 1,480 B, SHA-256
`C0A60106CD285E2B765CA7C025B4FAF065B289F97103DCC47251F7FFDBB15695`), abridged here by removing the
repeated `Date`/`Connection`/`content-length` header lines and surplus blank lines; the status line,
the attempt counter, every body and the log terminators are verbatim:

```
B30_GWPROBE_START host=b30-relay kernel=6.8.0-139-generic utc=2026-11-16T03:13:02Z
B30_ROLE=relay
GW_CONNECT=OK

### approved fixed request
ATTEMPT=1 RC=0 STATUS=200
HTTP/1.1 200 OK
content-type: application/json
Transfer-Encoding: chunked
107
{"id":"b30-gateway-fixture","object":"chat.completion","model":"deepseek-v4.1-flash-free","b30":"B30_GATEWAY_FIXTURE_OK","usage":{"prompt_bytes":127},"choices":[{"index":0,"message":{"role":"assistant","content":"B30_GATEWAY_FIXTURE_OK"},"finish_reason":"stop"}]}
0

### unapproved path
ATTEMPT=1 RC=0 STATUS=404
HTTP/1.1 404 Not Found
not found

### absolute-URI unapproved origin
ATTEMPT=2 RC=0 STATUS=404
HTTP/1.1 404 Not Found
not found

### CONNECT tunnel attempt
ATTEMPT=1 RC=0 STATUS=405
HTTP/1.1 405 Method Not Allowed

### missing credential
ATTEMPT=2 RC=0 STATUS=401
HTTP/1.1 401 Unauthorized
unauthorized

### wrong credential
ATTEMPT=2 RC=0 STATUS=401
HTTP/1.1 401 Unauthorized
unauthorized

B30_GWPROBE_LOG_END
```

Gateway-side counters per instance (from the harness event log): round 1 `requests 3`, refused
`[path]`, 263 response bytes; round 2 `requests 3`, refused `[path]`, 0 bytes; round 3 `requests 2`,
refused `[credential]`, 0 bytes; round 4 `requests 1`, refused `[credential]`, 0 bytes; round 5
received no request before the deadline and ended the run (`round_skipped`,
`reason: no_request_before_deadline`). `bytesOut` counts only upstream response body bytes forwarded
to the caller, so round 1's 263 is exactly the fixture body the guest printed as chunk `107` (hex)
and the three refusing rounds forwarded nothing. The extra requests are the guest's own retries: a
gateway instance latches on its first refusal and answers `503` afterwards, so three of the six
scenarios needed a second attempt to reach a fresh instance. That is the designed fail-closed
behavior, and it is visible in both logs.

The harness evidence file (`b30-gateway-evidence.json`, 4,032 B, SHA-256
`A9ED9EE26A4D98F22464B8C2E8639AB9AC2FE12FD2DB725FEC40B5919FCCD758`) records `mode: fixture`,
listen `10.30.2.1:18082`, the same policy digest for all four instances, the four per-round counter
sets above, and `origin.requests: 1` with a single metadata record: `POST /v1/chat/completions`,
authorization equality with `Bearer public`, JSON content type, 127 body bytes and the canary present
as a boolean flag. The file contains no body, no canary marker string and no authorization value; the
process exited and nothing listened on `18082` afterwards.

What this establishes: from inside the relay VM the approved request reaches the gateway and is
forwarded to the controlled fixture origin exactly once (the fixture reported `prompt_bytes 127`,
and no other response body exists); an unapproved path, an absolute-URI proxy-style request, a
`CONNECT` tunnel, a missing credential and a wrong credential are each refused before any upstream
fetch; and the gateway's own log carries no body, no canary marker and no authorization value
(`B30-CANARY-PROMPT-0f5a` and `Bearer` appear zero times in the event log and the evidence JSON).

**Deviation, recorded rather than hidden:** the first probe round (`B30GW`, log
`b30-gwprobe-b30-relay.log`, 1,377 B, SHA-256 `BC32E1F2...`) is not evidence for the refusals. The
harness then gave each round a fixed 180 s window while the operator console was driven by hand, so
rounds 1–5 expired before the guest started and the whole probe landed on the last instance: the log
shows `200`, then `404`, then four `Connection refused` retries. The harness now waits for the first
request within the overall deadline and ends the run instead of shifting scenarios; the second round
above is the corrected run. A related operator-side error is recorded for completeness: an early
collector run detached the media before the guest had written its log, which the collector treated
as `PARTIAL` and kept the VHDX; the media was re-verified and re-attached instead of rebuilt.

Evidence level: **deployed host-side gateway boundary with a controlled loopback origin**, plus raw
sockets from inside the relay VM. It is not integration evidence for the live TLS chain.

Supported by this entry: B30-07's requirement that an unapproved origin, path or `CONNECT` is denied
before any external request, that the fixed origin succeeds against a controlled gateway fixture,
that the gateway policy and digest are independently recorded, and that its logs keep no body or
authorization material — bounded to a loopback fixture origin and a plaintext relay-to-gateway leg.

Not supported by this entry: the deployed TLS chain (no real origin, resolver, trust store or
certificate validation was exercised), live inference, and the relay *process* forwarding through
this gateway (the probes are raw sockets from the relay guest shell, not the relay service). The
non-loopback worker-facing listener decision and the FIDO2 positive signature remain `not_run`.

Harness revision note: the deployment run used the harness revision present when its process
started. Subsequent local edits do not change behavior for the valid deployment arguments: the
evidence JSON now uses distinct `originConfig` and `origin` keys (the run's JSON had the latter
only, with per-round policy including the origin config); positive-integer argument checks reject
zero/invalid rounds, deadline and ports; the smoke probe now reports the nested `ECONNREFUSED`
code. The updated harness was exercised with `--smoke`, loopback-only and requiring no host firewall
rule.
Not rerun: the pinned OpenCode 2.2.5 harnesses (pinned binary outside the repository);
`integration/b30-egress-namespaces.sh` (privileged WSL fixture, unchanged); the FIDO2 positive
signature dry run; the active provider WebSocket-bypass experiment; live inference, paid calls and
any catalog read (not authorized). The deployment harness itself is not part of `node --test` (it is
deployment tooling under `integration/`, not a test file), so the suite result below does not
exercise the deployment path.

Suite at this head (documentation plus one deployment harness; `src/` and `test/` untouched):
serial `node --test --test-concurrency=1` -> 416 tests, 411 pass, 0 fail, 5 platform-gated skips,
exit 0 (195 s). The default-concurrency `node --test` run, which is what the Windows CI job uses,
exits 1 on the known timing-sensitive `B10-03` abort assertion (`aborted.stdout` empty instead of
`before`) on this loaded machine; the same file passes 8/8 in isolation, and the failure is
recorded here rather than erased. `git diff --check` is clean.

Claim: this entry supports that a host-side L7 gateway deployed on the ADR-010 relay link refuses an
unapproved origin, path, `CONNECT` tunnel and credential while forwarding exactly the approved
request to a controlled fixture origin, with a recorded policy digest and body-free logs, based on
guest-written probe output and host firewall and gateway counters. It does not support a deployed
TLS chain, live activation, ready-for-review or merge.

## Exact-head CI receipt for the 2026-11-16 gateway deployment evidence

At head d6e356269e5c57d4c606685caa047c51b4636c3b, CI run 43800413251 completed SUCCESS: Windows and Ubuntu jobs passed (Windows job 133079066746, Ubuntu job 133079066372). The workflow's exit-code 7/1 annotations are its intentional continue-on-error pipeline-exit fixtures, not test failures. This receipt validates the code/docs at that head under CI; it does not satisfy the remaining deployed TLS, application-level WebSocket, FIDO2, bypass, live-inference or independent-review gates. The evidence and smoke results remain as described in the preceding 2026-11-16 entry.

## Local revalidation at the publication head 5fe1e46 (2026-11-16, Windows 11 / Node 24.22.1)

Repeated on the maintainer's Windows 11 host at `5fe1e46196cd7d9f8ca5fa20f843d5e49cf2e4d8`
(base `11fcb422de47c2a9b79389de8470802d48ead730`) to confirm that the pinned-host and
namespace evidence still reproduces at the publication head, not only at the earlier heads
where it was first collected. No source, test or composition file was changed for this rerun;
the only change is this record.

- Pinned binary: downloaded `opencode-windows-x64.zip` from the official OpenCode v2.2.5
  release into a temporary directory outside the repository. SHA-256
  `2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8`, equal to the digest
  published in `integration/README.md`; `opencode.exe --version` printed `opencode v2.2.5`.
- Serial suite: `node --test --test-concurrency=1` -> 416 tests, 411 pass, 0 fail, 0 cancelled,
  5 platform-gated skips, exit 0 (193 s). This matches the count recorded at the preceding
  heads; the earlier `B15-03b`/`B10-03` timing failures were not observed in this run and are
  not treated as erased.
- Demo and diff: `node examples/fallback-demo.mjs` -> `mock/preferred` 429 then `mock/local`
  200, exit 0; `git diff --check` -> clean.
- WSL2 containment fixture (privileged, maintainer-run): `wsl -d Ubuntu -u root -- bash
  integration/b30-egress-namespaces.sh` -> `RESULT: containment verified`, exit 0, with all
  verdict lines `PASS`: worker->internet/gateway route and socket denied, worker->relay
  reachable, relay->internet denied and relay->gateway reachable, gateway->internet and
  gateway->worker denied, worker IPv6 and DNS denied, worker WebSocket upgrade denied, the
  forbidden listener on `:18099` timeout with the nft OUTPUT drop counter incremented, and the
  unprivileged worker boundary `uid=65534 gid=65534 CapInh/CapPrm/CapEff=0000000000000000
  CapBnd=000001ffffdfefff NoNewPrivs=1` with the unauthorized mutations refused. Teardown
  reported no owned residue and the initial-namespace ruleset remained empty.
- Pinned OpenCode 2.2.5 through the relay: `node integration/opencode-free-relay.mjs
  <opencode.exe>` -> exit 0, all six scenarios `ok` (normal plus 301/302/303/307/308). The
  normal run succeeded through relay->gateway with `Bearer public`; each redirect failed the
  task with one attempt and one origin request, the gateway latched `redirect-refused`, and the
  alternate origin recorded zero connections, zero raw socket bytes, zero requests and zero
  body bytes.
- Gateway deployment harness: `node integration/b30-gateway-host.mjs --smoke` ->
  `smoke_approved status 200`, `smoke_after_stop error:ECONNREFUSED`, exit 0; no host firewall
  rule was created.
- B29 prerequisite MCP workflow: `node integration/mcp-free-workflow.mjs <opencode.exe>` ->
  exit 0, `version 2.2.5`, `transportCalls 10`, statuses `queued`/`running`/`succeeded`,
  duplicate submission reused the same ID with one attempt and one workspace, zero fixture
  anomalies, the out-of-scope write denied, `testExitCode 0`, and the endpoint absent from
  config, task and MCP arguments.

Evidence level: **local fixture and pinned-host observations plus a privileged WSL2
namespace observation**. They reproduce the earlier results at the publication head; they do
not become deployment evidence. Not run and unchanged: the deployed TLS chain to the real
origin with a real resolver/trust store (including expired and wrong-host certificates), an
application-level WebSocket rejection, the positive FIDO2 hardware-key signature, the active
provider WebSocket-bypass experiment, the non-loopback worker-facing listener decision, any
fresh catalog read and live inference. No paid call, credential or external host was contacted;
the pinned binary is temporary and outside the repository. The draft stays draft and merge
still requires explicit authorization.

## Authorized live-boundary probes at a2c060f (2026-11-16, Windows 11 / Node 24.22.1)

The maintainer authorized the remaining network-side gates in this session. These probes were
run once, from one temporary script outside the repository, against the real fixed origin
`opencode.ai` only. No prompt, model output or paid route was used, and no source, test or
composition file was changed.

- Real TLS chain: a `node:tls` handshake to `opencode.ai:443` with Node default
  certificate/hostname verification and SNI `opencode.ai` returned `authorized: true`,
  `authorizationError: null`, `TLSv1.3`, `TLS_AES_256_GCM_SHA384`, subject CN `opencode.ai`,
  issuer `Google Trust Services`, SAN `DNS:opencode.ai, DNS:enterprise.opencode.ai`,
  validity `2026-11-13T00:00:15Z` to `2027-02-11T00:53:06Z`, SHA-256 fingerprint
  `E3:06:DC:19:28:EE:30:65:85:26:A9:04:24:23:9E:30:A8:A9:F8:07:74:26:5E:0A:35:20:8F:83:99:64:C6:8D`.
  This is the resolver + system trust store + hostname validation path the live gateway uses.
- Gateway in live mode: `createEgressGateway({ mode: 'live', listen: '127.0.0.1:18082' })` with the
  fixed origin/path and policy digest
  `e8b6ec5518c3c4ad108de4dcdbf841ef9a9a58282a1212b25f7bc28d0871e388` started successfully
  (an ambient `NODE_TLS_REJECT_UNAUTHORIZED=0` was absent). It forwarded exactly one
  `POST /inference/openai/v1/chat/completions` with `Bearer public` and an empty JSON body `{}`;
  the provider answered `400` with
  `{"error":{"message":"`model` must be a non-empty string","type":"invalid_request_error","param":"model","code":null}}`.
  The request was rejected before any model generation: no model was named, no prompt was sent
  and no completion or usage was produced. `bodyBytes` was 117; the gateway latched nothing
  (`liveEvents` empty) because the upstream answered normally over the validated TLS chain.
- Application-level WebSocket refusal: the same live gateway, sent a `GET` carrying
  `Connection: Upgrade`, `Upgrade: websocket` and `Sec-WebSocket-*` headers, answered `405`
  `method not allowed` and latched `method` before any upstream I/O. This is the gateway's own
  code path refusing a WebSocket handshake; it does not exercise a provider-side WebSocket.
- Dated catalog read (fresh, separately authorized): `fetchFreeMetadata()` at
  `2026-11-16T04:34:16.916Z` returned exactly one `deepseek-v4.1-flash-free` entry with all
  zero prices (`text.input.price 0`, `text.input.cache.read 0`, `text.output.price 0`). It is a
  dated snapshot, not authority to run, and was not repeated.

Evidence level: **deployed boundary observation against the real fixed origin plus one
application-level refusal**. It closes the "real resolver/trust store/hostname" portion of the
deployed TLS chain with a normal 400 response and no inference. Not run and unchanged: the
gateway's deployed placement behind the relay link (no relay guest exists; `Get-VM` returned zero
VMs while the `B30-Relay-Gateway` switch still carries `10.30.2.1`), expired/not-yet-valid/
wrong-host certificates against the real origin (only disposable-CA fixtures cover these), the
positive FIDO2 hardware-key signature (no FIDO2 device is present on this host), the active
provider WebSocket-bypass experiment from the worker compartment, the non-loopback worker-facing
listener decision (its own ADR amendment is still required), an independent Ubuntu host, and live
inference. The live composition path remains closed and the PR stays draft.

The earlier "no external host was contacted" sentence in the preceding entry describes that
run only; the probes above contacted `opencode.ai` under this session's authorization.

## Explicit relay bind address in the trusted composition (2026-11-16)

Implemented the maintainer-selected option for the last code-side deployment decision: the
trusted composition now accepts an explicit worker-facing relay address instead of hardcoding
loopback. Defaults and the closed live path are unchanged.

- `src/free-listeners.mjs`: `freeListenerPlan` accepts `relayHost` (default `127.0.0.1`),
  binds the relay to that exact address, derives `workerBaseURL` from it (IPv6 bracketed) and
  refuses, before any child starts, anything that is not a concrete loopback/private IPv4
  (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`) or IPv6 (`::1`, `fc00::/7`,
  `fe80::/10`). Wildcard/unspecified (`0.0.0.0`, `::` and compressed aliases), public
  addresses, IPv4-mapped IPv6 and hostnames are refused with `invalid_argument`. The address is
  part of `relayPolicyDigest`, so an admission gate built for one bind address cannot admit
  another. The gateway stays fixture-mode loopback.
- `test/free-listeners.test.mjs`: added a pure policy test (accepted/rejected addresses,
  digest difference, IPv6 URL form) and a real composition test that binds the relay on
  `127.0.0.2`, confirms `127.0.0.1` is not additionally exposed, and confirms close releases
  the port. Private addresses such as `10.30.1.1` are policy-tested only; binding them needs a
  real NIC.
- Docs: ADR-010 dated amendment, task contract listener bullet, roadmap/handoff status,
  deployment prerequisites item 3, B30 card and integration README updated; no live origin,
  composition flag or gateway mode was opened.

Validation: `node --test test/free-listeners.test.mjs test/free-listeners-authority.test.mjs`
-> 19 pass / 0 fail / 0 skip (exit 0); serial `node --test --test-concurrency=1` -> 418 tests,
413 pass / 0 fail / 5 platform-gated skips (exit 0, 186 s); `node examples/fallback-demo.mjs`
-> 429 then 200 (exit 0); pinned `integration/opencode-free-relay.mjs` -> exit 0 with the same
six scenarios; `git diff --check` clean.

Not run and unchanged: binding the relay on a real private NIC in the ADR-010 topology, the
deployed relay→gateway TLS leg (only the direct real-origin trust check above), positive FIDO2,
the provider WebSocket-bypass experiment, an independent Ubuntu host and live inference. The
live composition path remains closed; the PR stays draft.

## 2026-11-22 - B30 critical review correction follow-up

- Branch/head at pickup: `task/B30-free-relay`, published baseline `11685d57c6e15a7804a95c05c1a3666c70b56de7`; PR #45 remains draft and conflicting.
- Corrections: relay/gateway ingress timers now begin at request arrival, cover body collection and upstream fetch, abort stalled requests, refuse body completion after a latch, and close incomplete request sockets after bounded 413/504 responses. Worker preparation now accepts only the dedicated relay-provider profile with a syntactically constrained private/loopback URL; the one prefixed authorization model remains fixed. Added supervised two-connection latch regression, worker URL validation, and early fixture-origin cleanup registration. Clarified wire-model versus authorization model IDs.
- Focused validation: relay/gateway/supervised listener suite had 57/58 pass, then the one timeout-label expectation was corrected; worker-preparation focused suite 13/13 pass. A full default suite completed 422 tests: 416 pass, 1 fail (unrelated B10 subprocess timing/partial-output flake), 5 platform-gated skips, native exit 1. Serial full suite is running; do not claim its result until its actual native exit is captured. Demo 429 -> 200, native exit 0; `git diff --check`, native exit 0 (before the last socket-close adjustment; rerun required).
- Not run: pinned OpenCode relay harness, external/deployment gates, provider/catalog requests, live inference, real FIDO2, network probes, VMs/WSL namespace/firewall, CI. Live composition remains closed. Follow-up corrections are incomplete pending final reruns, independent critical re-review and remote/PR verification.
## 2026-11-22 - B30 follow-up validation receipt

The serial full-suite process launched during implementation completed: 422 tests, 417
passed, 0 failed, 5 platform-gated skipped; Node native exit 0 (197.5 s). This receipt
supersedes the earlier “serial suite is running” statement in the same day's appended
notes, but does not convert the default-concurrency result: default `node --test` ran 422
tests, 416 passed, 1 failed, 5 skipped, native exit 1 due the B10-03 partial-output
timing flake. The affected B10 file passes in the serial suite. Post-adjustment focused
B30 suite: 71/71, exit 0. Final `git diff --check`: exit 0. Fallback demo: 429 -> 200,
exit 0. Changes remain unpublished; no CI or PR-head result is claimed.
## Final post-correction B30 validation receipt — 2026-11-22

After adding the stalled-body and refusal-path cleanup regressions, the serial full suite
completed 423 tests: 418 passed, 0 failed, 5 platform-gated skips; native exit 0
(197.96 s). Final default full suite: 423 tests, 417 passed, 1 failed, 5 skips, native
exit 1; the sole failure is B10-03's existing loaded-machine partial-output timing flake.
Focused B30 suite passed 73/73, exit 0; the final `test/free-listeners.test.mjs` rerun
passed 16/16, exit 0, including late data/end/error and abort after the body deadline.
exit 0. Final demo exit 0 and final `git diff --check` exit 0. No CI/head verification
has been run on these unpublished corrections.

## Critical-review correction publication receipt — 2026-11-22

Published on the same branch and draft PR #45 as commit
`049383e038da24ffbcad480a826ac37675a59af5` (parent `11685d57c6e15a7804a95c05c1a3666c70b56de7`).
The exact remote ref matched this SHA; PR #45 still targets `main`, remains draft and
reports `DIRTY`. No current-head CI result was available. This is not independent
acceptance or a ready/merge claim.
# B30 latest critical-review corrections — 2026-11-22 (local validation)

- Correction work began from the verified clean local/remote head
  `f59d10373a18c43c70208a84b55a1707f168d6c6`; the initial two-file request-cleanup
  edits were preserved. Work remains on `task/B30-free-relay`.
- Focused command
  `fnm exec --using=24.22.1 node --test test/free-provider.test.mjs test/live-approval.test.mjs test/free-listeners.test.mjs test/free-listeners-authority.test.mjs test/relay.test.mjs test/egress-gateway.test.mjs test/opencode.test.mjs`
  passed 102/102 after corrections (exit 0). It covers bounded incomplete-body refusals,
  fresh-listener abort interleaving, one-request cap composition/request-2 denial,
  signed-ceiling binding, guard cap generation and refusal before listener ownership.
- Serial full suite
  `fnm exec --using=24.22.1 node --test --test-concurrency=1`: 428 total, 423 pass,
  0 fail, 5 skips, exit 0, ~199 seconds. Four TLS fixtures skipped because `openssl`
  is absent from PATH; one Windows platform-gated subprocess case skipped. The suite
  itself ran existing disposable-key tests; no key/certificate command was manually
  invoked.
- `fnm exec --using=24.22.1 node examples/fallback-demo.mjs`: mock 429 then 200,
  exit 0. `git diff --check`: exit 0 (CRLF normalization warning on ADR-010 only).
- An earlier focused run during development failed (2 tests: abort ordering and
  incomplete addition of effective cap parameter); an earlier broader run also
  timed out existing upstream-timeout cases when a request-end handler cleared the
  timer too early. These failures led to fixes and are retained here, not represented
  as passing evidence. Current focused and serial reruns above passed.
- Not rerun: pinned OpenCode-through-supervised composition, WSL/VM/network placement,
  deployed TLS, live/provider/catalog, FIDO2 positive signature, platform egress,
  current-head CI, default-concurrency full suite. PR remains draft/conflicting and
  issues #46/#47/#48 remain external blockers.
- Final post-review tightening rerun: focused three-case set (early refusal, fresh abort,
  one-request profile) passed 3/3, exit 0; serial full suite repeated after that test edit
  passed 428 total / 423 pass / 0 fail / 5 skips, exit 0 (~203 s). Demo and diff check
  were rerun after source changes and passed.
- Published source/tests/contract/ADR and local validation receipt as commit
  `8f888c22e0d7dcfb296be19edf2784f076896999` on the existing `task/B30-free-relay`
  PR branch. The task card records this latest publication SHA. The following docs-only
  publication receipt is separate and does not alter source/tests.

## Planning: reconcile delivery state and unblock supervised use — 2026-11-22

Executed on Windows x64, NT 10.0.26300.0, Node.js v24.22.1 (fnm installation
prepended to child PATH), Git 2.55.0.windows.5. Date: 2026-11-22.

Main/runtime baseline `11fcb422de47c2a9b79389de8470802d48ead730`; B30
baseline `a4f3954514e2109a5f0112dcea0534d291a9fcf4`. The current branch
changes documentation only; no source/test/integration file was changed
after these runs. Each native exit was captured before formatting output.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Existing main full suite, default concurrency | 305 total, 304 pass, 0 fail, 1 POSIX-only skip; 56.4 s | 0 |
| `node examples/fallback-demo.mjs` | Existing fallback demo | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `node --test test/free-listeners.test.mjs test/gateway-tls.test.mjs test/live-approval.test.mjs test/service-ownership-handoff.test.mjs` | Focused B30 listener/private bind, real local TLS, signature refusal/ledger and ownership checks in the existing B30 worktree, with Git OpenSSL on PATH | 41 pass, 0 fail, 0 skip; 7.9 s | 0 |
| `gh pr view 45 --json headRefOid,baseRefOid,mergeable,statusCheckRollup` | Observe B30 current head/checks, not approve it | Head `a4f3954`, base `11fcb42`, successful Windows/Ubuntu checks in run `43806088953` | 0 |
| `git diff --check` | Documentation whitespace | no output | 0 |

Result: the default-concurrency baseline passed once, and all 41 selected B30
fixtures ran without skips. This does not repair or invalidate the earlier
timing/maintenance failures recorded in this file and #45; #48 tracks those
separately. Demo output was 429 then 200. The first exploratory `node --version`
failed because Node was absent from the shell PATH; adding the existing fnm
24.22.1 installation fixed the invocation environment without installation or
repository changes. No failed test run is being hidden as a successful retry.

A one-off external content checker verified changed Markdown relative paths,
balanced fences, byte-for-byte append-only prefixes in worklog/validation and
an empty runtime/test/integration diff against main. Its first pass checked
10 documents/115 relative links, 0 broken; the final pre-publication pass checked
12 documents/121 relative links, 0 broken, with unchanged runtime and preserved
historical bytes. The checker is session tooling outside the repository, not a
new shipped test or reproducible integration gate.

GitHub maintenance was verified after execution: #6/#9 closed with reasons,
#33/#34 draft, #43/#45 still draft at unchanged code heads; #30/#31 narrowed
with old bodies retained; #46/#47/#48 created once. Published planning
comments: #32 `7073987471`, #33 `7073990711`, #34 `7073990720`,
#43 `7073990718`, #45 `7073990738`. After a session restart, existing remote
state and saved test logs were read; none of those mutations or tests was
blindly replayed.

Evidence level: Unit — demonstrates policy decisions and input normalization;
does not demonstrate host, network or production persistence. The B30 TLS
subset additionally provides Local HTTP evidence: real headers/status and
selection with controlled loopback fixtures, not real OpenCode sessions.
GitHub status is an external receipt, not local deployment validation.

Not rerun: pinned OpenCode smoke, B17/MCP/free-relay workflows and B19 pulse
(external binary/integration outside this documentation task); privileged
WSL/netns/Hyper-V/firewall runs (no environment changes authorized here);
catalog or provider requests, hardware signing and B20/live inference (not
authorized; existing dated receipts are not renewed). No complete B30
diff/security review or independent reviewer approval is claimed.

Claim: this entry supports the repository/queue reassessment and passing
local baseline/focused fixtures only. It does not establish B30 acceptance,
hardware-positive authorization, a deployed service chain, M2b sign-off,
M3 completion, deterministic test reliability, live activation or merge.

## B30 follow-up critical-review corrections — 2026-11-23 (local validation)

- Correction work began from the verified clean local/remote head
  `14013bbe82d28a4ffa9651c8a721ec015fa64891` on `task/B30-free-relay`.
- Source/tests/contract/ADR correction commit
  `4bf5e19f6e13f0ca63ac2c4d78c787ba849cba47` addresses the two blocking findings in
  https://github.com/pbsilvabd/ai-orchestrator/pull/45#issuecomment-7089619255 .
  The listener-free `fixtureEndpoint` composition now passes the signed gate ceiling to
  the worker guard and refuses a gate without an integer cap in 1..12 before ownership;
  live gateway origin validation strips IPv6 brackets before IP classification.
- Focused command
  `fnm exec --using=24.22.1 node --test test/egress-gateway.test.mjs test/free-provider.test.mjs`:
  36 total, 36 pass, 0 fail, 0 skips, exit 0. Includes the prepared-guard cap assertion
  and the IPv4/IPv6 literal-origin negatives.
- Focused B30 set (the same twelve files as the previous entry): 138 total, 134 pass,
  0 fail, 4 skips, exit 0, ~15 s. The four skips are TLS fixtures that require
  `openssl`, which is absent from PATH; no key or certificate tool was invoked.
- Serial full suite `fnm exec --using=24.22.1 node --test --test-concurrency=1`:
  431 total, 426 pass, 0 fail, 5 skips, exit 0, ~200 s. Skips: four TLS fixtures
  without `openssl` plus one Windows platform-gated subprocess case.
- Default-concurrency full suite `fnm exec --using=24.22.1 node --test`:
  431 total, 425 pass, 1 fail, 5 skips, exit 1, ~68 s. The only failure was the known
  B10-03 partial-output timing assertion (`'' !== 'before'` at
  `test/subprocess.test.mjs:78`), reproduced in two default-concurrency runs today and
  absent from the serial run. It is recorded as a flake, not passing evidence.
- `fnm exec --using=24.22.1 node examples/fallback-demo.mjs`: mock 429 then 200,
  exit 0. `git diff --check`: exit 0.
- Not run: current-head CI, pinned OpenCode through the supervised composition,
  deployment/network/VM gates, deployed TLS, live/provider/catalog calls, a FIDO2
  positive signature, and a signed one-request run through a real signature. PR #45
  remains draft and conflicting; issues #46/#47/#48 remain external blockers.

## B30 author self-review follow-up — 2026-11-23 (local validation)

- This is an **author self-review**, not the independent critical re-review, which
  remains pending. It reviewed the complete `main..HEAD` diff at
  `28f10a29dc7a70abd9f747393c3c9166162bfa7d` plus local probes of both listeners.
- Confirmed the two blocking findings from comment #7089619255 are corrected, and
  found one diagnostic defect by probe: when another request latched the listener
  while a valid request was awaiting its upstream response, the in-flight request
  answered `504 deadline exceeded` and overwrote `latchReason` with `timeout`, even
  though no deadline expired and the real latch was e.g. `method`. No upstream
  replay or forwarded bytes were involved; the refusal itself was correct.
- Correction commit `bf07293f0718ea25b7a93c54f20b66bda7f95c82`: both listeners now
  answer `503 <listener> latched` and retain the original latch reason when another
  request caused the latch; only a genuinely expired deadline answers 504. Added
  deterministic regressions in `test/relay.test.mjs` and `test/egress-gateway.test.mjs`
  (in-flight POST, concurrent wrong-method latch, one origin request, retained reason).
- Revalidation after the fix: `node --test test/relay.test.mjs test/egress-gateway.test.mjs`
  39 pass / 0 fail, exit 0; serial full suite 433 total, 428 pass, 0 fail, 5 skips,
  exit 0 (~200 s). Skips unchanged (four TLS fixtures without `openssl`, one
  platform-gated subprocess case).
- Probes ran locally with Node 24.22.1 against loopback fixture origins only; no
  provider, catalog, external network, VM, firewall, key, certificate or FIDO2
  operation was performed.

## B30 merge with main - 2026-11-24 (local validation)

- Merged `origin/main` `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` into
  `task/B30-free-relay` at `9a83ac9b95a3d00738080b64286544fde28fdb25` to clear the
  stale base. Conflicts were limited to `docs/backlog.md`, `docs/handoff.md`,
  `docs/roadmap.md`, `docs/validation.md` and `docs/worklog.md`; code, tests and the
  contract merged automatically.
- Resolution: main-side planning/reassessment content retained, B30 draft status
  updated to the current head, and both sides' dated entries preserved in
  chronological order (no history rewritten).
- Post-merge validation: `node --test test/relay.test.mjs test/egress-gateway.test.mjs`
  39 pass / 0 fail; serial full suite 433 total, 428 pass, 0 fail, 5 skips, exit 0;
  `node examples/fallback-demo.mjs` 429 -> 200, exit 0; `git diff --check` clean.
  Skips unchanged (four TLS fixtures without `openssl`, one platform-gated case).
- Not run: current-head CI (no run registered for the branch), independent critical
  re-review, pinned OpenCode through the supervised composition, deployment/VM/network
  gates, real TLS, provider/live calls and FIDO2. PR #45 stays draft; #46/#47/#48
  remain blockers.

## B30 independent critical review corrections - 2026-11-24 (local validation)

- The independent critical review (GPT-6.2 Sol, PR comment 7121684260) requested changes
  at `2f8d7aea4f75b53e391d32873bbecd38e4736d39`; exact-head CI run `45323052642` failed on
  Ubuntu at the fresh-abort regression (Windows passed).
- **B30-05 approval lifetime:** `validateLiveApproval` now requires
  `issuedAt <= now < expiresAt` and `0 < expiresAt - issuedAt <= 15 minutes`, so future
  issuance, inverted and zero-length intervals are refused before signature verification
  or reservation. Added clock-controlled cases for future, inverted, equal, exact boundary
  and expiry-at-now. Contract and ADR-010 amended.
- **B30-04 fresh abort:** the regression no longer sleeps. It observes the listener's
  terminal latch through the new diagnostics-only `service.freeListenerStatus()` (IPC
  status query) before completing the pending request, and preserves the zero-origin and
  ownership assertions.
- **First-cause latch reporting:** both listeners now keep the first latch reason
  (`latched` stays first-write-wins; the gateway still audits every refusal in `refused`).
  The concurrent-latch regressions wait for the origin request and the 405 instead of
  fixed sleeps, and new regressions prove an upstream failure after a latch cannot
  overwrite the original reason.
- **Merge history:** restored the dropped dated continuity text under historical
  headings in `docs/backlog.md` and `docs/handoff.md`, and labelled the `a4f3954` green CI
  historical in backlog/roadmap.
- Pinned host loopback evidence (author run at the reviewed head, recorded for this
  entry): `integration/opencode-free-relay.mjs` with OpenCode 2.2.5 exited 0; normal
  scenario succeeded with three origin requests, and 301/302/303/307/308 each failed
  terminally with one attempt, one origin request and zero alternate-origin anomalies.
  Fixture/loopback composition only, not deployment or live evidence.
- Validation after the corrections: `node --test test/live-approval.test.mjs
  test/relay.test.mjs test/egress-gateway.test.mjs` 55 pass / 0 fail; focused
  free-provider/supervisor/ownership/live-approval set 48 pass / 0 fail; fresh-abort
  regression 1 pass; serial full suite 436 total, 431 pass, 0 fail, 5 skips, exit 0;
  `node examples/fallback-demo.mjs` 429 -> 200, exit 0; `git diff --check` clean.
- Not run: corrected-head CI (pending), corrected-head independent re-review, deployed
  TLS/VM/firewall, provider/catalog, FIDO2 and live activation. PR #45 stays draft.

## B30-04 status-query follow-up - 2026-11-24 (local validation)

- The corrected-head re-review (PR comment 7121966650) closed the three prior findings but
  found one new blocking P2: `freeListenerStatus()` combined both status queries with
  `Promise.all`, so when one listener had already exited (synchronous throw) the other
  still-pending query could later reject unhandled and terminate the service.
- Fixed in `src/free-listeners.mjs`: the diagnostics query now awaits the relay and gateway
  statuses sequentially, so at most one query is in flight and every rejection returns to
  the caller.
- Regression in `test/free-listeners.test.mjs`: the gateway child is killed and observed
  exited, the combined query is started while the relay still runs, then the relay is
  killed before answering; the test asserts the call returns a promise that rejects and
  that no `unhandledRejection` is emitted.
- Validation: `test/free-listeners.test.mjs` 20 pass / 0 fail; the two targeted
  regressions 2 pass; serial full suite 437 total, 432 pass, 0 fail, 5 skips, exit 0.
  Two earlier serial attempts failed only B15-03b (known #48 readiness race; it passed in
  isolation and in the final run). Demo 429 -> 200, exit 0; `git diff --check` clean.
- No live/provider/VM/key/FIDO2 operation; PR #45 stays draft and no merge/ready transition.

## B30-04 status-regression handler-ordering correction - 2026-11-24 (local validation)

- The third-round re-review (PR comment 7122271270) confirmed the runtime fix and the three
  earlier findings but found one new blocking P2 in the new regression itself: it awaited the
  relay `SIGKILL` before attaching the rejection handler, so when the relay answered the
  status query first the expected gateway rejection was reported as unhandled. The reviewer
  reported 5/5 isolated failures and 3/3 passes for a variant that attached the handler
  immediately. This is a test-race, not a runtime regression: the sequential `status()`
  implementation is unchanged.
- Fixed in `test/free-listeners.test.mjs`: `assert.rejects(pending)` is now created
  immediately after the combined query starts, before the relay kill, and awaited afterwards.
- Validation: the targeted regression passed 5/5 isolated runs, `test/free-listeners.test.mjs`
  passed 20 pass / 0 fail, demo 429 -> 200, exit 0, and `git diff --check` is clean.
- Not run: exact-head CI for the corrected head (pending), a fourth-round independent
  re-review, deployed TLS/VM/firewall, provider/catalog, FIDO2 and live activation. PR #45
  stays draft.

## B30 independent review closure - 2026-11-24 (reviewer evidence)

- The fourth-round independent critical review (PR comment 7122405149) closed every prior
  finding at `7660b39874eecd48c408c1500d30da96c8423d2c` with no new blocking findings:
  approval lifetime bounds, fresh-abort latch ordering, restored merge history and
  first-cause latch reporting.
- Reviewer evidence at that head: the status regression passed 8/8 isolated runs and the
  listener file 20/20; controlled probes passed with a fast relay reply and with a silent
  relay; restoring the late handler reproduced the expected unhandled-rejection failure;
  cleanup checks confirmed both child exits, closed ports and removal of listener and owner
  locks. 41 relay/gateway tests and 3 pure approval tests passed. Exact-head CI run
  `45328472433` passed on Windows and Ubuntu, and a 29-module filtered serial suite, the
  fallback demo and whitespace checks passed.
- Reviewer exclusions: key- and certificate-generating fixtures, pinned OpenCode,
  deployment, provider/catalog and hardware checks. The unfiltered serial result remains
  author evidence.
- Review closure is not acceptance. Merge, ready and live activation remain unauthorized;
  #46/#47/#48 remain open and the deployment/provider/FIDO2 gates remain `not_run`.

## FIX48 propagation to B30/#45 - 2026-11-28

- Applied the reviewed correction from FIX48 PR #52 to the B30 branch starting
  at `67acd78d0c570d5619dcc56c1638138c650cf32a`: default-concurrency B10-03
  output readiness, MCP partial-line/collection retention, atomic B18 contender
  result publication, and the Windows/Ubuntu five-sample CI runner. Added the
  FIX48 task card and retained B30's pre-existing documentation/history.
- No B30 production, approval, provider, network, deployment or policy behavior
  was changed by the propagation. #45 and #51 remain draft; no merge.
- Run `46108300145` passed the receipt head `9b34a8c102af301f511c25c744caab3cb1e1ac36`.
  Both OS jobs checked common merge commit `7366b2218583d924614105a4d8dc17c5ff4ca858`,
  parented by base `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` and that PR head.
  Windows samples 1-5 each reported 310 tests / 309 pass / 0 fail / 1 skip;
  Ubuntu samples 1-5 each reported 310 / 306 / 0 / 4. All ten JSON outcomes
  report native exit 0, `worktreeClean=true` and `worktreeUnchanged=true` at the
  same OS-specific SHA. Both demo steps returned 429 then 200.
- This verifies the receipt head; it does not prove the #45 propagation head.
  The #45 work branch passed the focused command (88 total / 87 pass / 0 fail /
  1 platform skip) and full default suite (442 total / 437 pass / 0 fail /
  5 platform skips), native exit 0; the demo returned 429 then 200, exit 0.
- Actions run `46109110028` passed the #45 code head
  `784cdb4603896086033a3c7ca5bbacb9fabf9d8c`. Both platforms checked merge
  commit `8edcf05ee863dabc9c093b1b10204270b985eab7` (base
  `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` + PR head `784cdb4`). Windows
  job `140868429341` samples 1–5 and Ubuntu job `140868429560` samples 1–5
  each reported 442 tests / 437 pass / 0 fail / 5 skip, exit 0, clean and
  unchanged checkout at the same SHA. Both fallback demos returned 429 then
  200. The complete workflow and both jobs concluded success. The CLI watch's
  annotations request returned HTTP 502 after observing job completions; direct
  run/job metadata and both job logs confirmed success. #51 validation remains.
## FIX48: default-concurrency test stability — 2026-11-27

Executed on Windows x64, Node.js v24.22.1 (`fnm`).
Date: 2026-11-27.

Baseline SHA: `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672`. The initial clean-tree
baseline command ran before FIX48 edits. Corrected local commands ran in the
FIX48 worktree from that baseline; multi-platform repeated samples remain a
required CI gate at the final committed SHA.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `fnm exec --using=24.22.1 node --test` (baseline, before edits) | Reproduce default-concurrency #48 failure | 305 total, 303 pass, 1 fail, 1 skip; B10-03 failed with `'' !== 'before'` | 1 |
| `fnm exec --using=24.22.1 node --test test/repeat-default-suite.test.mjs test/subprocess.test.mjs test/scheduler.test.mjs test/mcp-server.test.mjs test/task-maintenance.test.mjs` | Exercise FIX48 runner, B10 child readiness, B12 lifecycle, B15 stream polling and B18 real-process ownership cases | 86 total, 85 pass, 0 fail, 1 platform skip | 0 |
| `fnm exec --using=24.22.1 node --test test/repeat-default-suite.test.mjs test/subprocess.test.mjs test/scheduler.test.mjs test/mcp-server.test.mjs test/task-maintenance.test.mjs` (final focused rerun, 2026-11-28) | Revalidate final FIX48 tests, including runner dirty-check and worktree-stability cases | 88 total, 87 pass, 0 fail, 1 platform skip | 0 |
| `fnm exec --using=24.22.1 node --test` | Full default-concurrency regression after final runner/test edits | 310 total, 309 pass, 0 fail, 1 platform skip | 0 |
| `fnm exec --using=24.22.1 node --test --test-concurrency=1` | Diagnostic serial regression (not a substitute for default concurrency) | 309 total, 308 pass, 0 fail, 1 platform skip | 0 |
| `fnm exec --using=24.22.1 node examples/fallback-demo.mjs` | Verify unchanged fallback example | `mock/preferred` 429, then `mock/local` 200 | 0 |
| `git diff --check` | Check whitespace in the current diff | no output | 0 |

Result: the clean baseline reproduced B10-03; the final focused post-edit cases, the
final default-concurrency full suite (310 tests) and the serial diagnostic
suite (309 tests) passed with one Windows-platform skip each. The fallback demo returned 429 then 200. The current
changes add readiness/atomic-publication regressions and a five-sample runner;
the required five consecutive default-concurrency full-suite samples on each
of Windows and Ubuntu have not yet run at the final committed SHA.

Evidence level: Unit — demonstrates policy decisions and input normalization;
does not demonstrate the host, the network or production persistence. The
multi-process and subprocess cases exercise local real processes; they do not
demonstrate deployed isolation or any provider/live path.

Not rerun: pinned OpenCode smoke/MCP integration (FIX48 does not alter the
client integration boundary); provider/catalog/live inference, key enrollment,
hardware, VM, firewall or network-policy operations (not authorized); five-run
Windows/Ubuntu campaign (pending publication at the final SHA).

Claim: this entry supports the reproduced baseline failure and one passing local
corrected default-concurrency suite on Windows, based on the tabled commands. It
does not support deterministic cross-platform reliability or closure of #48,
which requires five consecutive passing originals per platform at one final SHA
and verified propagation into PRs #45/#51.

### FIX48 focused revalidation — 2026-11-28

Environment: Windows x64, Node.js v24.22.1 (`fnm`).

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `fnm exec --using=24.22.1 node --test test/repeat-default-suite.test.mjs test/subprocess.test.mjs test/scheduler.test.mjs test/mcp-server.test.mjs test/task-maintenance.test.mjs` | Recheck final FIX48 runner, subprocess, scheduler, MCP and maintenance cases under default test concurrency | 88 total, 87 pass, 0 fail, 1 platform skip | 0 |
| `git diff --check` | Check the final documentation/test diff whitespace | no output | 0 |

Result: focused assertions passed, including the B12 scheduler process tests and
the FIX48 runner's rejection of failed samples, dirty checkout and revision
changes. The one skip is the existing Windows-platform skip for the POSIX-only
SIGTERM case. This is local Windows evidence only; it is not a repeated-suite
campaign or cross-platform CI result. The full suite/demo results above were
executed on 2026-11-27 before this focused-only rerun; no code changed between
those runs.

## FIX48 publication checkpoint — 2026-11-28

Published the task as draft PR #52:
https://github.com/pbsilvabd/ai-orchestrator/pull/52

| Check | Observed result |
| --- | --- |
| Base | `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` |
| Initial implementation head | `f88ffc54467220bd02c9c16f685bcd3bf52efcb4` |
| Remote branch | `task/FIX48-concurrency-stability` matched the pushed initial head |
| Initial CI run | `46107199648` queued on Windows and Ubuntu at the initial implementation head |
| PR status | OPEN/DRAFT; no merge or ready transition |

The acceptance campaign must run on the final updated PR head. This checkpoint
does not count any queued or superseded run as passing evidence; the draft PR
remains incomplete until a single clean SHA has five passing original suites on
each OS and propagation is verified on #45/#51.

## FIX48 first Windows/Ubuntu repeated campaign — 2026-11-28

Actions run `46107344778`:
https://github.com/pbsilvabd/ai-orchestrator/actions/runs/46107344778

The pull request run head was
`1a2bd5fa09b4cf1bff53bbb7cfef3844df329f80`. GitHub Actions checked out merge
commit `bfbeda97d78137de92e590184cef6e26cdeb4321` on both runners; its parents
are base `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` and the PR head above.
Each runner independently checked a clean checkout before and after every
sample and reported the same unchanged SHA for all five originals.

| OS / job | Sample | SHA | Tests / pass / fail / skip | Native exit |
| --- | ---: | --- | --- | ---: |
| Windows `windows-latest` / 140862999664 | 1 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140862999664 | 2 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140862999664 | 3 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140862999664 | 4 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140862999664 | 5 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 309 / 0 / 1 | 0 |
| Ubuntu `ubuntu-latest` / 140862999911 | 1 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140862999911 | 2 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140862999911 | 3 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140862999911 | 4 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140862999911 | 5 | `bfbeda97d78137de92e590184cef6e26cdeb4321` | 310 / 306 / 0 / 4 | 0 |

Every sample's JSON result and both five-result summaries were retrieved from
the job logs. Runner step and complete workflow passed on both OSes; demo steps
returned 429 then 200. The initial run `46107199648` at superseded head `f88ffc5`
was canceled by Actions concurrency and is not acceptance evidence.

This campaign passes the ten-sample requirement for the `1a2bd5f` PR content.
No merge or live/deployment acceptance is implied.

## FIX48 final-head campaign and propagation receipt — 2026-11-28

Actions run `46108300145`:
https://github.com/pbsilvabd/ai-orchestrator/actions/runs/46108300145

The PR head was `9b34a8c102af301f511c25c744caab3cb1e1ac36`. Both Actions
platform jobs checked out the same PR merge commit
`7366b2218583d924614105a4d8dc17c5ff4ca858`, whose parents are base
`f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` and that PR head. Every original
sample reported that exact SHA and a clean, unchanged worktree before and after
execution.

| OS / job | Sample | SHA | Tests / pass / fail / skip | Native exit |
| --- | ---: | --- | --- | ---: |
| Windows `windows-latest` / 140865912851 | 1 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140865912851 | 2 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140865912851 | 3 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140865912851 | 4 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140865912851 | 5 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 309 / 0 / 1 | 0 |
| Ubuntu `ubuntu-latest` / 140865912683 | 1 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140865912683 | 2 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140865912683 | 3 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140865912683 | 4 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140865912683 | 5 | `7366b2218583d924614105a4d8dc17c5ff4ca858` | 310 / 306 / 0 / 4 | 0 |

The raw per-sample JSON results and both aggregate summaries were inspected in
the job logs. Both full platform jobs and fallback demos succeeded; each demo
returned 429 then 200. The earlier canceled run `46107199648` remains excluded.
Together with run `46107344778`, both campaign heads have ten passing original
samples; neither substitutes for the other.

FIX48-06 propagation is verified at current remote PR heads: #45 is OPEN/DRAFT
at `4d51a393159ce1023718909da022f5b2617d1db5`, based on `f61e5e1`, and its
exact-head CI run `46109747250` passed on Windows and Ubuntu. Stacked #51 is
OPEN/DRAFT at `e1a08d4388945362e555ec3786e50c7fe60ac394`, based on #45 head
`4d51a393159ce1023718909da022f5b2617d1db5`; exact-head run `46111699960`
passed on both platforms. The seven FIX48 paths (workflow, runner, four test
files and task card) match between #52, #45 and #51. Both PRs remain drafts; no
merge, ready transition or live/deployment acceptance is implied.

## FIX48 receipt-head campaign — 2026-11-28

Actions run `46113674523`:
https://github.com/pbsilvabd/ai-orchestrator/actions/runs/46113674523

This run tested PR head `9bb1a41e2220ea1ef70d378054a1bd6f52116e16` in both
platform jobs at common merge checkout
`a9c0caaada4ddc7fbff79017d2fe4d563bac85b1`, with parents base
`f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` and that PR head. All five original
samples per platform ran sequentially under default concurrency and reported
the same checkout SHA, clean/unchanged worktree and native exit 0.

| OS / job | Sample | SHA | Tests / pass / fail / skip | Native exit |
| --- | ---: | --- | --- | ---: |
| Windows `windows-latest` / 140882585751 | 1 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140882585751 | 2 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140882585751 | 3 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140882585751 | 4 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 309 / 0 / 1 | 0 |
| Windows `windows-latest` / 140882585751 | 5 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 309 / 0 / 1 | 0 |
| Ubuntu `ubuntu-latest` / 140882585921 | 1 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140882585921 | 2 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140882585921 | 3 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140882585921 | 4 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 306 / 0 / 4 | 0 |
| Ubuntu `ubuntu-latest` / 140882585921 | 5 | `a9c0caaada4ddc7fbff79017d2fe4d563bac85b1` | 310 / 306 / 0 / 4 | 0 |

The raw result records and aggregate summaries were inspected in the job logs.
Both platform jobs and fallback demos succeeded; both demos returned 429 then
200. Run metadata confirms success at the PR head above. This documents the
receipt-head campaign; run `46108300145` remains the final-code-head campaign.

## B30 synchronous-verifier correction and main reconciliation — 2026-11-28

Environment: Windows x64, Node.js v24.22.1 via fnm. Local branch
`task/FIX48-propagate-B30`; correction commit `e1e6c967ab04db9e3572d4778c548b6d23ec4a3a`;
remote main merged from `04c6e5f80d4a54a20203922fd8ee259419dd069c`.

| Command | Result | Exit |
| --- | --- | ---: |
| `fnm exec --using=24.22.1 -- node --test test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs` | Focused admission/revalidation regressions passed, including Promise and thenable resolve/reject paths and rejection observation | 0 |
| `fnm exec --using=24.22.1 -- node --test` | 454 tests, 449 pass, 0 fail, 5 skips | 0 |
| `fnm exec --using=24.22.1 -- node examples/fallback-demo.mjs` | Fallback demo returned 429 then 200 | 0 |
| `git diff --check` | Clean; no whitespace errors | 0 |

The source correction refuses asynchronous trusted admission, worker validation and
receipt revalidation synchronously as `internal`, attaching a rejection observer
before returning. Pre-reservation refusal remains `cancelled` with no attempt;
post-reservation refusal remains `blocked` with the attempt preserved and no replay.
`origin/main` reconciliation kept main's current FIX48 campaign receipts and restored
the B30 append-only validation/worklog entries.

Evidence level: local unit/process tests and fallback demo only. The merge and
documentation reconciliation do not establish deployment, cross-compartment
composition, positive FIDO2 approval or live use.

Not run: pinned OpenCode smoke/relay fixture, current-head GitHub CI, independent
critical re-review, #51 propagation, VM/netns/firewall work, TLS/provider/catalog
requests, hardware signing, FIDO2, live inference or merge. #45 remains OPEN/DRAFT;
#46/#47/#48 and deployment acceptance remain incomplete.

## B30 final-tree revalidation after main merge — 2026-11-28

Revision: `6b155213950d2eae070f34bcde0cc2ec164a29d0` (merge of local correction
`e1e6c96` and `origin/main` `04c6e5f`). The merge-resolution commit changes only
the six reconciliation/receipt documents relative to its first parent; the
source/test correction is unchanged.

| Command | Result | Exit |
| --- | --- | ---: |
| `fnm exec --using=24.22.1 node --test test/live-approval-service.test.mjs test/live-approval-pre-spawn.test.mjs` | 29 tests, 29 pass, 0 fail, 0 skips | 0 |
| `fnm exec --using=24.22.1 node --test` | 454 tests, 449 pass, 0 fail, 5 skips | 0 |
| `fnm exec --using=24.22.1 node examples/fallback-demo.mjs` | Mock preferred returned 429; fallback returned 200 | 0 |
| `git diff --check` and base-to-head whitespace checks | Clean | 0 |

The full-suite skips are platform/tool availability skips, including four
OpenSSL-dependent TLS fixture cases and one Windows-only process case on this
Windows run; they are not reported as passed. `git diff origin/main...HEAD`
shows the B30 task implementation and correction; `git diff HEAD^1 HEAD` is
documentation-only. The relevant correction diff, acceptance rows and PR review
history were inspected. No code changes followed these tests.

Not run: pinned OpenCode smoke, VM/namespace/firewall/deployment campaign,
provider/catalog requests, real keys or positive FIDO2, live inference, exact
head GitHub CI or independent review of this new SHA. The PR's prior exact-head
checks/reviews do not transfer to this commit. Keep #45 OPEN/DRAFT and live
closed; no merge is authorized.

Publication follow-up: pushed the correction and reconciliation normally to
PR #45 as `05c39828e1c1f03197c1685c4dabb6136a562df1`; `git ls-remote` and PR
metadata agreed on the SHA, and the PR remained OPEN/DRAFT. Actions run
`46125175156` was queued for that exact head. A SHA-bound critical re-review was
requested in [comment 7236498297](https://github.com/pbsilvabd/ai-orchestrator/pull/45#issuecomment-7236498297).
Neither CI completion nor independent re-review is claimed.

# Reproducible validation

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

## B27 CI foundation — 2026-11-04

Executed locally on the `task/B27-ci-foundation` worktree with the Node.js 24.22.1
toolchain pinned in `.node-version`.
Date: 2026-11-04. Base: `origin/main` at `c6bb77a`.

| Command | Result | Exit |
| --- | --- | --- |
| `npm run check` on a clean tree | Syntax, schema, suite and whitespace gates pass | 0 |
| `node --test` | 208 passed, 0 failed, 2 skipped | 0 |
| `npm ci` after removing `node_modules` | Installs from `package-lock.json` only | 0 |
| `npm audit --audit-level=high` | 0 high-severity advisories | 0 |
| `./gitleaks detect --source . --config .gitleaks.toml --redact --no-banner --exit-code 1` | No leaks; test `idempotencyKey` fixtures excluded by the allowlist | 0 |
| Same scan with a seeded token outside the allowlist | Redacted finding reported | 1 |
| GitHub Actions `check`, `test` matrix and `gitleaks` jobs | Run to be recorded — RUN_URL_TBD | TBD |

Result: the lockfile reproduces the dependency set, every action is pinned by SHA
with `contents: read`, and `npm run check` is the single local gate. The secret scan
stays fail-closed: the allowlist only suppresses `idempotencyKey` fixture literals
under `test/`, and the seeded-token run proves an unmatched secret still fails with
redacted output.

Evidence level: Unit and local integration — the suite, check gate, clean install,
audit and gitleaks runs execute in this checkout. The allowlist was validated by a
negative seeded-token run rather than by inspection alone. CI URLs are placeholders
until the workflow runs complete.

Not rerun: `node integration/opencode-smoke.mjs` and `node integration/mcp-gate.mjs`
(no runtime change; both need the pinned OpenCode binary outside the repository);
Windows-host execution of the PowerShell fixtures (covered by the remote matrix, not
by this local run).

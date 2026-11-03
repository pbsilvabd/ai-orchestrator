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

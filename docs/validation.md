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

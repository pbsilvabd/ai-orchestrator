# Real OpenCode integration tests

Run separately from local tests, using Node 24 and a pinned official binary.

## MCP capability gate

```sh
node integration/mcp-gate.mjs /absolute/path/opencode.exe
```

Passing run on 2026-11-02 (Windows x64, Node.js v24.22.1, OpenCode 2.2.5)
printed:

```json
{"version":"2.2.5","protocol":"2026-07-28","server":"local stdio","transport":"codemode execute","discovered":true,"catalogued":true,"called":true,"resultInContext":true,"legacyHandshake":false,"providerRequests":5}
```

`providerRequests` is informational; it includes auxiliary host work.

The harness:

1. Creates an isolated temporary config/data/state tree and a loopback fixture
   provider, mirroring the smoke test.
2. Adds one `type: "local"` MCP server that runs `integration/mcp-fixture.mjs` with
   `protocol: "2026-07-28"`.
3. Starts `opencode serve` and sends one warm-up prompt so the Location boots and
   connects the server.
4. Waits for the host log `message="mcp connected" server=orchestrator tools=1`
   before sending the probe prompt. OpenCode connects MCP servers asynchronously and
   the CLI snapshots the tool registry before connection, so a single `run` can miss
   the tool. The warm-up mirrors a user message sent after the app has settled.
5. Drives the default Code Mode path: the fixture model calls `execute` with
   `tools.orchestrator.probe_echo({ message: 'GATE_FIXTURE' })`.
6. Asserts discovery (`server/discover`), `tools/list`, one `tools/call`, the
   `probe:GATE_FIXTURE` result reaching model context and the absence of the legacy
   `initialize` handshake. It also checks that every request carries
   `_meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"`.

`integration/mcp-fixture.mjs` is a minimal stateless MCP server: it logs JSONL to
`MCP_FIXTURE_LOG`, records calls to `MCP_FIXTURE_CALLS`, and returns `ttlMs` and
`cacheScope` from `tools/list`. It is not the task service and implements no
operation from the contract.

Set `MCP_GATE_DEBUG=1` to print host/probe output, the provider request log and the
MCP transcript, and to keep the temporary directory for diagnosis. Without it the
harness removes the directory and reports a cleanup failure instead of hiding the
original error. Windows process-tree termination and process-close waits are each
capped at five seconds; cleanup preserves the gate failure if it also fails. Readiness waits default to 30
seconds; commands default to 120 seconds. `MCP_GATE_READINESS_TIMEOUT_MS` and
`MCP_GATE_COMMAND_TIMEOUT_MS` accept smaller positive values (up to those defaults)
for bounded failure experiments. `MCP_GATE_FORCE_CLEANUP_ERROR=1` is a diagnostic
fixture that deliberately reports cleanup failure and retains its temporary tree;
remove that exact printed path after the experiment.

Limits: the gate proves that the pinned host can connect, list and call one local
stdio MCP tool over revision `2026-07-28` with Code Mode routing. It does not
validate the task contract, lifecycle, durability, ownership or the executor
adapter. A future protocol revision or a different host is not covered.

## B15 task adapter gate

Run the actual task service over stdio through the pinned client and a local fixture
provider:

```sh
node integration/mcp-task-gate.mjs /absolute/path/opencode.exe
```

The gate first starts `mcp-server.mjs` as a child and verifies idle stdin EOF releases
service ownership without writing non-protocol data to stdout. It then creates a
temporary Git repository and state home, starts OpenCode 2.2.5 with the B15 server,
confirms that all four tools are catalogued, submits one fixture task through
`submit_task`, and confirms the queued response reaches the model context and durable
task record. The provider is a loopback fixture; no real model, paid call or external
credential is used. The command reports the protocol revision, client version, tool
discovery and submitted task ID. It does not exercise the B16 polling/result workflow
or prove production-provider behavior.

Observed on 2026-11-11 (Windows x64, Node.js v24.22.1): the pinned OpenCode 2.2.5
client discovered the four tools, called `submit_task`, and received the persisted
`queued` result in model context; the gate exited 0.

## B16 pinned-client task workflow

Run the full task lifecycle through OpenCode 2.2.5, the B15 stdio adapter and a
temporary task service configured with a harmless local Node worker:

```sh
node integration/mcp-client-workflow.mjs /absolute/path/opencode.exe
```

The gate verifies the pinned binary version and explicitly checks that a missing
binary fails with `ENOENT`. Git fixture setup clears inherited `GIT_*` overrides,
uses temporary-only configuration and templates, and verifies the resolved worktree
and Git directory. A canary with an active branch and staged file is snapshotted
before a child run inherits hostile `GIT_DIR`/`GIT_WORK_TREE`; the run must fail at the
missing-binary phase while the canary config, index, refs, branch and status remain
unchanged.

A loopback fixture provider drives actual Code Mode MCP calls for a scratch repository.
The harness records request IDs and parsed response frames, then checks the correlated
`queued`, `running` and `succeeded` replies, returned changed path, diff, test command
and exit code. The primary worker waits until the client has received `running` before
it can finish. A separate CLI process repeats the exact submission twice; both returned
IDs and replay flags are checked against the original acceptance, along with one attempt
and one workspace.

For cancellation, the harness waits for the worker to write a start marker and partial
workspace output, then cancels it. It checks the transport response, `unknown` stop
evidence, worker-root exit and preserved partial diff. For host interruption, it waits
for worker-written output and an append-only invocation counter, terminates the OpenCode
process group, and restarts the service with dispatch enabled. MCP must report
`blocked/service-restart` with unknown stop evidence, the same workspace output remains,
and the counter stays at one. The result explicitly has no collected diff after restart;
the gate does not imply that startup collected artifacts. Fixture-only stale service
locks are removed only after checking that the owning process is dead.

Startup-failure coverage exercises both a live host plus descendant that time out and a
leader that exits before readiness while its descendant stays alive. POSIX cleanup
signals the process group after leader exit. The Windows gate uses the inbox .NET
Framework C# compiler to build a temporary launcher. On Windows 10 and later,
`CreateProcessW` assigns the host to a Job Object at creation. The launcher terminates
the job and checks for zero active members before returning. The regression lets the
leader exit immediately, reads the detached child PID from an assertion-only file,
and checks that the child exits and an unrelated sibling named in stdout stays alive.
Git canaries also
inject uppercase, lowercase and mixed-case Git directory/worktree overrides; the fixture
uses an allowlisted environment and pins resolved Git paths inside each scratch repo.
The primary client carries the task ID from its submit tool reply into every poll, and
the terminal tool response independently checks both status.taskId and result.taskId.

Set `B16_DEBUG=1` to retain the temporary tree and last sanitized provider request
for diagnosis. No real model, paid call or external provider credential is used. The
gate validates the pinned client/transport/service lifecycle with a fixture worker;
it does not establish production-provider behavior, model quality or use on this
repository.

## B17 executable M2b acceptance matrix

Run all thirteen normative items in `docs/task-contract.md` and emit one JSON report
with `pass`, `fail` or `not_run` for each item:

```sh
node integration/acceptance-matrix.mjs --opencode /absolute/path/opencode.exe --report /path/to/b17-report.json
```

The local items launch their named Node tests separately and require an observed TAP
test, zero skipped cases and a zero process exit. The pinned-client items run the
full B16 workflow once and validate its machine-readable summary, including the
correlated queued/running/succeeded status polls in order as returned in the pinned
client's Code Mode provider payloads, duplicate replay, actual result in provider
context, cancellation and restart without replay. The B16 fixture
holds its real scheduler callback until it has returned the persisted queued record
to the pinned client's first status poll; it neither fabricates status nor changes
runtime behavior. Omitting the binary, a missing
scenario, or a skipped required test is recorded as `not_run`; any missing or
non-passing item makes the overall process exit nonzero. The optional report path
must not already exist. The report omits raw test output and local binary paths.

The pinned client must be the trusted OpenCode 2.2.5 binary described below. This
fixture provider is loopback-only and does not use a paid or external model. Passing
the matrix is M2b acceptance evidence; it does not demonstrate model quality,
production-provider support or M3 use on this repository.
The current local report is committed at
[docs/evidence/B17-acceptance-matrix.json](../docs/evidence/B17-acceptance-matrix.json).

## Session/model smoke test

Run separately from local tests, using Node 24 and a pinned official binary:

```sh
node integration/opencode-smoke.mjs /absolute/path/opencode.exe
```

Validated on Windows x64 with OpenCode 2.2.5 on 2026-11-02. The binary is neither
installed globally nor committed to this repository. Obtain it from the
[official release](https://github.com/anomalyco/opencode/releases/tag/v2.2.5).
ZIP used: `opencode-windows-x64.zip` (121962397 bytes).
SHA-256 verified against the published release digest:
`2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8`.

The script checks the version, but does not download or verify the supplied
executable's hash; the caller must supply a trusted binary. Other platforms have
not been validated.

## What it runs

1. Creates a temporary directory, isolated configuration/data/cache and a server on 127.0.0.1.
2. Uses the built-in OpenAI-compatible provider, an empty catalog and a fake credential.
3. Executes `run --standalone --format json` with a context marker.
4. Starts another process with the same session and a different simulated model.
5. Checks both markers and the previous response in the payload received by the provider.
6. Emits a `write` call from the simulated model with all tools denied.
7. Verifies rejection in the output and absence of the target file.

Observed result: two prompts, four requests (including auxiliary host work), the
same session, preserved context, explicit model switching and denied writes.
Request count is informational, not an acceptance criterion.

## Limits and shutdown

This test has no real model, paid call or runner integration. It does not establish
automatic fallback, replay safety, in-flight recovery or completion of M2.
The tested permission policy is deny-all; it does not validate every tool policy.
It installs no community plugins and uses no personal credentials/configuration.
Isolation covers configuration/processes; it is not an outbound firewall.

Each command has a 45-second timeout. On Windows, timeout terminates the process
tree created by the test. Temporary directories are removed on completion;
cleanup failures report the path for diagnosis without masking the original error.

Harness fix: CLI stdin must be closed. The run implementation reads until EOF
before submitting the prompt, even when the message is supplied as an argument.
The initial timeout came from the harness; a server defect was not established.

Contracts inspected at OpenCode commit `9bbb8ce18c80f099e0e448775f59d965ead40a21`:
`packages/cli/src/run/run.ts`, `packages/plugin/src/promise/session.ts`,
`packages/schema/src/config/provider.ts`, `packages/schema/src/permission.ts`,
`packages/core/src/tool/plugin/write.ts`. The retry hook controls retry/delay;
the readonly model is not an atomic switching mechanism. Do not implement fallback
by repeating run/prompt without validating the effect boundary.

## B11 authorized invocation

Run separately from local tests with the pinned OpenCode binary:

```sh
node integration/opencode-invocation.mjs /absolute/path/opencode.exe
```

The launch builder requires a receipt-verified workspace descriptor at the accepted
base commit, one exact configured model, supported `read`/`edit` tools, exact
repository-relative writable globs and limits within the configured caps. It denies
all host permissions by default, then allows reads in the task workspace and edits
only for accepted globs. It rejects a workspace containing symlinks or junctions,
since OpenCode path permissions match lexical paths and a link could redirect an
allowed edit outside the workspace. `bash` is rejected because shell command permissions cannot
be confined by file-path globs. Prompt content is serialized as positional JSON data.

The harness creates a temporary Git repository and obtains a real receipt-verified
worktree from B09, then runs OpenCode 2.2.5 against a local OpenAI-compatible fixture
provider. It poisons ambient config/credential variables, then asks the fixture model
to call `write` outside the authorized glob and expand its permissions. It verifies the
host returned a denied tool result and the forbidden file was not created. A second
fixture request writes inside `src/**` and verifies the bytes before removing the
test file. A junction/symlink escape fixture also verifies launch rejection and an
unchanged outside sentinel. The test does not make an external or paid call.

FIX23 adds a regular hard-linked file fixture and an OPENCODE_CONFIG_CONTENT override
attempt. Both are rejected by the builder before launch; the external sentinel stays
unchanged and the provider receives no extra requests. Ordinary launches still use
the pinned host to verify real denied and allowed writes. Only FIXTURE_API_KEY is
accepted in providerEnvironment for the currently supported loopback fixture.

The B12 extension also submits through `createTaskService({ worker })`, verifies
prompt queued acceptance and duplicate-ID replay, waits for its scheduler, observes
one durable attempt and checks an allowed write in its B09 worktree. It uses
`createOpenCodeWorker` to prepare per-attempt isolated runtime files and B10 to run
the child. The JSON report includes `serviceSchedulerDispatch: true`. A zero host
exit without a recorded test command remains an explicit result limitation. The
harness explicitly removes its known fixture output and clean worktrees; the
scheduler itself never removes workspaces. Uncertain shutdown retains state.

Limitations: the helper currently accepts only loopback fixture providers. No MCP
task transport, production provider or self-development gate is covered. It is not
an OS sandbox or outbound network firewall. `PATH` and other required Windows OS variables remain in
the explicit host environment and need deployment-specific review before any real
provider or worker is authorized.

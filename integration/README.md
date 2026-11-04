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

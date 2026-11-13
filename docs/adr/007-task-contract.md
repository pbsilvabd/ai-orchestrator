# ADR-007 — Task contract, first transport and reuse decision

Date: 2026-11-02. Status: accepted for M2a; capability gate passed 2026-11-02.
Implementation target: M2b.

## Context

[ADR-006](006-worker-service.md) set the product direction and split M2 into contract
and reuse (M2a), one-worker delegation (M2b) and safe fallback (M2c). M2a requires a
written task contract, one selected client and transport, and a reuse/build decision
with pinned versions, licenses, evidence and gaps. No task service exists yet.

## Decision

1. The contract in [task-contract.md](../task-contract.md) is normative for M2b.
2. The first transport is **MCP over stdio**, protocol revision `2026-07-28`.
3. The first supported client is **OpenCode 2.2.5**, pinned at commit
   `9bbb8ce18c80f099e0e448775f59d965ead40a21`, subject to the capability gate below.
4. The service is a **small in-repo Node process with no third-party runtime
   dependency**. A hand-written stateless stdio server for `server/discover`,
   `tools/list` and `tools/call` is sufficient for four operations and keeps the wire
   format testable. Revision `2026-07-28` has no `initialize` handshake: each request
   carries the protocol version in `params._meta`.
5. The executor is the **OpenCode CLI as a subprocess** in an isolated worktree. The
   plugin/fallback path is not used in M2b; fallback is M2c.
6. Task state is stored with the **atomic JSON pattern from ADR-004**, not with a
   workflow engine. LangGraph, Temporal-like durability, LiteLLM and OpenHands are not
   adopted now.

If the gate fails, the same operations are exposed over a **loopback HTTP API with a
token file readable only by the operating-system user**. Operation semantics, records
and tests do not change; only the transport adapter does.

## Capability gate (first M2b step)

Before implementing the task store, run a time-boxed spike against the pinned host:
configure one local stdio server, confirm tool discovery and one `tools/call`, and
record the transcript in `docs/validation.md`. The gate fails if the pinned client
cannot start a stdio server, rejects the advertised protocol revision, or cannot pass
a structured JSON result. A failed gate selects the HTTP fallback and is recorded as
an amendment here, not silently.

### Gate result (2026-11-02)

**Passed.** OpenCode 2.2.5 started `integration/mcp-fixture.mjs` as a local stdio
server with `protocol: "2026-07-28"` and completed `server/discover`, `tools/list` and
one `tools/call`. The tool was catalogued to the fixture model as
`tools.orchestrator.probe_echo` through the default Code Mode `execute` path, and the
result `probe:GATE_FIXTURE` reached model context. No `initialize` request appeared;
every request carried
`_meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"`. The transcript is
recorded in [validation](../validation.md) and the harness is described in
[integration/README.md](../../integration/README.md). MCP over stdio stays the first
transport; the HTTP fallback is not selected.

## Reuse evaluation

Method: static repository metadata and license files retrieved 2026-11-02. **No
candidate was installed, executed or vendored.** Evidence is therefore desk research
plus the previously recorded OpenCode host smoke; it does not demonstrate runtime
compatibility, cost or safety.

| Candidate | Pinned | License | Evidence | Gap for our contract | Verdict |
| --- | --- | --- | --- | --- | --- |
| OpenCode 2.2.5 (`anomalyco/opencode`) | commit `9bbb8ce18c80f099e0e448775f59d965ead40a21` | MIT | Host smoke: session/context continuity, explicit model switch, denied write | No task lifecycle, ownership, artifact store or durable budget | **Adopt as executor** |
| MCP specification | revision `2026-07-28` (stable) | Spec published by the MCP project | Gate passed 2026-11-02: discover/list/call over local stdio | No task lifecycle or wire-level conformance suite yet | **Adopt as transport** |
| `@modelcontextprotocol/typescript-sdk` | `v2.4.0` | MIT to Apache-2.0 transition; per-file status | None | Adds a dependency and a mixed-license surface for three methods | **Defer; adopt only if the hand-written server fails conformance** |
| LiteLLM (`BerriAI/litellm`) | `v1.106.6` | MIT outside `enterprise/`, separate license there | None | Python service; routing is not needed for one authorized model | **Defer to M2c/M5** |
| OpenHands (`All-Hands-AI/OpenHands`) | `v1.34.0` | MIT | None | Overlapping executor, heavier runtime | **Keep as alternative, do not adopt** |
| LangGraph (`langchain-ai/langgraph`) | `1.2.19` | MIT | None | Durable graph orchestration unnecessary for one worker; ADR-004 covers the state we need | **Do not adopt** |
| This repository's policy, ledger, runner | current `main` | MIT | 43 local tests, loopback HTTP tests | Operation-level only; no task identity or artifacts | **Reuse as primitives** |

OpenHands and LiteLLM remain candidates only for later milestones. Nothing is pinned
as a dependency by this ADR.

## Consequences

### Amendment — 2026-11-03: receipt-verified Git workspaces (B09)

The task workspace helper creates a linked Git worktree at the accepted immutable
`baseCommit` and accepted task branch. A receipt outside the repository binds the
task ID, canonical repository, base, branch and owned path. Duplicate calls reuse
the workspace only after receipt, path, Git common directory, branch and base
ancestry checks. Existing unrelated paths and branches are never adopted.

Cleanup is an explicit operation. It removes only an unchanged, clean task worktree
whose branch still points at the accepted base. Dirty, advanced, moved or tampered
workspaces are preserved. An interrupted setup retains its receipt and any output
for manual inspection; there is no broad recursive deletion or automatic recovery.
This does not provide worker dispatch, process-tree stop proof or effect rollback.

### Amendment — 2026-11-04: hidden index changes

Cleanup refuses skip-worktree and assume-unchanged entries before relying on Git
status. Those flags can hide modified tracked output from both status and worktree
removal checks. Refusal preserves the files, branch, receipt and index flags; the
helper does not change the worker's index to make cleanup appear safe.

- M2b delivers a service process plus a transport adapter, a task store and one
  executor adapter; it does not deliver routing, memory or remote access.
- Writing the stdio server by hand creates a conformance risk. It is bounded by the
  gate above and by wire-level tests; adopting the official SDK is the documented
  remedy and requires a new decision entry here.
- Task state lives outside the repository, so tests must use temporary directories and
  must not read the developer's real state directory.
- Windows process control needs explicit handling: the executor runs in a worktree,
  cancellation is advisory, and child processes may survive an abort. `blocked` is the
  expected outcome whenever a stop cannot be proven.
- Cost remains unknown until a real provider is authorized; results must say
  `cost.known: false` rather than estimate.
- The contract can change only with the code and the tests in the same change.

### Amendment — 2026-11-12: Windows host containment for the B16 fixture

The opt-in B16 Windows harness builds a temporary launcher with the inbox .NET
Framework C# compiler. The launcher uses Windows 10+ creation-time Job Object
assignment and owns the job handle. It confirms the job is empty before the harness
removes its fixtures. This decision applies to test host teardown. The service still
reports uncertain task execution according to the task contract.

## Revisit triggers

Revisit this ADR when: the capability gate fails; M2b cannot meet an acceptance test
with the hand-written server; a second client is supported; remote access is proposed;
or M2c requires routing that our runner cannot express.

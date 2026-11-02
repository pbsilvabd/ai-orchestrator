# AI Orchestrator

## Start here (any model or agent)

Read, in order: this file, [docs/handoff.md](docs/handoff.md),
[docs/roadmap.md](docs/roadmap.md), [docs/task-contract.md](docs/task-contract.md) and
the ADRs referenced by the current milestone. Check `git log` and the remote before
editing; another agent may have moved the repository since the handoff was written.

Current state (2026-11-02): M0/M1a/M1b complete within their local scope, M2a
complete, M2b step 1 (MCP capability gate) passed. M2b step 2, the task store, is
next. The gate confirmed OpenCode 2.2.5 discovery, cataloguing and one call over
revision `2026-07-28` via local stdio; see
[ADR-007](docs/adr/007-task-contract.md) and [validation](docs/validation.md).

## Toolchain

- Node.js 24.22.1 (`engines: >=24 <25`), managed by fnm (`fnm use`).
- No `npm install` is required; the project has no runtime dependencies.
- Run `node --test` and `node examples/fallback-demo.mjs` from the repository root.
- `integration/opencode-smoke.mjs` needs the pinned OpenCode 2.2.5 binary outside the
  repository; see [integration/README.md](integration/README.md).

## Rules

- Integration reference: OpenCode 2.2.5; read docs/plugin-audit.md before enabling plugins.
- Run `node --test` and the demo when changing the policy.
- No paid calls or credentials in source files, tests or logs.
- Never treat an uncertain tool outcome as safe to replay.
- Keep changes small and documented. Use branches by default; direct main commits require maintainer authorization. Never force push.
- Do not claim validated integration based only on mocks.
- Write documentation, comments and user-facing repository messages in English.

## Documentation duties (every change)

- Update [docs/roadmap.md](docs/roadmap.md) status and
  [docs/handoff.md](docs/handoff.md) next action when a milestone moves.
- Append an entry to [docs/worklog.md](docs/worklog.md): date, milestone, branch,
  steps, files and validation. Never rewrite past entries.
- Record commands and results in [docs/validation.md](docs/validation.md); state what
  was not rerun.
- Add or amend an ADR when a decision, dependency or trust boundary changes.
- Keep [docs/task-contract.md](docs/task-contract.md) normative: code, tests and
  contract change together.
- Keep evidence levels separate (unit, local HTTP, OpenCode integration, use on this
  project). Mocks never satisfy an integration gate.

## Runtime state

The service stores task records under `AI_ORCHESTRATOR_HOME` (default
`%LOCALAPPDATA%\ai-orchestrator` on Windows), never inside the repository. Tests must
use temporary directories and must not read a developer's real state directory.

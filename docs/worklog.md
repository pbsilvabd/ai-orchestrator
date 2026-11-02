# Work log

Append-only record of merged increments, written for the next model or maintainer
picking up the repository. GitHub remains authoritative for PR numbers and commit
SHAs; this file records intent, steps and evidence.

Rules:

- One entry per merged change, newest last.
- Never rewrite or delete a past entry; correct it with a new entry.
- Every change appends its own entry in the same branch/PR.
- Update [handoff](handoff.md) when the next action changes.

Template:

```md
## YYYY-MM-DD — <milestone>: <short title>

- Branch: `<branch>`
- Scope: docs | code | tests | mixed
- Steps: ...
- Files: ...
- Validation: `command` → result
- Follow-up: <next concrete action>
```

## 2026-11-02 — M2a: task contract, transport and reuse decision

- Branch: `docs/m2a-task-contract`
- Scope: docs only; no executable behavior changed.
- Steps:
  1. Read ADR-001..006, requirements, roadmap, DoD, validation and handoff.
  2. Specified the task contract: four operations, request/response shapes, error
     codes, idempotency, lifecycle, restart, ownership, limits and artifacts.
  3. Selected MCP over stdio (spec revision `2026-07-28`) with OpenCode 2.2.5 as the
     first supported client, behind a capability gate.
  4. Recorded the reuse/build decision with pinned versions, licenses, evidence and
     gaps; no candidate was installed.
  5. Aligned README, requirements, roadmap, DoD, validation and handoff.
  6. Added this work log and expanded `AGENTS.md` so any model can resume safely.
- Files: `docs/task-contract.md`, `docs/adr/007-task-contract.md`, `docs/worklog.md`,
  `AGENTS.md`, `README.md`, `docs/requirements.md`, `docs/roadmap.md`,
  `docs/definition-of-done.md`, `docs/validation.md`, `docs/handoff.md`.
- Validation: `node --test` → 43 passed, 0 failed; `node examples/fallback-demo.mjs`
  → 429 then 200; local Markdown links checked. Runtime integration was not rerun.
## 2026-11-02 — M2b step 2: durable task store and idempotency index

- Branch: `feat/m2b-task-store`
- Scope: code and tests.
- Steps:
  1. Defined `src/tasks.mjs` as a primitive record store with `createTask`, `readTask`,
     `updateTask`, `listTasks`, `reconcile` and `prune`.
  2. Implemented atomic writes via the exclusive temp file/fsync/rename pattern from
     ADR-004.
  3. Implemented an idempotency index based on `clientId` and canonical payload hash
     (sorted keys, no whitespace, skipping `clientSessionId`).
  4. Integrated startup reconciliation: `running` or `dispatched` tasks become `blocked`
     on restart; missing index entries are repaired from records.
  5. Added `test/task-store.test.mjs` covering idempotency, reconciliation, cross-process
     visibility, persistence failures and pruning.
  6. Recorded decision in ADR-008.
- Files: `src/tasks.mjs`, `test/task-store.test.mjs`, `docs/adr/008-task-store.md`.
- Validation: `node --test test/task-store.test.mjs` → 15 passed, 0 failed;
  `node --test` (full suite) → 63 passed, 0 failed.
- Follow-up: M2b step 3, the service surface (four operations with strict validation,
  ownership and allowlist clamping).

## 2026-11-02 — M2b step 1: MCP capability gate passed

- Branch: `feat/m2b-mcp-gate`
- Scope: tests (opt-in integration harness) and docs; no service or executor code.
- Steps:
  1. Compared the MCP revision `2026-07-28` stateless flow (`server/discover`,
     per-request `_meta` protocol version, no `initialize`) with the pinned host.
  2. Wrote `integration/mcp-fixture.mjs`, a minimal stateless local stdio server with
     one `probe_echo` tool, JSONL transcript and `ttlMs`/`cacheScope` in `tools/list`.
  3. Wrote `integration/mcp-gate.mjs`: isolated temp tree, loopback fixture provider,
     `opencode serve`, warm-up prompt, wait for `mcp connected`, Code Mode `execute`
     probe, transcript and context assertions.
  4. Diagnosed two harness defects (no wait for async connect; log line on stderr)
     and corrected them; the host behaved correctly throughout.
  5. Recorded the passing transcript and its limits in validation, amended ADR-007
     and updated roadmap, handoff and integration instructions.
- Files: `integration/mcp-gate.mjs`, `integration/mcp-fixture.mjs`,
  `integration/README.md`, `docs/adr/007-task-contract.md`, `docs/validation.md`,
  `docs/roadmap.md`, `docs/handoff.md`, `docs/worklog.md`, `AGENTS.md`.
- Validation: `node integration/mcp-gate.mjs <pinned opencode.exe>` →
  `{"version":"2.2.5","protocol":"2026-07-28","transport":"codemode execute","discovered":true,"catalogued":true,"called":true,"resultInContext":true,"legacyHandshake":false}`;
  `node --test` → 43 passed, 0 failed; `node examples/fallback-demo.mjs` → 429 then
  200. The gate is not part of `node --test` because it needs the external binary.
- Follow-up: M2b step 2, the task store (`AI_ORCHESTRATOR_HOME`, atomic JSON,
  idempotency index, startup reconciliation) with duplication/crash/restart tests.

## 2026-11-02 — M2b step 3: task service surface

- Branch: `feat/m2b-task-store`
- Scope: code and tests.
- Steps:
  1. Added `src/service.mjs`, the transport-neutral service surface over
     `openTaskStore` from `src/tasks.mjs`.
  2. `submit_task` validates strictly (unknown/missing fields, objective 1..4000,
     acceptance criteria 1..20, repository shape, path inside configured writable
     roots, branch format), checks authorization subsets against the configured
     allowlist and task limits against configured budgets, then persists and returns
     `{ schemaVersion, taskId, status, acceptedAt, idempotentReplay }`.
  3. `get_task_status` returns the status view with attempts, cancel, progress and
     `resultAvailable`, plus the block section only when blocked; ownership is checked
     against the service client.
  4. `get_task_result` returns terminal artifacts, caps the diff at 1 MiB with an
     explicit truncation flag, caps logs at 256 KiB, reports limitations for unverified
     success or missing failed artifacts, keeps cost unknown and marks the result
     sanitized.
  5. `cancel_task` handles queued -> cancelled (effect `not_started`), running ->
     blocked with `cancelled-uncertain` (effect `requested`) and terminal tasks
     (effect `already_terminal`).
  6. Store errors are mapped to `ServiceError` preserving the contract code and the
     OS error code; unexpected failures map to `internal` without details.
- Files: `src/service.mjs`, `test/task-service.test.mjs`.
- Validation: `node --test` → 72 passed, 0 failed (9 new service tests); `node
  examples/fallback-demo.mjs` → 429 then 200.
- Follow-up: M2b step 4, the executor adapter (one OpenCode CLI subprocess in an
  isolated worktree and branch, collecting diff, changed files and test evidence).

## 2026-11-02 — M2b step 3: service boundary corrections for PR review

- Branch: `feat/m2b-task-store` (review snapshot only; no commit or remote update)
- Scope: code, tests and docs.
- Steps: bound submissions to configured identity; initialize through one startup reconciliation and fail closed on conflicting indexes before mutating tasks; reject credential-shaped request text without mutating caller data; redact matching patterns in result text; resolve writable patterns from repository root and enforce repository/configured-root boundaries; enforce UTF-8 diff and combined output/log budgets with truncation flags; reject unknown operation fields; map cancel persistence errors; repair negative tests to submit request objects.
- Files: `src/service.mjs`, `src/tasks.mjs`, `test/task-service.test.mjs`, `docs/task-contract.md`, `docs/adr/008-task-store.md`, `docs/roadmap.md`, `docs/handoff.md`, `docs/validation.md`.
- Validation: `node --test` → 82 passed, 0 failed; `node --test ../../reviews/pr-4-review.test.mjs` → 9 passed, 0 failed; `node examples/fallback-demo.mjs` → expected 429 then 200.
- Follow-up: maintainer review before publishing/merging. MCP gate remains inconsistent; this change did not rerun or fix it.

## Independent final review — 2026-11-02

- Branch: `feat/m2b-task-store`; local corrections accepted for publication and merge.
- Final review preserves existing truncation flags, requires a test command for
  success evidence, and marks uncertain cancellation/restart stop state unknown.
- Independent checks: full suite 83 passed, external reproductions 9 passed,
  demo 429 then 200. Regression cases are covered in the versioned service suite.
- Full M2b remains incomplete. Resolve MCP gate instability before relying on it
  for executor/client integration. No live executor acceptance is claimed.

## 2026-11-02 — RFC proposal: declarative lifecycle state machine

- Branch: `rfc/0002-lifecycle-state-machine`
- Scope: documentation only (`docs/rfcs/0002-lifecycle-state-machine.md` plus the
  worklog and validation entries); no source, schema, test or ADR change.
- Steps: derived the legal status edges from the lifecycle block
  (`docs/task-contract.md:179-192`, ASCII fence `:179-188`), the cancellation rules
  (`:154-159`), the restart rule (`:202-204`) and the code that implements them
  (`src/tasks.mjs:278-289`, `src/service.mjs:266-297`); specified a per-status
  transition table checked at the store mutation boundary (`updateTask` plus the direct
  `writeTask` in `reconcile`); specified the single `validateTransition` entry point
  RFC-0001's checker must gain, with a status-keyed dispatch table instead of
  `if`/`then` or `oneOf`, and a table-coverage check that takes the known-status set as
  an argument so `src/contracts/` keeps zero imports; mapped the table to the 13 M2b
  acceptance tests; recorded five open questions instead of resolving them — open
  questions 1-3 are gaps between the lifecycle block and the code, open question 4 is the
  missing producer for rows 1, 4, 5 and 6, open question 5 confirms the write-time-only
  guard.
- Files: `docs/rfcs/0002-lifecycle-state-machine.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test` → 83 passed, 0 failed (unchanged; no code touched). The
  sibling RFC-0001 branch was read via `git show rfc/0001-contract-schemas:...` to align
  the subset table, error format, `assertSchema` behaviour and adoption path; the
  referenced `docs/rfcs/0001-contract-schemas.md` ships in that sibling PR and is not on
  this branch.
- Follow-up: RFC-0001 review, then RFC-0002 adoption step 1 (shadow table and
  `validateTransition`), then step 2 (store guard), which must also rewrite the fixtures
  that seed terminal records through `updateTask`. Rows 1, 4, 5 and 6 have no producer
  (open question 4); rows 7, 10 and 11 are documented but unimplemented (open questions
  2 and 3).
- Review fix round in the same entry: corrected the terminal-row evidence to the ASCII
  fence plus `task-contract.md:159` and added the `blocked`/`RESULT_STATUSES` clause;
  normalized lifecycle-block references to `:179-192`; moved the status-key coverage set
  from `TASK_STATUSES` (`src/service.mjs:16`) into an explicit `knownStatuses` argument;
  specified the empty-enum check inside `validateTransition` and the
  `Object.hasOwn`/prototype-key rules; declared that combinators and numeric bounds are
  both declined and that RFC-0001 records this in `f7c8db7`; added the fixture-breakage
  warning to adoption step 2.

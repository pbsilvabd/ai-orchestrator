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

## 2026-11-02 — Docs (outside milestones): core rules summary and reading order

- Branch: `docs/core-rules-distillation`
- Scope: docs only; no executable behavior changed.
- Steps:
  1. Distilled the rules already stated in the normative documents into
     `docs/core-rules.md`, marked non-normative, with a link to its source on every rule
     and a conflict rule that the normative document wins.
  2. Made it the first mandatory read in `AGENTS.md` and added the Definition of Done
     and `CONTRIBUTING.md` to the ordered list; the current-state text is unchanged.
  3. Commits: `chore: ignore local worktrees directory` (`.gitignore` only) and
     `docs: add core rules summary and fix required reading order`
     (`docs/core-rules.md`, `AGENTS.md` plus this work log entry and the validation
     entry; the second commit also carried both doc-duty files).
- Files: `docs/core-rules.md` (new), `AGENTS.md`, `.gitignore`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test` → 83 passed, 0 failed; `node examples/fallback-demo.mjs` →
  429 then 200. The MCP gate and OpenCode smoke integration were not rerun.
- Follow-up: open the PR; keep `docs/core-rules.md` in sync when a normative rule
  changes.
- Review fix round in the same entry: the permission rule now cites the roadmap line that
  owns it; the invented term "scale" was removed from `docs/core-rules.md` and
  `AGENTS.md`; the dependency rule keeps the CONTRIBUTING qualifier; the allowlist and
  uncertain-outcome rules are paraphrased instead of copied verbatim; the handoff duty
  states "when the next action changes"; and the page is 70 lines. The second commit is
  recorded accurately above: it also carried this entry and the validation entry.

## 2026-11-02 — Docs: uniform templates for recurring artifacts

- Branch: `docs/templates-uniformity`
- Scope: docs only; no executable behavior changed.
- Steps:
  1. Read the real shapes of `docs/adr/007-task-contract.md`,
     `docs/adr/008-task-store.md`, `docs/worklog.md`, `docs/validation.md`,
     `docs/handoff.md`, `docs/definition-of-done.md` and `AGENTS.md` before writing
     anything, so the templates reuse the existing field names and order.
  2. Added `docs/templates/adr-template.md` with the header line, `Context`, `Decision`,
     `Alternatives considered`, `Consequences` and `Related documents`, one inline
     instruction per field, plus a filled sample based on ADR-008.
  3. Added `docs/templates/worklog-entry-template.md` with the file's real fields
     (heading, `Branch`, `Scope`, `Steps`, `Files`, `Validation`, `Follow-up`) and the
     append-only rules stated inline.
  4. Added `docs/templates/validation-entry-template.md` with environment, date, a
     command table (command, purpose, result, exit code), the four evidence levels,
     a mandatory `Not rerun` section and the final-claim sentence pattern.
  5. Added `docs/templates/handoff-update-template.md` mirroring the sections of
     `docs/handoff.md`, marking per section what must be updated and what is copied
     unchanged.
  6. Added `docs/templates/README.md` with the artifact-to-template mapping, the
     placeholder convention and the "templates are tooling, not normative" line, and
     added the templates bullet to the `AGENTS.md` documentation duties.
- Files: `docs/templates/README.md`, `docs/templates/adr-template.md`,
  `docs/templates/worklog-entry-template.md`,
  `docs/templates/validation-entry-template.md`,
  `docs/templates/handoff-update-template.md`, `AGENTS.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test` → 83 passed, 0 failed; `node examples/fallback-demo.mjs` →
  429 then 200; `git diff --check` → no output; relative Markdown links checked with a
  one-off, unversioned script → 0 broken. The OpenCode smoke and MCP capability gate were
  not rerun.
- Follow-up: publish this branch for review as the templates PR and use the templates
  for the next change. No milestone step moved and no ADR was needed, because this adds
  documentation tooling only.

## 2026-11-02 — Docs: align templates with repository practice and mark new elements

- Branch: `docs/templates-uniformity`
- Scope: docs only; no executable behavior changed.
- Steps:
  1. Corrected the README trigger statement: worklog and validation on every change, ADR
     only for a decision, dependency or trust boundary, handoff only when the next action
     moves; added the copy procedure and the format-versus-substance rule.
  2. Conformed the ADR template to the eight real ADRs: lowercase `accepted` plus a
     semicolon-separated qualifier, no invented status vocabulary, `Decided by` and the
     `Alternatives considered`/`Related documents` sections flagged as new, amendment rules
     reconciled with `AGENTS.md`.
  3. Replaced the ADR example that claimed to be a compressed ADR-008 with an explicitly
     fictional ADR, so it can no longer be read as history.
  4. Rewrote the handoff template: seven parts instead of a wrong count of six, no claim
     that the file names the maintainer, and examples that reproduce the copied-unchanged
     sections verbatim, including owner-only access and the M3 rule.
  5. Corrected the worklog and validation templates: two heading and Steps forms that exist
     in the file, scope values and wrap width as observed, the validation format declared as
     new rather than established, one heading date rule, and the broken table cell.
  6. Removed the round-1 validation contradiction between a listed link-check command and a
     not-rerun line that called the same check skipped.
  7. Sync with main after #10 merged (conflict resolution: both PRs' worklog/validation
     sections preserved; AGENTS.md merged cleanly).
- Files: `docs/templates/README.md`, `docs/templates/adr-template.md`,
  `docs/templates/worklog-entry-template.md`,
  `docs/templates/validation-entry-template.md`,
  `docs/templates/handoff-update-template.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: `node --test` → 83 passed, 0 failed; `node examples/fallback-demo.mjs` →
  429 then 200; `git diff --check` → no output. The OpenCode smoke and MCP capability gate
  were not rerun.
- Follow-up: publish the branch for the next review round; apply the templates to the next
  change. No milestone step moved.

## 2026-11-02 — M2b: independent PR review and agent backlog

- Branch: `review/2026-11-02-pr-backlog` (local review; not published).
- Scope: documentation and review evidence; no executable behavior changed.
- Steps: inspected main, four open PRs, merged service/rules PRs, two discussions
  and old executor/client/acceptance branches; reproduced boundary defects;
  prepared 25 tasks with priorities, dependencies, ownership and acceptance.
- Files: `docs/review-2026-11-02.md`, `docs/backlog.md`, `docs/handoff.md`,
  `docs/worklog.md`, `docs/validation.md`.
- Validation: main suite 83/83; PR #8 snapshot 106/106; acceptance snapshot
  73 passed / 2 failed. Both main and #8 demos printed 429 then 200.
  Temporary-state reproductions confirmed diagnostic and lifecycle gaps.
  Real OpenCode, MCP, SQLite and M3 experiments were not rerun.
- Follow-up: choose an unblocked backlog task; no milestone advanced and no
  external review, issue, PR or merge was submitted.

## 2026-11-02 — Docs: template lifecycle and proportionality corrections

- Branch: `docs/templates-review-fixes` (published to PR #11's
  `docs/templates-uniformity` branch; under review).
- Scope: docs only; no executable behavior changed.
- Steps:
  1. Merged main and preserved both independent worklog/validation histories.
  2. Added proposed/accepted/superseded ADR status guidance with maintainer
     approval evidence and separate proposal/acceptance dates.
  3. Made worklog dates describe work performed, without implying a merge.
  4. Allowed explained template adaptations and proportionate handoff edits,
     preserving required facts, invariants and normative precedence.
- Files: `AGENTS.md`, `docs/templates/README.md`,
  `docs/templates/adr-template.md`, `docs/templates/worklog-entry-template.md`,
  `docs/templates/handoff-update-template.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test --test-reporter=tap` → 83 passed, 0 failed, exit 0;
  `node examples/fallback-demo.mjs` → 429 then 200, exit 0;
  `git diff --check` → no output; five template files checked, 30 prose links
  valid and fences balanced. Real OpenCode/MCP/SQLite gates were not rerun.
- Follow-up: review corrected PR #11. The milestone and next implementation
  action remain unchanged; no handoff update or ADR is required for these
  formatting clarifications.

## 2026-11-02 — M2b: B04a ordinary lifecycle guards

- Branch: `task/B04-lifecycle-guards` (implementation for review).
- Scope: store hardening, regression tests and normative documentation; no worker
  execution or manual reconciliation operation.
- Steps:
  1. Guarded update and restart writes with a private transition table and
     immutable identity/request checks, using RFC-0002 as design input.
  2. Enforced state-dependent block/cancel/timestamp presence. Invalid historical
     records fail closed without rewriting; terminal artifacts remain writable.
  3. Updated fixtures to use legal transitions and added a 36-pair transition
     matrix plus identity, dispatch, corruption and late-result regressions.
  4. Amended ADR-008 and the contract together; recorded the bounded B04a scope
     and the next continuation task in roadmap, backlog and handoff.
- Files: `src/tasks.mjs`, `test/task-lifecycle.test.mjs`,
  `test/task-service.test.mjs`, `test/task-store.test.mjs`,
  `docs/task-contract.md`, `docs/adr/008-task-store.md`, `docs/backlog.md`,
  `docs/roadmap.md`, `docs/handoff.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: `node --test --test-reporter=tap` -> 126 passed, 0 failed, exit 0;
  `node examples/fallback-demo.mjs` -> 429 then 200. Real OpenCode/MCP/SQLite
  gates were not rerun. No paid calls or developer-state access.
- Follow-up: B05 service ownership; B01 is a small independent continuation.
  B12 dispatch, B14 stop proof and B18 human reconciliation remain scoped out.

- Template adaptation: compact amendment/checkpoint entries preserve scope, evidence,
  validation and next actions without repeating unchanged milestone background.
- Final review also made persisted attempt identity append-only; a regression covers
  erase-then-cancel and permits active attempts to acquire completion metadata.

## 2026-11-03 — M2b: B04a pre-merge review

- Branch: `task/B04-lifecycle-guards`, PR #13.
- Reviewed lifecycle edges, immutable request/identity, dispatch preservation,
  service cancellation compatibility and failure behavior against the contract.
- Found and closed queued-with-persisted-attempt -> running: it now fails before
  writing, so restart reconciliation must block the task rather than permit replay.
- Files: `src/tasks.mjs`, `test/task-lifecycle.test.mjs`, `docs/task-contract.md`,
  `docs/worklog.md`, `docs/validation.md`.
- Validation: 126 tests passed, 0 failed; fallback demo 429 then 200; diff check passed.
- Limits remain B05 ownership, B12 dispatch production, B14 stop proof and B18
  maintainer reconciliation. No live integration gate was rerun.
- Template adaptation: compact review addendum records the defect, fix and evidence
  without repeating the implementation checkpoint above.

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

## 2026-11-03 — M2b: B05 service ownership

- Branch: `task/B05-service-owner` (implementation for review).
- Scope: exclusive service ownership per state home through a lock file; no distributed locking or automatic crash recovery.
- Steps:
  1. Acquired `locks/service-owner.lock` before startup reconciliation; exposed idempotent `close()` and release ownership after failed initialization.
  2. Added regression coverage for competing owners, close/reopen and startup failure; updated multi-client fixtures to respect one service owner.
  3. Amended the normative contract and ADR-008; updated backlog, roadmap and handoff.
- Files: `src/service.mjs`, `test/task-service.test.mjs`, `docs/task-contract.md`, `docs/adr/008-task-store.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/handoff.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: `node --test --test-reporter=tap` -> 127 passed, 0 failed; `node examples/fallback-demo.mjs` -> 429 then 200; `git diff --check` passed. OpenCode/MCP/SQLite gates were not rerun.
- Follow-up: inspect stale lock PID/state after a crash before manual removal; proceed with B03/B06 before executor integration.
- Template adaptation: compact continuation checkpoint keeps the ownership contract, evidence and next steps without duplicating unchanged milestone history.

## 2026-11-03 — M2b: B05 pre-merge review

- Branch: `task/B05-service-owner`, PR #14.
- Found and fixed operation access after close: all four operations now reject closed
  service handles, preventing old owners from writing after another service starts.
- Made failed lock release retryable, and preserved reconciliation-conflict tests by
  closing the previous owner before simulating restart.
- Added real subprocess contention and abrupt-death coverage: rejected startup leaves
  running record bytes unchanged; stale locks survive death; explicit recovery blocks
  uncertain work. Added closed-owner/replacement-owner regression coverage.
- Files: `src/service.mjs`, `test/task-service.test.mjs`, `test/service-owner.test.mjs`,
  `docs/task-contract.md`, `docs/handoff.md`, `docs/backlog.md`, `docs/roadmap.md`,
  `docs/worklog.md`, `docs/validation.md`.
- Validation: 129 tests passed; fallback demo 429 then 200; diff check passed.
- No real OpenCode/MCP/SQLite gate was rerun. Maintenance must stop services/workers
  before direct store mutation. Compact review addendum preserves existing history.

## 2026-11-02 — M2b: Executable backlog and PR delivery contracts

- Branch: `docs/task-contracts-and-pr-workflow` (documentation implementation for review).
- Scope: documentation and delivery rules; the runtime contract/API and milestones are unchanged.
- Steps:
  1. Replaced the old paragraph queue with a verified index and 27 detailed task cards
     containing prerequisites, scope, implementation sequence and 107 acceptance rows.
  2. Retained merged B02/B04a/B05 as history, marked B01 corrected on open #8 and split
     the B22 umbrella into sequential one-PR tasks B22a/B22b/B22c.
  3. Added the end-to-end execution protocol, two mandatory review passes, blocked-work
     handling, task-card and PR templates; linked these from AGENTS, contributing and DoD.
  4. Updated continuation/roadmap status and verified links, anchors, IDs and card coverage.
- Files:
  - `AGENTS.md`
  - `CONTRIBUTING.md`
  - `.github/pull_request_template.md`
  - `docs/backlog.md`
  - `docs/task-execution.md`
  - `docs/definition-of-done.md`
  - `docs/handoff.md`
  - `docs/roadmap.md`
  - `docs/templates/README.md`
  - `docs/templates/task-card-template.md`
  - `docs/worklog.md`
  - `docs/validation.md`
  - `docs/tasks/B01.md`
  - `docs/tasks/B02.md`
  - `docs/tasks/B03.md`
  - `docs/tasks/B04.md`
  - `docs/tasks/B05.md`
  - `docs/tasks/B06.md`
  - `docs/tasks/B07.md`
  - `docs/tasks/B08.md`
  - `docs/tasks/B09.md`
  - `docs/tasks/B10.md`
  - `docs/tasks/B11.md`
  - `docs/tasks/B12.md`
  - `docs/tasks/B13.md`
  - `docs/tasks/B14.md`
  - `docs/tasks/B15.md`
  - `docs/tasks/B16.md`
  - `docs/tasks/B17.md`
  - `docs/tasks/B18.md`
  - `docs/tasks/B19.md`
  - `docs/tasks/B20.md`
  - `docs/tasks/B21.md`
  - `docs/tasks/B22a.md`
  - `docs/tasks/B22b.md`
  - `docs/tasks/B22c.md`
  - `docs/tasks/B23.md`
  - `docs/tasks/B24.md`
  - `docs/tasks/B25.md`
- Review pass 1: checked old acceptance requirements against every new card. Clarified
  B03 static-validation/idempotency/new-repository ordering and the distinction between
  required host evidence and a blocked draft; avoided rerunning completed work.
- Review pass 2: checked final cards, dependency ordering, protocol/templates and all
  changed docs against main. Made every named scenario variant mandatory, removed
  stale inherited main-write authorization and updated task/PR status facts.
- Validation: `node --test --test-reporter=tap` -> 129 passed, 0 failed, exit 0;
  `node examples/fallback-demo.mjs` -> 429 then 200, exit 0; temporary Markdown/card
  checker -> 27 cards, 107 acceptance rows and 234 relative links/anchors passed;
  `git diff --check` -> exit 0. Code was unchanged after these runtime checks.
- Not rerun: real OpenCode smoke/MCP gate (docs-only change); no SQLite or worker
  integration claim is made. No paid calls or credentials were used.
- Follow-up: review this documentation PR, then dispatch one ready B03/B06/B07/B10
  card through its PR using the copyable prompt.
- Template adaptation: per-task cards replace oversized inline backlog paragraphs;
  the compact review notes above preserve both review passes without an additional
  runtime ADR because no runtime architecture, authority or state format changed.

## 2026-11-03 — M2b: B03 repository identity before task acceptance

- Branch: `task/B03-repo-identity` (implementation and review for PR).
- Scope: validate real Git repository identity, path containment, commit-ish baseRef resolution to immutable full commit SHA, and branch absence/collision before task creation; defer filesystem checks after idempotency replay.
- Steps:
  1. Specified validation ordering: static request/identity checks -> client-scoped idempotency lookup -> new-request repository and Git inspection.
  2. Implemented `src/repository.mjs` with `RepositoryError`, `isPathContained` (preventing sibling attacks and handling case insensitivity), `resolveCanonicalPath` (following symlinks/junctions), and `validateRepositoryIdentity` (Git argument arrays, `rev-parse --is-inside-work-tree`, single commit-ish resolving to commit, `check-ref-format`, local branch existence and linked worktree checks).
  3. Stored fixed full base SHA as immutable metadata `baseCommit` in `src/tasks.mjs` without modifying original request or canonical payload hash. Exposed `findIdempotentTask` on store.
  4. Updated `submitTask` in `src/service.mjs` to return replays without filesystem inspection, validate new requests with `validateRepositoryIdentity`, and persist `baseCommit`.
  5. Updated existing service test fixtures to initialize real temporary Git repositories and added dedicated tests for acceptance matrix rows B03-01 to B03-05 plus repository unit tests in `test/repository.test.mjs`.
  6. Documented repository validation rules and ordering in `docs/task-contract.md` and added an amendment to `docs/adr/008-task-store.md`.
- Files:
  - `src/repository.mjs`
  - `src/tasks.mjs`
  - `src/service.mjs`
  - `test/task-service.test.mjs`
  - `test/repository.test.mjs`
  - `docs/task-contract.md`
  - `docs/adr/008-task-store.md`
  - `docs/backlog.md`
  - `docs/handoff.md`
  - `docs/worklog.md`
  - `docs/validation.md`
- Review pass 1 (implementation review):
  - Ordering verified: idempotency check runs before filesystem operations; replays succeed even if repo was deleted or branch created.
  - Sibling directory matching: `isPathContained` enforces exact path or subdirectory boundary (`sep`), preventing `/path-fake` from matching `/path`.
  - Immutable baseCommit: cannot be modified after initial acceptance, preserving auditability and compatibility with older records.
  - Subprocess safety: Git executed directly with argument arrays (`shell: false`, `windowsHide: true`).
- Review pass 2 (completed diff review):
  - Verified acceptance rows B03-01 through B03-05 all pass with observable evidence.
  - Verified full test suite (141 tests) and fallback demo pass without regressions.
  - Whitespace and formatting verified via `git diff --check`.
- Validation:
  - `node --test`: 141 passed, 0 failed, exit 0.
  - `node examples/fallback-demo.mjs`: 429 then 200, exit 0.
  - `git diff --check`: clean, exit 0.
- Not rerun: OpenCode smoke / MCP capability gate (requires pinned binary outside repo; B06 will diagnose gate stability).
- Follow-up: Open PR for B03; next ready tasks are B09 (workspace lifecycle), B10 (subprocess primitive), and B06.

## 2026-11-03 — B03 post-review authorization boundary fix

- Re-review found that a submitted subdirectory could resolve Git refs from an enclosing repository outside the configured writable roots.
- Resolved and canonicalized Git's actual worktree root, required that root to be contained in an authorized root, and used it for subsequent Git inspections.
- Added a real Git fixture covering an allowed nested directory with an unauthorized parent repository.
- Validation: focused repository tests 7/7; full suite 142/142; fallback demo 429 then 200; `git diff --check` clean.
- OpenCode/MCP gates not rerun; they are outside B03's scope.

## 2026-11-03 — B07 credential-free Windows/Linux CI

- Branch: `task/B07-cross-platform-ci`, based on `origin/main` at `c07b78e` (PR #16 merged).
- Added `.github/workflows/ci.yml`: PR and main-push triggers, `contents: read`, Windows/Linux matrix, Node 24.22.1, separate test/demo steps, explicit PowerShell native-exit propagation, and an exit-7 pipeline fixture on both shells.
- Added `docs/ci.md` with local reproduction steps and the boundary around opt-in OpenCode/MCP checks.
- Updated handoff, backlog and roadmap to reflect B03/#16 merged, B10/#17 and B09/#18 open, and B07 in progress.
- Review pass 1: inspected trigger scope, token permissions, untrusted input exposure, shell quoting, failure propagation and external-host boundaries. No secrets, publishing, shell expressions from PR text or write permissions are used.
- Review pass 2: checked the complete workflow/docs/status diff and mapped all B07 rows. Local work is complete; the GitHub matrix remains pending until a pull-request run provides Windows and Linux evidence.
- Local validation on Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5: full suite 142/142, fallback demo 429 then 200, and piped nonzero fixture retained native exit 7; each command exited 0 as expected. `git diff --check` clean.
- Follow-up: publish as draft while GitHub runner availability and both matrix jobs are observed; convert to ready only after required evidence is complete.

- B07 publication update: PR #19 CI run `41737541145` completed successfully. Windows job `126270492736` and Ubuntu job `126270493106` both used Node v24.22.1, passed 142/142 tests and the fallback demo. Pipeline fixtures failed as expected (Windows exit 1; Bash exit 7), while the workflow jobs passed. Draft contingency was unnecessary because both runners were available; PR moved to ready for review.

## 2026-11-03 — B07 merge review correction

- Reviewed PR #19 at `00631ee` against the card, full diff, permissions, triggers and successful Windows/Linux CI run `41737897011`.
- Corrected `docs/ci.md`: the Bash reproduction now enables `set -e -o pipefail`, so a failing test cannot be masked by a later successful demo. Clarified that subsequent native commands can overwrite PowerShell's `$LASTEXITCODE`.
- Verified a real exit-7 Node pipeline under Git Bash stops the script before the following command (shell exit 7, no continuation output). Initial standalone Bash attempts could not resolve the transient Node installation (exit 127); the successful experiment used the parent PowerShell process's absolute Node binary.
- Validation: `git diff --check`; CI will revalidate the updated PR head. No runtime code changed and OpenCode/MCP checks were not rerun.

## 2026-11-03 — B06 MCP capability gate diagnosis

- Branch: `task/B06-mcp-capability-gate`, based on current `origin/main` at `2ff7e5e` (PR #19 merged).
- Verified the externally supplied OpenCode 2.2.5 binary: `--version` returned `opencode v2.2.5`, Authenticode signature verified for Anomaly Innovations, and its ZIP SHA-256 matched the published digest `2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8` (121,962,397 bytes).
- Reproduced the previously intermittent ordering defect from the existing transcripts: a single probe could snapshot the tool registry before OpenCode asynchronously connected the MCP server. The harness warm-up and wait for the connection marker address that race.
- Ran eight sequential independent launches, each with fresh temporary config/data/state and fixture logs. Every launch returned exit 0 and observed `server/discover`, `tools/list`, `tools/call`, `probe:GATE_FIXTURE` in model context, no legacy `initialize`, protocol `2026-07-28`, and exactly five provider requests.
- Hardened `integration/mcp-gate.mjs`: readiness waits remain bounded (default 30 seconds), command execution remains bounded (default 120 seconds), Windows process-tree termination and process-close waits are each capped at five seconds, cleanup errors now fail the gate, and a cleanup failure is included alongside the original phase error with local fixture secrets redacted. Added bounded timeout overrides and a deliberate cleanup-failure diagnostic fixture; documented their use.
- Review pass 1: inspected phase ordering, child spawn/exit, server startup, MCP readiness, timeout kill, cleanup aggregation, credential redaction and temporary-state ownership. Fixed timeout races that had converted a timeout into a child exit code and could leave a caller waiting if stop failed.
- Review pass 2: rechecked the full harness and integration docs against B06 rows; all observed outcomes below are nonzero when expected, and the eight required real-host launches pass.
- Local environment: Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5, signed OpenCode 2.2.5.
- Validation: full suite 142/142; fallback demo 429 then 200; diff check clean. Eight host launches 8/8 success. Missing binary, wrong version and `cmd.exe` nonzero child each returned harness exit 1. Command timeout and readiness timeout returned exit 1; combined readiness plus forced cleanup error returned exit 1 and reported both original phase and cleanup failure.
- OpenCode smoke was not rerun; unrelated session/model evidence. No paid provider calls; only the loopback fixture provider was used.

## 2026-11-03 — B06 PR #20 follow-up review

- Reviewed PR #20's current diff, metadata, conversation, inline review threads and submitted reviews. The GitHub PR had no comments or review submissions at the time of inspection.
- Corrected the command timeout so it settles even if a descendant keeps inherited pipes open after the root process exits; timeout cleanup now closes the streams and unreferences the child after bounded process termination.
- Preserved the temporary fixture whenever host or server cleanup fails, fixed the retained-path diagnostic, and delayed the success JSON until cleanup completes.
- Validation: `npm test` 142/142; fallback demo 429 then 200; eight pinned OpenCode 2.2.5 launches passed; a 1 ms command timeout and combined readiness/forced-cleanup failure both exited 1; `node --check` and `git diff --check` passed.

## 2026-11-03 — Docs: shared PR review feedback (B26)

- Branch: `task/B26-pr-review-feedback`, from main `2ff7e5e`.
- Scope: documentation and instructions; no runtime or task-contract change.
- Steps:
  1. Inspected current code, merged baseline and open implementation PRs.
  2. Required PR findings, developer feedback intake/replies and re-review of the
     current commit, including failed publication and stale-review handling.
  3. Linked the protocol from agent/developer entry points, DoD and PR template.
  4. Documented current delegation gaps and a future sequential two-model loop.
- Files: `AGENTS.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md`,
  `docs/pr-review.md`, `docs/task-execution.md`, `docs/definition-of-done.md`,
  `docs/tasks/B26.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/handoff.md`,
  `docs/worklog.md`, `docs/validation.md`.
- Validation: `node --test` passed 142/142; fallback demo returned 429 then 200;
  content/link checks and `git diff --check` passed. OpenCode/MCP gates not rerun
  because runtime files are unchanged.
- Review: pass 1 checked publication, feedback intake, permissions and failure
  paths; pass 2 mapped B26-01–04 to instructions and existing code/dependencies.
  Corrected section placement and stale handoff actions. No blocking findings.
- Follow-up: independently review this PR, then the open B06/B09/B10 PRs. Runtime
  automation requires B11–B20 and separate controller design/implementation cards.

## 2026-11-03 — B26 merge review integration

- Merged current main after B06/#20; preserved both append-only histories and
  reconciled the handoff/current capability status. No runtime changes beyond
  already validated main. Rechecked feedback protocol and relative links; CI
  will validate the integrated head before merge.

## 2026-11-02 — RFC-0001: declarative contract schemas and checker skeleton

- Branch: `rfc/0001-contract-schemas`
- Scope: proposal plus test-only skeleton; no runtime wiring.
- Steps:
  1. Added `src/contracts/validate.mjs`, a zero-import checker for a curated JSON
     Schema subset (type with nullable unions, properties, required,
     `additionalProperties: false`, enum, pattern, string and array bounds, items,
     description/meta annotations) returning `{ ok }` or `{ ok: false, errors }` with
     relative paths, all errors collected and instance values truncated to 32 chars.
     Combinators and numeric bounds are deliberately excluded.
  2. Added `src/contracts/schemas/`: `task-submit-request` (from `validateSubmitRequest`),
     `worker-artifact` (attempts, testRuns, diff, changedFiles, commits, limitations,
     cost, evidence level; today's uncatalogued fields), `task-record` (from
     `validateTask`), and `error-envelope` (added so `ERROR_CODES` also has a schema
     anchor). Each file records its `file:line` origin in a `meta` block.
  3. Added `test/contracts.test.mjs`: keyword happy/negative tables with exact paths and
     messages, determinism and truncation checks, schema conformance for a real store
     record, and drift guards comparing the schema enums to `TASK_STATUSES`,
     `EVIDENCE_LEVELS`, `ERROR_CODES` and the private `STATUSES` literal read from
     `src/tasks.mjs` (sorted set equality, equal length).
  4. Wrote `docs/rfcs/0001-contract-schemas.md` with context, decision, supported
     subset, few-shots with real `validate()` output, a three-step adoption path,
     non-goals, later MCP reuse and four open questions.
- Files: `src/contracts/validate.mjs`,
  `src/contracts/schemas/{task-submit-request,worker-artifact,task-record,error-envelope}.schema.json`,
  `test/contracts.test.mjs`, `docs/rfcs/0001-contract-schemas.md`, `docs/validation.md`,
  `docs/worklog.md`.
- Validation: `node --test` → 103 passed, 0 failed (83 existing + 20 new);
  `node examples/fallback-demo.mjs` → expected 429 then 200;
  `node -e "import('./src/contracts/validate.mjs').then(m=>console.log(Object.keys(m)))"`
  → `[ 'exportEnum', 'validate' ]`.
- Follow-up: RFC-0002 (lifecycle state machine, combinators) and adoption steps 2-3
  (wire the submit boundary, derive the duplicated literals).

## 2026-11-02 — RFC-0001 review fixes: strict schemas and record artifacts

- Branch: `rfc/0001-contract-schemas`
- Scope: proposal and test-only skeleton; no runtime wiring.
- Steps:
  1. Added the artifact fields `updateTask` may write (`testRuns`, `changedFiles`,
     `baseCommit`, `headCommit`, `diff`, `diffTruncated`) as optional properties of
     `task-record`, with `testRuns[].command` optional to match the runtime's tolerated
     shape; a new test validates a store record after `updateTask` adds them.
  2. Reframed `worker-artifact` in its `$comment` and the RFC as the producer contract
     the future executor adapter must report, not a result envelope; `command` is now
     optional, and the strictness divergences (unknown keys, required `exitCode`,
     non-empty `outcome`) are stated.
  3. Made the checker fail closed: `additionalProperties: true` is rejected, and a new
     exported `assertSchema()` walks every node against a strict keyword whitelist
     (`type, properties, required, additionalProperties, enum, pattern, minLength,
     maxLength, minItems, maxItems, items, description, meta, $comment`), requiring a
     `type` on each node and rejecting malformed keyword values. `validate()` and
     `exportEnum()` run it first.
  4. Added a test that reads `src/contracts/schemas/` and runs `assertSchema` over every
     shipped file, plus cases for unknown keywords, missing `type` and
     `additionalProperties: true`.
  5. Aligned the RFC with the RFC-0002 review: combinators are declined and lifecycle
     legality is a status-keyed dispatch table; numeric bounds are declined, not an
     open question; the `Referenced-by` line names the unmerged sibling PR. Documented
     unanchored `pattern` search, `$comment`, error ordering, preview rules and inputs
     for every few-shot.
  6. Hardened the drift guard to quote-generic literal extraction and added a
     `SCHEMA_VERSION` assertion against `src/service.mjs` and the private literal in
     `src/tasks.mjs`.
- Files: `src/contracts/validate.mjs`,
  `src/contracts/schemas/{task-record,worker-artifact}.schema.json`,
  `test/contracts.test.mjs`, `docs/rfcs/0001-contract-schemas.md`, `docs/validation.md`,
  `docs/worklog.md`.
- Validation: `node --test` → 106 passed, 0 failed (83 existing + 23 contract tests);
  `node examples/fallback-demo.mjs` → expected 429 then 200; every schema file passes
  `assertSchema` via the directory walk test.
- Follow-up: adoption steps 2-3 in the RFC.

## 2026-11-02 — RFC-0001 re-review fixes: record branch and dialect declaration

- Branch: `rfc/0001-contract-schemas`
- Scope: proposal and test-only skeleton; no runtime wiring.
- Steps: corrected the `task-record` `$comment` to three deliberate strictness points
  including non-empty `attempts[].outcome`; added optional `branch`
  (`["string", "null"]`) to `task-record` because `src/service.mjs:207` reads it from
  the record even though no runtime writer sets it; added `$schema` to the closed
  keyword whitelist as an ignored string annotation and declared
  `https://json-schema.org/draft/2020-12/schema` in all four schema files, with the RFC
  table and checker header updated.
  - Sync with main after #10 merged (both sides' append-only sections preserved)
- Files: `src/contracts/schemas/*.schema.json`, `src/contracts/validate.mjs`,
  `test/contracts.test.mjs`, `docs/rfcs/0001-contract-schemas.md`, `docs/validation.md`,
  `docs/worklog.md`.
- Validation: `node --test` → 106 passed, 0 failed; `node examples/fallback-demo.mjs` →
  expected 429 then 200.
- Follow-up: adoption steps 2-3 in the RFC.
## B01 — Safe schema diagnostics — 2026-11-03

- Branch: `rfc/0001-contract-schemas` (existing PR #8).
- Scope: unknown instance property names are replaced with a fixed `<unknown>` path
  segment, including deeply nested keys. Known schema property paths remain useful.
- Steps:
  1. Removed attacker-controlled keys from unknown-property diagnostic paths.
  2. Added regression coverage for short, credential-shaped, very long and control-
     character keys at root and nested object levels.
  3. Updated existing unknown-key expectations and clarified the RFC diagnostics rules.
- Files: `src/contracts/validate.mjs`, `test/contracts.test.mjs`,
  `docs/rfcs/0001-contract-schemas.md`, `docs/worklog.md`, `docs/validation.md`.
- Template adaptation: concise append-only entries retain scope, files, evidence,
  limitations and commands while avoiding repeated milestone background.
- Validation: `node --test --test-reporter=tap` -> 107 passed, 0 failed;
  `node examples/fallback-demo.mjs` -> expected 429 then 200; `git diff --check` passed.
- Limits: schemas remain unwired to runtime operations; no live integration gates ran.

## 2026-11-03 — B01 schema scaffold merge review

- Branch: `rfc/0001-contract-schemas`; integrated main `104e9c1` without changing
  service/store behavior. Preserved both append-only histories and changed the
  unmerged sibling RFC link to its PR. Reviewed the schema subset and diagnostics;
  the unknown-key disclosure correction is present. Runtime adoption remains B08
  and requires differential checks. Integrated suite/demo and CI follow.

- B01 integration correction: updated the artifact fixture for full immutable base
  SHA and legal lifecycle transitions. Initial integrated suite failed 1/166;
  after correction, 166/166 pass and demo returns 429 then 200. Reviewed the final
  checker/schema/test diff; runtime consumers remain untouched. No host gates rerun.


## 2026-11-03 — M2b: B09 isolated Git workspace lifecycle

- Branch: `task/B09-isolated-worktree`, based on `c07b78e`.
- Scope: added receipt-bound linked worktrees at the accepted base and branch, with
  verified idempotent reuse and explicit conservative cleanup. Does not launch workers.
- Steps: implemented creation, receipt/path/repository/branch verification and cleanup;
  added real Git acceptance fixtures; reviewed interrupted and dirty-output behavior.
- Files: `src/workspace.mjs`, `test/workspace.test.mjs`, task contract, ADR-007,
  backlog, handoff, roadmap, validation and worklog.
- Validation: focused tests 5/5; full suite 147/147; fallback demo 429 then 200;
  `git diff --check` clean. Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5.
- Follow-up: review the published B09 PR. Executor and OpenCode/MCP integration remain
  separate gated work.

## 2026-11-04 — B09 current-main integration

- Merged current main into the existing B09 branch and reconciled status/handoff
  while preserving append-only history. Fixed review finding for ignored workspace
  output and added a real Git preservation regression fixture.
- Validation: `node --test test/workspace.test.mjs` passed 6/6; full suite passed
  172/172; fallback demo returned 429 then 200; `git diff --check` passed. Windows
  x64, Node 24.22.1, Git 2.55.0. Linux CI is pending after push.

## 2026-11-04 — B09 Windows CI fixture correction

- Inspected failed Windows job in CI run `41748264467`; Ubuntu passed. The manually
  created receipt in the incomplete-workspace fixture did not canonicalize paths,
  so Windows failed early with `workspace_conflict` instead of reaching the expected
  Git failure. Updated fixture paths with `realpathSync.native`.
- Validation on Windows x64 / Node.js v24.22.1: focused workspace tests 6/6; full
  suite 172/172; fallback demo 429 then 200; `git diff --check` clean. New CI run is
  required before merge.

## 2026-11-04 — B09 integration with merged B10

- Updated B09 to the main commit that merged B10 and preserved both worklog and
  validation histories. The earlier CI run `41749352307` passed on Windows/Ubuntu
  before this base update, so the final merge head still needs fresh CI.
- Integrated Windows validation: focused workspace tests 6/6; full suite 178 passed,
  1 POSIX-only skipped; fallback demo 429 then 200; `git diff --check` clean.

## 2026-11-03 — M2b: B10 bounded subprocess primitive

- Branch: `task/B10-bounded-subprocess`, based on `c07b78e`.
- Scope: added a no-shell child process helper with scoped environment, separate
  bounded UTF-8 output tails, deadlines, abort handling and truthful stop evidence.
  It does not implement the executor or claim descendant termination.
- Steps: implemented input validation and child lifecycle handling; added real
  child fixtures for the B10 acceptance rows; reviewed race/cleanup paths.
- Files: `src/subprocess.mjs`, `test/subprocess.test.mjs`, backlog, handoff,
  roadmap, validation and worklog.
- Validation: focused tests 5/5; full suite 147/147; fallback demo 429 then 200;
  `git diff --check` clean. Windows x64, Node.js v24.22.1.
- Follow-up: review the published B10 PR. OpenCode/MCP integration remains outside
  this task and requires the pinned host and a later executor task.

## 2026-11-04 — B10 current-main integration

- Merged current main into the existing B10 branch and preserved append-only
  histories. Fixed cross-chunk byte-tail trimming, normalized stop evidence, and
  bounded ignored-signal termination with stream/child detachment. Added split-tail,
  UTF-8 boundary and POSIX SIGTERM-ignore fixtures.
- Validation on Windows x64 / Node.js v24.22.1: focused subprocess tests 6 passed,
  1 POSIX-only skipped; full suite 172 passed, 1 skipped; fallback demo 429 then
  200; `git diff --check` clean. The ignored-SIGTERM fixture remains for Ubuntu CI.

## 2026-11-03 — M2b: post-merge workspace and subprocess corrections

- Branch: `task/FIX17-18-post-merge`, based on main `772fe3a`.
- Scope: code, tests and docs for maintainer task FIX17-18; no executor or model
  eligibility change.
- Steps: read all feedback on #17/#18, reproduced both findings, added four failing
  regressions, then guarded absent-child cleanup and refused hidden index flags.
- Files: workspace/subprocess helpers and tests, FIX17-18 card, task contract,
  ADR-007, backlog, handoff, roadmap, validation and this log.
- Review pass 1: checked original-error preservation, absent child resources, index
  tag parsing with NUL records, and preservation of file/branch/receipt/index state.
- Review pass 2: inspected completed diff and acceptance mapping; confirmed both
  index-flag fixtures also refuse dirty output after flag removal, then allow clean
  removal. No blocking findings remain locally; CI follows publication.
- Validation: before fixes, all four new regressions failed (exit 1). After fixes,
  focused tests 16 passed/1 POSIX-only skipped; full suite 182 passed/1 skipped;
  fallback demo 429 then 200; diff check passed. Windows x64, Node v24.22.1,
  Git 2.55.0.windows.5.
- Follow-up: publish corrective PR, answer original findings with commit/evidence,
  and inspect Windows/Ubuntu CI. Resume B11 only after corrections are accepted.

## 2026-11-03 — M2b: B11 authorized OpenCode invocation

- Branch: `task/B11-authorized-opencode`, based on main `093e050`.
- Scope: code, tests and docs for a trusted launch/config builder plus a pinned-host
  denied-write experiment. No service dispatch, scheduler or production provider.
- Steps: enforced one exact model, `read`/`edit` only, configured relative write globs,
  task budget caps, isolated host paths/environment, and a loopback-only fixture
  provider. The OpenCode 2.2.5 host denied a fixture write outside `src/**` despite a
  prompt requesting broader model/tool/path permissions, then allowed and wrote a
  fixture file inside the authorized glob. Review also found an
  existing 80 ms subprocess-test startup race under full-suite load; increased its
  fixture deadline to 500 ms while retaining the partial-output and deadline asserts.
- Files: `src/opencode.mjs`, `test/opencode.test.mjs`,
  `integration/opencode-invocation.mjs`, subprocess regression fixture, B11 card,
  task contract, ADR-006, integration README, backlog, roadmap, handoff, validation.
- Review pass 1: checked model/tool/path/budget rejection, CLI positional prompt
  handling, environment/config precedence, reserved provider variables, exact base
  workspace binding, cleanup and actual host permission evidence. Fixed provider env
  shadowing and flaky test startup discovered during review/validation.
- Review pass 2: reviewed complete diff and B11-01 through B11-04 against named tests
  and the real B09 receipt-backed host experiment. Checked changed local Markdown
  links (70, no missing targets). No blocking local findings remain; task-service
  integration, external providers, sandboxing and publication CI remain unrun/out of scope.
- Validation: 8 focused tests passed; OpenCode 2.2.5 denied the out-of-glob write and
  allowed the in-glob fixture write; full suite 190 passed, 0 failed, 1 POSIX-only
  skipped; fallback demo 429 then 200;
  diff check clean. Windows x64, Node.js v24.22.1, Git 2.55.0.windows.5.
- Publication: committed as `af74d75997bb06749271cba0561a5931070500a7`, pushed and
  opened [PR #23](https://github.com/pbsilvabd/ai-orchestrator/pull/23) against
  `main`. Initial CI run 41755507739 was queued at publication; check the current PR
  head and review feedback before delivery. Do not merge without task-specific
  maintainer authorization.
- CI correction: PR run 41755592522 passed Windows but failed Ubuntu because the new
  unit fixture supplied Windows-only absolute paths. Replaced those fixtures with
  platform-resolved paths; focused tests passed 8/8 and the full local suite passed
  190 tests with one POSIX-only skip. The corrected head needs fresh CI verification.
- CI completion: run 41756163116 passed on Ubuntu and Windows at head
  `8eb9ac05fcd407a38ddf728a1051cb945447e47e`. PR conversation comments, reviews and
  inline threads were empty at that head; maintainer review and merge remain pending.
- PR #23 review correction: reproduced the P1 junction escape with OpenCode 2.2.5;
  an allowed `src/link/...` write reached a sibling directory outside the workspace.
  The launch builder now rejects any workspace symlink/junction, with unit and real
  host fixtures verifying rejection and an unchanged external sentinel. Focused tests
  9/9, full suite 191 passed/1 POSIX-only skipped, integration/demo/diff checks passed.
  Fresh cross-platform CI is pending; the finding remains open until re-review.

## 2026-11-03 — M2b: FIX23 post-merge authorization corrections

- Branch: `task/FIX23-authorization`, base `05d5cda` (merged B11/#23).
- Scope: reject multiply linked regular files and use a fixed provider credential
  allowlist (FIXTURE_API_KEY only for the supported local fixture). B10 test cleanup
  retries transient Windows locks without changing the production subprocess runner.
- Regression: both new authorization tests failed on the base (exit 1, missing
  expected exceptions). After the fix, focused tests passed 19 with one POSIX skip;
  pinned OpenCode 2.2.5 harness rejected both invalid launches, preserving the outside
  sentinel while original real denied/allowed writes still passed.
- Review pass 1: checked lstat/link-count behavior without following aliases, the
  environment allowlist and fixture scope, and cleanup failure propagation. Improved
  B10-04 to wait for proof that its descendant actually starts before aborting root;
  final cleanup is bounded and descendantsStopped remains false.
- Review pass 2: checked the complete diff and FIX23-01..04 against named tests,
  contract/ADR updates and the remaining launch-time race limitation. No blocking
  local findings remain. Independent PR review is still required.
- Files: OpenCode builder, unit/host fixtures, subprocess fixture, FIX23 card,
  backlog/handoff/roadmap, contract/ADR, integration README and evidence docs.
- Final local validation: focused 19 passed/1 skipped; full suite 193 passed/1
  POSIX-only skipped; fallback demo 429 then 200; pinned integration exit 0;
  diff check clean. Windows x64, Node 24.22.1, Git 2.55.0.windows.5.
- Publication: one FIX23 PR, replies to original findings with commit/evidence,
  cross-platform CI and independent review. No merge authorization is inferred.

## 2026-11-04 — M2b: B12 durable single-worker scheduler

- Branch: `task/B12-durable-scheduler`, base
  `488e57ad817dbdf19496a2eb07c09be66c18c2aa` (local, unpublished).
- Scope: code, tests and docs for opt-in single-worker dispatch; no transport,
  artifact collection, production provider, fallback or automatic recovery.
- Steps:
  1. Compared the stale project mirror with fetched main and recent PRs. Confirmed
     M2a/ADR-007, merged B09–B11/FIX23 and green main CI run 41759929003.
  2. Reviewed FIX23 source and original #23 findings/correction replies; repeated
     the pinned-host authorization regressions. #24 had no published independent
     review; that acceptance gap remains explicit rather than inferred from merge.
  3. Defined queue/startup/shutdown policy before implementation. Added atomic
     running/attempt/workspace reservation, serial scheduling, no replay and
     conservative failure/close ownership. Kept old passive service behavior.
  4. Connected B09/B10/B11 through a trusted worker adapter with copied launch
     configuration, UUID runtime paths and exclusive runtime file creation.
  5. Exercised all B12 acceptance rows with real filesystem, Git and Node process
     fixtures; extended the pinned OpenCode harness to execute from the service.
  6. Reviewed implementation and failure paths, then the completed diff and every
     matrix row. Added adapter-copy/receipt immutability checks, cancellation/late
     result fencing, budget checks and runtime path-ID validation. No blocking
     local findings remain. Final harness review preserved workspace output even
     when host failure precedes descriptor assignment; the host gate was rerun.
     Process-error review kept ambiguous termination errors blocked instead of
     classifying every child error as a safe spawn failure; checks were rerun.
     Independent review/publication remain outstanding.
- Files: `AGENTS.md`, `README.md`, `docs/adr/008-task-store.md`,
  `docs/backlog.md`, `docs/handoff.md`, `docs/requirements.md`, `docs/roadmap.md`,
  `docs/task-contract.md`, `docs/tasks/B12.md`, `docs/validation.md`,
  `docs/worklog.md`, `integration/README.md`,
  `integration/opencode-invocation.mjs`, `src/opencode.mjs`,
  `src/scheduler.mjs`, `src/service.mjs`, `src/tasks.mjs`,
  `test/opencode.test.mjs`, `test/scheduler.test.mjs`.
- Validation: focused scheduler/OpenCode tests → 26 passed; full `node --test`
  → 208 passed, 0 failed, 1 POSIX-only skip; pinned OpenCode 2.2.5 invocation
  harness → serviceSchedulerDispatch and authorization checks true, exit 0;
  `node examples/fallback-demo.mjs` → 429 then 200; diff/link checks passed.
  Windows x64, Node 24.22.1 (fnm), Git 2.55.0.windows.5. MCP/session-switch gates
  and new-head remote Windows/Linux CI were not rerun.
- Follow-up: obtain explicit publication authorization, push/open the single B12
  PR, verify head/CI and complete independent FIX23/B12 review. Then B13 artifacts
  and B14 stop handling; M2b/M3 are not complete. The user restriction overrides
  the repository's usual publish-through-PR protocol. No push/merge was performed.

## 2026-11-04 — M2b: B12 authorized delivery checkpoint

- Branch: `task/B12-durable-scheduler`; runtime reviewed at `69aa920`.
- Scope: delivery documentation only; no runtime, tests or authority policy changed.
- Steps:
  1. Rechecked clean local state, unchanged remote main `488e57a` and absence of
     another B12 PR before publication.
  2. Recorded the maintainer's explicit publication/merge authorization following
     the implementing agent's completed review. No independent review is claimed.
  3. Updated current status pointers; final published head, feedback and CI must
     be verified before the already-authorized merge.
- Files: `AGENTS.md`, `docs/handoff.md`, `docs/backlog.md`, `docs/roadmap.md`,
  `docs/tasks/B12.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: `git diff origin/main..HEAD --check` passed for the reviewed runtime;
  documentation links and staged whitespace checked for this follow-up. Runtime
  evidence remains 208 passing tests, one POSIX skip, 26 focused passes and the
  passing pinned OpenCode harness. Runtime/host suites were not rerun because only
  documentation changed. New-head remote CI must run after publication.
- Follow-up: publish the same B12 PR, verify remote head/feedback/Windows/Linux CI
  and merge under this authorization; then B13 artifacts. M2b/M3 remain incomplete.

## 2026-11-04 — M2b: B12 canonical workspace receipt correction

- Branch: `task/B12-durable-scheduler`, same PR #25.
- Scope: code, tests and contract documentation for canonical dispatch receipt
  identity; no permission, replay, cancellation or provider expansion.
- Steps:
  1. Inspected CI run 41769624335: Ubuntu passed; Windows failed B12-01 while
     waiting for its first fixture marker (207 passed, one failure, one skip).
  2. Reproduced divergent planned/B09 canonical paths with a real aliased home;
     the new regression failed before the fix, exit 1, with both paths displayed.
  3. Canonicalized the workspace root before reserving dispatch, matching B09 even
     when the configured home uses an alias or a Windows short-name spelling.
  4. Reviewed startup ownership/failure cleanup and the complete correction diff;
     preserved the dispatch-before-spawn rule and immutable receipt binding.
- Files: `src/scheduler.mjs`, `test/scheduler.test.mjs`, `docs/task-contract.md`,
  `docs/adr/008-task-store.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: focused scheduler/OpenCode tests -> 27 passed; full suite -> 209
  passed, zero failed, one POSIX-only skipped; pinned OpenCode fixture -> dispatch
  and authorization checks true; demo -> 429 then 200; all exits 0. Whitespace and
  relative file links checked. Unchanged MCP/session-switch gates were not rerun.
- Follow-up: push the correction on PR #25, verify new-head Windows/Ubuntu CI and
  feedback, then execute the maintainer-authorized merge. No merge on failed CI.

## 2026-11-04 — Docs: backlog status after B12 merge

- Branch: `docs/backlog-status-after-b12`, base `68d3ea5`.
- Scope: documentation only; runtime, permissions, contracts and acceptance
  scenarios are unchanged. Task ID: DOC-backlog-status.
- Steps:
  1. Compared fetched main with GitHub PR #25 and main CI run 41770348768;
     confirmed B12 merged at `68d3ea5`, green Windows/Ubuntu checks and no open PRs.
  2. Marked delivered foundations/B12, made B13 the next ready implementation
     task, and recorded remaining M2b B13–B17 and M3 B18/B20 dependencies.
  3. Distinguished ready B08 support and B19 gate-pulse preparation from full
     task-history acceptance; retained all later storage/fallback/memory gates.
  4. Aligned current AGENTS/handoff/roadmap/review pointers and task-card statuses;
     preserved append-only evidence and clearly labeled historical checkpoints.
  5. Reviewed dependency/authority claims, then the full documentation diff against
     verified remote evidence; corrected stale B12 completion/review wording.
- Files: `AGENTS.md`, `docs/backlog.md`, `docs/handoff.md`, `docs/pr-review.md`,
  `docs/roadmap.md`, `docs/tasks/B08.md`, `docs/tasks/B12.md`,
  `docs/tasks/B13.md`, `docs/tasks/B19.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test --test-reporter=tap` -> 209 passed, zero failed, one
  POSIX-only skip; `node examples/fallback-demo.mjs` -> 429 then 200; whitespace
  and relative file links checked. OpenCode/MCP/session integration gates were
  not rerun because this refresh changes only documentation.
- Follow-up: publish this documentation branch when authorized; B13 remains the
  next implementation task. M2b/M3 remain incomplete. No merge authorization is
  inherited from B12 and no publication/merge was performed at this checkpoint.

## 2026-11-04 — Docs: repository maintenance skills

- Branch: `docs/repository-maintenance-skills`, base `3d70556`.
- Scope: two repo-local Codex instruction-only skills and discovery/usage guidance;
  no service, worker, permission, provider or runtime dependency change.
  Task ID: SKILLS-maintenance.
- Steps:
  1. Read Skill Creator and the maintained task/review protocols; confirmed clean
     current main and no existing repo skills or open PRs to duplicate.
  2. Created `orchestrator-task` and `orchestrator-review` under `.agents/skills`,
     linking canonical documents instead of copying their detailed procedures.
  3. Added AGENTS routing and README invocation examples. Kept normal skill
     discovery defaults, with no global installation or worker skill activation.
  4. Reviewed task selection, feedback intake, same-task authorization, uncertain
     remote writes, changed-head verdicts and implementing-agent review disclosure.
  5. Reviewed the complete diff; corrected duplicate section headings, checked
     relative targets and ran both bundled skill validators and baseline tests.
- Files: `.agents/skills/orchestrator-task/SKILL.md`,
  `.agents/skills/orchestrator-review/SKILL.md`, `AGENTS.md`, `README.md`,
  `docs/worklog.md`, `docs/validation.md`.
- Validation: both bundled `quick_validate.py` runs -> Skill is valid, exit 0;
  `node --test --test-reporter=tap` -> 209 passed, zero failed, one POSIX-only
  skip; demo -> 429 then 200; relative-file links and whitespace checked.
  Python 3.13.3/PyYAML 6.0.3 were used only in an isolated temporary validator
  environment outside the repository. Host/MCP gates and model-driven skill
  evaluations were not rerun; no runtime changed and no provider was activated.
- Follow-up: exercise the task skill on the next authorized B13 assignment and the
  review skill on an authorized PR review. B13 and M2b/M3 status remain unchanged.
  This local skills delivery does not inherit earlier publication/merge approvals.

## 2026-11-07 — M2b: B13 verifiable bounded artifacts

- Branch: `task/B13-bounded-artifacts`, base `c6bb77a`.
- Scope: code, tests and documentation. Task ID: B13.
- Steps:
  1. Implemented trusted artifact collector in `src/artifacts.mjs` against fixed base commit,
     covering committed, staged, unstaged, renamed, deleted and untracked files.
  2. Handled byte caps on diff and log tails, binary file omission reporting, and
     workspace containment verification.
  3. Added secret pattern redaction and multi-byte UTF-8 truncation utilities in `src/redaction.mjs`.
  4. Wired artifact collection into `src/scheduler.mjs` on completion and updated `src/service.mjs`
     and `src/tasks.mjs` to validate and project recorded task artifacts.
  5. Implemented acceptance test suite in `test/artifacts.test.mjs` covering B13-01 to B13-04.
  6. Verified full regression suite (213 passed, 1 skipped) and fallback demo.
  7. Addressed PR #35 review findings: gated test execution on known worker outcome
     with zero test launches on uncertain exit; enforced byte caps after redaction;
     captured workspace modifications after test command executions.
- Files: `src/artifacts.mjs`, `src/redaction.mjs`, `src/opencode.mjs`, `src/scheduler.mjs`,
  `src/service.mjs`, `src/tasks.mjs`, `test/artifacts.test.mjs`, `test/scheduler.test.mjs`,
  `docs/tasks/B13.md`, `docs/backlog.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test test/artifacts.test.mjs` -> 6 passed, 0 failed;
  `node --test test/scheduler.test.mjs` -> 21 passed, 0 failed;
  `node --test` -> 216 passed, 0 failed, 1 POSIX-only skipped; `node examples/fallback-demo.mjs`
  -> 429 then 200; `git diff --check` -> clean.
- Follow-up: publish PR for B13, verify CI and request review; B14 follows upon B13 merge.

## 2026-11-09 — M2b: B13 follow-up review corrections

- Branch: `task/B13-bounded-artifacts`, base `c6bb77a`; corrected reviewed head `53c373b`.
- Scope: resolve remaining PR #35 review findings.
- Steps:
  1. Rechecked task state before every configured artifact test and before persisting
     scheduler completion, preventing a later test launch after cancellation/shutdown.
  2. Kept Git diff evidence null when collection could not obtain it, with an explicit
     limitation distinct from a successfully collected empty workspace.
  3. Added local service/Git/subprocess regressions for cancellation during artifact
     collection and a zero-budget Git collection.
  4. Reviewed the final correction diff and reran focused and full validation.
- Files: `src/artifacts.mjs`, `src/scheduler.mjs`, `test/artifacts.test.mjs`,
  `test/scheduler.test.mjs`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused suite -> 24 passed, 0 failed; `node --test` -> 218 passed,
  0 failed, 1 POSIX-only skipped; demo -> 429 then 200; `git diff --check` -> clean.
- Limits: Windows local evidence; existing Ubuntu/Windows CI was for the parent head.
  OpenCode and MCP integration gates were not rerun.
- Follow-up: push to the existing PR #35, verify CI at the new head, and request
  re-review. B14 remains next after B13 merges.

## 2026-11-09 — M2b B13 post-merge corrections

- Branch `fix/B13-post-merge` from `254b5b9`. Scoped to the
  [PR #35 post-merge review](https://github.com/pbsilvabd/ai-orchestrator/pull/35#issuecomment-6755949829).
- Made artifact subprocesses follow the scheduler's conservative outcome handling.
  Cancellation and an uncertain test exit halt the queue and retain ownership
  and partial artifacts. The existing blocked task keeps its original reason.
- Fixed log-only result projection and updated the declarative task-record schema
  to accept nested artifacts and the scheduler's persisted attempt fields.
- Added regressions for queue and ownership behavior during cancellation and
  deadline, and validated log selection and the schema against a real task record.
- Updated the task contract, B13 card, handoff, backlog and roadmap. See the
  validation log for commands, results and evidence limits.

## 2026-11-09 — M2b: B14 cancellation and late-event handling

- Branch: `task/B14-cancellation-deadlines`
- Scope: code, tests and docs; no process-tree termination or maintainer reconciliation API was added.
- Steps:
  1. Read the merged B12/B13 implementation and specified queued, pre-spawn, active,
     deadline, crash and late-event evidence in the task contract.
  2. Persisted active cancellation before asking the scheduler to abort the root,
     halted later dispatch, and retained partial artifacts on the blocked task without
     starting artifact tests for an uncertain worker outcome.
  3. Added real subprocess checks for cancellation before spawn, deadline/exit races,
     detached Windows descendants and restart after process death; retained existing
     lifecycle immutability checks and a real late-zero-exit regression for late
     completions.
  4. During implementation review, found cancellation before spawn halted dispatch
     without setting the scheduler's reconciliation flag; set uncertainty before
     abort and verified `close()` retains ownership. A first descendant fixture did
     not survive root termination; made the child detached and verified its post-root
     write, with bounded cleanup.
  5. Re-read the complete final diff, mapped all four B14 rows and reran the full suite,
     fallback demo and diff check.
- Files: `src/service.mjs`, `src/scheduler.mjs`, `test/scheduler.test.mjs`,
  `test/subprocess.test.mjs`, `docs/task-contract.md`, `docs/adr/008-task-store.md`,
  `docs/tasks/B14.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/handoff.md`,
  `docs/validation.md`, `docs/worklog.md`.
- Validation: `node --test` → 223 passed, 0 failed, 1 POSIX-only skip;
  `node examples/fallback-demo.mjs` → 429 then 200; `git diff --check` → clean.
  OpenCode/MCP integration gates and Ubuntu CI were not rerun locally.
- Follow-up: monitor Windows/Ubuntu checks and review feedback on PR #37; merge remains
  a separate maintainer decision.

## 2026-11-09 — M2b: B14 review corrections

- Branch: `task/B14-cancellation-deadlines` from reviewed head `17b1f79`.
- Scope: both B14-02 findings on PR #37.
- Steps:
  1. Preserved captured stdout and stderr as an optional worker log, with credential
     redaction and the existing output cap. Kept worker output separate from tests.
  2. Replaced the timing-only subprocess test with real service fixtures for both
     deadline orderings and compared terminal record bytes after settling.
  3. Reviewed old v1 records, log selection and artifact validation, then checked
     the final diff against both review threads.
- Files: scheduler, artifact collector, result projection, task store, artifact
  schemas, scheduler/subprocess/contract tests, task contract, ADR-008, B14 card,
  validation and worklog.
- Validation: focused Windows subprocess and schema checks plus the full suite,
  demo and diff check. See the validation entry for observed results.
- Follow-up: recheck the PR head and review feedback before merge.

## 2026-11-11 — M2b: B15 MCP stdio adapter

- Branch: `task/B15-mcp-stdio-adapter` from merged B14 head `dc757c1`.
- Scope: code, tests and docs; no provider support, service-contract changes or
  automatic merge.
- Steps:
  1. Inspected the existing B15 implementation and confirmed B14 had merged before
     continuing the branch.
  2. Replaced unbounded line accumulation with incremental UTF-8 framing capped at
     1 MiB, and made malformed, oversized, unknown-field and serialization errors
     bounded and sanitized.
  3. Added foreign-owner, live-worker polling, partial-disconnect, and graceful idle
     shutdown checks while preserving the four service-owned operations.
  4. Added a pinned OpenCode 2.2.5 task-server gate using a loopback fixture provider;
     it discovers four tools, submits one task and observes the queued result.
  5. Reviewed the changed code against all B15 rows and updated the run, validation,
     backlog, roadmap and handoff documentation.
- Files: `README.md`, `docs/backlog.md`, `docs/requirements.md`, `docs/roadmap.md`,
  `docs/tasks/B15.md`, `docs/validation.md`, `docs/worklog.md`, `docs/handoff.md`,
  `integration/README.md`, `integration/mcp-task-gate.mjs`, `mcp-server.mjs`,
  `src/mcp-server.mjs`, `test/mcp-server.test.mjs`.
- Validation: `node --test --test-reporter=tap` → 251 passed, 0 failed, 1
  POSIX-only skip; pinned OpenCode task gate → four tools discovered and queued
  submission returned to context; fallback demo → 429 then 200; `git diff --check`
  → clean. OpenCode session/model smoke, standalone B06 gate and executor invocation
  were not rerun.
- Follow-up: review [PR #38](https://github.com/pbsilvabd/ai-orchestrator/pull/38).
  CI run `43131490538` was in progress on the implementation commit before the
  docs-only publication follow-up; no current run was returned for the latest head,
  and no review feedback existed at the last check. Refresh checks and review before
  authorized merge; then continue with B16, the pinned-client task polling/result
  workflow.

## 2026-11-12 — B15 review correction

- Branch: `task/B15-mcp-stdio-adapter`; corrected the blocking request-envelope
  finding on PR #38 at the reviewed head `255d18c`.
- Change: reject null, non-finite and non-integer numeric request IDs before tool
  dispatch; answer malformed request envelopes with bounded invalid-request errors;
  retain readable valid IDs when returning envelope errors.
- Tests: added coverage that invalid submit IDs do not call the service and malformed
  envelopes receive correlated or null-ID errors. Existing valid notification test
  remains in place.
- Validation: focused MCP adapter tests and full `node --test` passed on Node.js
  v24.22.1. Full suite: 254 tests, 253 passed, 0 failed, 1 POSIX-only skip. The
  fallback demo printed 429 then 200; `git diff --check` passed. Pinned OpenCode gate
  was not rerun because the correction affects malformed JSON-RPC envelope handling.
- Follow-up: push the correction, reply to Sol's review finding with the new SHA and
  validation, then re-review the new PR head and CI. PR #38 remains open and unmerged.

## 2026-11-11 — M2b: B16 pinned-client task workflow

- Branch: `task/B16-pinned-client-workflow`, based on merged B15 head `491de18`.
- Scope: pinned OpenCode client, real MCP stdio calls, fixture worker/provider and
  B16 evidence; no production provider, paid call or automatic merge.
- Steps:
  1. Added a B16 fixture service using the actual task service and MCP adapter, plus a
     real local Node worker and a redacted operation-name transport trace.
  2. Added pinned OpenCode flows for submit, running polls, terminal artifact retrieval,
     duplicate replay on a reconnect, active cancellation and host-process interruption
     followed by startup reconciliation.
  3. Added a missing-binary ENOENT check and assertions for stable identity, one
     attempt/workspace, unknown stop evidence, preserved artifacts and no replay.
  4. Reviewed the implementation, fixed readiness/polling and scenario-isolation issues,
     then reviewed the complete diff against B16-01–04 and updated the handoff, backlog,
     roadmap, requirements, task card, validation and integration instructions.
- Files: `integration/mcp-client-workflow.mjs`,
  `integration/fixtures/b16-mcp-server.mjs`, `integration/README.md`,
  `docs/backlog.md`, `docs/roadmap.md`, `docs/requirements.md`, `docs/tasks/B16.md`,
  `docs/validation.md`, `docs/worklog.md`, `docs/handoff.md`.
- Validation: pinned OpenCode gate exited 0 with 28 transport calls and every B16 row
  observed; full suite 254 tests (253 passed, 0 failed, 1 POSIX-only skipped),
  fallback demo 429 then 200, and diff check clean. See `docs/validation.md` for
  command details and evidence limits.
- Follow-up: publish one B16 PR, verify CI and remote head, then wait for task-specific
  maintainer review/merge before B17.

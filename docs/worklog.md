# Work log

Append-only record of merged increments, written for the next model or maintainer
picking up the repository. GitHub remains authoritative for PR numbers and commit
SHAs; this file records intent, steps and evidence.

Rules:

- One entry per merged change, newest last.
- Never rewrite or delete a past entry; correct it with a new entry.
- Every change appends its own entry in the same branch/PR.
- Update [handoff](handoff.md) when the next action changes.

## 2026-11-22 - M3: B30 PR #45 P2 review corrections (local)

- Branch/base: `task/B30-free-relay`, PR head `a4f3954514e2109a5f0112dcea0534d291a9fcf4`.
- Steps: corrected the supervised relay's fixed model to the worker wire ID; fixed asynchronous
  oversized-body rejection in relay and gateway and added supervised local-child regressions for
  normal forwarding and 413/latch/no-upstream/listener-survival/ownership behavior.
- Files: `src/free-listeners.mjs`, `src/relay.mjs`, `src/egress-gateway.mjs`,
  `test/free-listeners.test.mjs`, `docs/tasks/B30.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused B30 set 57/57 pass; serial full suite 415 pass / 0 fail / 5 skips,
  exit 0; the initial parallel full suite had one known timing-sensitive B10-03 failure
  (414 pass / 1 fail / 5 skip); demo 429 -> 200; diff check clean. See `docs/validation.md`.
- Follow-up: perform both implementation self-review passes, rerun any changed checks, then
  commit/push the same PR branch and verify its exact remote SHA before independent critical
  re-review. No commit/push yet. Pinned-host-through-supervised-composition and all outstanding
  B30 deployment/approval gates remain `not_run`; PR #45 remains draft and no merge is
  authorized.

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
- Publication: [PR #39](https://github.com/pbsilvabd/ai-orchestrator/pull/39) opened
  against `main`; remote branch matched head `ee019b844d1bc5f6df1e6fa2c4e7185076f79d31`.
  Windows and Ubuntu CI were pending at publication. Await task-specific maintainer
  review/merge before B17.

## 2026-11-12 — M2b: B16 review corrections

- Branch: `task/B16-pinned-client-workflow`, based on `491de18`.
- Scope: pinned-client gate, fixture service, documentation; no service contract change.
- Steps:
  1. Isolated fixture Git commands from inherited `GIT_*` variables and added an
     active-branch/staged-file canary that proves the missing-binary path leaves a
     separate repository unchanged.
  2. Logged correlated MCP response frames and asserted the actual submitted,
     running, succeeded, duplicate, cancellation and restart replies.
  3. Gated primary worker completion on a real `running` poll; waited for worker-written
     partial files before cancellation/interruption; checked worker exit, retained
     evidence and a no-replay counter after restart with dispatch enabled.
  4. Made host startup own cleanup and tested a live parent/descendant pair that never
     reports readiness; updated B16 task, integration, backlog, roadmap, requirements,
     validation and handoff documentation.
- Files: `integration/mcp-client-workflow.mjs`,
  `integration/fixtures/b16-mcp-server.mjs`, `integration/README.md`,
  `docs/tasks/B16.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/requirements.md`,
  `docs/validation.md`, `docs/worklog.md`, `docs/handoff.md`.
- Validation: pinned OpenCode 2.2.5 gate → 15 MCP calls and all B16 rows passed;
  four temporary regression injections (delayed poll, omitted test runs, mismatched
  replay ID, omitted cancellation signal) each failed as required; `node --test` →
  254 tests, 253 passed, 0 failed, 1 POSIX-only skip; fallback demo → 429 then 200;
  Node syntax checks and `git diff --check` clean.
- Follow-up: corrections were pushed as `1ef2b3f1b807c2138acfec528271d9fb2d59bb9d`;
  replied to all six review findings with the checks performed. Current-head CI run
  `43149559100` is in progress; request re-review after checks complete. Leave merge to
  separate task-specific authorization; PR #39 remains open.

## 2026-11-12 — B16 second re-review follow-ups

- Review identified three remaining defects on PR #39: Windows Git environment keys
  were filtered case-sensitively; primary polling used the durable disk ID instead of
  the client-facing submit reply and terminal result identity was not asserted; startup
  cleanup skipped descendants when their leader exited before readiness.
- Corrected the fixture Git environment with an allowlist and per-repository pinned
  Git directory/worktree. Added uppercase/lowercase/mixed-case hostile canaries.
- Primary polls now use the parsed ID from the submit reply seen by the provider. The
  terminal MCP result and provider-facing status/result pair each assert both task IDs,
  plus lifecycle and artifact evidence.
- Cleanup now signals POSIX process groups after leader exit and on Windows tracks and
  terminates fixture-owned descendant PIDs independently. Added a parent-exits-first
  readiness regression case.
- Validation: pinned OpenCode 2.2.5 gate → 15 MCP calls, all B16 rows passed; full suite
  → 254 tests, 253 passed, 0 failed, one POSIX-only skip. Four fault-injection copies
  (case-sensitive Git filtering, lost submit ID, wrong terminal ID, skipped cleanup
  after leader exit) each failed as required. `node --check` and `git diff --check`
  clean. Publication and current-head CI/re-review are next; PR #39 remains open.


## 2026-11-12 — B16 second re-review corrections published

- Published the follow-up fix and documentation in commit
  `8a23b51a62e230bf643d61c72c86531f90ae5c70` on the existing PR #39 branch. Replied to
  the three new inline findings with the targeted evidence; the earlier six findings
  also remain answered.
- Verified that local and remote branch heads match. Current-head CI run 43152221875
  passed on Windows and Ubuntu. The PR remains open; independent re-review is pending.


## 2026-11-12 — B16 process-ownership re-review follow-up

- The remaining review finding showed stdout-derived PIDs could both miss an unmarked
  descendant and target an unrelated process. Removed stdout from process ownership.
- On Windows a PowerShell monitor records Win32 process IDs, parent IDs and creation
  timestamps while the host runs. Cleanup follows only verified ancestry and rechecks
  creation identity before terminating descendants, even after the leader exits. POSIX
  cleanup signals the owned group after leader exit.
- The regression fixture writes its child PID only to an assertion file, prints a
  misleading unrelated sibling PID to stdout, exits its leader before readiness, and
  requires the child to be reaped while the sibling remains alive.
- Validation: pinned OpenCode gate → 15 MCP calls and all B16 rows passed; full suite →
  254 tests, 253 passed, 0 failed, one POSIX-only skip; fallback demo → 429 then 200.
  Two isolated fault injections (no ownership tracking; trust stdout PID) each failed
  as expected. Node syntax and diff checks were clean. Publish, check current-head CI,
  and reply to the review thread; PR #39 remains open.


## 2026-11-12 — B16 process-ownership fix published

- Published `d4c0206c247aeb207a03f9720045f3c7100d26e2` to the existing PR #39 branch and
  replied to the remaining process-ownership finding with the OS-identity regression
  evidence.
- CI run 43344816865 passed on Windows and Ubuntu. PR #39 remains open and unmerged;
  independent re-review is pending.

## 2026-11-12 — M2b: B16 Windows host containment

- Branch: `task/B16-pinned-client-workflow`, based on `491de18`.
- Scope: Windows cleanup in the opt-in B16 integration harness.
- Steps:
  1. Replaced ancestry sampling with a temporary launcher that attaches the host
     to a Windows Job Object at creation and verifies zero active job members.
  2. Removed the canary barrier so the parent exits immediately after creating
     the child. Retained the unrelated-sibling assertion.
  3. Reviewed process and handle ownership during implementation, then checked
     the complete PR diff and repeated the pinned gate and regression checks.
- Files: B16 harness, Windows launcher fixture, integration README, ADR-007,
  B16 card, validation, worklog, backlog, handoff, requirements and roadmap.
- Validation: pinned OpenCode 2.2.5 gate passed with 15 MCP calls. Removing
  creation-time job assignment in an isolated run failed the fast-exit case.
  The suite, fallback demo, syntax and diff checks passed. See `docs/validation.md`.
- Follow-up: verify PR #39 on its current head and await independent review.


## 2026-11-12 — M2b: executable thirteen-item acceptance matrix

- Branch: `task/B17-executable-acceptance-matrix`
- Scope: code, tests and docs; no task-service behavior or provider authority changed.
- Steps:
  1. Added an acceptance runner that reads the normative criteria, pins their
     content fingerprint and executes mapped local tests plus the real B16 client
     workflow, returning a machine-readable result for each item.
  2. Added reporter regressions for failed assertions, missing/skipped cases,
     contract drift and incomplete matrices; added a non-owner cancellation
     assertion with persisted-state checks.
  3. Published the 13-item result JSON and updated the backlog, roadmap, handoff
     and integration instructions.
- Files: `integration/acceptance-matrix.mjs`, `test/acceptance-matrix.test.mjs`,
  `test/task-service.test.mjs`, `package.json`, `integration/README.md`,
  `docs/evidence/B17-acceptance-matrix.json`, `docs/backlog.md`, `docs/handoff.md`,
  `docs/roadmap.md`, `docs/validation.md`, `docs/worklog.md`
- Validation: `npm run acceptance` → 13 pass, 0 fail, 0 not_run; missing-host
  injection → 7 pass, 6 not_run, exit 1; `node --test` → 258 passed, 0 failed,
  one POSIX-only skip; fallback demo → 429 then 200; `git diff --check` → clean;
  changed Markdown links → 6 files, 58 targets, 0 broken. The Ubuntu pinned-client
  workflow was not rerun.
- Publication: [PR #40](https://github.com/pbsilvabd/ai-orchestrator/pull/40)
  is open at `6447b9a9a6e11fd2098946d46e8f3c5777e8c790`, based on current `main`
  (`681f0a6cce3c2160c578cc92a0ab038ff5cfce01`). Remote CI run #74 was in progress
  at the first remote check; no review submissions, inline threads or comments exist.
  Merge requires separate task-specific authorization.

## 2026-11-14 — M2b: B17 acceptance review corrections

- Branch: `task/B17-executable-acceptance-matrix`
- Scope: code, tests and docs; no task-service runtime behavior or provider authority
  changed.
- Steps:
  1. Added real Node test-child coverage showing a required assertion failure stays
     `fail` when TAP also reports a skipped child and a TODO; added nonzero-exit
     precedence coverage when TAP reports only a TODO.
  2. Added client submission denial to the M2b-09 title, keeping the foreign-client
     denial and unchanged-record assertions in its executable mapping.
  3. Regenerated the B17 evidence JSON from the final pinned-client run and recorded
     the local and independently supplied validation results. Ran a temporary-copy
     fault injection that forces only the foreign-client test to fail and verified
     the matrix attributes the failure to M2b-09 rather than M2b-03.
- Files: `integration/acceptance-matrix.mjs`, `test/acceptance-matrix.test.mjs`,
  `test/task-service.test.mjs`, `integration/fixtures/b16-mcp-server.mjs`,
  `integration/mcp-client-workflow.mjs`, `integration/README.md`,
  `docs/evidence/B17-acceptance-matrix.json`, `docs/worklog.md`,
  `docs/validation.md`
- Validation: final pinned OpenCode matrix 13/13 passed; full suite 261 passed,
  1 POSIX-only test skipped on Windows, 0 failed; final focused reporter/service
  suite 35/35 passed; missing-host matrix correctly returned 7 pass and 6 not_run;
  negative attribution injection returned matrix exit 1 with M2b-09 fail and M2b-03
  pass. Fallback demo returned preferred 429 then local 200; final diff check passed.
  Independent transport, scheduler, artifacts and workspace results are recorded in
  `docs/validation.md`.
- Follow-up: supervisor reviews the finalized local diff and validation evidence;
  the correction is ready for publication on PR #40 and current-head CI.

## 2026-11-14 — M2b: B18 explicit maintainer recovery and retention

- Branch: `task/B18-maintainer-recovery`
- Scope: code, tests and docs; no worker-callable maintenance operation, replay path,
  provider or publication action added.
- Steps:
  1. Added service/maintenance owner interlocking, nonce-bound maintenance handles,
     explicit stale-owner audit and guarded direct store prune/reconciliation paths.
  2. Added exact-state/evidence-bound blocked-to-failed/cancelled recovery, strict
     completed-outcome/cancellation proof rules, and invariant `effectsReverted:false`.
  3. Added fixed 30-day pruning with per-record intent journals and interrupted
     record/index recovery; added actual process-death and active worker fixtures.
  4. Updated the task-record schema, normative contract, ADR-008, CLI/procedure,
     README, roadmap, backlog, task card and handoff. Kept the handoff current rather
     than using a new template block; its existing sections were updated in place.
  5. Review pass 1 found and fixed direct-store lock bypass, ordinary-update ability
     to attach a reconciliation receipt, incomplete schema support, a test-only prune
     phase hook, an inspection journal path error, and insufficient process-inventory
     evidence. Review pass 2 checked the complete local diff and every B18 matrix row.
- Files: `README.md`, `docs/adr/008-task-store.md`, `docs/backlog.md`,
  `docs/handoff.md`, `docs/roadmap.md`, `docs/task-contract.md`, `docs/tasks/B18.md`,
  `docs/task-maintenance.md`, `docs/worklog.md`, `docs/validation.md`,
  `src/contracts/schemas/task-record.schema.json`, `src/service.mjs`, `src/tasks.mjs`,
  `scripts/task-maintenance.mjs`, `test/contracts.test.mjs`,
  `test/task-lifecycle.test.mjs`, `test/task-maintenance.test.mjs`,
  `test/task-store.test.mjs`
- Validation: Windows 11 Pro x64, Node.js v24.22.1, Git 2.55.0.windows.5;
  `node --test` → 274 passed, 0 failed, 1 existing POSIX-only skip (exit 0);
  `node examples/fallback-demo.mjs` → 429 then 200 (exit 0);
  `node --check scripts/task-maintenance.mjs` and `git diff --check` passed.
  Pinned OpenCode/MCP host gates were not rerun.
- Follow-up: supervisor independently reviews this unpublished B18 diff, reproduces
  its acceptance scenarios and owns any correction/publication cycle.

## 2026-11-14 — M2b: B18 supervisor pass-1 corrections

- Branch: `task/B18-maintainer-recovery`
- Scope: code, tests and docs; no commit, push, PR or merge action was taken.
- Steps:
  1. Replaced caller-replayable maintenance nonce authorization with a private
     in-process capability, added a serialized stale-owner recovery gate, and
     documented manual recovery for an abandoned gate.
  2. Preserved original idempotency keys as durable tombstones after pruning,
     implemented an isolated `repair-index` CLI operation that leaves unrelated
     task lifecycle state unchanged, and restored
     configurable retention with a 30-day default.
  3. Added explicit unknown-outcome administrative failure closure that preserves
     dispatch evidence and the original block, without representing unknown work as
     a known execution failure; retained cancellation's persisted-request rule.
  4. Added real scheduler-crash/restart, competing recovery-process, detached
     descendant, MCP-wire denial, CLI repair/tombstone and unchanged-byte tests.
  5. Corrected B18/B19 status and acceptance wording; appended final validation
     evidence without reordering earlier history. The prior entry's counts describe
     its earlier run and are superseded for this checkout by this correction entry.
- Files: `README.md`, `docs/adr/008-task-store.md`, `docs/backlog.md`,
  `docs/handoff.md`, `docs/roadmap.md`, `docs/task-contract.md`,
  `docs/task-maintenance.md`, `docs/tasks/B18.md`, `docs/tasks/B19.md`,
  `docs/validation.md`, `docs/worklog.md`,
  `src/contracts/schemas/task-record.schema.json`, `src/service.mjs`,
  `src/tasks.mjs`, `scripts/task-maintenance.mjs`, `test/contracts.test.mjs`,
  `test/mcp-server.test.mjs`, `test/task-lifecycle.test.mjs`,
  `test/task-maintenance.test.mjs`, `test/task-store.test.mjs`
- Validation: Windows 11 Pro x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5;
  focused B18/schema/store/lifecycle/MCP suite → 135 passed, 0 failed;
  `node --test` → 280 passed, 0 failed, 1 existing POSIX-only skip;
  `node examples/fallback-demo.mjs` → 429 then 200; CLI syntax and final diff
  whitespace checks passed. Pinned OpenCode host gates and Ubuntu CI were not run.
- Follow-up: supervisor reviews the corrected unpublished diff and its acceptance
  evidence; supervisor owns publication. Merge remains separately unapproved.

## 2026-11-14 — M2b: B18 supervisor re-review corrections

- Branch: `task/B18-maintainer-recovery`
- Scope: code, tests and docs; no commit, push, PR or merge action was taken.
- Steps:
  1. Made maintainer-update identity checks preserve the distinction between an
     absent optional `baseCommit` and an explicit value; added a legacy-v1 blocked
     record recovery regression.
  2. Added the distinct guarded `reconcile-store` CLI command and an actual
     subprocess crash workflow covering owner recovery, startup reconciliation,
     digest-bound administrative closure and idempotent no-worker replay.
  3. Registered bounded cleanup for the surviving-descendant test and bounded the
     competing recovery child waits/termination while retaining ambiguous fixtures.
  4. Corrected the Windows recovery runbook, retention signature/comment and the
     sanitized name of the supervisor descendant experiment in new validation evidence.
- Files: `docs/adr/008-task-store.md`, `docs/task-maintenance.md`,
  `docs/validation.md`, `docs/worklog.md`, `scripts/task-maintenance.mjs`,
  `src/tasks.mjs`, `test/task-maintenance.test.mjs`
- Validation: Windows 11 Pro x64, Node.js v24.22.1 (fnm), Git 2.55.0.windows.5;
  focused maintenance/schema/store/lifecycle/MCP suite → 137 passed, 0 failed;
  `node --test` → 282 passed, 0 failed, 1 existing POSIX-only skip;
  fallback demo → 429 then 200; CLI syntax and final diff checks passed.
  Pinned OpenCode gates and Ubuntu CI were not rerun.
- Follow-up: supervisor owns the final complete-diff review and publication;
  merge remains separately unapproved.

## 2026-11-14 — M2b: B18 Windows PowerShell CLI input correction

- Branch: `task/B18-maintainer-recovery`
- Scope: CLI, operator procedure and tests; no commit, push, PR or merge action was taken.
- Steps:
  1. Added `--input-file <path>` with UTF-8 and optional-BOM decoding, exact JSON
     object validation, strict argument-form rejection and path-free read errors;
     retained raw JSON arguments for shells that preserve native quoting.
  2. Replaced inline JSON in Windows runbook examples with structured
     `ConvertTo-Json`/`Set-Content -Encoding UTF8` files and documented the raw
     argument compatibility caveat.
  3. Added platform-independent file-input and unchanged-byte regressions plus an
     actual Windows PowerShell 5.1 subprocess test for BOM, spaces, malformed,
     missing and array inputs.
- Files: `docs/task-maintenance.md`, `docs/validation.md`, `docs/worklog.md`,
  `scripts/task-maintenance.mjs`, `test/task-maintenance.test.mjs`
- Validation: Windows 11 Pro x64, PowerShell 5.1.26100.9818, Node.js v24.22.1;
  focused suite → 139 passed, 0 failed; full suite → 284 passed, 0 failed,
  1 existing POSIX-only skip; demo → 429 then 200; CLI syntax and diff checks passed.
  Pinned OpenCode gates and Ubuntu CI were not rerun.
- Follow-up: supervisor owns final complete-diff review and publication; merge
  remains separately unapproved.

## 2026-11-14 — M2b: B18 supervisor final review and delivery

- Branch: `task/B18-maintainer-recovery`
- Scope: code/test review, independent validation and delivery documentation; no
  provider activation, worker replay or merge authority added.
- Steps:
  1. GPT-6.1 Sol supervised GPT-6 Luna high from base `190370f`, with B17/#40
     and its Windows/Ubuntu PR/post-merge checks verified and no existing B18 PR.
  2. Reviewed the complete diff and each acceptance row, independently reproduced
     blockers, returned them to Luna and verified the corrections over three rounds.
     Fixes cover role-scoped maintenance, serialized recovery, retained key guards,
     unknown administrative closure, CLI repair/crash flow, legacy compatibility,
     bounded fixture cleanup and PowerShell 5.1-safe file input.
  3. Independently ran the final focused/full suites, fallback demo, CLI syntax and
     external correction probes against temporary homes. Reviewed all new source,
     schema, tests, Windows procedure and status changes; no blocker remains.
  4. Updated AGENTS, README, backlog/card, roadmap and handoff for the single B18 PR
     review checkpoint. Appended supervisor validation without altering committed
     worklog/validation history. Current-head publication, CI and feedback receipts
     belong to that PR; merge remains a separate maintainer decision.
- Files: `AGENTS.md`, `README.md`, `docs/backlog.md`, `docs/handoff.md`,
  `docs/roadmap.md`, `docs/tasks/B18.md`, `docs/validation.md`, `docs/worklog.md`;
  reviewed implementation/test files are enumerated in the prior B18 entries.
- Validation: focused suite 139 passed; `node --test` -> 284 passed, one existing
  POSIX-only skip; demo -> 429 then 200; CLI syntax and independent final probes
  passed (all exits 0). Final whitespace/link checks accompany publication.
  Pinned OpenCode/client gates were not rerun; fixture evidence is not B20/M3 use.
- Follow-up: publish the reviewed commit without force, verify the one PR/head and
  observe CI; leave the PR open for the maintainer's merge decision.

## 2026-11-14 — M2b: B19 opt-in harness pulse

- Branch: `task/B19-opt-in-harness-pulse`
- Scope: code, tests and docs; no service scheduler, task execution, provider activation,
  model ranking or automatic/scheduled retry was added.
- Steps:
  1. Added a manual eight-slot capability pulse with explicit pinned host/version,
     bounded subprocess and UTF-8 output, per-slot phase/transcript, exclusive report
     creation, failure-preserving diagnostic retries and conservative timeout cleanup.
  2. Added the gated read-only history projection. It requires passing tracked B17
     evidence, reads only one explicit task record, sanitizes/bounds fields, and refuses
     blocked or uncertain outcomes without store reconciliation or task replay.
  3. Added real temporary child/filesystem tests for all B19 rows and a pinned-host
     failure/retry report using only the local loopback fixture provider.
  4. Updated the current-state summary in AGENTS, normative task contract, ADR-006,
     task/backlog/roadmap/handoff status, README, integration guide and pulse evidence
     map. Adapted the worklog/validation templates as the required append-only records.
- Review pass 1: found and fixed absolute-path leakage from child stack traces, capped
  raw-tail credential leakage, malformed/uncertain history handling, and an initially
  unsafe scratch parent for timeout fixtures. Also removed a test-only B17 evidence-path
  override that could have weakened the tracked-evidence gate; a copied pre-B17 CLI
  fixture now tests refusal on a real temporary filesystem. Capped raw streams are
  omitted; timeout scratch is retained in temp/report scope and the test removes its
  exact owned fixture.
- Review pass 2: inspected the complete base-to-working diff and each B19 row; verified
  missing host/version slots, eight original results plus separate retry, pre-B17 and
  uncertain history byte preservation/no task replay, exclusive artifacts, no
  scheduler/provider/ranking/task executable path, and accurate milestone/host-evidence
  wording. No blocking finding remains locally.
- Files: `AGENTS.md`, `README.md`, `docs/adr/006-worker-service.md`, `docs/backlog.md`,
  `docs/handoff.md`, `docs/pulses/B19-pinned-host.json`, `docs/pulses/README.md`,
  `docs/roadmap.md`, `docs/task-contract.md`, `docs/tasks/B19.md`,
  `docs/validation.md`, `docs/worklog.md`, `integration/README.md`,
  `integration/harness-pulse.mjs`, `integration/mcp-gate.mjs`,
  `test/harness-pulse.test.mjs`.
- Validation: `node --test` → 288 passed, 0 failed, 1 existing POSIX-only skip;
  fallback demo → 429 then 200; B19 injected pinned-host pulse → expected exit 1,
  originals 7 pass/1 fail/0 not_run with a separately passing retry; `git diff --check`
  → clean. Ubuntu pinned-host integration was not rerun.
- Follow-up: supervisor reviews the unpublished B19 branch/diff and decides on
  publication; B20 remains gated on M2b acceptance and explicit real-provider/model/
  budget authorization.

## 2026-11-14 — M2b: B19 supervisor corrections

- Branch: `task/B19-opt-in-harness-pulse` (unpublished local corrections over user
  checkpoint `91e43e4`; no commit or publication authorized)
- Scope: mixed.
- Steps:
  1. Contained Windows gate launches in the B16 creation-time Job Object helper,
     keeping its randomized cleanup proof marker out of the child environment; POSIX
     launches use a dedicated process group with bounded teardown/empty-group
     verification. Timeout or uncertain cleanup preserves the original sample,
     halts subsequent original samples, marks remaining slots `not_run`, and prevents
     retries.
  2. Separated original gate phase from cleanup phase/status and preserved cleanup
     outcome without replacing the failure phase.
  3. Made history a distinct B17-gated read-only report mode, using the task store's
     pure record validator, conservative lifecycle checks and an output path outside
     the selected home. Coherent known-failure reconciliation is allowed; unknown or
     incoherent administrative outcomes are refused.
  4. Added regression coverage for a real spawned descendant, uncertain cleanup,
     history-only CLI/API side effects and known/unknown reconciliation records.
- Self-review pass 1: identified that the Windows proof marker could be inherited by
  the gate and potentially echoed as a false cleanup confirmation; the launcher now
  removes it from its child environment. Also tightened history mode to reject binary
  and version options instead of silently ignoring mixed-mode arguments.
- Self-review pass 2: rechecked all acceptance rows and the complete local diff,
  including actual B16 Job Object pulse evidence, forced simultaneous probe/cleanup
  failure metadata, history home byte preservation and timeout/retry suppression. No
  remaining local blocker identified; supervisor retest is still required.
- Files: `integration/harness-pulse.mjs`, `integration/mcp-gate.mjs`,
  `integration/fixtures/b16-windows-job.cs`, `src/tasks.mjs`,
  `test/harness-pulse.test.mjs`, `docs/task-contract.md`,
  `docs/adr/006-worker-service.md`, `integration/README.md`,
  `docs/pulses/README.md`, `docs/validation.md`, `docs/roadmap.md`,
  `docs/handoff.md`, and `docs/pulses/B19-final-containment.json`.
- Validation: focused B19 suite 4/4; full suite 288 passed, 0 failed, 1 existing
  POSIX-only skip; demo 429 then 200; pinned-host fixture 7/1/0 with separate passing
  retry and verified Job Object cleanup; forced probe+cleanup fixture preserved
  `failure:probe` plus `cleanup/failed`; syntax and diff checks passed. Exact commands
  and limits are recorded in `docs/validation.md`.
- Follow-up: supervisor independently retests this local diff and decides publication.

## 2026-11-14 — M2b: B19 R5 supervisor corrections and final local review

- Branch: `task/B19-opt-in-harness-pulse` (unpublished local changes over checkpoint
  `91e43e4`; no commit, push or PR authorized).
- Scope: code, tests, evidence and docs.
- Steps: gated diagnostics on the entire originals run remaining certain; removed
  duplicate retry `not_run` records; added both retry regressions. Increased ordinary
  fixture timeouts to 15 seconds and kept dedicated timeout fixtures separate, with
  complete outcome assertions. Made POSIX signal-failure settlement bounded and
  uncertain, explicitly documented process-group/escaped-descendant limits, consumed
  Windows control-stdin errors, and restricted persisted version to exact `2.2.5`.
- Supervisor failure preserved: the supervisor's focused test command exited 1 with
  B19-01 summary.fail 2 (expected 1) and the oversized-output fixture status `fail`
  (expected `pass`). Per-test termination evidence was unavailable. A local diagnosis
  using a 1-second B19-style budget did not reproduce either failure (injected exit 7
  plus verified cleanup; oversized output passed in 175 ms); cause remains unconfirmed.
- Self-review pass 1: checked retry invariants, full-outcome diagnostics, uncertain
  cleanup, Windows stdin and version handling, and bounded POSIX signal-failure flow.
  Self-review pass 2: reviewed the completed diff and evidence mapping; repeated B19
  tests, full suite/demo/diff checks, B16 shared-helper integration and fresh pinned
  host report. No B17 rerun was made.
- Files: `integration/harness-pulse.mjs`, `test/harness-pulse.test.mjs`,
  `docs/task-contract.md`, `docs/adr/006-worker-service.md`, `integration/README.md`,
  `integration/fixtures/b16-windows-job.cs`, `src/tasks.mjs`, `docs/pulses/README.md`,
  `docs/pulses/B19-r5-final.json`, `docs/validation.md`, `docs/worklog.md`,
  `docs/handoff.md`, `docs/roadmap.md`.
- Validation: focused suite twice, each 6/6; full suite 290 passed, 0 failed, 1
  existing POSIX-only skip; fallback demo 429 then 200; retry reproducer matched 3-call
  no-retry and 9-call/eight-unique-record expectations; B16 pinned-client workflow
  passed; new pinned-host pulse assertions passed (7/1/0, separate retry and confirmed
  Job Object cleanup; expected command exit 1); syntax and diff checks passed. Full
  commands, the supervisor failure and limitations are appended in `docs/validation.md`.
- Limits: native POSIX process-group behavior was not run on this Windows host. The
  injected POSIX settlement test validates bounded control flow, not OS containment;
  escaped descendants remain outside process-group verification. No real provider,
  M2b service use or M3 task evidence.
- Follow-up: independent supervisor review of the unpublished current diff and
  `B19-r5-final.json`; publication remains supervisor-owned.

## 2026-11-14 — M2b: B19 independent supervisor review and verification

- Branch: `task/B19-opt-in-harness-pulse`
- Scope: review, independent validation and documentation; no real-provider/task
  execution or additional product capability.
- Steps:
  1. GPT-6.1 Sol reviewed the entire base-to-final diff and every B19 row, reproduced
     blockers, returned them to GPT-6 Luna high and verified the corrections.
  2. Independently ran the six focused cases, both retry reproductions, full suite,
     current-code B17 matrix, pinned-host pulse, forced probe/cleanup failure, demo,
     syntax and whitespace checks. Kept all earlier pulse artifacts unchanged.
  3. Updated continuation and evidence mapping; recorded earlier failed results and
     remaining POSIX/provider limits instead of replacing them with later passes.
- Files: `AGENTS.md`, `README.md`, `docs/backlog.md`, `docs/tasks/B19.md`,
  `docs/handoff.md`, `docs/roadmap.md`, `docs/pulses/README.md`,
  `docs/pulses/B19-supervisor-final.json`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused 6/6; full suite 290 passed, 0 failed, 1 existing POSIX-only skip;
  B17 13/13; pulse originals 7/1/0 plus one separate passing retry, expected native
  exit 1; forced cleanup failure retained original phase; demo 429 then 200; syntax
  and diff checks passed. Native POSIX and unrelated smoke gates were not rerun.
- Follow-up: publish the single reviewed B19 PR, record findings/correction SHAs and
  verified re-review, wait for exact-head CI, then use only the current B19-specific
  conditional merge authorization. Confirm remote main and post-merge CI afterward.

## 2026-11-14 — M2b: B19 PR publication checkpoint

- Branch: `task/B19-opt-in-harness-pulse`
- Scope: publication status documentation only; tested runtime code unchanged.
- Steps:
  1. Committed the initial review checkpoint `91e43e4` and verified corrections in
     `87782d2`, pushed without force and opened the single B19 PR #42 against main
     `c268239`. The remote branch and PR head both matched `87782d2`.
  2. Read the complete conversation, submitted reviews and inline-thread query at
     that head: all empty, with no next thread page. CI started on Windows/Ubuntu.
  3. Recorded the PR as the authoritative future check/merge receipt rather than
     claiming a merge or green CI before observation.
- Files: `AGENTS.md`, `README.md`, `docs/backlog.md`, `docs/tasks/B19.md`,
  `docs/roadmap.md`, `docs/handoff.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: publication and SHA verification succeeded; content checks passed for
  12 Markdown files, 111 links and all four preserved pulse reports; diff check passed.
  Runtime checks were not
  rerun for this documentation-only checkpoint; the preceding entry records final
  code verification. Exact-head CI, feedback re-read and conditional merge follow.
- Follow-up: publish SHA-specific review/resolutions, verify this documentation diff,
  then await final-head CI. No merge until all gates are observed passing.

## 2026-11-14 — M3 preparation: B29 anonymous free worker, fixture only

- Branch: `task/B29-opencode-free-provider`
- Scope: code, unit tests, a pinned-host loopback harness and docs; the live free route
  stays closed, so no real inference, catalog GET, paid call or merge was performed.
- Steps:
  1. Inspected the uncommitted B29 worktree on base `688da04` and ran the focal tests (8
     passed) and the full suite (299 passed, one platform skip) on the initial code. The
     pinned-host harness had not been run yet.
  2. Ran the pinned OpenCode 2.2.5 binary against a loopback fixture. The guard did not
     admit the model: it refused `variant: "default"`, which the host reports for every
     model and treats as a no-op. The guard now accepts `undefined` or `default` and still
     refuses any other variant or `null`; the unit fixture now uses the observed shape.
  3. Ran the pinned harness across six scenarios. Normal, 401, 402, 429 and connection-drop
     passed. The 307 redirect was followed and reached a second loopback origin with the
     prompt body; the guard cannot control it, so the redirect case fails by design.
  4. Removed the ineffective `redirect: "error"` Request replacement in
     `src/free-guard.mjs` and documented the host limit in the guard header.
  5. Closed live composition in `src/configured-service.mjs`: a free worker without an
     explicit loopback fixture endpoint is refused before approval or metadata reads.
     Metadata is required from trusted callers; no default catalog fetch remains there.
  6. Adjusted `test/free-provider.test.mjs` to the observed event shape, removed the
     redirect assertion and added the live-closure and variant cases.
  7. Added `integration/opencode-free.mjs` (pinned-host loopback harness), its section in
     `integration/README.md`, the admission clause in `docs/task-contract.md`, the ADR-009
     decision (proposed), the plugin evidence section in `docs/plugin-audit.md`, and the
     B29 status matrix in `docs/tasks/B29.md`.
  8. Updated the backlog index, roadmap M3 status and handoff next action; recorded B19 as
     merged on main `688da04`. B20 PR #43 and its unimplemented test were not touched.
- Files: `src/free-provider.mjs`, `src/free-guard.mjs`, `src/configured-service.mjs`,
  `src/opencode.mjs`, `src/service.mjs`, `mcp-server.mjs`,
  `test/free-provider.test.mjs`, `test/fixtures/free-worker.mjs`,
  `integration/opencode-free.mjs`, `integration/README.md`,
  `docs/adr/009-free-anonymous-worker.md`, `docs/tasks/B29.md`,
  `docs/task-contract.md`, `docs/plugin-audit.md`, `docs/backlog.md`, `docs/roadmap.md`,
  `docs/handoff.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: `node --test test/free-provider.test.mjs` → 8 passed, 0 failed; `node --test`
  → 300 tests, 299 passed, 0 failed, 1 platform-gated skip; `node examples/fallback-demo.mjs`
  → 429 then 200; `node --check` on nine changed `.mjs` files passed; the pinned harness
  exited 1 only on `redirect-307`. Details are in [validation](validation.md). The
  OpenCode smoke, MCP gate, B16 pinned-client workflow and live free route were not rerun.
- Follow-up: the maintainer must choose a redirect control in ADR-009 before any live
  approval; until then the B29 PR stays draft and B20 remains not_run.

## 2026-11-14 — M3 preparation: B29 redirect-control decision

- Branch: `task/B29-opencode-free-provider`
- Scope: documentation-only technical/security decision; no worker, relay, live
  request, public catalog request or B20/#43 change.
- Steps:
  1. Checked PR #44 at `4d28b65`: still draft; Windows and Ubuntu CI passed.
     Reviewed the pinned host redirect path and the existing B29 evidence.
  2. Amended ADR-009 with a conditional relay plus independently verified
     worker egress restriction; kept live composition closed and required a
     maintainer-signed, relay-bound approval and a WebSocket-negative gate.
  3. Narrowed the B29 card to fixture-only without erasing its historical
     307 failure; kept MCP-client fixture acceptance mandatory. Updated the
     backlog PR link, roadmap and handoff. Prepared B30's card separately on
     `task/B30-free-relay` from main; no B30 code was added to this branch.
- Files: `docs/adr/009-free-anonymous-worker.md`, `docs/tasks/B29.md`,
  `docs/backlog.md`, `docs/handoff.md`, `docs/roadmap.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test` → first run 297 passed/2 failed, second run
  298 passed/1 failed (the same timing-sensitive B10-03 case); isolated
  `node --test test/subprocess.test.mjs` → 8 passed, 1 Windows skip;
  `node --test test/free-provider.test.mjs` → 8 passed; demo → 429 then
  200; `git diff --check` → no errors. No pinned-host harness, catalog,
  real inference or MCP-client fixture was rerun for this docs-only decision.
- Follow-up: complete B29-04 MCP-client fixture evidence and review PR #44's
  new head while retaining draft; B30's separate branch holds the live card.

## 2026-11-14 — M3 preparation: B29 pinned-client fixture MCP correction

- Branch: `task/B29-opencode-free-provider`
- Scope: test-only integration code, focused process/unit tests and documentation;
  no production service/CLI source, external provider, public catalog, B20 or
  live worker route changed.
- Steps:
  1. Added `integration/fixtures/b29-free-mcp-server.mjs` as a trusted
     loopback-only composition entry point distinct from the production CLI.
  2. Added `integration/mcp-free-workflow.mjs` to exercise the pinned client,
     real MCP stdio, queued/running/result polling, two idempotent replays,
     a scoped diff/test exit and denied out-of-scope write. Reused the B16
     Windows Job Object with an explicit empty-job cleanup marker.
  3. Added CLI refusal/passive tests, direct launch-time approval expiry tests
     and pinned-host post-effect loss and uncertain-deadline fixtures, keeping
     the historical 307 target/body-byte leak as a failing scenario.
  4. Reviewed implementation/authority and responded to the second free-agent
     inspection finding: built the status sequence from actual polls, removed
     unobserved external-call booleans, tightened the dispatch barrier and
     recorded the scheduler's required reconciliation on an uncertain stop.
  5. Independently reran focal, pinned-client, negative harness, full suite and
     demo checks. Amended the ADR/contract for test-only MCP composition,
     documented the eight-scenario harness and updated card, backlog, roadmap
     table formatting/status and handoff. Appended this and validation entries
     rather than rewriting earlier failed/partial checkpoints.
- Files: `integration/fixtures/b29-free-mcp-server.mjs`,
  `integration/mcp-free-workflow.mjs`, `integration/opencode-free.mjs`,
  `integration/README.md`, `test/b29-cli-composition.test.mjs`,
  `test/free-provider.test.mjs`, `docs/adr/009-free-anonymous-worker.md`,
  `docs/task-contract.md`, `docs/tasks/B29.md`, `docs/backlog.md`,
  `docs/roadmap.md`, `docs/handoff.md`, `docs/validation.md`,
  `docs/worklog.md`.
- Validation: `node --test` → 303 passed, 0 failed, 1 Windows skip;
  `node --test test/free-provider.test.mjs test/b29-cli-composition.test.mjs`
  → 12 passed; pinned MCP fixture → queued/running/succeeded, one attempt,
  test exit 0; pinned free harness → exit 1 solely for redirect-307, with
  one alternate request and 7121 body bytes; demo → 429 then 200;
  `git diff --cached --check` → no whitespace errors. Standalone smoke, B16/B17,
  B19, real catalog/inference and B30 deployment were not rerun.
- Follow-up: review the complete diff and PR feedback at the published B29
  head, verify Windows/Ubuntu CI, then mark only the fixture PR ready if
  checks pass. B30's relay/egress/signature work waits for B29 merge and a
  suitable deployment; live stays closed. This entry adapts the task-card
  status format by appending a dated matrix checkpoint rather than rewriting
  the historical failed 307 row.

## 2026-11-14 — M3 preparation: B29 independent review corrections

- Branch: `task/B29-opencode-free-provider`
- Scope: one fixture service-level regression and documentation/comment fixes;
  no worker/transport executable behavior, live endpoint, catalog or PR #43
  changed.
- Steps:
  1. Read all PR #44 conversation, submitted reviews and four inline P3
     findings at `3c30866`; confirmed the independent fixture-only verdict,
     reproduced 307 failure and Windows/Ubuntu CI success at that head.
  2. Corrected `docs/handoff.md` to describe ADR-009 as accepted for fixture
     preparation and `mcp-server.mjs` header to document the approval variable,
     recognized worker block and explicit live closure.
  3. Added a real service-level test to `test/free-provider.test.mjs` for
     approval expiry after admission: the reserved attempt blocks, workspace
     and owner lock remain, new submissions refuse and replay stays readable.
     Documented that conservative outcome in the card and task contract.
  4. Recorded the independent review's full-suite B10-03 failure and our two
     repeated full-suite failures without rewriting the earlier successful
     run; isolated B10-03 passed. This pre-existing timing issue requires a
     separate maintenance correction and is not silently treated as green.
- Files: `mcp-server.mjs`, `test/free-provider.test.mjs`, `docs/handoff.md`,
  `docs/tasks/B29.md`, `docs/task-contract.md`, `docs/validation.md`,
  `docs/worklog.md`.
- Validation: focal B29/CLI tests → 13 passed; `node --test` twice →
  303 passed/1 B10-03 failed/1 Windows skip each, exit 1; isolated
  `test/subprocess.test.mjs` → 8 passed/1 skip, exit 0;
  `node --test --test-concurrency=1` → 304 passed/1 skip, exit 0;
  demo → 429 then 200,
  exit 0; syntax and staged diff checks → no errors. Pinned MCP/negative
  harness, standalone smoke, B16/B17, B19 and live routes were not rerun.
- Follow-up: publish this correction in the same PR #44 and reply to each
  inline finding with its new SHA/evidence. Re-review the exact head and CI;
  if CI fails, keep draft and correct it. Even if fixture-only PR is ready,
  B30 owns the failed live 307 gate and merge needs separate authorization.

## 2026-11-14 — M3 preparation: B29 exact-head CI and status correction

- Branch: `task/B29-opencode-free-provider`
- Scope: docs only; no service, test or live worker behavior changed.
- Steps:
  1. Read the three new PR #44 findings after the `762c133` re-review and
     verified run `43628743462`: Windows failed in the PowerShell suite step,
     Ubuntu passed. The review reports an incomplete JSON read in the
     competing maintenance recovery test; this session's `--log-failed`
     response contained no text.
  2. Corrected `docs/handoff.md` to label the older 299/303-pass reports as
     historical snapshots, record the two B10-03 default-suite failures and
     the red Windows CI, and keep the draft PR's next action current.
  3. Appended the CI receipt and isolated test observation to
     `docs/validation.md`; retained the earlier green runs as historical
     evidence rather than revising their original entries.
- Files: `docs/handoff.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: `gh run view 43628743462 --json headSha,conclusion,jobs` →
  Windows failure/Ubuntu success at `762c133`, command exit 0;
  `node --test test/task-maintenance.test.mjs` → 21 passed, exit 0;
  `git diff --check` → no output, exit 0. The full suite, pinned-host
  harnesses, public catalog, real inference, B20 and B30 were not rerun.
- Follow-up: publish the correction and an accurate PR #44 description;
  inspect CI and feedback at the new head. Keep draft while a required check
  is red; a green rerun or a separately reviewed race correction must be
  observed before any fixture-only ready transition. No merge is authorized.

## 2026-11-14 — M3 preparation: B29 P3 feedback receipts and exact-head CI

- Branch: `task/B29-opencode-free-provider`
- Scope: docs only; no executable, test or live worker behavior changed.
- Steps:
  1. Read the three new P3 findings at `113e926` (r4575329883, r4575329966,
     r4575330038) and the supervisor's in-progress edits to `docs/handoff.md`,
     `docs/tasks/B29.md`, `docs/roadmap.md` and `docs/backlog.md`.
  2. Verified the exact-head CI receipt (run `43630565937`) with `gh run view`
     and the raw Windows/Ubuntu job logs, and appended it to `docs/validation.md`
     as a superseding entry rather than rewriting the earlier "remains pending"
     sentence.
  3. Extended the default-concurrency failure wording in `docs/validation.md`
     to the six-failure run (five `test/mcp-server.test.mjs` output-wait
     timeouts plus B10-03) without rewriting the earlier B10-03-only rows; the
     B29-06 card row (supervisor edit) and the PR description carry the same
     six-failure qualification.
  4. Ran the isolated maintenance test and fallback demo with Node on the child
     PATH, capturing native exits; cited the supervisor's serial-suite receipt
     and the independent review's six-failure observation as evidence I did not
     reproduce myself.
  5. Updated the PR #44 body (new head, three P3 links, six-failure run, removal
     of the stale "Current-head CI is required" line) and replied to the three
     inline findings with the new SHA and evidence.
- Files: `docs/backlog.md`, `docs/handoff.md`, `docs/roadmap.md`,
  `docs/tasks/B29.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: `node --test test/task-maintenance.test.mjs` → 21 passed, 0
  failed, exit 0; `node examples/fallback-demo.mjs` → 429 then 200, exit 0;
  supervisor serial `node --test --test-concurrency=1` → 305/304 pass/0 fail/1
  skip, exit 0; `gh run view 43630565937` → success at `113e926`; `git diff
  --check` and `git diff --cached --check` → no output. The pinned free/MCP
  harnesses, standalone smoke, B16/B17, B19 pulse, public catalog, real
  inference, B20/#43 and B30 were not rerun.
- Follow-up: verify the new head's exact-head CI (the last green run was at
  `113e926`; the pushed head's CI is pending until observed), obtain re-review
  of the three P3 replies, then the maintainer's draft-to-ready decision for
  the fixture-only PR. No merge is authorized.

## 2026-11-14 — M3 preparation: B30 live-boundary card

- Branch: `task/B30-free-relay`
- Scope: documentation-only planning card on a separate branch from B29; no
  executable relay, egress control, live inference or PR was delivered.
- Steps:
  1. Created a B30 card with a relay/egress trust boundary and six measurable
     acceptance rows, starting from remote main `688da04`.
  2. Linked the card in the backlog and marked the next action in the handoff;
     B29/#44 must be reconciled after its fixture-only decision is published.
- Files: `docs/tasks/B30.md`, `docs/backlog.md`, `docs/handoff.md`,
  `docs/worklog.md`, `docs/validation.md`.
- Validation: `git diff --check` → no whitespace errors; full suite, demo,
  pinned-host fixture, MCP client and live API were not run on this card branch.
- Follow-up: reconcile the B30 branch with B29 after its reviewed fixture
  completion, then implement B30 only under its own task authorization.

## 2026-11-14 — M3 preparation: specify B30 egress and signing

- Branch: `task/B30-free-relay`
- Scope: documentation-only security architecture; no VM, network namespace,
  gateway, key, signature, provider call or service code was created.
- Steps:
  1. Inspected platform documentation for Hyper-V switch isolation, Linux
     network namespaces and OpenSSH SSHSIG sign/verify semantics.
  2. Added ADR-010 with separate worker/relay network compartments, trusted
     host L7 egress gateway and exact-byte offline maintainer signature;
     documented the partial change to ADR-009's live listener clause.
  3. Made the B30 acceptance matrix observable for both platforms, gateway
     bypass and signature tampering; updated backlog and handoff status.
- Files: `docs/adr/010-live-egress-and-approval.md`, `docs/tasks/B30.md`,
  `docs/backlog.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `git diff --cached --check` → no whitespace errors after staging;
  full suite, demo, pinned host, actual isolation and SSHSIG were not rerun.
- Follow-up: after B29 fixture acceptance and merge, amend ADR-009 to reconcile
  the host-only listener, then implement/review B30 or split oversized
  deployment work into sequential cards without relaxing the live gate.

## 2026-11-14 — M3 preparation: B30 relay, gateway, SSHSIG admission and WSL2 containment

- Branch: `task/B30-free-relay`
- Scope: fixture-only relay/egress-gateway/SSHSIG/admission implementation and one
  isolated WSL2 netns/veth containment observation; live composition stays closed.
- Steps:
  1. Merged B29 main `11fcb42` into the branch with an ordinary merge; resolved the
     handoff/validation/worklog conflicts preserving both append-only entry sets.
  2. Implemented `src/relay.mjs`: one fixed upstream, no arbitrary target, `Bearer
     public` only, terminal refusal of 301/302/303/307/308 without forwarding,
     independent request/byte/time bounds and a fail-closed lifecycle.
  3. Implemented `src/egress-gateway.mjs`: one fixed origin, CONNECT/redirect and
     unapproved-path refusal, sanitized body-free logging and a policy digest.
  4. Implemented `src/live-approval.mjs`: strict canonical SSHSIG approval,
     `ssh-keygen -Y verify` against a single-principal `allowed_signers` plus a KRL,
     FIDO2 presence/verification flag enforcement, policy/metadata binding, a durable
     single-use approval ledger and an admission-ordering function.
  5. Added `integration/b30-egress-namespaces.sh` and ran it in WSL2 Ubuntu (root,
     CAP_NET_ADMIN): worker/relay netns + veth with no default route, full inventory,
     then real socket probes (worker→relay reachable, worker→gateway and worker/
     relay→Internet denied, relay→gateway reachable); fail-closed teardown verified empty.
- Files: `src/relay.mjs`, `src/egress-gateway.mjs`, `src/live-approval.mjs`,
  `test/relay.test.mjs`, `test/egress-gateway.test.mjs`, `test/live-approval.test.mjs`,
  `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/task-contract.md`,
  `docs/backlog.md`, `docs/roadmap.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: focused relay/gateway/approval tests 31/31 pass; WSL containment fixture
  printed "containment verified" (exit 0); serial full suite and fallback demo pass
  (see validation entry for exact counts). `git diff --check` clean.
- Follow-up: publish the single draft PR; answer any review findings. Remaining B30
  gates are platform/hardware (`nftables` or an approved alternative, a real FIDO2
  `-sk` signing dry run) plus a separately authorized public-catalog read before any
  live experiment. Live, catalog, nftables and hardware signing remain `not_run`.

## 2026-11-14 — B30 review corrections (P1 ledger, P2 gateway/bind/WSL scope)

- Branch: `task/B30-free-relay` (draft PR #45, correcting head `cff5265`).
- Scope: correct the four blocking supervisor findings at `cff5265` without widening
  the live boundary; PR stays draft and live closed.
- Steps:
  1. P1 — rewrote `openApprovalLedger` to claim atomically with no overwrite: write the
     complete record to a private temp file, fsync, then hard-link to the target
     (`linkSync` fails `EEXIST` on collision); on collision re-read and return only an
     exact replay. Added a two-process competition test and a restart re-read test.
  2. P2 — gateway now enforces the fixed ingress `Bearer public` and forwards only that
     credential upstream (never inheriting arbitrary client headers), enforces its own
     independent request cap, and both relay and gateway reject unspecified `0.0.0.0`/
     `::` bind addresses. Added a relay→gateway→fixture-origin end-to-end test, cap and
     wildcard tests.
  3. P2 — rewrote `integration/b30-egress-namespaces.sh` to use three disposable
     namespaces (`b30-worker`, `b30-relay`, `b30-gw`) and moved both ends of every veth
     into a namespace, so the WSL initial/host namespace is never assigned an address,
     route or link. Reran the new version: "containment verified" (exit 0); verified no
     `b30-*` netns/veth and no `10.100.x` address/route remain in the host namespace.
     The earlier observation (host-side veth + `ip addr add` in the initial namespace)
     was out of scope and is corrected, not repeated.
  4. Corrected whole-row `pass` overclaims to `partial`/`not_run` in the PR body, ADR,
     contract, handoff and validation; recorded the concrete not-run subgates.
- Files: `src/live-approval.mjs`, `src/egress-gateway.mjs`, `src/relay.mjs`,
  `test/fixtures/approval-claim.mjs`, `test/live-approval.test.mjs`,
  `test/egress-gateway.test.mjs`, `test/relay.test.mjs`,
  `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/task-contract.md`,
  `docs/handoff.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: focused relay/gateway/approval tests (now 40) pass; new 3-namespace WSL
  fixture "containment verified" (exit 0) with verified empty host residue; serial full
  suite and demo pass (see validation entry). No catalog GET, live inference, package
  install, host/Windows network change or FIDO2 hardware run.
- Follow-up: reply to the supervisor finding with the new head SHA and evidence; keep
  the draft open. Remaining gates stay `not_run` (nftables, bare-metal/VM, pinned-host
  relay, FIDO2 hardware dry run, catalog, live).

## 2026-11-14 — B30 re-review correction (in-namespace veth, collision safety, IPv6 aliases)

- Branch: `task/B30-free-relay` (draft PR #45, correcting head `32c0339`).
- Scope: correct the residual Finding 4 and the IPv6 wildcard follow-up from the
  re-review at `32c0339`; PR stays draft and live closed.
- Steps:
  1. Rewrote `integration/b30-egress-namespaces.sh` to create every veth pair **inside**
     an already-created disposable namespace (`ip netns exec <ns> ip link add ...`) and
     move only the peer, so `ip link add` never runs in the WSL initial/host namespace.
     Namespaces now use a unique per-run suffix; the script tracks the exact namespaces
     it created and tears down only those, refuses a name collision without touching the
     pre-existing object, and fails on any partially failed `ip` configuration (explicit
     `|| fail` on every setup command). Added a `--self-test` mode that exercises
     collision refusal and owned-only cleanup with disposable namespaces only.
  2. Reran the safe script under the narrow permission: `--self-test` passed, and the
     full fixture printed "containment verified" (exit 0) with a "teardown removed all
     owned objects, no initial-namespace residue" assertion; external residue check
     confirmed no `b30-*` netns/veth and no `10.100.x` address/route in the host.
  3. Replaced the IPv6 unspecified-address check with a sound all-zero predicate that
     expands `::` compression to eight groups, so compressed aliases such as
     `0:0:0:0:0:0:0::` and `0:0:0:0:0::` are rejected in both `src/relay.mjs` and
     `src/egress-gateway.mjs`; added compressed-alias and positive cases to both tests.
- Files: `integration/b30-egress-namespaces.sh`, `src/relay.mjs`,
  `src/egress-gateway.mjs`, `test/relay.test.mjs`, `test/egress-gateway.test.mjs`,
  `integration/README.md`, `docs/adr/010-live-egress-and-approval.md`,
  `docs/task-contract.md`, `docs/handoff.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: focused relay/gateway/approval tests 40/40 pass (incl. compressed IPv6
  aliases); WSL `--self-test` and full fixture both exit 0 with verified empty host
  residue; serial full suite and demo pass (see validation entry). No catalog GET, live
  inference, package install, host/Windows network change or FIDO2 hardware run.
- Follow-up: reply to the re-review with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (nftables, bare-metal/VM, pinned-host relay,
  FIDO2 hardware dry run, catalog, live).

## 2026-11-14 — B30 re-review correction 2 (cleanup-error reporting + fault injection)

- Branch: `task/B30-free-relay` (draft PR #45, correcting head `ad010a7`).
- Scope: correct the residual cleanup finding from the re-review at `ad010a7`; PR stays
  draft and live closed.
- Steps:
  1. Reworked `do_cleanup` so a failed `ip netns del` is reported with the owned-name
     inventory (`LEFTOVER_NS`) and a nonzero return instead of being silently ignored;
     `CREATED_NS` is cleared only after every owned namespace is confirmed gone, so
     unresolved teardown requires manual reconciliation and never claims "nothing
     remains". The EXIT trap re-runs cleanup on every exit path, so an early `fail` or
     partial configuration failure still cleans and reports.
  2. Tracked the self-test's collision object in `CREATED_NS` so a failed assertion
     cannot leak it.
  3. Added `--self-test-fault`: a controlled partial-failure injection that creates two
     owned disposable namespaces and then fails, so the EXIT trap must remove them; the
     caller verifies no `b30-fault-*` residue remains after the nonzero exit.
  4. Reran `--self-test` (exit 0), `--self-test-fault` (exit 1, then verified no
     `b30-fault-*` residue), and the full fixture ("containment verified" exit 0 with
     "teardown removed all owned objects, no initial-namespace residue"); external
     residue check confirmed no `b30-*` netns/veth and no `10.100.x` address/route.
- Files: `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: WSL `--self-test` exit 0, `--self-test-fault` exit 1 with no residue, full
  fixture exit 0 with no residue. No Node/test code changed in this correction, so the
  prior focused 40/40 and serial 345/0/1 results remain valid for the unchanged modules.
  No catalog GET, live inference, package install, host/Windows network change or FIDO2
  hardware run.
- Follow-up: reply to the re-review with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (nftables, bare-metal/VM, pinned-host relay,
  FIDO2 hardware dry run, catalog, live).

## 2026-11-14 — B30 re-review correction 3 (EXIT trap status + inventory-error handling)

- Branch: `task/B30-free-relay` (draft PR #45, correcting head `cc3e917`).
- Scope: correct the residual failure-propagation finding from the re-review at `cc3e917`;
  PR stays draft and live closed.
- Steps:
  1. Verified the Bash behavior the reviewer cited: `trap "false" EXIT; exit 0` returns
     exit 0, but `trap "exit N" EXIT; exit 0` returns exit N (a trap that calls `exit`
     can override the process status without recursion).
  2. Replaced `trap do_cleanup EXIT` with `trap on_exit EXIT`, where `on_exit` re-runs
     `do_cleanup` and `verify_cleanup` and calls `exit 1` when either is uncertain, so a
     cleanup or inventory failure always forces a nonzero process status.
  3. `namespace_exists` now returns 0 (exists), 1 (confirmed absent) or 2 (inventory
     unreadable). `do_cleanup` treats 2 as uncertain (records the owned name and returns
     nonzero, leaving `CREATED_NS` intact), `create_ns` refuses on 2, and `verify_cleanup`
     returns nonzero on an unreadable inventory instead of treating it as clean.
  4. Added mocked-`ip` self-test modes: `--self-test-delete-fault` (failed `ip netns
     del`), `--self-test-inventory-fault` (unreadable `ip netns list`) and
     `--self-test-trap-status` (a deliberate `exit 0` with a failed delete that the trap
     overrides to exit 1), each confined to disposable namespaces with a `command ip`
     pass-through mock.
  5. Reran all self-test modes and the full fixture under the narrow permission; cleaned
     the single leftover from the trap-status test and verified no `b30-*` residue.
- Files: `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `--self-test` exit 0; `--self-test-fault` exit 1 with no residue;
  `--self-test-delete-fault` and `--self-test-inventory-fault` exit 0 (both report the
  uncertain inventory and preserve ownership); `--self-test-trap-status` exit 1 (trap
  overrides `exit 0`); full fixture exit 0 with no residue. No Node/test code changed,
  so prior focused 40/40 and serial 345/0/1 results remain valid.
- Follow-up: reply to the re-review with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (nftables, bare-metal/VM, pinned-host relay,
  FIDO2 hardware dry run, catalog, live).

## 2026-11-14 — B30 pinned OpenCode 2.2.5 through the relay (normal + redirect)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: run the pinned OpenCode 2.2.5 host through the service-owned relay and L7
  gateway against loopback fixtures; close the B29 307 prompt-leak baseline. Fixture-only;
  live closed; no catalog, provider inference or external host contact.
- Steps:
  1. Relaxed the relay's fixed-model identifier to accept a bare model ID (the host sends
     `body.model = deepseek-v4.1-flash-free`, not `opencode/...`), and made both relay and
     gateway forward the upstream `content-type` (the fixture origin returns
     `text/event-stream`, which the host requires).
  2. Added `integration/opencode-free-relay.mjs`, which starts a loopback fixture origin,
     a loopback gateway and a loopback relay, then composes the pinned host with
     `fixtureEndpoint` set to the relay. It runs a normal scenario plus one redirect
     scenario per 301/302/303/307/308 to a second loopback alternate origin.
  3. Ran it with the pinned OpenCode 2.2.5 binary (Windows x64): all six scenarios
     passed (exit 0). Normal succeeded with three `Bearer public` POST
     `/v1/chat/completions` origin requests and no WebSocket/upgrade or non-POST method;
     each redirect made the task `failed` with exactly one attempt and one origin request,
     and the alternate origin received zero requests and zero body bytes.
- Files: `src/relay.mjs`, `src/egress-gateway.mjs`, `integration/opencode-free-relay.mjs`,
  `integration/README.md`, `docs/adr/010-live-egress-and-approval.md`,
  `docs/task-contract.md`, `docs/backlog.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: relay/gateway focused tests 28/28 pass after the identifier/content-type
  change; pinned-host relay harness exit 0 with the exact counts above; full serial suite
  and demo rerun (see validation entry). No catalog GET, live inference, package install,
  host/Windows network change or FIDO2 hardware run.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (nftables firewall, bare-metal/VM, service signing
  integration, FIDO2 hardware dry run, catalog, live).

## 2026-11-14 — B30 alternate-origin egress counter (aborted/partial body) + WebSocket claim

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: correct the reviewer finding that the alternate-origin zero-byte counter missed
  aborted/partial requests, and correct the overclaimed B30-03 WebSocket bypass negative.
- Steps:
  1. Rewrote the alternate-origin handler in `integration/opencode-free-relay.mjs` to
     count at raw connection, per request entry, and per body `data` chunk (plus an
     abort/error flag), so an aborted/partial body or a pre-header connection attempt
     increments the counters instead of being missed by a `for await` that throws.
  2. Added `--self-test`: a controlled negative that opens a raw connection, sends a
     partial POST body and aborts it, then asserts every counter incremented (proving an
     incomplete/aborted body cannot pass the zero-egress assertion).
  3. Reran the six pinned scenarios (normal + 301/302/303/307/308) with the pinned
     OpenCode 2.2.5 binary (Windows x64): exit 0; normal succeeded with three `Bearer
     public` origin requests; each redirect failed the task with one attempt and one
     origin request, and zero alternate-origin connections / raw socket bytes / requests /
     body bytes.
  4. Corrected the B30-03 claim: the fixture origin seeing no `Upgrade` header on normal
     POSTs is not the active worker-compartment WebSocket-bypass negative; that gate stays
     `not_run`.
- Files: `integration/opencode-free-relay.mjs`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `--self-test` exit 0 with `{connections:1, socketBytes:132, requests:1,
  bodyBytes:24, aborted:2}`; six pinned scenarios exit 0 with all alternate-origin
  counters zero. No Node/test code changed, so prior focused and full-suite results remain
  valid. No catalog GET, live inference, package install, host/Windows network change or
  FIDO2 hardware run.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (nftables firewall, bare-metal/VM, active
  WebSocket-bypass negative, service signing integration, FIDO2 hardware dry run,
  catalog, live).

## 2026-11-14 — B30 digest-stability test fix (failing Ubuntu CI)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: fix the nondeterministic digest-stability test that failed exact-head Ubuntu CI
  run `43669588038` (Windows passed). No production hashing behavior changed.
- Steps:
  1. Reproduced the cause: `test/live-approval.test.mjs` (`approval digest is stable over
     canonical bytes`) called `approval()` twice, and each call derived `issuedAt`/
     `expiresAt` from a separate `Date.now()`; a millisecond clock boundary made the
     canonical bytes differ and the two `approvalDigest` hashes legitimately differ.
  2. Fixed the test to build one `approval()` once, compare its digest with a spread copy
     of the same bytes, and assert a deliberate `approvalId` change differs.
  3. Recorded the failing run as a blocking CI receipt in `docs/validation.md` (not green).
- Files: `test/live-approval.test.mjs`, `docs/validation.md`, `docs/worklog.md`,
  `docs/handoff.md`.
- Validation: focused `test/live-approval.test.mjs` 12/12 pass; full serial suite and demo
  rerun (see validation entry); `git diff --check` clean.
- Follow-up: reply to the supervisor with the new head SHA and evidence; verify exact-head
  Windows/Ubuntu CI at the corrected head. Remaining gates stay `not_run`.

## 2026-11-15 — B30 active egress negatives + relay failure/lifecycle fixtures

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: continue safe local B30 gates: active worker IPv4/IPv6/DNS/WebSocket-upgrade
  negative probes inside disposable WSL2 namespaces, and relay timeout/partial-body/
  port-release fixtures; assess signed-approval service integration.
- Steps:
  1. Extended `integration/b30-egress-namespaces.sh` with active negative probes from the
     worker: direct IPv6 (`curl -6` to `2001:db8::1`), DNS resolution (`.invalid` hostname),
     and a WebSocket-like `Upgrade` request to TEST-NET. All denied with recorded exits
     (`rc=7` unrouted connections, `rc=6` unresolved DNS); no external address contacted;
     teardown verified empty.
  2. Added `test/relay.test.mjs` fixtures: upstream timeout latches with a terminal 502 and
     no second request; upstream partial-body drop latches without replay; terminal stop
     releases the port (a second relay binds it, no dangling unowned listener).
  3. Assessed signed-approval service integration: the SSHSIG verification, binding,
     admission ordering and atomic no-replace ledger are implemented and tested standalone;
     wiring them into live `createConfiguredTaskService` admission is not performed because
     it requires a real FIDO2 hardware dry run and verified firewall-filtered egress (both
     `not_run`). Documented as `not_run`, no invented signature/hardware.
- Files: `integration/b30-egress-namespaces.sh`, `test/relay.test.mjs`,
  `integration/README.md`, `docs/adr/010-live-egress-and-approval.md`,
  `docs/task-contract.md`, `docs/backlog.md`, `docs/handoff.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: WSL fixture "containment verified" (exit 0, no residue) with the new
  IPv6/DNS/WebSocket-upgrade negatives; relay tests 16/16; focused 43/43; full suite and
  demo rerun (see validation entry). No catalog GET, live inference, install, host/Windows
  network change, hardware signing or B20.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (nftables firewall, bare-metal/VM, active provider
  WebSocket-bypass experiment, signed-approval service integration, FIDO2 hardware dry run,
  catalog, live).

## 2026-11-15 — B30 nftables default-drop inside disposable namespaces

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: maintainer-authorized nftables install in WSL2 Ubuntu, then per-namespace
  default-drop OUTPUT/FORWARD with allow rules, counters and active negative probes.
- Steps:
  1. Read-only preflight: nft/iptables absent, host firewall empty, `apt-get -s install
     nftables` = 3 new packages with no service/host-firewall side effects.
  2. Installed `nftables` (1.0.9-1build1) + `libnftables1` + `libnftnl11` via apt
     (exit 0); verified host `nft list ruleset` empty and the `nftables` systemd unit
     `disabled` after install.
  3. Confirmed nft works inside a disposable namespace with a per-namespace ruleset
     (host ruleset stays empty).
  4. Extended `integration/b30-egress-namespaces.sh` to install a per-namespace nftables
     `inet b30fw` table in the worker and relay namespaces (OUTPUT/FORWARD `policy drop`,
     allow worker→relay:18081 and relay→gateway:18082 via `counter accept`, final
     `counter drop`), record the nft ruleset/counters, and add a routable-but-not-allowed
     relay port (`:18099`) negative probe.
  5. Ran the fixture: "containment verified" (exit 0); worker nft counters `dport 18081
     accept packets 1`, `drop packets 7`; relay `dport 18082 accept packets 1`, `drop
     packets 10`; forbidden `:18099` `rc=28` timeout (nft-dropped); host nft ruleset empty
     and no residue after teardown.
- Files: `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/task-contract.md`, `docs/backlog.md`,
  `docs/handoff.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: full suite and demo rerun (see validation entry). No catalog GET, live
  inference, host firewall/route change, hardware signing or B20. The nftables package
  remains installed; namespaces/rules were removed and verified absent.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (bare-metal/VM deployment, active provider
  WebSocket-bypass experiment, signed-approval service integration, FIDO2 hardware dry
  run, catalog, live).

## 2026-11-15 — B30 unprivileged worker capability removal + forbidden-port proof

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: correct the supervisor P1/P2 findings at `a103ccf` (worker probes ran as root with
  network-admin; forbidden-port test accepted any failure).
- Steps:
  1. Preflight: `setpriv`/`runuser`/`su`/`capsh` present; `nobody` = uid/gid 65534.
  2. Worker-side probes now drop to `nobody` via `setpriv --reuid/--regid 65534
     --clear-groups --no-new-privs --bounding-set=-net_admin,-sys_admin`; the capability
     inventory records `CapEff:0 CapPrm:0 NoNewPrivs:1` and NET_ADMIN/SYS_ADMIN dropped
     from the bounding set.
  3. Added unprivileged mutation refusal: `nft add table` → "Operation not permitted"
     (rc=1); `ip route add default` → "RTNETLINK answers: Operation not permitted" (rc=2).
  4. Hardened the forbidden-port proof: verify the `:18099` listener is bound via `ss -ltn`,
     require the exact `rc=28` timeout, and confirm the nft drop counter incremented for
     that probe.
  5. Ran the fixture: "containment verified" (exit 0) with all checks passing; host nft
     ruleset empty and no residue after teardown.
- Files: `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: full suite and demo rerun (see validation entry). No catalog GET, live
  inference, host firewall/route change, hardware signing or B20.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (bare-metal/VM deployment, active provider
  WebSocket-bypass experiment, signed-approval service integration, FIDO2 hardware dry
  run, catalog, live).

## 2026-11-15 — B30 fail-closed capability inventory (missing/malformed/retained rejected)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: correct the supervisor P1 re-review finding at `2096d62` (missing CapEff defaulted
  to zero; CapInh/CapPrm/CapBnd logged but not asserted; post-mutation read failures treated
  as absence).
- Steps:
  1. Replaced the `$((16#${capeff:-0}))` arithmetic (fail-open on missing) with string-only
     helpers: `cap_mask_zero` (rejects empty/malformed/nonzero masks) and `cap_bit_set`
     (nibble-extraction bit test for NET_ADMIN bit 12 / SYS_ADMIN bit 21, no 64-bit math).
  2. Expanded the captured inventory to UID/GID, CapInh/CapPrm/CapEff/CapBnd, NoNewPrivs,
     and captured the nft/ip mutation return codes plus the post-mutation `nft list tables`
     / `ip route show` read exit codes; read failures are now uncertainty (fail closed).
  3. Rewrote `verify_worker_privileges` to gate `containment verified` on UID/GID 65534,
     all-zero CapInh/CapPrm/CapEff, NET_ADMIN/SYS_ADMIN absent from CapBnd, NoNewPrivs 1,
     both mutations refused, both reads succeeded, and no unauthorized table/default route.
  4. Extended `--self-test-capability` to 1 accept + 17 reject cases (missing/malformed
     CapEff, nonzero CapEff/CapPrm/CapInh, retained NET_ADMIN/SYS_ADMIN CapBnd, missing
     CapBnd, wrong uid/gid, unset NoNewPrivs, mutation success, unauthorized table/route,
     read failures).
  5. Ran both: self-test-capability passed; full fixture "containment verified" with
     `PASS worker privilege boundary (uid=65534 gid=65534 CapInh/CapPrm/CapEff=0 CapBnd=000001ffffdfefff NoNewPrivs=1 nft_rc=1 route_rc=2)`; host nft ruleset empty, no residue.
- Files: `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: full suite and demo rerun (see validation entry). No catalog GET, live
  inference, host firewall/route change, hardware signing or B20.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (bare-metal/VM deployment, active provider
  WebSocket-bypass experiment, signed-approval service integration, FIDO2 hardware dry
  run, catalog, live).

## 2026-11-15 — B30 CapBnd whole-mask canonical validation

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: correct the supervisor P2 re-review finding at `7a10cd3` (`cap_bit_set` validated
  only the requested nibble, so a 16-character `CapBnd` with a non-hex character outside
  bits 12/21 — e.g. `z00001ffffdfefff` — was accepted).
- Steps:
  1. Added a whole-mask `case *[!0-9a-fA-F]*` check to `cap_bit_set` right after the length
     check, so any non-hex character anywhere in the 16-digit mask returns malformed (2)
     before any nibble extraction; the specific-bit nibble arithmetic is unchanged.
  2. Extended `--self-test-capability` with two non-hex corruptions outside the checked
     nibbles (MSB `z00001ffffdfefff`, LSB `000001ffffdfeffz`), preserving the prior 18 checks.
  3. Ran: `bash -n` clean; self-test-capability passed (1 accept + 19 rejects); full fixture
     "containment verified" with the real `CapBnd=000001ffffdfefff`; host nft ruleset empty,
     no residue.
- Files: `integration/b30-egress-namespaces.sh`, `integration/README.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: full suite and demo rerun (see validation entry). No catalog GET, live
  inference, host firewall/route change, hardware signing or B20.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (bare-metal/VM deployment, active provider
  WebSocket-bypass experiment, signed-approval service integration, FIDO2 hardware dry
  run, catalog, live).

## 2026-11-15 — B30 signed-approval service admission integration (B30-05)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: bind the standalone SSHSIG verification/atomic single-use ledger to service
  admission for new task dispatch (the prior ADR-010 `not_run` gap), fail-closed and offline.
- Steps:
  1. `createTaskService` gained an optional synchronous `admission` gate that runs after
     idempotent replay resolution and repository inspection but before task persistence,
     workspace or spawn; it pre-generates the taskId, passes the resolved baseCommit, and
     maps `authorization_denied`/`invalid_argument`/`unavailable` to the contract.
  2. `submit_task` gained optional `approval`/`signature` fields, excluded from the canonical
     payload/idempotency hash and never persisted; `store.createTask` accepts an optional
     validated UUIDv4 `taskId`.
  3. `src/live-approval.mjs` gained `liveRequestHash` and `createSignedApprovalAdmission`
     (verify + resolved-base-commit/policy/metadata binding + ledger reserve); the binding
     now also checks `approval.repository.baseRef === baseCommit`.
  4. `createConfiguredTaskService` passes a supplied `admission` through unchanged.
  5. Added `test/live-approval-service.test.mjs` (service mechanism with a labelled mock,
     real factory refusal paths, real-ledger single-use) and extended
     `test/live-approval.test.mjs` for the base-commit binding.
- Files: `src/tasks.mjs`, `src/service.mjs`, `src/live-approval.mjs`,
  `src/configured-service.mjs`, `test/live-approval-service.test.mjs`,
  `test/live-approval.test.mjs`, `docs/task-contract.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/worklog.md`, `docs/validation.md`.
- Validation: focused 23/23 and full suite/demo rerun (see validation entry). No catalog
  GET, live inference, host network change, hardware signing or B20; no hardware signature
  is simulated or claimed.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (real FIDO2 hardware-key signing dry run / positive
  signature path, bare-metal/VM deployment, catalog, live inference).

## 2026-11-15 — B30 signed-approval pre-spawn revalidation + host/readable binding (B30-05)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: correct the two P1 findings at `0f5bbd1` (review `6897307203`): no re-validation
  immediately before spawn; and the signed host identity / readable approval scope not bound
  to the effective task/worker.
- Steps:
  1. `verifyApprovalBinding` now binds the signed readable objective / repository.branch /
     maxAttempts / budget+output limits to the effective validated request, and the signed
     `hostBinaryDigest` to a measured trusted executable (`measureHostBinaryDigest`), before
     the ledger reserve.
  2. `createSignedApprovalAdmission` requires `hostBinaryDigest` + `remeasureHostBinaryDigest`
     and returns a trusted in-memory receipt with a `revalidate(now)` closure (expiry +
     metadata freshness + host digest); `admitLiveApproval` surfaces the receipt fields.
  3. `createTaskScheduler` accepts a `revalidate` hook and calls it synchronously before the
     dispatch reservation/workspace/spawn; a failure records the queued task as `cancelled`
     (`executionStopped: true`, `admission-refused` progress, no attempt) and halts the queue.
  4. `createTaskService` retains receipts in-memory keyed by taskId, maps admission return
     `false`/`{admitted:false}` to refusal, and passes `revalidate` to the scheduler.
  5. Added `test/live-approval-pre-spawn.test.mjs` (positive mock spawn + expiry/drift/
     missing-receipt negatives) and extended the host/readable binding tests.
  6. Performed the staged one-shot bounded catalog GET (HTTP 200, 104,821 bytes, zero-price
     `deepseek-v4.1-flash-free`, endpoint/package match) and a non-invasive FIDO2 tooling
     inventory (OpenSSH 9.5p2 `ssh-keygen` + `ssh-sk-helper` present; hardware presence not
     inferred); added `docs/deployment-prerequisites.md` as a plan only.
- Files: `src/live-approval.mjs`, `src/service.mjs`, `src/scheduler.mjs`,
  `test/live-approval.test.mjs`, `test/live-approval-service.test.mjs`,
  `test/live-approval-pre-spawn.test.mjs`, `docs/task-contract.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/deployment-prerequisites.md`,
  `docs/worklog.md`, `docs/validation.md`.
- Validation: focused 28/28 and full suite/demo rerun (see validation entry). The catalog
  GET is dated evidence, not live activation; no FIDO2 hardware action, host network change,
  WebSocket-bypass call, paid call, live inference or B20.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (real FIDO2 hardware-key signing dry run / positive
  signature path, bare-metal Ubuntu / two-VM Hyper-V deployment, active WebSocket-bypass
  experiment, live inference).

## 2026-11-15 — B30 just-before-spawn revalidation + admission result + host-path binding (B30-05)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: correct the three P1 findings at `8e358a4` (review `6897600299`): revalidation is
  before `worker.prepare`, not just before spawn; a returned admission value without a
  callable verifier silently passes; the factory does not itself measure the configured host
  executable.
- Steps:
  1. `createTaskScheduler` now re-checks the receipt a second time synchronously just before
     `runSubprocess` (after `createTaskWorkspace` + `worker.prepare`); a refusal there records
     the dispatched task as `blocked` (executionStopped unknown, dispatch attempt preserved),
     never `cancelled`, never replayed.
  2. `createTaskService` requires an admission result of `{ admitted: true, revalidate }`;
     `false`/`true`/`undefined`/`null`/`{admitted:true}` without a verifier are refused before
     persistence, and the dispatch hook fails closed on a missing/invalid receipt.
  3. `createSignedApprovalAdmission` now takes the absolute `hostExecutable` path and measures
     its SHA-256 itself at admission and revalidation (removed the caller-supplied
     `hostBinaryDigest`/`remeasureHostBinaryDigest`); an unreadable path is `unavailable`.
  4. Tests: expiry/drift during `worker.prepare` (marker-file zero-spawn assertion → `blocked`),
     the admission return-value matrix, and the self-measured host path (unreadable → `unavailable`).
- Files: `src/live-approval.mjs`, `src/service.mjs`, `src/scheduler.mjs`,
  `test/live-approval-service.test.mjs`, `test/live-approval-pre-spawn.test.mjs`,
  `docs/task-contract.md`, `docs/adr/010-live-egress-and-approval.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: focused 30/30 and full suite/demo rerun (see validation entry). No catalog GET
  repeat, no FIDO2 hardware action, no host network change, no WebSocket-bypass call, no live
  inference or B20; the host identity is bound at the factory interface to the supplied
  `hostExecutable` path (the caller must pass the configured worker's executable), and the
  end-to-end positive signature path remains `not_run`.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (real FIDO2 hardware-key signing dry run / positive
  signature path, bare-metal Ubuntu / two-VM Hyper-V deployment, active WebSocket-bypass
  experiment, live inference).

## 2026-11-15 — B30 tie measured host executable to the configured worker (B30-05)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: correct the remaining P1 #3 at `9b91845` (review `6898063391`): the measured host
  path is not tied to the executable the configured worker actually starts.
- Steps:
  1. `createSignedApprovalAdmission` now exposes the canonical measured executable on the
     returned gate (`gate.hostExecutable`, resolved via `canonicalExecutablePath` using
     `realpathSync.native` with a lexical-resolve fallback).
  2. `createConfiguredTaskService` enforces that a supplied signed-admission gate's canonical
     `hostExecutable` equals the canonical `settings.executable` the configured worker starts;
     a mismatch is refused before any service/task/child exists.
  3. Added negative (`A != B`) and positive (`A == B`) composition fixtures in
     `test/free-provider.test.mjs` (mock signature only, no hardware).
- Files: `src/live-approval.mjs`, `src/configured-service.mjs`, `test/free-provider.test.mjs`,
  `docs/task-contract.md`, `docs/adr/010-live-egress-and-approval.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: focused 42/42 and full suite/demo rerun (see validation entry). No catalog GET
  repeat, no FIDO2 hardware action, no host network change, no WebSocket-bypass call, no live
  inference or B20. The relay/gateway policy-drift and signer-revocation dispatch checks remain
  partial/`not_run` pending deployment.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (real FIDO2 hardware-key signing dry run / positive
  signature path, bare-metal Ubuntu / two-VM Hyper-V deployment, active WebSocket-bypass
  experiment, live inference).

## 2026-11-15 — B30 relay/gateway lifecycle symmetry (B30-04)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: close the B30-04 lifecycle gap — the egress gateway lacked the failure/lifecycle
  fixtures the relay already had; add temporary child/process/port fixtures (no green-path
  only).
- Steps:
  1. Added to `test/egress-gateway.test.mjs`: port-conflict refusal, terminal `stop()` with
     restart refusal, `stop()` releasing the port (a second gateway binds it), an upstream
     timeout latched to `upstream-unavailable` with exactly one origin request (no replay),
     and an upstream partial-body drop that latches `response-stream` without replay.
  2. Confirmed relay + gateway fixtures pass together (36/36) and re-recorded levels/limits.
- Files: `test/egress-gateway.test.mjs`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused 36/36 + full suite/demo rerun (see validation entry). No external
  network or provider call, no catalog GET, no install, no WSL/host network/firewall change,
  no hardware signing, no B20/live activation.
- Follow-up: reply to the supervisor with the new head SHA and evidence; keep the draft
  open. Remaining gates stay `not_run` (relay/gateway service-level uncertain-child-stop,
  upstream DNS/TLS-failure latches, live-mode TLS hostname validation and the full
  cross-namespace TLS chain, bare-metal/VM deployment, active WebSocket-bypass experiment,
  live inference).

## 2026-11-15 — B30 listener supervision and gateway TLS fixtures (B30-04/07)

- Branch: `task/B30-free-relay` (draft PR #45, base `11fcb42`).
- Scope: code, tests and docs; offline loopback fixtures only. No live composition, catalog GET, provider call, hardware signing, WSL or host network change, DNS or hosts change, deployed TLS chain, B20 or merge.
- Steps:
  1. Added `src/listener-supervisor.mjs`: a service-owned supervisor that runs one relay or gateway in a child process, with a durable lock file created before spawn, the pid recorded before the `start` message, release only after a confirmed exit, an unconfirmed stop, kill or ready timeout that keeps the lock and refuses restart, no automatic restart, and an explicit `reconcileListenerLock` that requires the exact token and pid and `confirmedStopped: true`.
  2. Added `src/listener-child.mjs`, the child entry: it binds one listener on `start`, reports `ready` or `error` (exit 2), answers `status`, stops on `stop`, and stops when its supervisor disconnects.
  3. Changed `src/egress-gateway.mjs`: upstream fetch failures are classified into `dns-failure` (`ENOTFOUND`, `EAI_AGAIN`), `tls-failure` (TLS, SSL and certificate codes) or `upstream-unavailable`; live mode refuses `NODE_TLS_REJECT_UNAUTHORIZED=0` at creation (throws) and before each request (`tls-policy` latch); the header comment now describes the offline scope.
  4. Added `integration/listener-fixture-child.mjs` (test-only child that ignores stop, or never reports ready) and `integration/tls-fixture-resolver.mjs` (test-only `--import` preload: maps two fixture names to loopback, passes IP literals, and fails every other name without an external query).
  5. Added `test/listener-supervisor.test.mjs` (8 cases: confirmed stop, port conflict, held lock, restart, uncertain stop with reconciliation, silent child, unusable home with no spawn, orphan stop on disconnect) and `test/gateway-tls.test.mjs` (6 cases: trusted TLS forward, untrusted CA, hostname mismatch, DNS failure, ambient bypass refusal, classifier). The TLS certificates are generated with openssl at test time into a temp directory that is removed afterwards; no certificate or key is committed.
  6. Recorded the decisions and evidence limits in `docs/adr/010-live-egress-and-approval.md` (2026-11-15 amendment), the B30 section of `docs/task-contract.md`, `docs/roadmap.md`, `docs/backlog.md` (B30 row) and `docs/handoff.md` (continuation point and next action).
  7. Mutation-checked the new tests in a scratch copy (lock released on unconfirmed stop; DNS/TLS collapsed) and confirmed the expected tests fail.
- Files: `src/egress-gateway.mjs`, `src/listener-supervisor.mjs`, `src/listener-child.mjs`, `integration/listener-fixture-child.mjs`, `integration/tls-fixture-resolver.mjs`, `test/listener-supervisor.test.mjs`, `test/gateway-tls.test.mjs`, `docs/adr/010-live-egress-and-approval.md`, `docs/task-contract.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/handoff.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused `node --test` on the new and existing relay/gateway files → 50 pass, 0 fail; serial `node --test --test-concurrency=1` → 388 tests, 387 pass, 0 fail, 1 skip, exit 0; default-concurrency `node --test` exits 1 on eight timing-sensitive locations that also fail at base `eb4968d`; `node examples/fallback-demo.mjs` → 429 then 200; `git diff --check` clean. The pinned OpenCode host, privileged WSL fixture, deployed TLS chain, expired-certificate case, catalog, WebSocket bypass, FIDO2 and live inference were not rerun or run (see validation entry).
- Follow-up: keep PR #45 draft and reply to the 18:18 review findings with this head and evidence; the next B30 step is an independent Ubuntu/Hyper-V deployment with a deployed TLS chain and a real trust store, which remains `not_run` until a maintainer provides the environment.

## 2026-11-15 — B30 catalog-evidence continuity correction (P2 review)

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: documentation only; corrects the catalog GET status in new continuity text after the supervisor P2 review. No source, test, network request or live action; the catalog GET is not repeated.
- Steps:
  1. Read the P2 review at `6899620770` and checked `docs/validation.md` line 2862, which records the one bounded catalog GET at `8e358a4` (HTTP 200, 104,821 bytes).
  2. Amended the 2026-11-15 handoff continuation and next action in `docs/handoff.md` to state the GET as performed once at `8e358a4`, dated and expiring, not repeated, with a fresh read needing separate narrow authorization and no live-inference authorization.
  3. Amended the B30 backlog row in `docs/backlog.md`, the M3 row and the 2026-11-15 paragraph in `docs/roadmap.md`, and the 2026-11-15 ADR amendment in `docs/adr/010-live-egress-and-approval.md` with the same status, plus a dated note on the 2026-11-14 ADR bullet.
  4. Added a dated parenthetical to the B30 admission-wiring sentence in `docs/task-contract.md`, which said no catalog read had been performed.
  5. Corrected the matching lines in the PR body (Deferred, Not rerun, the Validation bullets and the draft summary) to state the same dated status.
  6. Appended this entry and a validation entry; earlier entries are not rewritten.
- Files: `docs/handoff.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/adr/010-live-egress-and-approval.md`, `docs/task-contract.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused `node --test` on the listener-supervisor, gateway-tls, egress-gateway and relay files → 50 pass, 0 fail, exit 0 (source unchanged); `git diff --check` clean; static grep of added `catalog` lines consistent with the `8e358a4` receipt. The full suite, demo and any live, FIDO2, WebSocket, VM or deployed-TLS gates were not rerun (see the validation entry).
- Follow-up: keep PR #45 draft and re-review the new documentation head; a fresh catalog read, if ever needed, requires a separate narrow authorization and does not authorize live inference.

## 2026-11-15 — B30 fixture-only supervised composition and second catalog snapshot

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: code, tests and docs; fixture-only composition with loopback listeners. No live composition, provider, FIDO2, WebSocket, VM, host-network or paid action; one bounded public catalog GET (user-authorized) recorded as dated metadata; no ready or merge.
- Steps:
  1. Read the PR feedback (no blocking findings; CI `c6c064e` green) and the composition path: `createConfiguredTaskService`, the scheduler's dispatch and close, the worker validation and the signed-admission gate.
  2. Added `src/free-listeners.mjs`: a pure plan (fixed non-zero loopback ports, relay upstream to the gateway port, fixed model and path, both policy digests) and `startFreeListeners`, which starts the gateway and then the relay under the supervisor, checks the child-reported digests, and stops whatever started on any failure.
  3. Changed `src/configured-service.mjs`: the `freeListeners` option requires an approved run and a signed-admission gate that exposes matching digests, both checked before metadata or any listener start; the worker base URL comes from the relay port; a dead listener blocks dispatch in `prepare`; `close()` stops listeners after the scheduler is idle; a failure after listener start stops them. Live composition is unchanged when the option is absent.
  4. Changed `src/live-approval.mjs`: the signed-admission gate exposes its relay and gateway policy digests as read-only properties.
  5. Changed the `src/listener-supervisor.mjs` header comment (no longer unwired).
  6. Added `test/free-listeners.test.mjs` (nine cases) and fixed two of its defects (approval-bound request and listener cleanup on failure).
  7. Performed one bounded catalog GET through `fetchFreeMetadata` and recorded the validated fields.
  8. Updated `docs/adr/010-live-egress-and-approval.md` (second 2026-11-15 amendment, and the two earlier sentences that said the supervisor was unwired), `docs/task-contract.md` (composition bullet and the revised wiring sentence), `docs/deployment-prerequisites.md` (Ubuntu host checklist and minimum permissions, plan only), `docs/handoff.md`, `docs/backlog.md` and `docs/roadmap.md`.
- Files: `src/configured-service.mjs`, `src/free-listeners.mjs`, `src/live-approval.mjs`, `src/listener-supervisor.mjs`, `test/free-listeners.test.mjs`, `docs/adr/010-live-egress-and-approval.md`, `docs/task-contract.md`, `docs/deployment-prerequisites.md`, `docs/handoff.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: nine focused composition tests pass; the 104-test composition, approval, B29 and B30 focused set passes; the serial suite failed once on the known MCP `B15-01f` output-wait flake and passed on rerun (396 pass, 0 fail, 1 skip); the demo returns 429 then 200; `git diff --cached --check` clean. The default-concurrency run, the pinned host, WSL, deployed TLS, FIDO2, WebSocket-bypass, VM and live gates were not rerun (see the validation entry).
- Follow-up: keep PR #45 draft and do not merge. Before any ready decision, the `not_run` gates in the validation entry and the Ubuntu checklist in `docs/deployment-prerequisites.md` need separate authorization and evidence. A non-loopback worker-facing listener needs an ADR amendment before code changes.

## 2026-11-15 — B30 composition close-path stop on rejection

- Branch: `task/B30-free-relay` (draft PR #45).
- Scope: code (one error path) and docs; fixture-only composition otherwise unchanged; no live, provider, FIDO2, WebSocket, VM, host-network or paid action.
- Steps:
  1. Second self-review of `src/configured-service.mjs`: `service.close` stopped the supervised listeners only when the scheduler close resolved; a rejection would have left them running.
  2. Changed the close wrapper to stop the listeners on both outcomes and rethrow a rejection.
  3. Reran the 104-test focused set, the 397-test serial suite (396 pass, 0 fail, 1 skip) and the demo (429 then 200) on the final code; recorded in the validation entry.
- Files: `src/configured-service.mjs`, `docs/validation.md`, `docs/worklog.md`.
- Validation: see the final-rerun validation entry; the rejected-close branch is inspected but not tested.
- Follow-up: unchanged from the previous entry (keep the draft, no merge, no ready). A test seam for the rejected-close branch is optional and can wait for the next composition change.

## 2026-11-15 – M3: B30 listener ownership and startup authority correction

- Branch: `task/B30-free-relay`
- Scope: code, tests and docs; fixture-only loopback composition, correcting two P1
  review findings; no live composition, provider, deployment or hardware path changed.
- Steps:
  1. Acquired and reconciled exclusive task-home ownership in `openTaskHome` before any
     supervised listener child may bind, and handed that store and release function to
     `createTaskService` so it does not acquire or reconcile twice; a competing owner,
     corrupt store or mismatched home refuses before a child, port or lock.
  2. Kept ownership through startup and shutdown: listener stop precedes owner release,
     an unconfirmable stop at close or during failed-startup cleanup keeps the task-home
     owner lock and every unconfirmed listener lock, and the construction-failure path
     leaves release to the owner instead of racing a second stop.
  3. Separated startup authority from task admission: `freeListenerPlan` records
     `FREE_LISTENER_START_AUTHORITY` (unsigned operator artifact plus a digest-bound gate,
     not an SSHSIG), `createConfiguredTaskService` exposes it as
     `service.freeListenerAuthority`, and a gate without an exposed host identity is
     labelled a test double.
  4. Added `test/free-listeners-authority.test.mjs`: competing owner and corrupt store
     spawn no child, port or lock; ownership is held while listeners run; the real
     signed-gate factory with a disposable non-hardware key refuses missing, malformed,
     non-FIDO2 and forged task signatures with zero task/workspace/worker effect; a
     close-time or failed-startup uncertain stop keeps owner and listener locks and refuses
     restart.
  5. Extended the test-only `integration/listener-fixture-child.mjs` with an
     `ignore-stop-valid` mode that reports the real policy digest and binds the configured
     fixed port, so close-time and failed-startup uncertainty are exercised without
     production changes.
  6. Updated the normative contract, ADR-010 amendment, handoff, backlog row and both
     evidence files.
- Files: `src/service.mjs`, `src/configured-service.mjs`, `src/free-listeners.mjs`,
  `integration/listener-fixture-child.mjs`, `test/free-listeners-authority.test.mjs`,
  `test/free-listeners.test.mjs`, `docs/task-contract.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/handoff.md`, `docs/backlog.md`,
  `docs/roadmap.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused composition/approval/B29/B30 set → 112 pass, 0 fail, exit 0;
  `node --test --test-concurrency=1` → 405 tests, 404 pass, 0 fail, 1 skip, exit 0;
  `node examples/fallback-demo.mjs` → 429 then 200, exit 0; `git diff --check` → no
  output, exit 0. Two self-review passes covered ownership ordering, close/startup
  failure paths, old `createTaskService` callers, contract/ADR wording and the refusal
  evidence; the second pass found and fixed the failed-startup cleanup ownership gap.
  Exact-head CI run `43760697682` succeeded on both OS jobs; the docs-only receipt commit
  has its own PR run. The default-concurrency suite was not rerun locally (CI ran
  `node --test` and passed); the WSL fixture, pinned OpenCode harnesses, deployed TLS,
  FIDO2 positive signature, WebSocket bypass, VM and live inference were not rerun.
- Follow-up: keep PR #45 draft and reply to the two P1 findings with the new head;
  independent re-review of this ownership/authority correction is required before any
  ready or merge decision. All B30 deployment gates remain `not_run`.

## 2026-11-15 – M3: B30 ownership handoff capability correction

- Branch: `task/B30-free-relay`
- Scope: code, tests and docs; closes the P1 from the independent re-review at `6ea76d8`
  without changing live composition, provider, deployment or hardware paths.
- Steps:
  1. Replaced the caller-shaped `{ store, releaseOwner }` ownership option with a
     module-local capability: `createTaskService` accepts only an object present in a
     private `WeakMap`, minted by `openTaskHome` after the exclusive lock and
     reconciliation. Forged, spread-copied, reconstructed, released, reused and
     wrong-home handoffs are refused with `invalid_argument`; a refused handoff releases
     nothing.
  2. Made the capability single-use and stateful (`minted`, `consumed`, `releasing`,
     `released`, `uncertain`). `createTaskService` consumes it synchronously before any
     effect. Release runs an optional `beforeRelease` cleanup while ownership is still
     held; if that cleanup or the lock release fails, the capability becomes `uncertain`,
     the owner lock is retained and all later handoffs are refused (fail closed).
  3. Kept the configured listener path on the same pre-bind acquisition: it passes the
     minted capability directly and binds listener stop as `beforeRelease`, so a
     competing owner still spawns no listener child/port/lock.
  4. Restored synchronous `close()` for passive default services; a passive service
     composed from a capability returns the release Promise.
  5. Added `test/service-ownership-handoff.test.mjs` (7 tests): forged ownership beside
     an active owner, copied/reconstructed handoffs, reuse before/after close, release
     before handoff, mismatched home, competing legitimate owner and uncertain
     `beforeRelease`. Revalidated the existing `test/service-owner.test.mjs` (B12) and the
     B29/B30 listener-lock set.
  6. Updated the normative contract, ADR-010 amendment, handoff, roadmap, backlog row and
     both evidence files; the PR body and the P1 reply carry the fix SHA and evidence.
- Files: `src/service.mjs`, `src/configured-service.mjs`,
  `test/service-ownership-handoff.test.mjs`, `docs/task-contract.md`,
  `docs/adr/010-live-egress-and-approval.md`, `docs/handoff.md`, `docs/roadmap.md`,
  `docs/backlog.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused B29/B30/ownership set -> 121 pass, 0 fail, exit 0; full serial
  `node --test --test-concurrency=1` -> 412 tests, 411 pass, 0 fail, 1 skip, exit 0
  (two earlier attempts hit the known B15-03b and B10-03 timing flakes; the passing
  rerun is claimed, the failures are not erased); `node examples/fallback-demo.mjs` ->
  429 then 200, exit 0; `git diff --check` -> no output, exit 0. Two self-review passes
  covered the capability boundary, release/uncertainty and close paths, old callers and
  the contract wording; the second pass restored the documented passive-close behavior.
  Exact-head CI run `43764489116` succeeded on both OS jobs; the docs-only receipt commit
  has its own PR run. Default-concurrency local suite, WSL fixture, pinned OpenCode
  harnesses, deployed TLS,
  FIDO2 positive signature, WebSocket bypass, VM and live inference were not rerun.
- Follow-up: keep PR #45 draft; reply to the P1 with the fix SHA and CI receipt;
  independent re-review of the new head is required. All B30 deployment gates remain
  `not_run`.

## 2026-11-15 – M3: B30 release-authority transfer correction

- Branch: `task/B30-free-relay`
- Scope: code, tests and docs; closes the P1 from the independent re-review at `f6fdd1e`
  without changing live composition, provider, deployment or hardware paths.
- Steps:
  1. Split the capability's release into a private, memoized `record.release` and a
     creator-facing `releaseOwner` that refuses with `invalid_argument` unless the
     capability is still `minted` and unconsumed. The frozen capability never exposes the
     private release, so a creator cannot release a lock that an active service owns.
  2. Moved consumption to immediately before the first effect (after every pure argument
     check). The consuming service's close path uses the private release, which runs
     `beforeRelease` while ownership is held and removes the lock only after scheduler
     idle; repeated or concurrent `close()` calls share one release.
  3. A failed construction (for example an invalid worker) returns the unconsumed
     capability to its creator so the documented cleanup path, including
     `beforeRelease`, can release; an uncertain cleanup still retains the lock.
  4. Preserved passive default synchronous `close()`, capability-composed passive close
     returning the release Promise, and the pre-bind listener ownership order.
  5. Extended `test/service-ownership-handoff.test.mjs` with early creator release beside
     an active service, close idempotency, `beforeRelease`-before-unlock ordering and
     failed-construction cleanup; revalidated the B12 owner tests. A standalone
     reproduction of the reviewer trigger outside the repository exited 0 with the second
     service refused.
- Files: `src/service.mjs`, `test/service-ownership-handoff.test.mjs`,
  `docs/task-contract.md`, `docs/adr/010-live-egress-and-approval.md`, `docs/handoff.md`,
  `docs/roadmap.md`, `docs/backlog.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: focused B29/B30/ownership set -> 125 pass, 0 fail, exit 0; full serial
  `node --test --test-concurrency=1` -> 416 tests, 415 pass, 0 fail, 1 skip, exit 0
  (two earlier attempts hit the known `B15-03b` output-wait flake, the first also
  `B10-03`; the passing rerun is claimed, the failures are not erased);
  `node examples/fallback-demo.mjs` -> 429 then 200, exit 0; `git diff --check` -> no
  output, exit 0. Two self-review passes covered the release split, construction
  rollback, close/uncertainty paths and the contract wording. Exact-head CI run
  `43768061960` succeeded on both OS jobs; the docs-only receipt commit has its own PR run.
- Follow-up: keep PR #45 draft; reply to the P1 with the fix SHA and CI receipt;
  independent re-review of the new head is required. All B30 deployment gates remain
  `not_run`.

## 2026-11-15 – M3: B30 two-VM Hyper-V deployment (worker compartment and relay egress)

- Branch: `task/B30-free-relay`
- Scope: deployment evidence and documentation only. No product code changed, no live
  inference, no paid call, no firewall or host-network change, and no catalog read.
- Steps:
  1. Built the ADR-010 Windows topology with two Ubuntu Server 24.04.5 Generation 2 guests:
     `B30-Worker-Relay` carrying the worker and the relay's worker-side NIC, and
     `B30-Relay-Gateway` carrying the relay's gateway-side NIC and the host. Neither switch
     is bound to a physical adapter; WSL's own `WSL (Hyper-V firewall)` switch was identified
     and excluded from the topology rather than deleted.
  2. Recorded the host inventory: `10.30.2.1/30` on the gateway vEthernet with forwarding
     `Disabled`, the host's worker-side vEthernet `Disabled` and unaddressed, no route to
     `10.30.1.0/30`, no WinNAT instance, and `SharedAccess` running with no share, no
     `192.168.137.*` address and no share key naming a B30 adapter.
  3. Applied the guest netplan from a FAT32 VHDX (`B30CFG`) instead of installing a remote
     shell: relay `10.30.1.1/30` and `10.30.2.2/30`, worker `10.30.1.2/30`, no default route,
     no DNS server, forwarding disabled on both.
  4. Ran `probe.sh` from a second FAT32 VHDX (`B30PROBE`) inside each guest; each guest wrote
     its own log to the volume, and the host read the logs from the attached disk. No console
     transcription, no package installation, and no guest ever had network reachability to
     the host or the Internet.
  5. Interpreted the one deviation honestly instead of adjusting the expectation: the relay's
     ICMP to the host gateway is dropped while the host reaches the relay. The gateway
     vEthernet is `Public`/`Rede nao identificada`, the Public profile blocks inbound by
     default and the built-in echo rules are disabled; Kaspersky is also a firewall product,
     so the filter is not attributed. Recorded as a prerequisite for the L7 gateway rather
     than as a topology defect, and no firewall change was made.
- Files: `docs/validation.md`, `docs/worklog.md`, `docs/deployment-prerequisites.md`.
- Validation: guest-written logs `B30-Worker-b30-probe-b30-worker.log` (2,996 B, SHA-256
  `4C4F0C05...`) and `B30-Relay-b30-probe-b30-relay.log` (3,162 B, SHA-256 `53BBA405...`);
  worker off-link attempts `Network is unreachable` for the host gateway, `1.1.1.1`,
  `93.184.216.34`, DNS and IPv6 while `10.30.1.1` answers ICMP and resets TCP/22; relay
  off-link attempts denied for `1.1.1.1:443`, `8.8.8.8:53`, `93.184.216.34:443`, DNS and IPv6
  while `10.30.1.2` answers ICMP. Host checks as listed above, all exit 0 through the
  operator's administrator session. `node --test` was not rerun because no code changed.
- Follow-up: keep PR #45 draft. The remaining gates are the host-side L7 gateway and its TLS
  chain (which now also needs an authorized inbound rule scoped to the relay address), the
  WebSocket-upgrade and unapproved-port probes from inside the VM, the positive FIDO2
  signature, live inference and the signed approval. Merge still requires explicit
  authorization.

## 2026-11-15 – M3: B30 two-VM WebSocket-upgrade and unapproved-port probes

- Branch: `task/B30-free-relay`
- Scope: deployment evidence and documentation only. No product code changed, no live
  inference, no paid call, no firewall or host-network change, and no catalog read.
- Steps:
  1. Built a second FAT32 probe volume (`B30WS`, `probe2.sh` SHA-256
     `CF17EB9BF46F40C4A5F91CC95D41D54DB87C19C9383141AEAFFBC0366238D2AE`) and hot-attached it
     at SCSI 0/3 on both running guests.
  2. The operator typed one line per console, relay first and then worker
     (`sudo mkdir -p /media/b30 && sudo mount -L B30WS /media/b30 && sudo bash /media/b30/probe2.sh`);
     each guest wrote its own log back onto the same volume. No console transcription, no
     package installation, no guest-to-host network path.
  3. Hot-detached the volumes, read each one from the host through WSL
     `--mount --vhd <path> --partition 1`, and copied `b30-wsprobe-*.log` into
     `%TEMP%\opencode\b30-collected`; then deleted the two VHDX files, the staging directory
     and the now-empty `C:\B30-VMs\_media`.
  4. Recorded two operational deviations instead of hiding them: the new mount stacked over the
     stale `B30PROBE` mount, so `probe2.sh` reported `B30_WSPROBE_UMOUNT=FAILED` on both guests
     (an explicit `sudo umount /media/b30` on the worker returned cleanly), and hot-detaching the
     earlier, already-removed disk produced `device offline error, dev sdc` plus
     `Buffer I/O error on dev sdc1` on the worker console. Both logs still end with
     `B30_WSPROBE_LOG_END` after two `sync` calls.
- Files: `docs/validation.md`, `docs/worklog.md`, `docs/tasks/B30.md`, `docs/handoff.md`,
  `docs/backlog.md`.
- Validation: relay log 741 B SHA-256 `D4E51881...` and worker log 939 B SHA-256 `0F509C9E...`;
  a plaintext WebSocket upgrade to `93.184.216.34:80` and `1.1.1.1:80` is
  `Network is unreachable` on both guests (exit 11 at connect), while the reachable peer on the
  permitted link answers `Connection refused` on `18099` and `8080` (`EXIT=1`), and the worker's
  upgrade attempt to `10.30.1.1:18099` is refused as well. `node --test` was not rerun because
  no code changed.
- Follow-up: keep PR #45 draft. Still `not_run`: the host-side L7 gateway and deployed TLS chain
  (needs an authorized inbound rule scoped to the relay address), an application-level
  WebSocket rejection, the FIDO2 positive signature, the active WebSocket-bypass experiment,
  live inference and the signed approval. Merge still requires explicit authorization.

## 2026-11-16 - M3: B30 host-side L7 gateway on the Windows relay link (B30-07)

- Branch: `task/B30-free-relay`
- Scope: one new deployment harness (`integration/b30-gateway-host.mjs`), one temporary
  authorized inbound firewall rule (created, used and removed in the same session), and the
  deployment evidence. No live inference, no paid call, no catalog read, no switch, NAT,
  ICS or forwarding change, and no guest netplan change.
- Steps:
  1. Created the single scoped rule `B30-Relay-Gateway-Inbound` (Inbound/Allow/TCP,
     `10.30.2.1:18082` from `10.30.2.2`, adapter `vEthernet (B30-Relay-Gateway)`, profile
     `Public`, program `Any`), read the filters back, and confirmed the port was free.
  2. Started the deployment harness: the reviewed `src/egress-gateway.mjs` in `fixture` mode
     on `10.30.2.1:18082`, origin `http://127.0.0.1:18083`, path `/v1/chat/completions`,
     limits `maxRequests 4` / `maxRequestBytes 1048576` / `maxResponseBytes 1048576` /
     `timeoutMs 120000`, policy digest `9512dfe8d20d81fa7389538d0fab7c7a9c83fa2217576e5b7c99efe4700dc4e4`.
     The loopback fixture origin keeps metadata only (method, path, `Bearer public`
     equality, body byte count, canary presence), never a body.
  3. The operator typed one line on the relay console
     (`sudo mount -L B30GW2 /media/b30 && sudo bash /media/b30/probe4.sh`); the guest sent six
     raw requests and wrote its own log to the attached FAT32 volume.
  4. Collected the log on the host through WSL `--mount --vhd ... --partition 1`, then deleted
     the VHDX, the staging directory and the empty `C:\B30-VMs\_media`.
  5. Removed the firewall rule and verified the previous inbound surface: 712 -> 711 total
     rules, zero `B30` rules, adapter unchanged. The harness still held `18082` at that point
     (round 5 was waiting); after the run ended, no listener and no gateway process remained.
- Files: `integration/b30-gateway-host.mjs`, `integration/README.md`, `docs/validation.md`,
  `docs/worklog.md`, `docs/deployment-prerequisites.md`, `docs/adr/010-live-egress-and-approval.md`,
  `docs/tasks/B30.md`, `docs/task-contract.md`, `docs/roadmap.md`, `docs/handoff.md`,
  `docs/backlog.md`.
- Validation: guest log `B30-Relay-b30-gwprobe2-b30-relay.log` (1,480 B, SHA-256 `C0A60106...`)
  with `GW_CONNECT=OK` and `200`, `404`, `404`, `405`, `401`, `401`; the approved response came
  from the fixture origin with `prompt_bytes 127`; gateway instances recorded refused `path`
  and `credential`, and `B30-CANARY-PROMPT-0f5a` and `Bearer` appear zero times in the gateway
  event log. Harness evidence `b30-gateway-evidence.json` (4,032 B, SHA-256 `A9ED9EE2...`)
  records 4 completed rounds, round 5 skipped at the deadline, `origin.requests=1`, and one
  metadata-only origin record (`POST /v1/chat/completions`, public-authorization equality true,
  127 bytes, canary-presence flag true); neither the event log nor evidence JSON contains the
  canary string or authorization value. The first probe round (`BC32E1F2...`) is recorded as a harness timing failure, not
  as evidence. Serial `node --test --test-concurrency=1` -> 416 tests, 411 pass / 0 fail / 5
  platform-gated skips (exit 0); the default-concurrency run exits 1 on the known `B10-03` abort
  timing flake on this loaded machine (the file passes 8/8 in isolation) and that is recorded, not
  hidden. `integration/b30-gateway-host.mjs --smoke` on the committed revision ->
  `smoke_approved status 200`; `git diff --check` clean.
- Follow-up: keep PR #45 draft. Still `not_run`: the deployed TLS chain to the real origin,
  an application-level WebSocket rejection, the FIDO2 positive signature, the active
  WebSocket-bypass experiment, the non-loopback worker-facing listener decision and live
  inference. Merge still requires explicit authorization.
## 2026-11-16 - M3: B30 deployment evidence CI receipt

- Branch/head: task/B30-free-relay, d6e356269e5c57d4c606685caa047c51b4636c3b (base 11fcb422de47c2a9b79389de8470802d48ead730).
- Steps: read exact-head CI run 43800413251 and verified both jobs; recorded that exit 7/1 annotations are intentional pipeline fixtures. No code or deployment environment changed.
- Files: docs/validation.md, docs/worklog.md.
- Validation: run 43800413251 SUCCESS; Windows job 133079066746 and Ubuntu job 133079066372. Prior serial suite and fallback demo remain as recorded in the preceding entry. git diff --check rerun before this receipt commit.
- Follow-up: request independent re-review of the draft PR. Real-origin TLS, application-level WebSocket rejection, positive FIDO2 signature, provider bypass and live inference remain not_run; no ready or merge.

## 2026-11-16 - M3: B30 local revalidation at the publication head

- Branch/head: task/B30-free-relay, 5fe1e46196cd7d9f8ca5fa20f843d5e49cf2e4d8 (base 11fcb422de47c2a9b79389de8470802d48ead730); docs-only record on top of that head.
- Steps: reran the serial suite, demo, diff check, the privileged WSL2 containment fixture, the pinned OpenCode 2.2.5 relay harness, the host-gateway smoke and the B29 free MCP workflow at the publication head; downloaded and hash-verified the pinned binary from the official release into a temporary directory outside the repository.
- Files: docs/validation.md, docs/worklog.md.
- Validation: serial `node --test --test-concurrency=1` -> 416 tests, 411 pass / 0 fail / 5 platform-gated skips (exit 0, 193 s); demo 429 then 200 (exit 0); `git diff --check` clean; WSL `containment verified` (exit 0, all verdicts PASS, no teardown residue); `integration/opencode-free-relay.mjs` exit 0 with six scenarios ok and zero alternate-origin bytes; `integration/b30-gateway-host.mjs --smoke` exit 0; `integration/mcp-free-workflow.mjs` exit 0. Binary SHA-256 `2f3bfd6b...` matched the published digest and reported `opencode v2.2.5`.
- Follow-up: commit and push this docs-only record, verify the new remote head and its CI. The deployed TLS chain, application-level WebSocket rejection, positive FIDO2 signature, provider bypass, non-loopback listener decision, catalog read and live inference stay not_run; PR #45 stays draft and merge requires explicit authorization.

## 2026-11-16 - M3: B30 authorized live-boundary probes

- Branch/head: task/B30-free-relay, a2c060f9a811d0ef8dc5d067f10ce0a687223009 (base 11fcb422de47c2a9b79389de8470802d48ead730); docs-only record on top of that head.
- Steps: with maintainer authorization, ran one temporary probe outside the repository for the real TLS chain, the live-mode gateway forwarding one empty JSON request, an application-level WebSocket-handshake refusal, and a fresh bounded catalog read; no prompt, model output or paid route was used and no source/test/composition file changed.
- Files: docs/validation.md, docs/worklog.md.
- Validation: `opencode.ai:443` handshake authorized under Node defaults (TLSv1.3, CN `opencode.ai`, Google Trust Services, valid to 2027-02-11, fingerprint `E3:06:DC:19...`); live gateway digest `e8b6ec55...` forwarded one `POST /inference/openai/v1/chat/completions` with `Bearer public` and `{}`, provider 400 `` `model` must be a non-empty string `` with no generation; WebSocket upgrade refused 405/latch `method`; catalog at `2026-11-16T04:34:16.916Z` still lists `deepseek-v4.1-flash-free` at zero price. Ghost `B30-Relay-Gateway` switch remains at `10.30.2.1` but `Get-VM` reports zero VMs.
- Follow-up: commit and push this record, verify the new head and CI. Expired/wrong-host real certificates, positive FIDO2 hardware signature (no device present), the provider WebSocket-bypass from the worker compartment, the non-loopback listener ADR, an independent Ubuntu host and live inference remain not_run; PR #45 stays draft.

## 2026-11-16 - M3: B30 explicit relay bind address

- Branch/head: task/B30-free-relay, on top of 59dabbc6b62f79037dd87f4273c6f930f27a952f (base 11fcb422de47c2a9b79389de8470802d48ead730).
- Steps: implemented the maintainer-selected listener option - the trusted composition accepts an explicit loopback/private `relayHost` (default `127.0.0.1`), binds the relay there, derives the worker base URL and binds the address into the relay policy digest; added policy and real-bind tests and updated ADR-010, the task contract, roadmap, handoff, prerequisites, card and integration README.
- Files: src/free-listeners.mjs, test/free-listeners.test.mjs, docs/adr/010-live-egress-and-approval.md, docs/task-contract.md, docs/roadmap.md, docs/handoff.md, docs/deployment-prerequisites.md, docs/tasks/B30.md, docs/validation.md, docs/worklog.md, integration/README.md.
- Validation: focused free-listener files 19/19 (exit 0); serial `node --test --test-concurrency=1` -> 418 tests, 413 pass / 0 fail / 5 platform-gated skips (exit 0, 186 s); demo 429 then 200 (exit 0); pinned `integration/opencode-free-relay.mjs` exit 0 with six scenarios; `git diff --check` clean. The real bind test uses loopback `127.0.0.2`; private `10.30.1.1` is policy-tested only.
- Follow-up: commit and push, verify the head and CI. Binding on a real private NIC, the deployed relay->gateway TLS leg, positive FIDO2 (no device), provider WebSocket bypass, an Ubuntu host and live inference remain not_run; PR #45 stays draft.

## 2026-11-22 - B30 critical review correction follow-up

- Branch/head baseline: `task/B30-free-relay`, `11685d57c6e15a7804a95c05c1a3666c70b56de7`; PR #45.
- Steps: addressed terminal-latch races, ingress-started body/upstream deadline handling and request socket cleanup; tightened worker preparation URL profile; added two-connection supervised regression and worker preparation URL test; moved fixture origin cleanup registration before composition; documented wire-model ID distinction. Corrections are not yet independently reviewed.
- Files: `src/relay.mjs`, `src/egress-gateway.mjs`, `src/opencode.mjs`, `src/configured-service.mjs`, `test/free-listeners.test.mjs`, `test/free-provider.test.mjs`, `test/relay.test.mjs`, `test/egress-gateway.test.mjs`, `docs/task-contract.md`, `docs/tasks/B30.md`, `docs/validation.md`, `docs/worklog.md`.
- Validation: default `node --test` (Node 24.22.1) => 422 total, 416 pass, 1 fail, 5 skip, native exit 1; B10-03 partial-output timing flake. Serial full suite in progress at logging time. Focused tests worker-preparation 13/13 exit 0; relay/gateway/listener prior run 57/58 exit 1 before final label adjustment. Demo exit 0; `git diff --check` exit 0 before final socket-cleanup adjustment; both require final rerun.
- Limits: pending serial result, final focused/full/demo/diff reruns, complete review-conversation re-read, final diff review, publication, PR draft/head verification and independent review. No deployment, live provider, catalog, paid, FIDO2, VM/WSL/firewall or external network gate was run.
## 2026-11-22 - B30 validation result correction

- Update to the earlier same-date entry: serial full `node --test --test-concurrency=1`
  completed 422 total / 417 pass / 0 fail / 5 platform skips, native exit 0 (197.5 s).
  Default full `node --test` remains 422 / 416 / 1 / 5, exit 1 for B10-03 partial-output
  timing flake; serial run passes that test.
- Post-adjustment focused B30 suite 71/71 exit 0; fallback demo exit 0 (429 then 200);
  final diff check exit 0. No independent review, CI, deployment or live gate is claimed.
## Final post-correction B30 validation receipt — 2026-11-22

- Serial full suite after all test/code changes: 423 total, 418 pass, 0 fail, 5
  platform-gated skips, native exit 0 (197.96 s). Default full suite: 423 total,
  417 pass, 1 fail, 5 skips, native exit 1 due B10-03 partial-output timing flake.
- Focused B30 suite 73/73 exit 0; listener composition file 16/16 exit 0. Demo 429 -> 200,
  exit 0; diff check exit 0. Corrections remain unpublished, without current-head CI.

## 2026-11-22 - B30 critical-review correction publication

- Commit `049383e038da24ffbcad480a826ac37675a59af5` was pushed to the existing
  `task/B30-free-relay` branch (parent `11685d57c6e15a7804a95c05c1a3666c70b56de7`).
  `git ls-remote` verified the exact SHA. PR #45 remains open, draft, targets `main`,
  and reports `DIRTY`; current-head CI rollup is empty.
- Validation receipt and findings replies are recorded separately. Independent
  re-review remains pending; no ready, merge, deployment or live-gate claim.
# 2026-11-22 — B30 latest critical-review corrections (in progress)

- Branch `task/B30-free-relay`, starting head `f59d10373a18c43c70208a84b55a1707f168d6c6`.
  Preserved the two uncommitted request-cleanup edits from the prior partial session.
- Corrected early terminal cleanup in relay/gateway; bound the signed approval request
  ceiling to the effective trusted cap; passed the same <=12 cap through relay/gateway
  plan and worker guard. Added signed binding, one-request composition/request-2,
  before-ownership mismatch, stalled early-response and fresh abort-interleaving tests.
  Corrected normative model-ID language and amended ADR-010.
- Focused B30/worker set: 102 pass / 0 fail, exit 0. Serial complete suite: 428 total,
  423 pass / 0 fail / 5 skips, exit 0. Demo 429 -> 200, exit 0; diff check exit 0.
  Detailed commands and limitations are appended in `docs/validation.md`.
- Earlier development failures (two focused failures, then test fix; one upstream
  timeout regression caused by clearing timer on request end) remain documented in
  validation; all current focused and serial reruns passed.
- No network/provider/catalog/key/certificate/VM/firewall/FIDO2/live operation.
  Current changes not yet published; no current-head CI or independent re-review.
- Repeated the 3 focused timing/cap regressions (3/3, exit 0) and serial suite after
  the final test assertion tightening: 428 total, 423 pass, 0 fail, 5 skips, exit 0
  (~203 s); demo and diff check rerun successfully.
- Published code/docs commit `8f888c22e0d7dcfb296be19edf2784f076896999` on the same
  draft PR branch. Follow-up docs-only receipt records publication and task-card status.


## 2026-11-22 — Planning: reconcile delivery state and unblock supervised use

- Branch: `docs/project-reassessment-2026-11-22`
- Scope: docs and authorized GitHub queue maintenance only; no runtime, tests,
  integration harness, task contract or existing security gate changed.
- Steps:
  1. Fetched current refs and compared main `11fcb42`, B30/#45 `a4f3954`
     and B20/#43 `1dd9614` with stale local continuity. Read B30's 67
     conversation comments, submitted-review/inline channels, task/ADR,
     composition/verifier/TLS tests and dated deployment receipts.
  2. Distinguished implemented fixture mechanisms from missing compartment
     composition, direct TLS/405 observations from full deployment, and
     FIDO2's current mandatory profile from possible future local profiles.
  3. Created #46 (composition/deployment campaign), #47 (approval-profile
     decision) and #48 (test readiness/maintenance races); narrowed #30/#31
     while preserving original issue bodies as historical details.
  4. Closed obsolete #6/#9 with reasons and prior findings preserved.
     Returned conflicting #33/#34 to draft, commented on #32–#34/#43,
     and corrected #45's current summary without rewriting its history.
  5. Updated README, roadmap/backlog, handoff, AGENTS and B20/B21 pickup
     state. Added an ADR-006 planning amendment; no approval replacement,
     acceptance waiver, runtime capability or merge authority was adopted.
- Review pass 1: traced live-vs-fixture composition, signature requirements,
  actual TLS failure coverage, stale remote descriptions and proposal
  objections. Kept FIDO2/network invariants and existing B30/B20 PR identity.
- Review pass 2: inspected the completed documentation diff and disposition
  table against GitHub. Corrected ADR amendment ordering and clarified that
  M2b fixture reconciliation does not depend on B30/hardware; distinguished
  gateway-to-origin HTTPS from an accidentally required private-link TLS hop.
- Files: `AGENTS.md`, `README.md`, `docs/adr/006-worker-service.md`,
  `docs/backlog.md`, `docs/handoff.md`, `docs/pr-review.md`,
  `docs/project-reassessment-2026-11-22.md`, `docs/roadmap.md`,
  `docs/tasks/B20.md`, `docs/tasks/B21.md`, `docs/validation.md`,
  `docs/worklog.md`.
- Validation: main-code `node --test` -> 304 passed, 0 failed, 1 platform
  skip, exit 0; demo -> 429 then 200, exit 0. B30 focused listener/TLS/
  approval/ownership files -> 41 passed, 0 failed, 0 skipped, exit 0.
  Documentation content/link, unchanged-runtime, append-only and whitespace
  checks passed; details and limits are in the appended validation entry.
  No pinned-host, VM/netns, provider, catalog or hardware gate was rerun.
- Format: used the worklog/validation templates; the reassessment uses an
  inventory/disposition report because this is cross-project triage, not a
  new executable backlog card. Handoff adds a clearly superseded history
  section while preserving all contract/API/run/workflow guidance.
- Follow-up: publish this documentation PR, verify its remote head/CI and
  settle #47/#46 before privileged deployment. Existing runtime gates remain
  authoritative; no merge or live activation was performed.

## 2026-11-23 - B30 follow-up critical-review corrections

- Branch `task/B30-free-relay`, starting head `14013bbe82d28a4ffa9651c8a721ec015fa64891`.
  Addressed the two blocking P2 findings in PR comment #7089619255 without widening
  scope: the fixture (`fixtureEndpoint`) composition now bounds the worker guard by the
  signed gate's `maxRequests` (refusing a gate without an integer cap in 1..12 before
  ownership), and the live gateway strips IPv6 brackets before rejecting IP literals.
  Added a prepared-guard assertion, a pre-ownership refusal test and IPv4/IPv6 origin
  negatives; updated the normative contract and ADR-010 amendment.
- Validation: focused 36/36; focused B30 set 134 pass / 0 fail / 4 environment skips;
  serial full suite 431 total / 426 pass / 0 fail / 5 skips; default-concurrency suite
  425 pass / 1 fail (known B10-03 timing flake, reproduced twice); demo 429 -> 200;
  `git diff --check` clean. Details and limits in `docs/validation.md`.
- No network/provider/catalog/VM/firewall/key/FIDO2/live operation, no rebase, no ready
  transition and no merge. Current-head CI is still empty and issues #46/#47/#48 remain
  blockers; independent critical re-review of this head is pending.
- Published code commit `4bf5e19f6e13f0ca63ac2c4d78c787ba849cba47`; the docs-only
  publication receipt follows on the same branch.

## 2026-11-23 - B30 author self-review (not independent)

- Reviewed the complete `main..HEAD` diff at `28f10a2` plus local probes; this is not
  the independent critical re-review, which remains pending.
- Confirmed both blocking findings from comment #7089619255 are corrected. Found and
  fixed one diagnostic defect by probe: an in-flight request latched by another request
  answered 504 and rewrote `latchReason` to `timeout`; it now answers 503 and retains
  the original reason. No replay or forwarded bytes were involved.
- Commit `bf07293f0718ea25b7a93c54f20b66bda7f95c82` with deterministic regressions in
  both listener test files. Revalidated: listener tests 39/39; serial suite 433 total,
  428 pass, 0 fail, 5 skips. No network/provider/VM/key/FIDO2/live operation.
- PR remains draft/conflicting; current-head CI is empty; issues #46/#47/#48 remain
  blockers.

## 2026-11-24 - B30 merge with main (documentation conflict resolution)

- Branch `task/B30-free-relay`, head `9a83ac9b95a3d00738080b64286544fde28fdb25`;
  merged `origin/main` `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` to clear the stale
  base. Only five documentation files conflicted (`backlog`, `handoff`, `roadmap`,
  `validation`, `worklog`); code and tests merged automatically.
- Resolution kept the append-only history on both sides: the main-side 2026-11-22
  planning entry was inserted chronologically in `validation.md` and `worklog.md`;
  `backlog.md`/`roadmap.md`/`handoff.md` take the reassessment framing (#46-#48,
  B20/#43 blocked, B29 fixture-only) with B30's current draft head and pending
  independent re-review noted. The 2026-11-16 next-action heading in `handoff.md`
  is marked historical under the reassessment continuation.
- No code, test, contract, ADR or gate changed; no network/provider/VM/key/FIDO2/live
  operation and no ready transition. Validation commands and results are recorded in
  `docs/validation.md`.

## 2026-11-24 - B30 independent review corrections

- The independent critical review requested changes at `2f8d7ae` (comment 7121684260);
  exact-head CI `45323052642` failed on Ubuntu at the fresh-abort regression.
- B30-05: `validateLiveApproval` now enforces `issuedAt <= now < expiresAt` and a positive
  lifetime of at most 15 minutes, with future/inverted/equal/boundary tests; contract and
  ADR-010 amended.
- B30-04: the fresh-abort regression waits for the listener's real latch through the
  diagnostics-only `freeListenerStatus()` instead of a fixed sleep. Latch reporting is
  first-write-wins in both listeners; the concurrent-latch regressions are ordered by
  origin arrival and the 405, and new regressions cover an upstream failure after a latch.
- Merge history: restored the dropped dated backlog/handoff continuity under historical
  headings and labelled the `a4f3954` green CI historical in backlog/roadmap.
- Validation: focused 55/55 and 48/48; fresh-abort 1/1; serial suite 436 total, 431 pass,
  0 fail, 5 skips; demo 429 -> 200; diff check clean. No live/provider/VM/key/FIDO2 run;
  PR #45 stays draft.

## 2026-11-24 - B30 status-query unhandled-rejection correction

- Corrected-head re-review (comment 7121966650) closed the prior findings but found that
  `freeListenerStatus()` could leave an unhandled rejection when one listener had exited and
  the other pending query later failed. Fixed by awaiting both status queries sequentially.
- Added a regression that kills the gateway, starts the combined query while the relay runs,
  kills the relay, and asserts a returned rejecting promise with no `unhandledRejection`.
- Validation: listener file 20/20; serial suite 437 total, 432 pass, 0 fail, 5 skips (two
  earlier attempts failed only the known B15-03b #48 race). Demo and diff check clean.

## 2026-11-24 - B30 status-regression handler ordering

- Third-round re-review (comment 7122271270) closed the runtime finding but found the new
  regression attached its rejection handler only after the relay kill, so a fast relay reply
  turned the expected gateway rejection into an unhandled one. Fixed by creating
  `assert.rejects(pending)` immediately after the query starts; the sequential `status()`
  implementation is unchanged.
- Validation: targeted regression 5/5 isolated passes; listener file 20/20; demo and diff
  check clean. No live/provider/VM/key/FIDO2 operation; PR #45 stays draft.

## 2026-11-24 - B30 independent review closed

- Fourth-round independent review (comment 7122405149) closed all findings at `7660b39`
  with no new blocking issues; reviewer evidence recorded in `docs/validation.md`.
- Recorded the closure in `docs/handoff.md`, `docs/roadmap.md` and the B30 card, explicitly
  as review closure rather than acceptance. Merge/ready/live remain unauthorized and
  #46/#47/#48 remain open.

## 2026-11-28 - Propagate FIX48 correction to B30

- Branch: `task/FIX48-propagate-B30`, based on B30/#45 head
  `67acd78d0c570d5619dcc56c1638138c650cf32a`.
- Applied FIX48 test synchronization, repeated-suite runner and CI changes, and
  added the FIX48 acceptance card. Preserved B30's existing documentation and
  appended a propagation receipt; no B30 production/live behavior changed.
- Review note: an initial content-level merge conflicted because the FIX48 docs
  snapshot predated B30's review history. The code, tests, CI and task card were
  retained; B30's five overlapping status/history documents were restored from
  its head and updated narrowly.
- Source validation: FIX48's first campaign passed five originals per OS at PR
  head `1a2bd5f` / merge checkout `bfbeda9`; receipt-head run `46108300145`
  passed five per OS at PR head `9b34a8c` / common merge checkout `7366b22`.
  Every sample exited 0 with a clean, unchanged checkout; detailed totals are in
  `docs/validation.md`.
- Propagated branch validation via Node 24.22.1: focused five-file command 88
  total / 87 pass / 0 fail / 1 platform skip, exit 0; full `node --test` 442
  total / 437 pass / 0 fail / 5 platform skips, exit 0; fallback demo 429 then
  200, exit 0; staged diff check clean.
- Current-head CI: run `46109110028` at PR code head `784cdb4` passed on
  Windows and Ubuntu. All five originals per OS at merge checkout `8edcf05`
  exited 0, checkout clean/unchanged, 442 tests / 437 pass / 0 fail / 5 skip.
  Demo steps passed. The bounded watch's annotations request returned HTTP 502;
  direct `gh run view` and both job logs confirmed workflow/job success.
- Files: test/CI runner and regressions; FIX48 card; backlog, handoff, roadmap,
  validation and worklog receipts.
- Not done: #51 propagation and exact-head CI there; merge, ready/live transition
  or deployment activity.

# ADR template

When to use: a decision, dependency, trust-boundary change, or a reversal of an earlier
decision needs a durable record. [AGENTS.md](../../AGENTS.md) requires an ADR when a
decision, dependency or trust boundary changes. One ADR records one decision.

Who writes it: the author of the change, in the same branch and PR as the change it
justifies. Who maintains it: the maintainer accepts or supersedes it; the author never
edits an accepted ADR to say something else — a reversal is a new ADR that supersedes it.

Filename: `docs/adr/<NNN>-<short-slug>.md` with the next free three-digit number. A new
ADR is never inserted into the middle of a number sequence, and numbers are never reused.

Do not use it for: status updates, plans, task checklists or validation evidence. Those
belong in [roadmap](../roadmap.md), [worklog](../worklog.md) and
[validation](../validation.md).

## Template

```markdown
# ADR-<NNN> — <decision title in one line, no trailing period>

<!-- Header line. Replace the date with the day the decision was taken (YYYY-MM-DD),
     not the day the file was last touched. Keep exactly one status value:
     "Proposed" (not yet accepted, not binding), "Accepted" (binding now) or
     "Superseded by ADR-<NNN>" (binding no longer; name the replacing ADR).
     Never add a fourth status and never leave the status empty.
     "Decided by" names the authority: the maintainer, or the PR link when a review
     approved it. Do not put a person's private contact data here. -->
Date: <YYYY-MM-DD>. Status: Proposed | Accepted | Superseded by ADR-<NNN>. Decided by: <maintainer | PR link>.

## Context

<!-- Why this decision had to be taken now, in past tense: the problem, the constraint
     that forces a choice, and the constraints already fixed by earlier ADRs (link
     them). State the situation as it is, not the decision.
     Belongs here: the forcing problem, relevant earlier decisions and their
     consequences, what is already impossible because of them.
     Must NOT go here: the decision itself, a list of options (next section), test
     results or evidence transcripts (validation.md), or a plan of future steps
     (roadmap.md). Two paragraphs is normally enough. -->

## Decision

<!-- The decision in one or two sentences, in present tense and the active voice,
     starting with the thing that is decided. Then state the boundary it fixes: what
     becomes allowed, forbidden or fixed from now on.
     Belongs here: numbered clauses when the decision has independent parts; the
     precise names of files, operations, protocols or versions it fixes.
     Must NOT go here: motivation (previous section), rejected options (next
     section), cost or risk discussion (Consequences), or a promise of dates.
     If the decision can fail and fall back, state the fallback clause here in one
     sentence so the default is never ambiguous. -->

## Alternatives considered

<!-- One bullet per option that was seriously on the table, including "do nothing"
     when it was real. Each bullet names the option and the reason it was rejected.
     Belongs here: options that were evaluated, with the concrete rejection reason.
     Must NOT go here: options nobody evaluated, a straw-man list added for length,
     or details of the chosen option (that is Decision). If an earlier ADR already
     rejected the option, link that ADR instead of repeating the whole argument. -->

## Consequences

<!-- What changes because of this decision: what becomes true, what stays out of
     scope, what new risk or limitation the repository now carries, and what future
     work is required. Write in the future or present tense.
     Belongs here: new obligations, new failure modes, explicit non-goals, and the
     limitations that a reader could otherwise mistake for missing work.
     Must NOT go here: a restatement of the decision, a task list with owners, or
     evidence that the decision works (validation.md). Never omit the negative
     consequences; a consequences section with only benefits is an incomplete ADR. -->

## Related documents

<!-- Every document the reader needs to understand or apply this decision, as relative
     Markdown links with a short label. Include the ADRs this one depends on or
     supersedes, the normative contract it changes, and the implementation file when
     one exists.
     Belongs here: ADRs, task-contract.md, validation.md sections, source files.
     Must NOT go here: external URLs that may rot, PR descriptions, or links to
     documents that do not exist yet. -->
```

## Optional closing section

Existing ADRs end with `## Revisit triggers` when the decision has a known expiry
condition (a gate that can fail, a milestone that removes the constraint). Use it only
with a concrete trigger written as a condition, for example "when the capability gate
fails". Do not use it to list wishes.

## Example

The example below is [ADR-008](../adr/008-task-store.md), a real past decision,
compressed to this skeleton. It is a filled sample, not a template: do not copy its
content.

```markdown
# ADR-008 — Durable task store and idempotency index

Date: 2026-11-02. Status: Accepted. Decided by: maintainer.

## Context

[ADR-007](007-task-contract.md) made [task-contract.md](../task-contract.md) normative
and the MCP capability gate passed, so M2b step 2 needs durable task records: one record
per task, a client-scoped idempotency index and startup reconciliation. The existing
ledger ([ADR-004](004-local-ledger.md)) solves a different problem: one in-flight
external call per session, held under an exclusive lock for the whole call. A task lives
across many writes and is read by the supervisor while the service works, so it needs a
record store, not a session lock.

## Decision

1. `src/tasks.mjs` exposes `openTaskStore({ home, retentionMs })` with `createTask`,
   `readTask`, `updateTask`, `listTasks`, `reconcile` and `prune`. It owns persistence
   only: no operation validation, no executor, no cancellation semantics.
2. Layout: `tasks/<taskId>.json` plus `idempotency/<sha256(clientId, key)>.json` under
   `AI_ORCHESTRATOR_HOME`; the home is never inside the repository and tests always pass
   a temporary directory.
3. Writes reuse the ADR-004 pattern per record: exclusive temporary file in the same
   directory, fsync, close, rename. Reads never rewrite a committed record.

This fixes the boundary: the store persists records, and everything about task
semantics stays in the service surface.

## Alternatives considered

- Reuse the local ledger from ADR-004: rejected, because its exclusive lock spans one
  external call and a task outlives many writes.
- Adopt a workflow engine such as LangGraph: rejected in ADR-007 as durable graph
  orchestration that one worker does not need.
- Keep task state in memory in the service process: rejected, because a restart would
  silently lose accepted tasks and make duplicate work possible.

## Consequences

- An unreadable or invalid record is `unavailable`, never an absent task, and never
  reset. Recovery is a maintainer action, as in ADR-004.
- Duplicate-work safety depends on successful reconciliation before accepting any
  operation. A service that skips `reconcile` can create a second task for a key whose
  record survived a crash.
- Store tests use injected timestamps and temporary directories; they do not validate
  the transport, the executor or the operation semantics. No cross-process lock exists
  in this step, so multiple service processes are out of scope.

## Related documents

- [ADR-007 — Task contract, first transport and reuse decision](007-task-contract.md)
- [ADR-004 — Local ledger](004-local-ledger.md)
- [task-contract.md](../task-contract.md)
- [src/tasks.mjs](../../src/tasks.mjs)
```

# Execute one task through its PR

This is the required delivery protocol for backlog work. Read it with the selected
[task card](backlog.md) and [Definition of Done](definition-of-done.md).
One executable task ID produces one PR. A parent/umbrella ID is not executable.
The completed delivery is a published PR ready for review; merged is a separate state.

For an existing PR, read full conversations, submitted reviews and inline threads
on the initial pass. For a resumed correction, reconcile new, changed and reopened
feedback against a verified checkpoint; reread relevant feedback in full if
completeness cannot be demonstrated. Follow [the PR feedback protocol](pr-review.md):
publish actionable findings on GitHub, reply to findings with commit/evidence and
verify them at the current head before treating a blocking finding as resolved.

## Start and establish the baseline

1. Read AGENTS, applicable sources/sections, the selected card and relevant ADRs.
   Use the current handoff/roadmap for task selection or changed dependencies.
   Inspect status, current remote main, existing branches/PRs and dependencies.
   Preserve user/other-agent edits. Record task ID, base SHA, scope and expected files.
2. Choose a ready task whose prerequisites are actually merged/verified. Do not assume
   an open PR or an old test count satisfies a prerequisite. Update the existing task
   PR if one exists. Otherwise create `task/<ID>-<slug>` from current main.
3. Turn each card matrix row into a verification entry: row ID, concrete input/trigger,
   expected state/output, forbidden side effects, test/experiment name and evidence
   location. Add missing cases discovered in code review; the matrix is a minimum.
4. Resolve routine implementation choices within existing authority. If a new trust
   boundary or externally controlled prerequisite is unresolved, document the precise
   decision/blocker rather than choosing an unsafe default. Do independent work while
   waiting; do not mark the dependent criterion passed.

## Implement, test and review during development

5. Implement only the task scope. Keep API, normative contract, producer/consumer and
   compatibility behavior consistent. Use real temporary filesystem/process/Git
   fixtures when the failure boundary requires them, rather than mocking that boundary.
6. Exercise focused success, rejection, race, persistence/restart and cleanup cases
   relevant to the task. Assert forbidden side effects and committed bytes as well as
   return values. Tests must fail on the defect being prevented; do not weaken tests
   to obtain a pass or change expected behavior without a documented contract decision.
7. **Self-review objective 1 — implementation:** inspect design and changed call
   sites, lifecycle/authority, input provenance, secret handling, failure cleanup,
   old-record compatibility and exact matrix coverage. Record findings, fixes and
   justified exclusions. Correct blocking defects in scope and rerun affected
   scenarios. P3 suggestions are optional and do not require correction.

## Finish and review the completed change again

8. Run the complete `node --test` suite and fallback demo, focused task experiments,
   applicable host/platform gates and `git diff --check`. Capture actual command exit
   codes before formatting output. In PowerShell save `$LASTEXITCODE` immediately
   after the native command; explicitly fail the calling script on nonzero. Never
   use `|| true`, ignore assertions or infer a test exit from a downstream formatter.
9. Consolidate worklog and validation evidence before final-head review, using the
   templates. Update contract/ADR for behavior/authority changes, and handoff/roadmap
   only for continuation/milestone changes. Record versions, exact commands, results,
   evidence level and not-rerun reasons. Never turn required not_run into passed or
   quietly drop a matrix row. Record final CI/review receipts on GitHub at their SHA,
   not in a receipt-only commit.
10. **Self-review objective 2 — completed diff:** inspect the entire proposed diff
    against its base, including new files, tests, docs and deletions. Recheck every
    acceptance row against actual evidence, old consumers and final behavior.
    Check close/reopen, stale handles, startup failures and cross-process behavior
    whenever ownership or lifecycle is involved. Look for unrelated changes,
    misleading completion claims, secrets, swallowed exits and unsafe cleanup.
    These two self-review objectives may be recorded in one consolidated review
    when it clearly documents both objectives. No independent reviewer is dispatched
    by the executor; after publication the coordinator handles review intake/dispatch.
11. Correct blocking findings within scope, update evidence and revalidate affected
    checks. After code changes, rerun the full suite/demo as required; do not treat
    checks on a prior code revision as validating new code. Documentation-only
    corrections require corresponding content/link checks; avoid repeating
    unrelated host gates. Do not start an additional review round solely to rereview
    documentation updates.

## Publish and verify

12. Commit the complete scoped diff. Push without force and open/update the single
    task PR only when authorized. Include task ID, base/head, concrete before/after
    behavior, matrix-to-test evidence, both review summaries, limitations and
    not-rerun gates. Use the repository PR template. Ordinary completed work is ready
    for review, not a placeholder draft.
13. After publication, automatically hand the exact PR context to the authorized
    coordinator; do not require another user prompt for already-authorized phases.
    The coordinator launches the independent reviewer and performs other safe checks
    while one blocking `gh pr checks <PR> --repo <owner/repo> --watch --interval 30
    --fail-fast` operation monitors the current head. Set its initial tool timeout
    to 30 minutes (1,800,000 ms), capped by runtime limits. Do not use repeated model
    calls to poll CI. Run at most one watch per unchanged head; a corrected head
    requires its own bounded watch and delta review.
14. When the watch finishes, verify the current remote PR head/base, all required
    check conclusions, findings/feedback, acceptance evidence and current
    authorization. If CI failed, correct only blocking in-scope findings within the
    existing maximum of two correction rounds, then validate and repeat review/CI for
    the new head. `WAITING_CI` is an end state only if the watch times out or
    monitoring is unavailable; continue independent safe work after a timeout when
    possible. Report a completed merge only after GitHub confirms the exact head was
    integrated. Continue to another task only if original authorization explicitly
    permits multiple deliveries and budget remains.

Do not end at an intermediate phase or ask the user to repeat authorization already
granted for this delivery. `WAITING_CI` is valid only after the bounded watch times
out or monitoring is unavailable. A verified incomplete checkpoint is a valid
session outcome, not task completion. Stop for a real blocker, unavailable authority,
provider/runtime limit, exhausted correction/review budget or uncertain outcome
requiring reconciliation. Give short progress updates during active work. After a
final reply no background work is implied.

## Blocked work

An external blocker is unavailable credentials/authorized provider, missing required
host/platform, inaccessible remote, an unresolved maintainer decision, conflicting
concurrent edits requiring coordination, or another prerequisite the agent cannot
resolve within authority. A failing test or blocking review finding within scope
normally requires correction; P3 suggestions are optional. Long work and the prospect
of another review are not blockers. A pending CI check is not a blocker while its
bounded watch and independent review/checks can proceed.

- Finish safe independent work and reproduce the blocker. Record attempted command,
  result, affected criteria and exactly what input/environment would unblock it.
- Persist the verified checkpoint with the task, base/head, evidence, limits,
  consumed correction/review budget and next authorized action. Commit, push or open
  a draft only when authorized and safe within the frozen scope; if publication is
  blocked, retain local commits and report branch/SHA and the remote error.
- Never publish knowingly incomplete work as ready, invent evidence, or claim task
  completion merely because a PR exists. State `blocked/incomplete` and the draft URL
  or local checkpoint. Do not split an unfinished task into a second competing PR.
- A user request to stop/pause takes precedence; leave an accurate continuation point.

## Copyable task dispatch

Replace TASK_ID with one ready ID from the index; the selected card supplies scope.

> Execute TASK_ID from docs/backlog.md and docs/tasks/TASK_ID.md within the
> authorized frozen scope. Follow AGENTS.md and docs/task-execution.md. One task =
> one branch and one PR. Test every acceptance row and document both self-review
> objectives; correct only blocking findings within scope and revalidate fixes.
> Consolidate evidence before final-head review. Do not dispatch an independent
> reviewer; coordinator handles review intake after publication. Commit/push/open
> only when authorized, verify remote head, and do not merge. Stop at a known
> missing gate, authority/provider limit, exhausted budget or uncertain outcome.
> Report complete or incomplete status, SHA, evidence, limits and next action;
> leave a verified checkpoint for incomplete work.

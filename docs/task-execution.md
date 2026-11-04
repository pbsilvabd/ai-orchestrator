# Execute one task through its PR

This is the required delivery protocol for backlog work. Read it with the selected
[task card](backlog.md) and [Definition of Done](definition-of-done.md).
One executable task ID produces one PR. A parent/umbrella ID is not executable.
The completed delivery is a published PR ready for review; merged is a separate state.

For existing PRs, read full conversations, submitted reviews and inline threads
before implementation/correction and before final delivery. Follow
[the PR feedback protocol](pr-review.md): publish actionable findings on GitHub,
reply to corrections with commit/evidence and re-review the current head before
treating a blocking finding as resolved.

## Start and establish the baseline

1. Read AGENTS and its ordered sources, the selected card and relevant ADRs. Inspect
   status, current remote main, existing branches/PRs and task dependencies. Preserve
   user/other-agent edits. Record task ID, base SHA, scope and expected files.
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
7. **Review pass 1 — implementation review:** inspect design and changed call sites,
   lifecycle/authority, input provenance, secret handling, failure cleanup, old-record
   compatibility and exact matrix coverage. Record findings, their fixes and any
   justified exclusions. Fix blocking findings and rerun affected scenarios.

## Finish and review the completed change again

8. Run the complete `node --test` suite and fallback demo, focused task experiments,
   applicable host/platform gates and `git diff --check`. Capture actual command exit
   codes before formatting output. In PowerShell save `$LASTEXITCODE` immediately
   after the native command; explicitly fail the calling script on nonzero. Never
   use `|| true`, ignore assertions or infer a test exit from a downstream formatter.
9. Append worklog and validation entries using the templates. Update contract/ADR
   for behavior/authority changes, and handoff/roadmap for continuation/milestone
   changes. Record versions, exact commands, results, evidence level and not-rerun
   reasons. Never turn a required not_run into passed or quietly drop a matrix row.
10. **Review pass 2 — completed diff review:** inspect the entire proposed PR diff
    against its base, including new files, tests, docs and deletions. Recheck every
    acceptance row against actual evidence, old consumers and the final behavior.
    Check close/reopen, stale handles, startup failures and cross-process behavior
    whenever ownership or lifecycle is involved. Look for unrelated changes,
    misleading completion claims, secrets, swallowed exits and unsafe cleanup.
11. Correct findings, update evidence, rerun affected checks and the full suite/demo
    after code changes, then repeat final review of the changed parts. Checks on a
    previous code revision do not validate new code. Documentation-only corrections
    require corresponding content/link checks; avoid repeating unrelated host gates.
    Self-review is mandatory even when a more capable model will review later. These
    are two deliberate passes by the implementing agent; no second model is required.

## Publish and verify

12. Commit the complete scoped diff and push without force. Open the single task PR
    with task ID, base/head, concrete before/after behavior, matrix-to-test evidence,
    both review summaries, limitations and not-rerun gates. Use the repository PR
    template. Ordinary completed work is ready for review, not a placeholder draft.
13. Verify the remote branch SHA equals the intended local head and the PR targets
    the intended base/head. Inspect available CI results; fix failures from this
    change. If CI is still running, say pending and record the final head rather than
    reporting a pass. Do not keep polling unchanged CI indefinitely.
14. Report PR URL, head SHA, actual validation results, remaining limitations and next
    unblocked task. Mark the backlog task `PR open` (not merged). Merge only with
    explicit authorization for this task; earlier merge approval is not inherited.

Do not end a normal task after only planning, creating a branch, implementing or
passing the first test run. Continue until publication and verification are complete.
Do not ask for a new "continue" for these already-authorized steps. Give short progress
updates during active work. After a final reply no background work is implied.

## Blocked work

An external blocker is unavailable credentials/authorized provider, missing required
host/platform, inaccessible remote, an unresolved maintainer decision, conflicting
concurrent edits requiring coordination, or another prerequisite the agent cannot
resolve within authority. A failing test or review finding normally requires a fix,
not a pause. Long work and the prospect of another review are not blockers.

- Finish safe independent work and reproduce the blocker. Record attempted command,
  result, affected criteria and exactly what input/environment would unblock it.
- If code can be shared safely, commit/push it and open/update the **same task PR as
  draft**, clearly listing incomplete criteria. If publication itself is blocked,
  retain local commits and report branch/SHA and the remote error.
- Never publish knowingly incomplete work as ready, invent evidence, or claim task
  completion merely because a PR exists. State `blocked/incomplete` and the draft URL
  or local checkpoint. Do not split an unfinished task into a second competing PR.
- A user request to stop/pause takes precedence; leave an accurate continuation point.

## Copyable task dispatch

Replace TASK_ID with one ready ID from the index; the selected card supplies scope.

> Execute TASK_ID from docs/backlog.md and docs/tasks/TASK_ID.md. Follow AGENTS.md
> and docs/task-execution.md. One task = one PR. Implement the complete scope, test
> every acceptance row, review during implementation, fix findings, then review
> the completed diff again and revalidate corrections. Update the required docs,
> commit, push, open the PR and verify its remote head. Continue through the PR
> without stopping after intermediate steps. Report URL, SHA, results and limits.
> Do not merge. If an external blocker prevents completion, follow the blocked-work
> procedure and explicitly report the incomplete criteria.

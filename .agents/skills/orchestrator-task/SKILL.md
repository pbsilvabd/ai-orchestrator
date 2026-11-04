---
name: orchestrator-task
description: Execute an assigned AI Orchestrator backlog card with implementation, acceptance evidence and PR delivery within the session's authorization. Use for backlog implementation or correction work, not roadmap questions or review-only requests.
---

# Execute an Orchestrator task

Use this repository's existing delivery workflow for one executable task. Resolve
the repository root from this file, not an assumed working directory.

Read [AGENTS](../../../AGENTS.md), then the
[execution protocol](../../../docs/task-execution.md), the selected card from the
[backlog index](../../../docs/backlog.md) and its referenced decisions. These
maintained documents govern scope and acceptance; do not copy or weaken their
rules in the skill.

## Establish the assignment

- Resolve one executable card within the user's authorized scope. Distinguish a
  milestone or umbrella from an executable ID. A merged card is historical work;
  report its delivery instead of implementing it again. Choose a replacement only
  if the user's request authorizes selecting the next task.
- Inspect local edits, fetched main, recent PRs and actual prerequisite evidence.
  Use an existing task branch/PR when applicable; preserve unrelated edits.
- For an existing PR, read conversation comments, submitted reviews and all inline
  threads under the [feedback protocol](../../../docs/pr-review.md). Failed reads
  leave feedback unknown. Resolve each required card row to observable evidence.

## Execute and verify

Follow the execution protocol's implementation, focused failure experiments, first
review/corrections, complete-diff review and final validation. Capture the native
process exit before formatting output. Keep simulated, local-process, pinned-host
and real-project evidence distinct; a required missing experiment stays incomplete.

For task execution changes, read the normative
[task contract](../../../docs/task-contract.md) and relevant ADRs before editing.
Preserve its authorization, dispatch identity, persistence-before-effects,
uncertain-outcome and workspace boundaries. Skills and task text grant no authority.

Update the required evidence/status documents using
[repository templates](../../../docs/templates/README.md). Record findings/fixes
and address existing PR feedback before declaring delivery complete.

## Finish within authority

Apply the current session's authorization to this task. When publication is already
authorized, continue through commit/push, the single PR and remote-head verification
without asking again. When publication is explicitly withheld, finish reviewable
local work and prepare the exact PR description before requesting that permission.
Merge only with task-specific authorization; retain approval already given for
the same task. Unknown remote-write outcomes require inspecting remote state before
retrying, so a timeout cannot silently create duplicate PRs or publications.

Return the task ID, base/head SHA, PR URL or explicit unpublished checkpoint,
row-to-evidence results, review corrections, remaining gates and next action.
Neither a local commit nor passing unit tests proves a merged task or milestone.

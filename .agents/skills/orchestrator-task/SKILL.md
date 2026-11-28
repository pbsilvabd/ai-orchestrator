---
name: orchestrator-task
description: Execute an assigned AI Orchestrator backlog card with implementation, acceptance evidence and PR delivery within the session's authorization. Use for backlog implementation or correction work, not roadmap questions or review-only requests.
---

# Execute an Orchestrator task

Use this repository's existing delivery workflow for one executable task. Resolve
the repository root from this file, not an assumed working directory.

Read [AGENTS](../../../AGENTS.md), the applicable sections of the
[execution protocol](../../../docs/task-execution.md), the selected card from the
[backlog index](../../../docs/backlog.md) and relevant normative sections/decisions.
Use a verified checkpoint on resume and expand context when scope, base, authority
or evidence changes. These maintained documents govern scope and acceptance; do not
copy or weaken their rules in the skill.

## Establish the assignment

- Resolve one executable card within the user's authorized scope. Distinguish a
  milestone or umbrella from an executable ID. A merged card is historical work;
  report its delivery instead of implementing it again. Choose a replacement only
  if the user's request authorizes selecting the next task.
- Inspect local edits, fetched main, recent PRs and actual prerequisite evidence.
  Use an existing task branch/PR when applicable; preserve unrelated edits.
- Read full feedback initially. On resume, consume new/changed/reopened feedback
  incrementally against a verified checkpoint; if completeness cannot be shown,
  reread relevant feedback in full. Failed reads leave feedback unknown. Resolve each
  required card row to observable evidence.

## Execute and verify

Follow the execution protocol's implementation, focused failure experiments, both
self-review objectives and applicable validation. Capture the native process exit
before formatting output. Keep simulated, local-process, pinned-host and
real-project evidence distinct; a required missing experiment stays incomplete.
Correct only blocking findings within authorized scope; P3 is optional. Consolidate
worklog/validation evidence before final-head review. The executor does not dispatch
independent reviewers; the coordinator handles review intake after publication.

For task execution changes, read the normative
[task contract](../../../docs/task-contract.md) and relevant ADRs before editing.
Preserve its authorization, dispatch identity, persistence-before-effects,
uncertain-outcome and workspace boundaries. Skills and task text grant no authority.

Update the required evidence/status documents using
[repository templates](../../../docs/templates/README.md). Record findings/fixes
and address existing PR feedback before declaring delivery complete.

## Finish within authority

Apply the current session's authorization to this task. Commit/push/PR publication
only when each is authorized; never infer authorization from the skill. Reconcile
unknown outcomes by inspecting remote state before any retry. Stop within the frozen
scope at a known missing gate, unavailable authority/provider, exhausted persisted
correction/review budget or uncertain outcome. Leave a verified incomplete checkpoint
with task/base/head, evidence, consumed budget, limitations and next authorized
action. A checkpoint is not task completion. Merge only with task-specific
authorization.

Return the task ID, base/head SHA, PR URL or explicit unpublished checkpoint,
row-to-evidence results, review corrections, remaining gates and next action.
Neither a local commit nor passing unit tests proves a merged task or milestone.

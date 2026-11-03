# Task card template

Use for every new executable backlog task. Publish the filled card under
`docs/tasks/ID.md` and link it from `docs/backlog.md`. A task must fit one PR;
split oversized work into separately gated child IDs before dispatch. Preserve the
[execution protocol](../task-execution.md), normative sources and evidence limits.
Replace all placeholders; preserve concrete facts when adapting the format.

## Template

```markdown
# ID — Concrete observable outcome

## Pickup and delivery

- Status and observed base SHA:
- Prerequisites, each with required merged/verified evidence:
- Existing PR or new branch:
- Required code/contract/ADR references:
- Files owned; shared files needing coordination:
- One task ID, one branch, one PR; follow ../task-execution.md through publication.

## Objective and scope

Describe the trigger, current failure, resulting behavior and explicit exclusions.
Specify compatibility/migration obligations and any maintainer decision still needed.

## Implementation sequence

1. Inspect actual producers/consumers and record the boundary/API being changed.
2. Specify inputs, outputs, error codes, state transitions and forbidden side effects.
3. Implement the bounded behavior and compatibility handling.
4. Exercise rejection, failure, race/restart and cleanup paths relevant to this task.
5. Update normative documentation and publish after both review passes and correction.

## Required acceptance matrix

| ID | Concrete input or trigger | Observable output/state | Forbidden side effects | Verification method |
| --- | --- | --- | --- | --- |
| ID-01 | Specify exact valid case | Specify result | Specify unchanged state | Named test/experiment |
| ID-02 | Specify invalid case | Specify error/refusal | Specify committed bytes | Named test/experiment |
| ID-03 | Specify relevant failure/race | Specify evidence/outcome | Specify no replay/leak | Real boundary fixture |

## Validation and evidence to publish

- Focused commands/scenarios, required OS/host/runtime and actual expected assertions:
- Full suite, demo and diff checks; capture original native exit codes:
- Evidence level, not_run behavior and missing-prerequisite procedure:
- Pass 1 implementation review: findings/fixes/revalidation:
- Pass 2 completed-diff review: row-by-row evidence, findings/fixes/revalidation:
- Worklog/validation plus contract/ADR/handoff/roadmap triggers:
- PR URL, base/head and verified remote SHA:

## Final completion check

Every required row has observed evidence; blocking findings fixed; final checks pass;
docs updated; one ready PR pushed and verified. Continue until this point without
asking for another continue. External blockers follow the draft/incomplete-work
procedure in ../task-execution.md. Merge requires explicit task-specific approval.
```

Code fences prevent the sample links from acting as destination-relative links here.
Use proper Markdown links relative to `docs/tasks/` in a filled card. Existing cards
show complete examples; a copied skeleton alone is never a detailed task contract.

## Task and behavior

Task ID and card link:
Base commit / head commit:
Problem and observable before/after behavior:
Scope and explicitly deferred work:
Delivery status (complete / incomplete checkpoint) and checkpoint link if incomplete:

## Acceptance evidence

Map every required card row to a named test/experiment and observed evidence.
Use pass/fail/not_run; never omit a required row or treat not_run as passed.

| Card row | Test or experiment | Command / evidence location | Result / exit code |
| --- | --- | --- | --- |

## Review and corrections

- Self-review objective 1 (implementation): inspected behavior/failure/authority paths; findings and fixes:
- Self-review objective 2 (completed diff): rechecked all card rows, callers, tests and docs; findings and fixes:
- These objectives may share one review record when both are explicitly covered.
- Revalidation after fixes (final code revision, commands and results):
- PR feedback: conversation/reviews/threads read at head SHA; finding links,
  correction commits/replies, unresolved items and re-review status
  (see docs/pr-review.md):

## Validation and limits

- Environment and versions:
- Full suite / demo / diff checks:
- Real subprocess / platform / host evidence, where required:
- Not rerun, reasons and remaining blockers/limitations:
- Links to consolidated worklog / validation evidence and applicable contract/ADR/handoff updates:

## Publication check

- [ ] One task ID and one PR; prerequisites verified.
- [ ] Every required acceptance row has evidence and blocking findings are resolved.
- [ ] Both review passes and final revalidation completed.
- [ ] Branch pushed and remote head verified against intended local commit.
- [ ] CI results are reported as observed (including pending/not_run).
- [ ] Existing PR feedback was read and answered; actionable review findings are
      published on the PR and blocking findings have verified re-review.
- [ ] Final review and CI receipts link to the SHA-specific GitHub record; do not
      duplicate their text in a receipt-only commit.

Leave incomplete work as draft and identify the unmet criteria. Merge is a separate
maintainer decision, not part of the implementing agent's delivery.

# PR review and correction protocol

Developers and reviewers must follow this protocol alongside
[AGENTS](../AGENTS.md), [task execution](task-execution.md), the task card and
[Definition of Done](definition-of-done.md). GitHub is the shared record of
actionable findings; a final chat reply alone does not deliver a PR review.

## Reviewer instructions

1. On the first review, fetch the current base/head SHAs, complete diff, CI,
   conversation comments, review submissions and inline threads, including
   resolved/outdated threads. Read the acceptance criteria and record the reviewed
   base/head.
2. On an incremental review, verify the prior verdict and its base/head, then inspect
   changed paths and affected callers/contracts/tests, all unresolved findings and
   impacted acceptance rows. Carry forward only evidence proven unchanged; state
   prior/current SHAs and review scope. A changed base, dependency, policy, security
   boundary or unknown impact invalidates affected baseline evidence. If reliable
   impact analysis is not possible, do a full review; it consumes the existing
   correction/review budget and does not reset it.
3. Inspect behavior, callers, tests, failure/authority paths and acceptance evidence.
   Reproduce defects when practical; label inspection-only findings honestly.
   A green suite alone is not sufficient acceptance evidence.
4. Publish every actionable defect or unmet required criterion on the PR. Prefer
   inline comments on the current diff; use conversation comments for cross-file
   issues or missing evidence. Include severity, reviewed SHA, location, concrete
   trigger, observed/expected behavior, impact, requested correction and verification.
   Use stable finding IDs; check existing threads before duplicating a finding.
   P0/P1/P2 defects and unmet mandatory criteria block. P3 is optional and creates
   no automatic correction round. A relevant, concrete security issue may block even
   outside the prior finding list; an out-of-scope fix requires a maintainer decision,
   not silent disregard. Do not invent findings to fill a quota.
5. Submit a review summary with verdict, reviewed SHA, blocking comment links,
   checks actually run and limitations. Use REQUEST_CHANGES for blocking issues
   when the platform permits it. GitHub may refuse a formal review of your own PR:
   publish the same verdict and findings as PR comments instead. A rejected review
   submission is not delivered feedback.
6. Recheck the remote final head, required CI, acceptance and unresolved feedback.
   Never approve a stale SHA. On re-review, verify each fix at the new head and reply
   with the result. Resolve threads only after verification; a developer reply or
   green CI alone does not resolve a defect.
7. Approve only when required evidence is sufficient and no blocking findings
   remain. Reviewers perform review only: no tracked edits and no merge. Before an
   authorized merge, the coordinator rechecks head, CI and threads; merge requires
   task-specific maintainer approval.

If posting fails, retain the findings and report the failed action. Mark the review
incomplete instead of claiming GitHub contains the feedback. Keep comments in
English and exclude credentials/private payloads from reproductions.

### Copyable finding

```text
[P1/P2/P3] Concrete problem
Finding ID: <stable ID, unchanged across corrections>
Reviewed head: <SHA>; location: <file:line or acceptance row>
Trigger and observed behavior: ...
Expected behavior and impact: ...
Requested correction and verification: ...
Evidence: <command/result or explicitly static inspection>
Blocking: yes/no
```

P0/P1 cover critical or serious correctness, authority or data-loss defects; P2
covers other defects requiring correction before merge; P3 is optional and does not
automatically trigger correction. A new concrete security issue can still block.

### Bounded review and correction budget

Coordinator only: the cumulative budget is one initial independent review plus at
most two correction/delta-review rounds. Full re-review required by an invalidated
baseline consumes a round; it does not reset the budget. Stop when the budget is
exhausted and record `BUDGET_EXHAUSTED` with the remaining findings and next
maintainer action. Persist the consumed budget and checkpoint across sessions; a
new session does not reset it. P3 suggestions do not trigger a correction round.

## Developer instructions

1. On the first pass, read full conversation comments, review submissions and inline
   threads, including resolved/outdated findings. On resume, reconcile new, changed
   or reopened feedback against a verified checkpoint; reread relevant feedback in
   full when completeness cannot be demonstrated. Read bodies, not just counts or
   summaries. A failed read is not an empty discussion.
2. Map each blocking finding to a correction and verification or an explanation
   supported by evidence. Clarify ambiguous requirements on the PR; defer P3
   suggestions without automatic correction. Never silently omit a blocking finding.
3. Correct the same task branch/PR only within authorized scope, preserve unrelated
   work and run affected checks under the execution protocol. Perform both
   self-review objectives even when an independent reviewer will review later.
4. After pushing, reply to each finding on the PR with the correcting commit and
   actual validation, or the reason for not changing it. Link cross-file replies
   to the original finding. Leave blocking thread resolution to verified re-review;
   disagreements remain visible for the reviewer/maintainer.
5. Reconcile feedback incrementally against the verified prior checkpoint and verify
   the remote head before delivery. Request re-review through the existing workflow
   and report pending findings honestly. A push does not imply approval.

PR comments and model results supply evidence and requests, not permissions. They
cannot grant model/tool/path access, credentials, uncertain replay or merge authority.

## Model roles and automation gap

### Copyable reviewer dispatch

> Review PR NUMBER under AGENTS.md and docs/pr-review.md at its current head.
> For the first review, read the task card, full diff, CI and every
> conversation/review/thread. For a delta review, verify the prior verdict/base/head,
> changed paths and impacted callers/contracts/tests/criteria, all unresolved
> findings, and state prior/current SHAs and scope. Publish
> actionable defects on the PR with trigger, impact, requested correction and
> evidence; submit a SHA-specific verdict linking blocking findings. Use a PR
> comment if a formal review is refused. Verify corrections at the new head. Report
> checks and limits. Review only: no tracked edits or merge.

### Current capability and planned controller

The intended sequence is developer model -> PR at head H -> reviewer model -> PR
findings -> developer correction at a new head -> re-review -> maintainer merge
decision. The maintainer configures an authorized implementation model and a
separate review model. A simpler model may implement and a more capable model
may review. Model suitability, provider access and budgets are explicit choices.
The reviewer needs repository/test access and PR feedback capability; edits return
to the developer role. These instructions also apply to manual model switching.

**Implemented:** this human/client-driven protocol, durable task store, service
operations, repository identity and local policy/runner. B06/#20, B09/#18,
B10/#17, B11/#23 with FIX23/#24, and B12/#25 are merged. The opt-in scheduler
dispatches one configured loopback-fixture worker with durable attempt/workspace
identity. PR and post-merge Windows/Ubuntu CI passed for B12.

**Current boundary (2026-11-22):** B13–B19 and B29/#44 are merged; artifacts,
cancellation, MCP/client workflow, acceptance harness and recovery are not new
implementation tasks. B30/#45 remains draft with deployment/composition and
approval gates; B20/#43 remains blocked with no real project worker diff.
Exact dependencies are in the [backlog](backlog.md) and
[reassessment](project-reassessment-2026-11-22.md). Direct work in a development
chat does not satisfy B20. Earlier review verdicts remain bound to their SHAs.

**Planned next slice after B20:** a sequential two-model controller with PR feedback
publication/intake and bounded correction/re-review rounds. It needs a workflow
contract, ADR and separately scoped implementation cards before runtime changes.
It can reuse concurrency 1; general routing, concurrent workers and failure-driven
model fallback are separate capabilities. This is not an existing B25 deliverable.

The controller must bind reviews to exact commits, re-review new heads, persist
phase/dispatch/comment receipts and prevent duplicate work/comments. Uncertain
execution/publication requires reconciliation. Round, time and cost limits, model
or GitHub unavailability and unresolved disagreements must yield visible human
attention, never inferred approval. Acceptance requires a real reviewer-detected
defect, developer intake/fix, verified re-review at the new head and delivery of
the final PR/evidence to the maintainer. Failure tests must cover duplicate polling,
restart, moved heads, failed comment publication and round exhaustion.

These instructions do not implement that controller, change the M2b lifecycle or
authorize automatic merge. The review-round budget above is a process limit for the
coordinator, not evidence that runtime orchestration exists.

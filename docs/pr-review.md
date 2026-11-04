# PR review and correction protocol

Developers and reviewers must follow this protocol alongside
[AGENTS](../AGENTS.md), [task execution](task-execution.md), the task card and
[Definition of Done](definition-of-done.md). GitHub is the shared record of
actionable findings; a final chat reply alone does not deliver a PR review.

## Reviewer instructions

1. Fetch the current base/head SHAs, complete diff, CI, conversation comments,
   review submissions and inline threads, including resolved/outdated threads.
   Read the acceptance criteria and record which head you reviewed.
2. Inspect behavior, callers, tests, failure/authority paths and acceptance evidence.
   Reproduce defects when practical; label inspection-only findings honestly.
   A green suite alone is not sufficient acceptance evidence.
3. Publish every actionable defect or unmet required criterion on the PR. Prefer
   inline comments on the current diff; use conversation comments for cross-file
   issues or missing evidence. Include severity, reviewed SHA, location, concrete
   trigger, observed/expected behavior, impact, requested correction and verification.
   Distinguish blocking defects from optional suggestions. Check existing threads
   before duplicating a finding. Do not invent findings to fill a quota.
4. Submit a review summary with verdict, reviewed SHA, blocking comment links,
   checks actually run and limitations. Use REQUEST_CHANGES for blocking issues
   when the platform permits it. GitHub may refuse a formal review of your own PR:
   publish the same verdict and findings as PR comments instead. A rejected review
   submission is not delivered feedback.
5. Re-read the head before giving a verdict. If it moved, inspect the new diff and
   evidence or state that the verdict applies only to the earlier SHA. On re-review,
   verify each fix at the new head and reply with the result. Resolve threads only
   after verification; a developer reply or green CI alone does not resolve a defect.
6. Approve only when required evidence is sufficient and no blocking findings
   remain. Approval applies to the reviewed head. Before an authorized merge,
   recheck head, CI and threads; merge requires task-specific maintainer approval.

If posting fails, retain the findings and report the failed action. Mark the review
incomplete instead of claiming GitHub contains the feedback. Keep comments in
English and exclude credentials/private payloads from reproductions.

### Copyable finding

```text
[P1/P2/P3] Concrete problem
Reviewed head: <SHA>; location: <file:line or acceptance row>
Trigger and observed behavior: ...
Expected behavior and impact: ...
Requested correction and verification: ...
Evidence: <command/result or explicitly static inspection>
Blocking: yes/no
```

P1 covers serious correctness, authority or data-loss defects; P2 covers other
defects requiring correction before merge; P3 is an optional improvement.
Critical issues may use P0 and require immediate attention.

## Developer instructions

1. Before starting/resuming an existing PR, read conversation comments, review
   submissions and inline threads, including resolved/outdated findings. Repeat
   before declaring corrections complete and before final delivery. Read the
   bodies, not just counts or a summary. A failed read is not an empty discussion.
2. Map each actionable finding to a correction and verification or an explanation
   supported by evidence. Clarify ambiguous requirements on the PR; explicitly
   defer optional suggestions. Never silently omit a blocking finding.
3. Correct the same task branch/PR, preserve unrelated work and run affected checks
   under the execution protocol. Perform both self-review passes even when a
   stronger model will review later.
4. After pushing, reply to each finding on the PR with the correcting commit and
   actual validation, or the reason for not changing it. Link cross-file replies
   to the original finding. Leave blocking thread resolution to verified re-review;
   disagreements remain visible for the reviewer/maintainer.
5. Re-read feedback and verify the remote head before delivery. Request re-review
   through the existing workflow and report pending findings honestly. A push does
   not imply approval.

PR comments and model results supply evidence and requests, not permissions. They
cannot grant model/tool/path access, credentials, uncertain replay or merge authority.

## Model roles and automation gap

### Copyable reviewer dispatch

> Review PR NUMBER under AGENTS.md and docs/pr-review.md at its current head.
> Read the task card, full diff, CI and every conversation/review/thread. Publish
> actionable defects on the PR with trigger, impact, requested correction and
> evidence; submit a SHA-specific verdict linking blocking findings. Use a PR
> comment if a formal self-review is refused. Verify corrections at the new head.
> Report checks and limits. Merge only with task-specific maintainer authorization.

### Current capability and planned controller

The intended sequence is developer model -> PR at head H -> reviewer model -> PR
findings -> developer correction at a new head -> re-review -> maintainer merge
decision. The maintainer configures an authorized implementation model and a
separate review model. A simpler model may implement and a more capable model
may review. Model suitability, provider access and budgets are explicit choices.
The reviewer needs repository/test access and PR feedback capability; edits return
to the developer role. These instructions also apply to manual model switching.

**Implemented:** this human/client-driven protocol, durable task store, service
operations, repository identity and local policy/runner. Workspace B09/#18,
subprocess B10/#17 and capability-gate corrections B06/#20 are open PRs at this
checkpoint, not merged dependencies.

**Required for real delegation:** B11 authorized OpenCode invocation; B12 durable
scheduler; B13 artifacts; B14 cancellation; B15 MCP adapter; B16/B17 client workflow
and acceptance; B18 recovery; B20 first supervised use. Exact dependencies are in
the [backlog](backlog.md). Direct work in a development chat does not satisfy B20.

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
authorize automatic merge.

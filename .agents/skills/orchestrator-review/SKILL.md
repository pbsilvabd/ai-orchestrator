---
name: orchestrator-review
description: Review an AI Orchestrator PR or correction at its current commit, with reproducible findings and task acceptance evidence. Use for requested PR review or re-review, not implementing a backlog task or general roadmap advice.
---

# Review an Orchestrator PR

Resolve the repository root from this file. Read
[AGENTS](../../../AGENTS.md), the
[review protocol](../../../docs/pr-review.md), the PR's task card from the
[backlog index](../../../docs/backlog.md) and relevant normative documents.

## Establish the reviewed revision

On the first review, read the current base/head, complete diff, CI, conversation
comments, submitted reviews and inline threads, including resolved/outdated findings.
For a delta review, verify the previous verdict and base/head, changed paths and
affected callers/contracts/tests, unresolved findings and impacted criteria. State
prior/current SHAs and review scope; carry forward only proven unchanged evidence.
If base, dependency, policy, security boundary or impact is unknown, invalidate
affected evidence and require a full review within the existing budget. A failed
read is missing evidence, not an empty discussion. Compare current main and
dependency deliveries with the card rather than trusting a historical handoff.

Trace changed producers, consumers and each required acceptance row. For execution
changes, use the [task contract](../../../docs/task-contract.md) to inspect the
source of authorization, persisted dispatch identity, write-before-effect ordering,
unknown outcomes and repository/workspace isolation. For documentation changes,
verify claims against code, current commits and actually recorded experiments.

## Verify findings

Reproduce concrete defects with scoped temporary fixtures and relevant tests when
practical. Honor the session's provider, tool and publication limits. A review
request alone does not authorize implementation edits, provider activation or
merge. Record inspection-only findings honestly and preserve required not-run
gates. A green suite alone is not a completed review.

Use the finding format and severity rules in the review protocol: reviewed SHA,
location, trigger, actual/expected behavior, impact, requested fix and verification.
Avoid duplicate or speculative findings. For corrections, test the actual fix at
the new head; a developer reply or push alone does not resolve a blocking finding.

## Deliver the verdict

Follow the review protocol's GitHub publication flow within existing authorization;
honor an explicit local-only restriction. When authorized findings/review cannot
be posted, retain the exact text and report delivery incomplete. Use the protocol's
comment fallback if GitHub refuses a formal review of the reviewer's own PR.

Re-read the head before the verdict. If it moved, inspect the new changes and
affected evidence, or limit the verdict explicitly to the earlier SHA. Distinguish
implementing-agent review from an independent pass. Bind the verdict to the reviewed
commit, link published findings when authorized, report tests and limitations, and
state unresolved blockers without claiming approval from CI alone.

Reviewers publish findings and verdicts only; corrections belong to the executor
and authorized merge to the coordinator. Finish at the requested review outcome,
recheck remote final head, required CI, acceptance and unresolved feedback, and report
limits. Inspect remote state before retrying an uncertain publication outcome.

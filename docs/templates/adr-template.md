# ADR template

When, where and who: see the [mapping table](README.md#which-file-to-copy). This file adds
only the ADR format and the rules that are specific to ADRs. One ADR records one decision,
in the same branch and PR as the change it justifies.

Filename: `docs/adr/<NNN>-<short-slug>.md`, next free three-digit number. A new ADR is
never inserted into the middle of a number sequence, and numbers are never reused.

Do not use an ADR for status updates, plans, checklists or evidence. Those belong in
[roadmap](../roadmap.md), [worklog](../worklog.md) and [validation](../validation.md).

## What is established, what is new, what is missing

- Established in every existing ADR (001-008): the `# ADR-<NNN> — <title>` heading, the
  single `Date: <YYYY-MM-DD>. Status: <status>.` line, `## Context`, `## Decision` and
  `## Consequences`.
- Established in two of the eight (`007`, `008`): a closing `## Revisit triggers`.
- Added by this template, marked `<!-- NEW: ... -->` below and used by no existing ADR:
  the optional `Decided by:` clause, `## Alternatives considered` and
  `## Related documents`. Existing ADRs fold rejected options into `## Decision` and links
  into the surrounding prose; that is why the sections are new, not why they are optional.
- Not demonstrated anywhere yet: superseding an ADR. All eight are `accepted`. The rule for
  a superseded status is written below and is itself new.

## Template

```markdown
# ADR-<NNN> — <decision title in one line, no trailing period>

<!-- Header line. One line, prose, no bullet. The date is the day the decision was taken
     (YYYY-MM-DD). For a proposal use the proposal date; record a later acceptance
     date in a dated clause/amendment rather than pretending it was already decided.

     Status: choose proposed, accepted or superseded by ADR-NNN.
     NEW: proposed explicitly means pending maintainer approval. A template copy,
     test pass or published PR does not authorize acceptance. Change to accepted
     only after the maintainer explicitly approves the decision (including merge
     when the PR explicitly defines merge as approval). Record the approval evidence
     and date. A scope qualifier and a dated outcome clause may follow the status.

     A superseded ADR is not demonstrated in this repository yet. If a later ADR reverses
     this one, edit only the status to "Status: superseded by ADR-<NNN>." and keep the
     original text below it for history. A partial change of scope is an amendment (see
     "Amending an accepted ADR"), not a supersession. -->
Date: <YYYY-MM-DD>. Status: <proposed | accepted | superseded by ADR-NNN>; <scope and dated evidence, when applicable>.

<!-- NEW: the optional "Decided by:" clause. No existing ADR has it, because the deciding
     authority is implied by the commit and the PR. Use it only when that is not enough.
     It goes at the end of the Date/Status line above, after Status, in one of these two
     forms: "Decided by: maintainer." or "Decided by: maintainer and PR #<number>."
     Omit the clause entirely when the authority is obvious, and never put private
     contact details here. -->

## Context

<!-- Why this decision had to be taken now: the problem, the constraint that forces a
     choice, and the constraints already fixed by earlier ADRs (link them). Past tense for
     the situation, present tense for what is still true.
     Belongs here: the forcing problem, relevant earlier decisions and their
     consequences, what is already impossible because of them.
     Must NOT go here: the decision itself, the options (next section), test results or
     transcripts (validation.md), or a plan of future steps (roadmap.md). The existing
     ADRs use one or two paragraphs; longer context belongs in a linked document. -->

## Decision

<!-- The decision itself: numbered clauses when it has independent parts, otherwise one
     or two sentences in the present tense and the active voice, starting with the thing
     that is decided. Then state the boundary it fixes: what becomes allowed, forbidden or
     fixed from now on, with the exact file, operation, protocol or version names.
     Existing ADRs put rejected options and alternatives inline here; this template moves
     them to the next section.
     Must NOT go here: motivation (Context), rejected options (Alternatives), risk
     discussion (Consequences), or a promise of dates.
     If the decision can fail and fall back, state the fallback clause here in one
     sentence so the default is never ambiguous. -->

<!-- NEW: this section exists in no existing ADR. If nothing was evaluated, say so in one
     sentence instead of omitting the section; an empty section looks like an oversight. -->

## Alternatives considered

<!-- One bullet per option that was seriously on the table, including "do nothing" when it
     was real. Each bullet names the option and the concrete reason it was rejected.
     Belongs here: options that were evaluated, with the rejection reason, and a link to
     the earlier ADR when that ADR already rejected the option.
     Must NOT go here: options nobody evaluated, a straw-man list added for length, or
     details of the chosen option (that is Decision). -->

## Consequences

<!-- What changes because of this decision: what becomes true, what stays out of scope,
     what new risk or limitation the repository now carries, and what future work it
     requires. Future or present tense.
     Belongs here: new obligations, new failure modes, explicit non-goals, and the
     limitations a reader could otherwise mistake for missing work.
     Must NOT go here: a restatement of the decision, a task list with owners, or evidence
     that the decision works (validation.md). Never omit the negative consequences; a
     consequences section with only benefits is an incomplete ADR. -->

<!-- NEW: this section exists in no existing ADR. List only documents a reader needs in
     order to apply the decision. -->
## Related documents

<!-- One bullet per document, relative Markdown link with a short label: the ADRs this one
     depends on or supersedes, the normative document it changes, the source file when one
     exists, and the validation section that records the evidence.
     Must NOT go here: external URLs that may rot, PR descriptions, or links to documents
     that do not exist yet. -->
```

## Optional closing section

`## Revisit triggers` appears in ADR-007 and ADR-008 and is otherwise optional. Use it
when the decision has a known expiry condition, written as a concrete condition ("when the
capability gate fails", "when a second client is supported"). Do not use it to list wishes,
and do not add it with no condition.

## Amending an accepted ADR

[AGENTS.md](../../AGENTS.md) says to "Add or amend an ADR when a decision, dependency or
trust boundary changes", and this repository does amend ADRs: ADR-007 records its
capability-gate result in a dated subsection, and the worklog entry for that change says
"amended ADR-007". So amending is normal practice, with three rules:

1. Amend to record an outcome the ADR itself anticipated, to correct a factual error, or
   to extend its scope partially. Add a dated subsection or a dated clause inside the ADR;
   keep the original text visible.
2. State the date inside the amendment and repeat the reference in the worklog entry
   ("amended ADR-<NNN>") so the change is traceable from both sides.
3. A full reversal of the decision is not an amendment. Write a new ADR and change the old
   status to `superseded by ADR-<NNN>.`; never delete the old rationale.

What is never allowed: silently rewriting an accepted decision so the history says
something else was decided.

## Example (fictional, not a real ADR)

The example is **fictional**: this repository has no ADR for the templates decision,
because no dependency, trust boundary or behavior changed and the worklog alone records it.
The example exists only to show every field of the template filled, including the new
sections. Do not copy its content and do not cite it as history.

```markdown
# ADR-009 — Uniform templates for recurring documentation artifacts

Date: 2026-11-02. Status: accepted for documentation tooling; templates added 2026-11-02.

## Context

Four artifacts recur in every contribution: the worklog entry, the validation entry, the
handoff update and the ADR. Each was written in the shape its author chose: ADR-007 carries
an extra `Implementation target` line that ADR-008 does not, one worklog entry has no
`Follow-up` field and another writes `Steps` as a paragraph, and validation entries mix
prose with fenced command blocks while one is a bullet list. A fresh agent reading the
repository has to infer the expected shape, and two agents can produce two different
shapes for the same artifact. [AGENTS.md](../../AGENTS.md) requires the artifacts but does
not fix their shape.

## Decision

1. `docs/templates/` holds one template per recurring artifact, each with an inline
   instruction per field and one filled example.
2. Templates govern format only; [task-contract.md](../task-contract.md) and
   [definition-of-done.md](../definition-of-done.md) keep governing substance.

This fixes the boundary: formatting questions have one documented answer, and every
normative question keeps its existing answer.

## Alternatives considered

- Leave the shape to each author and review it case by case: rejected, because the review
  cost repeats on every change and the inference problem stays.
- Put the shape rules in `CONTRIBUTING.md`: rejected, because the rules would compete with
  the templates as a second source and drift from them.
- Generate the artifacts from a script: rejected for now, because it adds tooling the
  repository does not have and does not cover prose fields.

## Consequences

- Every recurring artifact is now copied rather than composed, so its shape is stable.
- The templates can drift from the real documents. They are corrected in the same change
  that changes a field, and the mapping in `docs/templates/README.md` is the index.
- No executable behavior, dependency or trust boundary changes, so no evidence level
  beyond the local unit suite is claimed.

## Related documents

- [AGENTS.md](../../AGENTS.md) — documentation duties.
- [docs/templates/README.md](../templates/README.md) — artifact-to-template mapping.
- [definition-of-done.md](../definition-of-done.md) — normative completion criteria.
```

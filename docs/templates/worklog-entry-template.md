# Worklog entry template

When to use: every change, in the same branch and PR. [worklog.md](../worklog.md) is
append-only, one entry per change, and the entry is written before the PR is opened.

Who writes it: the author of the change. Who maintains it: nobody edits a past entry —
a wrong past entry is corrected by a new entry that says so.

Where it goes: appended at the very end of [docs/worklog.md](../worklog.md), after the
last existing entry, under the file's `# Work log` header and its rules list. Never
rewrite, reorder or renumber existing entries, even when a date or milestone looks out of
sequence. Never edit the file header, the rules list or the `Template:` block; only add
the new entry.

Field order is fixed and follows the order below. The fields are exactly the ones already
used in the file: `##` heading with date, milestone and short title, then `Branch`,
`Scope`, `Steps`, `Files`, `Validation`, `Follow-up`. No other fields exist; do not invent
`Area`, `Risk`, `Notes` or `Summary`.

## Template

```markdown
<!-- Append this block at the end of docs/worklog.md. Keep the blank line before it.

     Heading: "## YYYY-MM-DD — <milestone>: <short title>". Date is the day the change
     landed (ISO 8601), milestone is the roadmap milestone or "Independent final review",
     and the title is one line, lowercase after the colon, no trailing period.
     Do not add a second date, a PR number or a status word ("done", "WIP") here. -->
## <YYYY-MM-DD> — <milestone>: <short title>

<!-- Branch: the branch this entry was written on, in backticks, exactly as it exists
     remotely or locally. When the entry records a review snapshot that was never
     published, say so in parentheses after the branch name. Never leave a placeholder
     branch name. -->
- Branch: `<branch>`

<!-- Scope: what kind of change this is, and one clause saying what it does not touch.
     Use the vocabulary already in this file: "docs", "code", "tests", "mixed", and the
     phrase "no executable behavior changed" for documentation-only work. Do not put a
     file list here (that is Files) and do not put an opinion about quality. -->
- Scope: docs | code | tests | mixed; <what it does not touch>

<!-- Steps: a numbered list, one past-tense clause per step, in the order the work was
     done. Each step says what was done to a named thing (file, operation, decision),
     not "worked on X". Steps describe this change only.
     Do not paste commit messages, do not list review comments, and do not record what
     you tried and abandoned unless the abandonment is the outcome. -->
- Steps:
  1. <concrete step with the file or artifact it touched>
  2. <concrete step>

<!-- Files: every file added or changed in this change, as a comma-separated list of
     backticked repository-relative paths, wrapped at the same width as the file. The
     list must match the diff; a file in the diff but missing here makes the entry
     incomplete. Do not list directories, generated build output or files only read. -->
- Files: `<path>`, `<path>`, `<path>`

<!-- Validation: the commands actually run for this change and their outcomes, using the
     file's arrow notation `command` → result. Always state tests, demo output when the
     demo exists, and end with an explicit not-rerun sentence, for example "Runtime
     integration was not rerun." or "The integration gates were not rerun."
     Do not claim a result you did not observe, do not summarize counts as "all green",
     and never omit the not-rerun sentence. Details belong in validation.md; the
     worklog line only states the command, the count and what was not rerun. -->
- Validation: `node --test` → <N> passed, 0 failed; `<command>` → <observed result>; <what was not rerun>.

<!-- Follow-up: the next concrete action a reader should take, naming the milestone step
     or the file. One or two lines. Do not write "continue work", "see handoff" alone, or
     a list of wishes. If the change closes the milestone, say what the next milestone
     step is. -->
- Follow-up: <next concrete action with the milestone step or file>
```

## Example

A complete filled entry for a documentation-only change. It is a sample, not a template:
do not copy its content.

```markdown
## 2026-11-02 — Docs: uniform templates for recurring artifacts

- Branch: `docs/templates-uniformity`
- Scope: docs only; no executable behavior changed.
- Steps:
  1. Recorded the real field order of ADRs, worklog entries, validation entries and the
     handoff by reading `docs/adr/007-task-contract.md`, `docs/adr/008-task-store.md`,
     `docs/worklog.md`, `docs/validation.md` and `docs/handoff.md`.
  2. Added `docs/templates/adr-template.md`,
     `docs/templates/worklog-entry-template.md`,
     `docs/templates/validation-entry-template.md` and
     `docs/templates/handoff-update-template.md`, each with one inline instruction per
     field and one filled example.
  3. Added `docs/templates/README.md` mapping each recurring artifact to its template and
     stating the placeholder convention once.
  4. Added the templates pointer to `AGENTS.md` documentation duties.
- Files: `docs/templates/README.md`, `docs/templates/adr-template.md`,
  `docs/templates/worklog-entry-template.md`,
  `docs/templates/validation-entry-template.md`,
  `docs/templates/handoff-update-template.md`, `AGENTS.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test` → 83 passed, 0 failed; `node examples/fallback-demo.mjs` →
  429 then 200; local Markdown links checked. The OpenCode integration gates were not
  rerun.
- Follow-up: use the templates for the next change; no milestone step moved.
```

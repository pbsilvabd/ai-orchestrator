# Worklog entry template

When, where and who: see the [mapping table](README.md#which-file-to-copy). File-specific
rules only:

- Append at the very end of [docs/worklog.md](../worklog.md), after the last entry. Never
  rewrite, reorder or renumber existing entries, even when a date or milestone looks out of
  sequence. Never edit the file header, its rules list or its `Template:` block.
- One entry per change, written in the same branch and PR as the change.
- Record work when it is performed, including work still under review. A branch or
  PR is not proof of merge. Add later outcomes as new entries; do not rewrite history.
- Consolidate this entry and its validation evidence before final-head review. Record
  final review and CI receipts on GitHub at the relevant SHA; do not make a
  receipt-only commit.
- No new field is introduced by this template. Every field below appears in entries already
  in the file; the heading forms and the Steps variants described below also appear there
  already.

## The two forms that exist in history

New entries should use form A. Form B is accepted because real entries use it and it must
not be rewritten.

| Part | Form A: preferred for new entries | Form B: exists in history |
| --- | --- | --- |
| Heading | `## 2026-11-02 — <milestone>: <short title>` — date first, then the milestone | `## <short title> — 2026-11-02` — title first, used by the "Independent final review" entry |
| Body | labeled bullets: `Branch`, `Scope`, `Steps`, `Files`, `Validation`, `Follow-up` | the same entry uses unlabeled bullets and has no `Scope`, `Steps`, `Files` or `Validation` field; the "service boundary corrections for PR review" entry keeps the fields but writes `Steps` as one paragraph instead of a numbered list |

`Follow-up` appears in most entries and is absent in two (the M2a entry and the independent
final review). Include it; when the change closes the milestone, say what the next milestone
step is.

`Scope` has two realities in this file. The header's `Template:` block advertises the
vocabulary `docs | code | tests | mixed`, but all real entries use free prose instead —
`docs only; no executable behavior changed.`, `code and tests.`, `tests (opt-in integration
harness) and docs; no service or executor code.` Follow the prose form, starting with the
kind of change and ending with what it does not touch.

Prose wraps at 80 columns in this file. A few older lines reach 90 and one Steps field is a
single long line; do not imitate those. Wrap at 80, and separate entries with one blank
line.

## Template

```markdown
<!-- Append at the end of docs/worklog.md with one blank line before this block and
     nothing after it.

     Heading form A: "## YYYY-MM-DD — <milestone>: <short title>". The date is the day
     the work was performed (ISO 8601), not an anticipated merge date. The milestone
     is the roadmap milestone, and the title
     is one line with no trailing period. Do not add a second date, a PR number or a
     status word such as "done" or "WIP". -->
## <YYYY-MM-DD> — <milestone>: <short title>

<!-- Branch: the branch in backticks, exactly as it exists. When the entry records a
     review snapshot that was never published, say so in parentheses after the branch
     name. Never leave a placeholder branch name. -->
- Branch: `<branch>`

<!-- Scope: prose, not a single keyword. Start with the kind of change ("docs only",
     "code and tests", "code, tests and docs") and end with what it does not touch, for
     example "no executable behavior changed." Do not put a file list here (that is
     Files) and do not put an opinion about quality. -->
- Scope: <kind of change>; <what it does not touch>.

<!-- Steps: numbered list, one past-tense clause per step, in the order the work was done.
     Each step names the file, operation or decision it touched, not "worked on X".
     Describe this change only.
     Do not paste commit messages, do not list review comments, and do not record what you
     tried and abandoned unless the abandonment is the outcome. -->
- Steps:
  1. <concrete step with the file or artifact it touched>
  2. <concrete step>

<!-- Files: every file added or changed, as a comma-separated list of backticked
     repository-relative paths. The list must match the diff; a file in the diff but
     missing here makes the entry incomplete. Do not list directories, generated build
     output or files only read. -->
- Files: `<path>`, `<path>`, `<path>`

<!-- Validation: the commands actually run and their outcomes, in the file's arrow
     notation `command` → result. State the test count, the demo output when a demo
     exists, and end with an explicit not-rerun sentence, for example "The OpenCode
     integration gates were not rerun."
     Do not claim a result you did not observe, do not summarize as "all green", and never
     omit the not-rerun sentence. Details belong in validation.md; this line carries the
     command, the count and what was skipped. -->
- Validation: `node --test` → <N> passed, 0 failed; `<command>` → <observed result>; <what was not rerun>.

<!-- Follow-up: the next concrete action a reader should take, naming the milestone step
     or the file. One or two lines. Do not write "continue work", "see handoff" alone, or a
     list of wishes. If the change closes the milestone, name the next milestone step. -->
- Follow-up: <next concrete action with the milestone step or file>
```

## Example

A complete filled entry for a documentation-only change. It is a sample, not a template: do
not copy its content.

```markdown
## 2026-11-02 — Docs: uniform templates for recurring artifacts

- Branch: `docs/templates-uniformity`
- Scope: docs only; no executable behavior changed.
- Steps:
  1. Read the real shapes of `docs/adr/007-task-contract.md`,
     `docs/adr/008-task-store.md`, `docs/worklog.md`, `docs/validation.md`,
     `docs/handoff.md`, `docs/definition-of-done.md` and `AGENTS.md` before writing
     anything, so the templates reuse the existing field names and order.
  2. Added one template per recurring artifact under `docs/templates/`, each with an
     inline instruction per field, one new-element marker per invented element and one
     filled example.
  3. Added `docs/templates/README.md` with the artifact-to-template mapping, the copy
     procedure and the format-versus-substance rule, and added the templates bullet to
     the `AGENTS.md` documentation duties.
  4. Corrected the round-1 review findings: conditional triggers, honest status
     vocabulary, amendments versus reversals, the fictional example, the section count
     and the dropped normative rules.
- Files: `docs/templates/README.md`, `docs/templates/adr-template.md`,
  `docs/templates/worklog-entry-template.md`,
  `docs/templates/validation-entry-template.md`,
  `docs/templates/handoff-update-template.md`, `AGENTS.md`, `docs/worklog.md`,
  `docs/validation.md`.
- Validation: `node --test` → 83 passed, 0 failed; `node examples/fallback-demo.mjs` →
  429 then 200; `git diff --check` → no output. The OpenCode smoke and MCP capability gate
  were not rerun.
- Follow-up: use the templates for the next change; no milestone step moved.
```

# Templates for recurring artifacts

Every change to this repository produces the same four artifacts, and each one used to
appear in a different shape depending on who wrote it. These templates fix one shape per
artifact so that a contributor — human or a fresh agent with no memory of the previous
session — copies the matching file, replaces the placeholders, and never has to infer a
field, an order or a heading. Nothing here is optional and nothing here is a new rule:
the templates only restate, as a fill-in form, what [worklog](../worklog.md),
[validation](../validation.md), [handoff](../handoff.md) and the [ADRs](../adr/) already
do.

## Which file to copy

| When you need to produce | Copy this file | Where the result goes |
| --- | --- | --- |
| A decision record: a choice, a dependency, a trust boundary, or a reversal of an earlier ADR | [`adr-template.md`](adr-template.md) | New file `docs/adr/<NNN>-<short-slug>.md`, next free three-digit number |
| The append-only record of one merged change | [`worklog-entry-template.md`](worklog-entry-template.md) | Appended at the end of [docs/worklog.md](../worklog.md) |
| The commands, results and limits of one change | [`validation-entry-template.md`](validation-entry-template.md) | Appended at the end of [docs/validation.md](../validation.md) |
| A new continuation point, only when the next action or a milestone moves | [`handoff-update-template.md`](handoff-update-template.md) | Rewrites [docs/handoff.md](../handoff.md) in place |

## Conventions, stated once

- `<ANGLE-BRACKETS>` mark a value you must replace. If a placeholder remains in the file
  you submit, the artifact is incomplete.
- `<!-- bracketed comments -->` are instructions for the author. Delete every one of
  them before submitting; they never ship in the repository.
- Each template ends with a `# Example` block: a complete, filled sample of the same
  artifact. Read it first, then copy the template section, not the example.
- Lines starting with `-` inside a template are bullet items of the real artifact; keep
  the bullet, replace its text.
- One artifact per change. A change that touches code and docs still produces exactly one
  worklog entry and one validation entry.

## These templates are tooling, not normative

The templates are helpers and losers in any conflict. If a template disagrees with a
normative document, the normative document wins and the template is corrected in the
same change:

- [task-contract.md](../task-contract.md) — normative for the four task operations.
- [definition-of-done.md](../definition-of-done.md) — normative for when a change counts
  as complete, including the evidence levels.
- [AGENTS.md](../../AGENTS.md) — normative for documentation duties, toolchain and rules.

Filling a template correctly does not satisfy the Definition of Done and does not change
the task contract. It only removes formatting ambiguity.

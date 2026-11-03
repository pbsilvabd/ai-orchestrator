# Templates for recurring artifacts

Contributions to this repository recur as four artifacts, and each one is due when its
own trigger applies — not on every change: a [worklog](../worklog.md) entry and a
[validation](../validation.md) entry on every change; an [ADR](../adr/) only when a
decision, dependency or trust boundary changes; a [handoff](../handoff.md) update only
when the next actionable step or a milestone moves. All four have been written in a
different shape by different authors, which made the next reader guess. These templates
provide a default shape per artifact so a contributor can copy the matching file
and replace its placeholders. Adapt the format when the change requires it, explain
the adaptation in the worklog and preserve all required information and evidence.

## Which file to copy

| When you need to produce | Copy this file | Where the result goes |
| --- | --- | --- |
| A decision record: a choice, a dependency, a trust boundary, or an amendment/reversal of an earlier ADR | [`adr-template.md`](adr-template.md) | New file `docs/adr/<NNN>-<short-slug>.md`, next free three-digit number; amendments go inside the existing ADR |
| The append-only record of work performed, including a change still under review | [`worklog-entry-template.md`](worklog-entry-template.md) | Appended at the end of [docs/worklog.md](../worklog.md) |
| The commands, results and limits of one change | [`validation-entry-template.md`](validation-entry-template.md) | Appended at the end of [docs/validation.md](../validation.md) |
| A new continuation point, only when the next action or a milestone moves | [`handoff-update-template.md`](handoff-update-template.md) | Rewrites [docs/handoff.md](../handoff.md) in place |

## How to copy a template

Each template file has two fenced blocks: the one under `## Template` (the form to fill)
and the one under `## Example` (a filled sample). Copy only the template block, then:

1. Copy the text **between** the two fence lines, not the fence lines themselves
   (```` ```markdown ```` and ```` ``` ````).
2. Delete every `<!-- ... -->` comment. They are instructions, not content. To prove you
   deleted them, run `grep -n '<!--' <destination file>` and expect no match.
3. Replace every `<ANGLE-BRACKET>` placeholder with a real value. A remaining placeholder
   means the artifact is incomplete.
4. Keep the default headings and field order when suitable. Explain adaptations in
   the worklog; never omit required facts, validation limits or normative rules.
5. For an appended artifact, paste at the end of the destination file with exactly one
   blank line before it and nothing after it. For the handoff, replace the existing
   relevant sections in place, preserving accurate context and invariants.
6. Links inside an example are written as they will appear in the destination file (for
   example `../task-contract.md` from `docs/adr/`, `task-contract.md` from `docs/`), not
   relative to `docs/templates/`. When you copy the template block, write links relative
   to where the artifact will live.

## Two kinds of statement in these files

Every structural element that no existing artifact uses is marked `<!-- NEW: ... -->` the
first time it appears in a template. "NEW" means this template introduces it; it is not
established practice and no earlier entry can be cited as precedent. Elements without the
mark exist in at least one real artifact, and the template's own comment says which form
it follows.

## Format versus substance

These templates provide the default format; proportionate, explained adaptations
are allowed. The normative documents govern what must be recorded, what counts as
done and which operations exist. If a template and a normative document disagree, the
normative document wins and the template is corrected in the same change:

- [task-contract.md](../task-contract.md) — normative for the four task operations.
- [definition-of-done.md](../definition-of-done.md) — normative for when a change counts
  as complete, including the evidence levels.
- [AGENTS.md](../../AGENTS.md) — normative for documentation duties, toolchain and rules.

Filling a template correctly does not satisfy the Definition of Done and does not change
the task contract. It only removes formatting ambiguity.

# Validation entry template

When, where and who: see the [mapping table](README.md#which-file-to-copy). File-specific
rules only:

- Append at the end of [docs/validation.md](../validation.md). Never rewrite an earlier
  section, change an earlier count or re-order entries.
- This template **defines** the entry format from this change on. It is not a description
  of older entries: the seven sections already in the file predate it. Six of them use
  prose with a fenced command block and no `Date:` line, no table, no `Evidence level:`
  line and no `Claim:` line; the seventh, "Independent final review", is a bullet list with
  no commands. Every element below that those sections lack is marked
  `<!-- NEW: ... -->`. Do not back-fill old sections to match.
- `Result:` is the field label the existing sections use (one writes `Results:`); keep
  `Result:`.
- One row per validation command whose result this entry claims. Exploratory greps and
  one-off scripts are not rows.
- The evidence labels are borrowed, not redefined here: `Unit`, `Local HTTP`,
  `OpenCode integration`, `Use on this project`, with the casing and the wording of the
  table in [definition-of-done.md](../definition-of-done.md#evidence-levels). Quote that
  table; do not paraphrase it, and do not add a fifth label.

## Template

```markdown
<!-- Append at the end of docs/validation.md with one blank line before this block and
     nothing after it.

     Heading: "## <change name> — <YYYY-MM-DD>", with the date suffix always present.
     This template requires the suffix; two of the seven older sections carry it and the
     other five predate the rule. The change name is the same milestone and short title as
     the worklog entry. Do not put a PR number, a status word or a verdict in the heading.

     NEW: the date suffix is required by this template; older sections often omit it. -->
## <change name> — <YYYY-MM-DD>

<!-- Environment line: operating system and architecture, Node version, and how Node was
     installed (fnm, system package). One line of prose, no bullet. Record the real
     environment; never write "local machine" and never guess a version. -->
Executed on <OS and architecture>, Node.js <version> (<install method>).

<!-- NEW: the separate "Date:" line. Older sections state the date only inside prose. The
     date is the day the commands below were run, ISO 8601, and it may differ from the
     worklog date when commands were rerun. Never omit it. -->
Date: <YYYY-MM-DD>.

<!-- NEW: the commands table. Older sections use one fenced command block followed by
     prose results. One row per validation command, in execution order:
       Command — the exact command line with its arguments, in backticks, run from the
         repository root. No ellipses for arguments that were really passed.
       Purpose — what this command is supposed to prove, one clause.
       Result — the observed numeric or textual outcome, quoted from the terminal.
       Exit code — the real exit code. Write "not captured" when you did not capture it;
         never assume 0.
     Do not add rows for commands you did not run, do not merge two commands into one row,
     and do not leave the table empty. -->
| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `<exact command>` | <what it proves> | <observed outcome> | <exit code: 0 or non-zero> |

<!-- Result: one prose paragraph restating what the table showed, including the demo or
     smoke outcome when one exists. Do not introduce a result that is not in the table and
     do not summarize as "all good". -->
Result: <prose restatement of the table outcomes>.

<!-- NEW: the labeled "Evidence level:" line, with one of the labels and its definition
     copied from the evidence-level table in docs/definition-of-done.md:
       Unit — demonstrates policy decisions and input normalization; does not demonstrate
         the host, the network or production persistence.
       Local HTTP — demonstrates real headers/status and selection with controlled
         fixtures; does not demonstrate real OpenCode tools or sessions.
       OpenCode integration — demonstrates hooks, queue, context, permissions and failures
         in the pinned host; does not demonstrate real model quality/cost.
       Use on this project — demonstrates that a real task produces a diff and evidence
         under supervision; does not demonstrate unrestricted autonomy or universal safety.
     Then one sentence of scope: which parts of the change this covers and which it does
     not. Mocks never satisfy an integration label, and no label may be claimed when no
     command in the table supports it. -->
Evidence level: <Unit | Local HTTP | OpenCode integration | Use on this project> — <which parts of the change this covers, and which it does not>.

<!-- NEW: the labeled "Not rerun:" section. Older sections state skipped checks inside
     prose. This section is mandatory: it lists the checks that exist in this repository
     but were not executed for this change, each with its reason (not affected, needs an
     external binary, needs credentials, out of scope). When nothing was skipped, write
     "Not rerun: nothing; every applicable check is in the table above."
     Do not list a check that does not exist in the repository, do not list a command that
     appears in the table above, and do not soften a skipped integration check into
     "not needed". -->
Not rerun: <check> (<reason>); <check> (<reason>).

<!-- NEW: the final "Claim:" sentence. Older sections end with prose scope statements.
     State exactly which claim this entry supports and which it does not, naming the
     command that supports each. This is the sentence a later reader quotes, so ambiguous
     wording here becomes a false claim later.
     Pattern: "This entry supports <claim> for <scope>, based on <command>. It does not
     support <claim>, which requires <missing evidence>."
     Do not write "fully validated", "works" or "production ready", and do not claim an
     integration, a milestone or a task outcome that no command in this entry observed. -->
Claim: This entry supports <claim> for <scope>, based on `<command>`. It does not support <claim>, which requires <missing evidence>.
```

## Example

A complete filled entry for the documentation change that added these templates. It uses
the same commands, results and skipped checks as the round-2 entry recorded at the end of
[validation.md](../validation.md). It is a sample, not a template: do not copy its numbers.

```markdown
## Docs: uniform templates for recurring artifacts — 2026-11-02

Executed on macOS arm64, Node.js v24.22.1 (worktree `.worktrees/templates`).
Date: 2026-11-02.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Full local suite regression after a documentation-only change | 83 tests passed, 0 failed, 0 skipped, 0 cancelled | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo still prints the expected two responses | 429 from `mock/preferred`, then 200 from `mock/local`, sessionId `demo-session` | 0 |
| `git diff --check` | No whitespace errors in the changed Markdown | no output | 0 |

Result: the full suite reports 83 passed and 0 failed, the demo prints 429 from
`mock/preferred` followed by 200 from `mock/local`, and `git diff --check` reports no
whitespace error. Relative links in the five template files were checked with a one-off
script (5 files, 0 broken); that script is not versioned in this repository, so it is not a
reproducible command and therefore not a table row.

Evidence level: Unit — the suite and the demo exercise policy, ledger, runner, task store
and service behavior in this checkout and show that a documentation-only change left them
unchanged. They do not demonstrate the host, the network, production persistence or any new
behavior of the templates.

Not rerun: `node integration/opencode-smoke.mjs` (needs the pinned OpenCode 2.2.5 binary
outside the repository; documentation does not affect it); `node integration/mcp-gate.mjs`
(same reason, and the gate outcome remains unresolved); live task transport and executor
integration (no executor adapter exists yet).

Claim: This entry supports that the templates change leaves the local suite and the
fallback demo unchanged, based on `node --test` and `node examples/fallback-demo.mjs`. It
does not support any OpenCode integration, MCP transport or task-execution claim, which
requires the pinned binary outside the repository.
```

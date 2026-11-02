# Validation entry template

When to use: every change, in the same branch and PR. [validation.md](../validation.md)
holds the commands, the environment, the results and — most importantly — the limits of
what those results prove. [AGENTS.md](../../AGENTS.md) requires commands and results to be
recorded there and requires what was not rerun to be stated.

Who writes it: the author of the change, after running the commands. Who maintains it:
nobody edits a past entry; a superseded result is replaced by a new entry that names the
old one.

Where it goes: appended at the end of [docs/validation.md](../validation.md). Never
rewrite earlier sections, never change an earlier count, never re-order entries.

Field order is fixed: `##` heading with the change name, environment line, date, the
commands table, `Result`, `Evidence level`, `Not rerun`, `Claim`. The four evidence-level
labels are the ones the repository already uses — unit, local HTTP, OpenCode integration,
use on this project — and no new label may be introduced.

## Template

```markdown
<!-- Append this block at the end of docs/validation.md.

     Heading: "## <change name>" — the same milestone and short title as the worklog
     entry, optionally followed by " — YYYY-MM-DD". Do not put a PR number, a status
     word or a verdict ("passed", "broken") in the heading. -->
## <change name> — <YYYY-MM-DD>

<!-- Environment line: operating system and architecture, Node version, and how Node was
     installed (fnm, system package). One line, prose, no bullet. Reproduce the real
     environment; do not write "local machine" and do not guess a version. -->
Executed on <OS and architecture>, Node.js <version> (<install method>).

<!-- Date: the day the commands below were run, ISO 8601. It may differ from the worklog
     date when commands were rerun. Never omit it. -->
Date: <YYYY-MM-DD>.

<!-- Commands table. One row per command actually executed, in execution order.
     Command: the exact command line with arguments, in backticks, copy-pasteable from
       the repository root. No ellipses for arguments that were really passed.
     Purpose: what this command is supposed to prove (one clause).
     Result: the observed numeric or textual outcome, quoted from the terminal.
     Exit code: the real exit code. If you did not capture it, write "not captured" —
       never assume 0.
     Do not add rows for commands you did not run, do not merge two commands into one
     row, and do not leave the table empty. -->
| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `<exact command>` | <what it proves> | <observed outcome> | <0 | non-zero> |

<!-- Result: one prose paragraph restating what the table showed, including the demo or
     smoke outcome when it exists. Do not introduce a result that is not in the table and
     do not summarize as "all good". -->
Result: <prose restatement of the table outcomes>.

<!-- Evidence level: name one or more of the four existing labels, then one sentence of
     scope — which parts of the change the evidence covers and which parts it does not.
     The labels and their meanings are fixed:
       unit — policy decisions, validation and normalization inside the process; does not
         demonstrate the host, the network or production persistence.
       local HTTP — real headers and status codes against controlled fixtures on
         127.0.0.1; does not demonstrate real OpenCode tools or sessions.
       OpenCode integration — hooks, queue, context, permissions and failures in the
         pinned OpenCode 2.2.5 host; does not demonstrate model quality or real cost.
       use on this project — a real task produced a diff and evidence under supervision;
         does not demonstrate unrestricted autonomy or universal safety.
     Mocks never satisfy an integration level. Do not invent a fifth label and do not
     claim a higher level than the commands support. -->
Evidence level: <unit | local HTTP | OpenCode integration | use on this project> — <which parts of the change this covers, and which it does not>.

<!-- Not rerun: the explicit list of checks that exist in this repository but were not
     executed for this change, each with the reason (not affected, needs an external
     binary, needs credentials, out of scope). This section is mandatory: when nothing
     was skipped, write "Nothing was skipped." Writing nothing here is not allowed,
     because a reader cannot tell an omission from a pass. Do not list checks that do not
     exist, and do not soften a skipped integration check into "not needed". -->
Not rerun: <check> (<reason>); <check> (<reason>). | Nothing was skipped.

<!-- Claim: the final-claim sentence pattern. State exactly which claim this entry
     supports and which claims it does not, naming the command that supports each. This
     is the sentence a later reader quotes; ambiguous wording here becomes a false claim
     later.
     Pattern: "This entry supports <claim> for <scope>, based on <command>. It does not
     support <claim> ..."
     Do not write "fully validated", "works", "production ready", and do not claim an
     integration, a milestone or a task outcome that no command in this entry observed. -->
Claim: This entry supports <claim> for <scope>, based on `<command>`. It does not support <claim>, which requires <missing evidence>.
```

## Example

A complete filled entry for a documentation-only change. It is a sample, not a template:
do not copy its numbers.

```markdown
## Docs: uniform templates for recurring artifacts — 2026-11-02

Executed on macOS arm64, Node.js v24.22.1 (fnm-managed install).
Date: 2026-11-02.

| Command | Purpose | Result | Exit code |
| --- | --- | --- | --- |
| `node --test` | Full local suite regression after a docs-only change | 83 tests passed, 0 failed | 0 |
| `node examples/fallback-demo.mjs` | Fallback demo still prints the expected two responses | 429 from `mock/preferred`, then 200 from `mock/local`, sessionId `demo-session` | 0 |
| `git diff --check origin/main..HEAD` | No whitespace errors in the new Markdown | no output | 0 |

Result: the full suite reports 83 passed and 0 failed, the demo prints 429 from
`mock/preferred` followed by 200 from `mock/local`, and `git diff --check` reports no
whitespace error in the new template files.

Evidence level: unit — the suite and the demo exercise policy, ledger, runner, task store
and service behavior in this checkout; the change itself is documentation, so no new
behavior is claimed for it. No host, network or persistence evidence is added here.

Not rerun: `node integration/opencode-smoke.mjs` (needs the pinned OpenCode 2.2.5 binary
outside the repository and documentation does not affect it); `node integration/mcp-gate.mjs`
(same reason, and the gate outcome is unresolved); live task transport and executor
integration (no executor adapter exists yet); automated Markdown link checking (this
repository has no link-checker script, so the relative links were reviewed by
inspection).

Claim: This entry supports that the documentation-only change leaves the local suite and
the fallback demo unchanged, based on `node --test` and `node examples/fallback-demo.mjs`.
It does not support any OpenCode integration, MCP transport or task-execution claim, which
requires the pinned binary outside the repository.
```

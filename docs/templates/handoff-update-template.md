# Handoff update template

When, where and who: see the [mapping table](README.md#which-file-to-copy). File-specific
rules only:

- Use it only when the next actionable step changes or a milestone moves, which is the rule
  in [AGENTS.md](../../AGENTS.md) under "Documentation duties". A change that leaves the next
  action intact does not touch [handoff.md](../handoff.md); it appends a worklog entry and a
  validation entry only.
- Rewrite the file in place, never append below it: it always describes exactly one
  continuation point. Delete what is no longer true.
- The file does not name an owner. The authority over scope and permissions is stated in
  [roadmap.md](../roadmap.md) ("The maintainer owns scope and permissions"); do not add an
  owner line here.
- Structure is fixed and already exists in the file. Seven parts, in this order: the title,
  one status paragraph, then five `##` sections — `Next action:`,
  `Contract rules that must not drift`, `Run and validate`,
  `Existing API (reuse, do not bypass)`, `Workflow`. No section is optional, and none may be
  renamed, reordered or added. No element below is new.

## What to update and what to copy

Only three parts change when the next action moves: the title date, the status paragraph
and the `Next action` section. Everything else is copied unchanged unless the change that
triggered this update made a normative or API change; when it did, the affected bullet or
line is updated and the same change records the ADR reference in the worklog entry.

The current file shows the expected proportions: the status paragraph is a single paragraph
of about eight wrapped lines, and `Next action` has four numbered items. Match that shape;
do not paste a changelog into the status paragraph.

## Template

```markdown
<!-- Title: "Continuation point — YYYY-MM-DD", the date of this update. The em dash is part
     of the real title. No milestone name, no version number, and never the previous date. -->
# Continuation point — <YYYY-MM-DD>

<!-- Status paragraph: no heading, no bullets, present tense. State in this order: which
     milestones are complete and within what scope; what is in progress and where it stops;
     what is explicitly not done; which unresolved risk still applies.
     Update every sentence that became false. Do not repeat the next action here, do not
     claim a milestone the evidence does not support, and never soften an unresolved gate
     into "working". -->
<Status paragraph: complete milestones, work in progress, what is not done, open risk.>

<!-- Next action: heading "## Next action: <short imperative title naming the step>", then
     a numbered list ordered by execution. Item 1 is the single next concrete step and must
     name the file, module or command involved, so a fresh agent can start without asking.
     Close with one sentence naming what stays out of scope for this milestone.
     Update every item here when the next action moves. No background, no history, no
     undecided options, and no item that is really a wish. -->
## Next action: <short imperative title naming the step>

1. <next concrete step, naming the file or command>
2. <following step>

<One sentence: what is out of scope until this milestone ends.>

<!-- Contract rules: copy all bullets unchanged from the previous handoff. Update a bullet
     only when this change made a normative change (task-contract.md or an ADR), and when it
     did, put the ADR link inside the bullet so the change is traceable. Never add a rule no
     document backs, never delete a bullet as redundant, and never turn "must not" into
     "should not". -->
## Contract rules that must not drift

- <invariant that must not drift>
- <invariant that must not drift>

<!-- Run and validate: copy the commands unchanged unless the toolchain changed. State the
     Node version and how it is managed, say that no dependency installation or credentials
     are required, give the commands with exact paths, and list the separate harnesses with
     the reason they are separate. No results here: results live in validation.md. -->
## Run and validate

`<command>` and `<command>` (Node <version>, via <manager>). No dependency installation or
credentials are required. <Constraint, for example: tests must use temporary state
directories.>

<Separate harness command and the reason it is not part of the main suite.>

<!-- Existing API: copy what is still true, and update it when a function or guarantee is
     added, renamed or removed. List entry points with signatures and the guarantee each
     provides, then the limitations a caller must respect. No planned functions, and no
     limitation removed because it was inconvenient. -->
## Existing API (reuse, do not bypass)

`<functionName>(<args>)` in `<file>` — <guarantee it provides>. <Constraint the caller must
respect>.

<Limitations paragraph: what is not guaranteed, and which failure modes require manual
action.>

<!-- Workflow: copy unchanged unless the rules themselves changed. It states the branch and
     PR rule, the documentation duties and the separation of evidence levels. Never relax a
     rule here to match a shortcut taken by this change: when the change broke a rule, the
     change is wrong, not this section. -->
## Workflow

Work on a branch, open a PR and never force push. Every change appends an entry to
[worklog](worklog.md), updates [roadmap](roadmap.md) and this handoff when the next action
changes, and records commands/results in [validation](validation.md). Decisions and
dependency changes need an ADR amendment. Documentation is maintained in English.

Evidence levels stay separate: unit, local HTTP, OpenCode integration and use on this
project. Mocks do not satisfy an integration gate, and direct edits in a development chat do
not count as M3.
```

## Example

A filled skeleton for a hypothetical update, so the shape is unambiguous. Only the title,
the status paragraph and `Next action` are invented; the other four sections reproduce the
content of the current [handoff.md](../handoff.md) verbatim — same words, same bullets, same
links — because the rules say to copy them unchanged. It is a sample, not the current
handoff: the real file wins.

```markdown
# Continuation point — 2026-11-03

M0/M1a/M1b are complete within the local scope of the ADRs. M2a is complete as
documentation: the normative [task contract](task-contract.md) and
[ADR-007](adr/007-task-contract.md) fix the operations, lifecycle, ownership, limits,
artifacts, the first transport and the reuse decision. M2b step 1 (MCP capability gate) had
one pass and one later failure; the root cause is unresolved and the gate is not considered
consistently validated. Step 2 (durable task store) is complete and step 3 (service surface)
passed independent review. There is no transport adapter, no executor adapter and no
self-development use yet.

## Next action: add the executor adapter behind the stable gate

1. Add `src/executor.mjs`: run one OpenCode CLI subprocess in an isolated worktree and
   branch, collecting the diff, the changed files and test evidence.
2. Cover it in `test/executor.test.mjs` with a fake subprocess, then rerun `node --test` and
   `node examples/fallback-demo.mjs`.
3. Rerun the capability gate once it is stable, and record the transcript in
   [validation](validation.md) before claiming any transport integration.

No routing, memory, remote access, fallback or automatic merge in M2b.

## Contract rules that must not drift

- Persist the task before any worker starts; a persistence failure accepts no task.
- Same idempotency key and payload returns the same task ID; a different payload is a
  conflict. No silent duplicate work.
- `blocked` is terminal until a human reconciles it; nothing resumes automatically after a
  restart, and a persisted dispatch is never replayed.
- Cancellation is a request. `executionStopped` is `unknown` after abort/crash and
  `effectsReverted` stays `false`.
- Task text and artifacts never grant permissions; authorization is clamped to the
  configured allowlist.
- Success claims need a recorded command and exit code; otherwise report a limitation.
- Result and status access are owner-only; `clientId` comes from configuration.

## Run and validate

`node --test` and `node examples/fallback-demo.mjs` (Node 24.22.1, via fnm). No dependency
installation or credentials are required. Tests must use temporary state directories, never
the developer's real `AI_ORCHESTRATOR_HOME`.

The real smoke harness remains useful as the executor reference:
`node integration/opencode-smoke.mjs <absolute-path-to-opencode.exe>`. The verified 2.2.5
binary lives outside the repository (see integration/README.md). The MCP capability gate runs
separately: `node integration/mcp-gate.mjs <absolute-path-to-opencode.exe>`.

## Existing API (reuse, do not bypass)

`createState(sessionId)`, `select(state, models, options)`, `success(state, dispatch)`,
`failure(state, dispatch, error, options)`, `nextOperation(state)` in `src/policy.mjs`.
`openSession(directory, sessionId)` in `src/ledger.mjs` provides the exclusive lock and
atomic checkpoint. `runOperation` in `src/runner.mjs` adds cancellation and the
per-invocation budget (ADR-005). Dispatch identity is the original object from `select`;
never rebuild it from current state. State version 1 is rejected without migration.

The smoke test proved session/context continuity, explicit model switching and denied writes
against the pinned host. SDK retry changes retry/delay, not the readonly model. Close
`child.stdin` because the run waits for EOF. Abort does not undo effects. Locks left by a
crash require manual reconciliation and are never removed automatically.

There is no event authentication, exactly-once guarantee or power-loss guarantee. Ledger
scope is a trusted local directory with cooperative writers; network filesystems are
unsupported.

## Workflow

Work on a branch, open a PR and never force push. Every change appends an entry to
[worklog](worklog.md), updates [roadmap](roadmap.md) and this handoff when the next action
changes, and records commands/results in [validation](validation.md). Decisions and
dependency changes need an ADR amendment. Documentation is maintained in English.

Evidence levels stay separate: unit, local HTTP, OpenCode integration and use on this
project. Mocks do not satisfy an integration gate, and direct edits in a development chat do
not count as M3.
```

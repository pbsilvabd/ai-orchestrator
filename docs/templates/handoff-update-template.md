# Handoff update template

When to use: only when the next actionable step changes or a milestone moves. That is the
rule in [AGENTS.md](../../AGENTS.md) under "Documentation duties": update
[handoff.md](../handoff.md) when the next action changes. A change that leaves the next
action intact does not touch this file — it only appends a worklog entry and a validation
entry.

Who writes it: the author of the change that moved the next action. Who maintains it: the
maintainer, who owns scope and permissions and is named there as the authority for
milestone moves.

Where it goes: [docs/handoff.md](../handoff.md) is rewritten in place, not appended. It
always describes exactly one continuation point: the state of the repository now and the
single next action. Delete what is no longer true instead of adding a new section below it.

This file is the first thing a fresh agent reads, so every section must let that agent act
without asking a question. Six sections exist, in this order: the title, the status
paragraph, `Next action`, `Contract rules that must not drift`, `Run and validate`,
`Existing API (reuse, do not bypass)`, `Workflow`. No section is optional and none may be
renamed or reordered.

## Template

```markdown
<!-- Title: "Continuation point — YYYY-MM-DD", the date of this update, ISO 8601.
     The em dash is part of the real title. Do not add a milestone name here, do not add
     a version number, and do not leave the old date in place. -->
# Continuation point — <YYYY-MM-DD>

<!-- Status paragraph: no heading, 6-12 lines of prose. State, in this order: which
     milestones are complete and within what scope; what is in progress and where it
     stops; what is explicitly not done; and which unresolved risk still applies.
     Update every sentence that became false. Do not repeat the next action here (next
     section), do not claim a milestone the evidence does not support, and never soften an
     unresolved gate into "working". -->
<Status paragraph: complete milestones, work in progress, what is not done, open risk.>

## Next action: <short imperative title naming the step>

<!-- Next action: a numbered list of at most five items. Item 1 is the single next
     concrete step and must name the file, module or command involved, so a fresh agent can
     start without asking. Later items are the steps that follow, in order.
     Update all items when the next action moves. Do not put background or history here,
     do not write "continue the work", and do not list an option without deciding it.
     Close with one sentence naming what stays out of scope for this milestone. -->
1. <next concrete step, naming the file or command>
2. <following step>

<One sentence: what is out of scope until this milestone ends.>

## Contract rules that must not drift

<!-- Copy this section unchanged from the previous handoff. Update a bullet only when a
     normative change happened in this change (task-contract.md or an ADR), and when it
     did, link the ADR inside the bullet so the change is traceable. Do not add a rule
     that no document backs, do not delete a bullet because it looks redundant, and never
     turn a "must not" into a "should not". -->
- <invariant that must not drift>
- <invariant that must not drift>

## Run and validate

<!-- Copy the commands unchanged unless the toolchain changed. State the Node version and
     how it is managed, say that no dependency installation or credentials are required,
     and give the commands with their exact paths. Include the separate harnesses and the
     reason they are separate (external binary). Do not move environment instructions to
     another file, and do not state a result here — results live in validation.md. -->
`<command>` and `<command>` (Node <version>, via <manager>). No dependency installation
or credentials are required. <Constraint, for example: tests must use temporary state
directories.>

<Separate harness command and the reason it is not part of the main suite.>

## Existing API (reuse, do not bypass)

<!-- Copy only what is still true, and update the section when a function or guarantee is
     added, renamed or removed. List the existing entry points with their signatures and
     the guarantee each provides, then the known limitations a caller must respect.
     Do not list planned functions, do not copy the task-contract operation list verbatim
     when the implementation differs from it, and do not let a limitation disappear
     because it was inconvenient. -->
`<functionName>(<args>)` in `<file>` — <guarantee it provides>. <Constraint the caller
must respect>.

<Limitations paragraph: what is not guaranteed, and which failure modes require manual
action.>

## Workflow

<!-- Copy this section unchanged unless the rules themselves changed. It states the branch
     and PR rule, the documentation duties and how evidence levels are kept separate.
     Do not relax a rule here to match a shortcut taken in this change: when the change
     broke a rule, the change is wrong, not the section. -->
Work on a branch, open a PR and never force push. Every change appends an entry to
[worklog](../worklog.md), updates [roadmap](../roadmap.md) and this handoff when the next
action changes, and records commands/results in [validation](../validation.md). Decisions
and dependency changes need an ADR amendment. Documentation is maintained in English.

Evidence levels stay separate: unit, local HTTP, OpenCode integration and use on this
project. Mocks do not satisfy an integration gate.
```

## Example

A complete filled skeleton for a hypothetical next step after the current M2b state. It
is a sample, not the repository's current handoff: the real file wins.

```markdown
# Continuation point — 2026-11-03

M0/M1a/M1b are complete within the local scope of the ADRs. M2a is complete as
documentation: the normative [task contract](../task-contract.md) and
[ADR-007](../adr/007-task-contract.md) fix the operations, lifecycle, ownership, limits,
artifacts, the first transport and the reuse decision. M2b step 1 (MCP capability gate) had
one pass and one later failure; the root cause is unresolved and the gate is not
considered consistently validated. Step 2 (durable task store) is complete and step 3
(service surface) passed independent review. There is no transport adapter, no executor
adapter and no self-development use yet.

## Next action: add the executor adapter behind the stable gate

1. Add `src/executor.mjs`: run one OpenCode CLI subprocess in an isolated worktree and
   branch, collecting the diff, the changed files and test evidence.
2. Cover it in `test/executor.test.mjs` with a fake subprocess, then rerun `node --test`
   and `node examples/fallback-demo.mjs`.
3. Rerun the capability gate once it is stable, and record the transcript in
   [validation](../validation.md) before claiming any transport integration.

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

## Run and validate

`node --test` and `node examples/fallback-demo.mjs` (Node 24.22.1, via fnm). No dependency
installation or credentials are required. Tests must use temporary state directories,
never the developer's real `AI_ORCHESTRATOR_HOME`.

The MCP capability gate runs separately and needs the pinned binary outside the
repository: `node integration/mcp-gate.mjs <absolute-path-to-opencode.exe>`.

## Existing API (reuse, do not bypass)

`openTaskStore({ home, retentionMs })` in `src/tasks.mjs` — create, read, update, list,
reconcile and prune task records. One service process only; no cross-process lock.
`src/service.mjs` exposes the four contract operations over that store. Dispatch identity
is the original object returned by `select`; never rebuild it from current state.

There is no event authentication, exactly-once guarantee or power-loss guarantee. Locks
left by a crash require manual reconciliation and are never removed automatically.

## Workflow

Work on a branch, open a PR and never force push. Every change appends an entry to
[worklog](../worklog.md), updates [roadmap](../roadmap.md) and this handoff when the next
action changes, and records commands/results in [validation](../validation.md). Decisions
and dependency changes need an ADR amendment. Documentation is maintained in English.

Evidence levels stay separate: unit, local HTTP, OpenCode integration and use on this
project. Mocks do not satisfy an integration gate.
```

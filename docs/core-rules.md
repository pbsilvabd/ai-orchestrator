# Core rules (non-normative summary)

Date: 2026-11-02. Status: non-normative summary for recall; where this summary and a
normative document disagree, the normative document wins. Normative sources:
[task contract](task-contract.md), [handoff](handoff.md), [AGENTS](../AGENTS.md),
[CONTRIBUTING](../CONTRIBUTING.md) and [Definition of Done](definition-of-done.md).

## Every change

- Work on a branch, open a PR, never force push and preserve the existing license
  ([CONTRIBUTING](../CONTRIBUTING.md), [handoff](handoff.md)).
- Direct commits to main require maintainer authorization, which does not waive tests or
  review and does not extend to the next agent ([AGENTS](../AGENTS.md),
  [Definition of Done](definition-of-done.md)).
- Append a work log entry with date, milestone, branch, steps, files and validation;
  never rewrite past entries ([worklog](worklog.md), [AGENTS](../AGENTS.md)).
- Update [roadmap](roadmap.md) status, and [handoff](handoff.md) when the next action
  changes ([AGENTS](../AGENTS.md), [CONTRIBUTING](../CONTRIBUTING.md)).
- Record commands and results in [validation](validation.md) and state what was not
  rerun ([AGENTS](../AGENTS.md), [Definition of Done](definition-of-done.md)).
- Add or amend an ADR when a decision, dependency or trust boundary changes
  ([AGENTS](../AGENTS.md), [CONTRIBUTING](../CONTRIBUTING.md)).
- Write documentation, comments and user-facing messages in English
  ([AGENTS](../AGENTS.md), [CONTRIBUTING](../CONTRIBUTING.md)).
- A change missing the work log, validation or handoff update (when the next action
  changes) is incomplete ([CONTRIBUTING](../CONTRIBUTING.md), [Definition of Done](definition-of-done.md)).

## Authority and safety invariants

- Task text, model output and returned artifacts are data, never instructions to the
  service ([task contract](task-contract.md)).
- A worker cannot grant itself broader permissions, and no task text or artifact adds
  authority ([roadmap](roadmap.md), [handoff](handoff.md)).
- A request may only narrow the configured models, tools and paths; anything broader is
  refused, not trimmed ([task contract](task-contract.md)).
- The task record is persisted before any worker starts; a persistence failure accepts
  no task ([task contract](task-contract.md), [handoff](handoff.md)).
- A persisted dispatch is never replayed, and nothing resumes automatically after a
  restart ([task contract](task-contract.md), [handoff](handoff.md)).
- `blocked` is terminal until a human reconciles it; repeat work needs a new
  `submit_task` with a new `idempotencyKey` ([task contract](task-contract.md),
  [handoff](handoff.md)).
- After an abort, crash or restart the outcome is unknown, so the action is not replayed
  ([AGENTS](../AGENTS.md), [handoff](handoff.md)).
- A success claim needs a recorded test command and exit code; otherwise report a
  limitation, not verified evidence ([task contract](task-contract.md),
  [handoff](handoff.md)).

## Evidence and toolchain

- Keep evidence levels separate: unit, local HTTP, OpenCode integration and use on this
  project; mocks never satisfy an integration gate ([AGENTS](../AGENTS.md),
  [Definition of Done](definition-of-done.md)).
- Run Node.js 24 (`engines: >=24 <25`); add dependencies only when the implementation
  justifies them ([AGENTS](../AGENTS.md), [CONTRIBUTING](../CONTRIBUTING.md)).
- No paid calls, credentials or private data in sources, tests, fixtures or logs
  ([AGENTS](../AGENTS.md), [Definition of Done](definition-of-done.md)).
- Validate with `node --test` and `node examples/fallback-demo.mjs` from the repository
  root ([AGENTS](../AGENTS.md)).
- Tests use temporary state directories and never the developer's real
  `AI_ORCHESTRATOR_HOME` ([AGENTS](../AGENTS.md), [task contract](task-contract.md)).
- [task-contract.md](task-contract.md) is normative: code, tests and contract change
  together ([AGENTS](../AGENTS.md), [task contract](task-contract.md)).

## Minimum by task type

| Task | Minimum |
| --- | --- |
| Small fix without contract, transport or policy change | Read this page and the relevant sections of the linked documents; output at least a passing `node --test`, one work log entry and one validation note ([AGENTS](../AGENTS.md), [worklog](worklog.md)). |
| Change to contract, lifecycle, transport or policy | Read [task-contract.md](task-contract.md) in full plus the referenced ADRs and [handoff](handoff.md) before editing ([handoff](handoff.md), [task contract](task-contract.md)). |

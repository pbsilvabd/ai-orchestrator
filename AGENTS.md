# AI Orchestrator

## Start here (any model or agent)

Start with this file, [core-rules.md](docs/core-rules.md) and the task card (if
applicable). Read the current handoff/roadmap only for task selection, changed
dependencies or milestone decisions. Read [task-execution.md](docs/task-execution.md)
for implementation/correction and [pr-review.md](docs/pr-review.md) for review.
Read the [Definition of Done](docs/definition-of-done.md) and applicable normative
contracts/ADRs before assessing their gates. For a resumed correction or delta review,
use the verified checkpoint, unresolved findings, affected code/tests and normative
sections; expand context when scope, base, authority or evidence changes. Normative
sources win; missing or failed reads are not evidence. Check remote and local state
before edits. Do not load unrelated historical documents by default.

## Backlog delivery

Read [docs/task-execution.md](docs/task-execution.md) and the selected
[task card](docs/backlog.md) before backlog work. One executable task ID produces
one branch and one PR. Preserve both self-review objectives: review implementation
and failure/authority paths, then review the completed diff and acceptance evidence;
revalidate fixes. A green suite alone is not a completed review.
Continue authorized work through implementation, independent review, CI, corrections
and the merge gate within the frozen scope; do not stop at a phase transition or
require a new prompt when the existing authorization covers the next phase. While CI
is running, perform independent review and safe mandatory checks. Use one bounded
blocking CI watch per unchanged head; `WAITING_CI` is only for a watch timeout or
unavailable monitoring. After CI completes, reverify head/base, checks, findings and
authorization before merging. Merge only when authorization covers that exact PR;
otherwise complete review/CI and return `READY_TO_MERGE`. A verified incomplete
checkpoint is a valid session outcome, not task completion. Stop for real blockers,
unavailable authority, provider limit, exhausted correction/review budget or
uncertain outcome requiring reconciliation. Final delivery gives PR URL, SHA,
evidence and limits. Never claim missing evidence passed.

Verified 2026-11-22: remote main `11fcb42` includes B12–B19 and B29/#44
fixture-only preparation. B30/#45 is draft at `a4f3954`; B20/#43 remains a
blocked draft and M3 has no real worker-produced project diff. M2b technical
fixture evidence exists; milestone acceptance is not newly declared here.
Next: settle the approval-profile decision (#47) and compartment-aware
composition (#46), with test synchronization tracked in #48. Do not rebuild
VMs before defining the actual service/worker/relay/gateway placement.
The current FIDO2/egress gates remain authoritative until a reviewed replacement
is implemented; no provider use, network changes or merge is authorized by the
reassessment. See [the reassessment](docs/project-reassessment-2026-11-22.md)
and current handoff/backlog. Earlier task-specific authorizations do not carry
forward.

## Repository maintenance skills (Codex)

For backlog implementation/correction, use
[$orchestrator-task](.agents/skills/orchestrator-task/SKILL.md). For a requested PR
review/re-review, use
[$orchestrator-review](.agents/skills/orchestrator-review/SKILL.md). Each skill routes
to the maintained protocols; existing session authorization still governs actions.
These repo-local skills guide development agents. They do not enable skills in
the OpenCode worker or change service permissions.

## PR feedback

Developers and reviewers must follow [docs/pr-review.md](docs/pr-review.md).
Reviewers publish actionable findings on the PR with the reviewed SHA and evidence.
Read full feedback initially; on resume, read new, changed or reopened feedback and
use a verified checkpoint for the unchanged remainder. If completeness cannot be
proved, read the relevant feedback in full. Developers reply to each actionable
finding with a fix commit and verification or an evidence-based explanation. A push
does not close a finding.

## Toolchain

- Node.js 24.22.1 (`engines: >=24 <25`), managed by fnm (`fnm use`).
- No `npm install` is required; the project has no runtime dependencies.
- Run `node --test` and `node examples/fallback-demo.mjs` from the repository root.
- `integration/opencode-smoke.mjs` needs the pinned OpenCode 2.2.5 binary outside the
  repository; see [integration/README.md](integration/README.md).

## Rules

- Integration reference: OpenCode 2.2.5; read docs/plugin-audit.md before enabling plugins.
- Run `node --test` and the demo when changing the policy.
- No paid calls or credentials in source files, tests or logs.
- Never treat an uncertain tool outcome as safe to replay.
- Keep changes small and documented. Use branches by default; direct main commits require maintainer authorization. Never force push.
- Do not claim validated integration based only on mocks.
- Write documentation, comments and user-facing repository messages in English.

## Documentation duties (every change)

- Update [docs/roadmap.md](docs/roadmap.md) status and
  [docs/handoff.md](docs/handoff.md) next action only when a milestone, status or
  next action actually changes.
- Consolidate the change's worklog and validation evidence before the final-head
  review. Record date, milestone, branch, steps, files, commands, results and what
  was not rerun. Never rewrite historical entries; preserve append-only records.
- Record the final review and CI receipt on GitHub at the relevant SHA; do not add
  a commit solely to record a review/CI receipt.
- Add or amend an ADR when a decision, dependency or trust boundary changes.
- Keep [docs/task-contract.md](docs/task-contract.md) normative: code, tests and
  contract change together.
- Keep evidence levels separate (unit, local HTTP, OpenCode integration, use on this
  project). Mocks never satisfy an integration gate.
- Templates for recurring artifacts live in docs/templates/: use the matching
  template as the default. Explain format adaptations in the worklog and preserve
  all required information, evidence and normative rules.

## Runtime state

The service stores task records under `AI_ORCHESTRATOR_HOME` (default
`%LOCALAPPDATA%\ai-orchestrator` on Windows), never inside the repository. Tests must
use temporary directories and must not read a developer's real state directory.

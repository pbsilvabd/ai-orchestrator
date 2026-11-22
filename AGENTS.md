# AI Orchestrator

## Start here (any model or agent)

Read, in order: this file, [docs/core-rules.md](docs/core-rules.md), then
[docs/handoff.md](docs/handoff.md), [docs/roadmap.md](docs/roadmap.md),
[docs/definition-of-done.md](docs/definition-of-done.md), [CONTRIBUTING.md](CONTRIBUTING.md),
[docs/task-contract.md](docs/task-contract.md) and the ADRs referenced by the current
milestone. `docs/core-rules.md` is non-normative; the normative sources it links win on
conflict — read them before work that touches the contract, lifecycle, transport or policy.
Check `git log` and the remote before editing; another agent may have moved the
repository since the handoff was written.

## Backlog delivery: continue through the PR

Read [docs/task-execution.md](docs/task-execution.md) and the selected
[task card](docs/backlog.md) before backlog work. One executable task ID produces
one branch and one PR. Implement the scope, test every acceptance row, review during
implementation, fix findings, review the completed diff again and revalidate fixes.
Update documentation, commit, push, open/update the PR and verify its remote head.
Continue through those already-authorized steps without stopping after a plan,
branch or initial implementation. A green suite alone is not a completed review.
Final delivery gives PR URL, SHA, evidence and limits; merge requires explicit
authorization for that task. Genuine external blockers follow the protocol's
draft/incomplete-work procedure; never claim missing evidence passed.

Verified 2026-11-22: main `11fcb42` includes B12–B19 and B29/#44 fixture-only
preparation. B20/#43 and B30/#45 remain incomplete. B31 adds project-local
OpenCode V2 agents for build, plan, executor, explore and review; there is no
frontend in this repository. The exact-PR `/review-merge` commands provide
conditional authorization only for the PR explicitly invoked and only after
acceptance/final-head/CI/review gates pass. The service worker cannot merge.
Actual OpenCode runtime integration is not yet evidenced. See B31, ADR-011 and
the current handoff; earlier task-specific authorizations do not carry forward.

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
Developers read conversation comments, review submissions and inline threads before
resuming a PR and before final delivery, then reply to each finding with a fix
commit and verification or an evidence-based explanation. Re-review the new head;
a chat-only verdict or a push does not close blocking findings.

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
  [docs/handoff.md](docs/handoff.md) next action when a milestone moves.
- Append an entry to [docs/worklog.md](docs/worklog.md): date, milestone, branch,
  steps, files and validation. Never rewrite past entries.
- Record commands and results in [docs/validation.md](docs/validation.md); state what
  was not rerun.
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

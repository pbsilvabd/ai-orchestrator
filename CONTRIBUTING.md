# Contributing

Use Node.js 24 and run `node --test` before opening a PR. Keep the project free of
dependencies until the implementation justifies them. Do not install plugins
automatically or add credentials, private payloads or provider logs.

Write documentation, comments and user-facing messages in English. Preserve API
identifiers, commands and proper names when translating existing material.

Fallback contract changes require observable safety tests and an updated ADR.
Distinguish simulation, static inspection and executed integration. Preserve the
existing license and use branches/PRs without force pushes.

Check the [Definition of Done](docs/definition-of-done.md) and update the
[roadmap](docs/roadmap.md) when completing a milestone. Append an entry to the
[work log](docs/worklog.md) and update the [handoff](docs/handoff.md) when the next
action changes; a change without those updates is incomplete.

For backlog work follow [the task execution protocol](docs/task-execution.md) and
the selected [task card](docs/backlog.md): one executable ID, one branch, one PR.
Complete implementation, required validation, two review passes and correction,
then commit, push and verify the published PR. Do not stop at an intermediate step
to request another continue. Missing external prerequisites use the documented
draft/incomplete-work procedure. Direct main commits and merges require explicit
task-specific authorization; earlier session approvals do not carry forward.

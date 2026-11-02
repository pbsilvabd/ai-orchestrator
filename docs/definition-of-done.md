# Definition of Done

## A change is complete when

- [ ] The problem, scope and observable acceptance criterion are documented in the commit/PR/documentation.
- [ ] Implementation stays within its milestone; limitations and remaining work are explicit.
- [ ] Relevant behavior/failure tests and full-suite regression checks pass.
- [ ] Commands, environment and results are recorded in docs/validation.md.
- [ ] No mandatory paid APIs, credentials or private data appear in sources/logs/fixtures.
- [ ] Unknown failures never authorize replay; authentication and permissions are not bypassed.
- [ ] README, requirements and roadmap reflect the result; architectural decisions have ADRs when needed.
- [ ] The diff is reviewed, license preserved, commit published and remote state verified; no force push.

Direct main commits may be used when authorized by the maintainer, as in this
cycle. This does not waive tests/review or change the future agent's permissions.

## Evidence levels

| Level | Demonstrates | Does not demonstrate |
| --- | --- | --- |
| Unit | Policy decisions and input normalization | Host, network, production persistence |
| Local HTTP | Real headers/status and selection with controlled fixtures | Real OpenCode tools or sessions |
| OpenCode integration | Hooks, queue, context, permissions and failures in the pinned host | Real model quality/cost |
| Use on this project | A real task produces a diff and evidence under supervision | Unrestricted autonomy or universal safety |

## Integrated MVP ready (M2)

- [ ] Reproducible installation and execution with pinned OpenCode 2.2.5.
- [ ] A 429 before a response switches A to B without losing context/permissions.
- [ ] Two failing models terminate within the limits.
- [ ] Restart preserves history and blocks dispatches with uncertain outcomes.
- [ ] Failure after a write/external effect does not repeat the action.
- [ ] Return to A happens only in a new safe operation after cooldown.
- [ ] Authentication, incompatible capabilities, cancellation, duplicate events and concurrency have tests.

## First use on this project ready (M3)

- [ ] The project executed a backlog task through OpenCode, rather than only through this chat.
- [ ] Authorized providers and runtime/version details are recorded without disclosing credentials.
- [ ] Changes are isolated on a branch, with a recorded base and a task-scoped diff.
- [ ] The workflow ran tests, results are verifiable and human review is complete.
- [ ] The report includes attempts, failures, files and known (or explicitly unknown) costs.
- [ ] A recovery procedure exists and the agent did not elevate its permissions.

## Public release ready

M3 demonstrated, clean installation reproduced, limitations/privacy documented,
license/dependencies audited and smoke tests passed on each declared platform.
Making the repository public and enabling providers are explicit maintainer
decisions. Passing unit tests alone is not enough to announce a stable release.

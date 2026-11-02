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

## Task contract and reuse ready (M2a)

- [ ] Task inputs, ownership, authorization, lifecycle, duplicate submission, cancellation and artifact access are specified.
- [ ] One initial client and transport are selected with a compatibility test plan.
- [ ] Reuse/build decision records pinned versions, licenses, evidence and gaps.

## One-worker delegation ready (M2b)

- [ ] A real compatible client submits a task and receives a stable task ID.
- [ ] One worker executes independently between client status queries.
- [ ] Status and result retrieval return scoped artifacts and verifiable evidence.
- [ ] Duplicate submission/reconnect does not silently create duplicate work.
- [ ] Cancellation requested and execution stopped are distinguished; uncertain restart blocks replay.
- [ ] Task permissions, ownership, limits and failures are tested without mandatory paid APIs.
- [ ] No implicit public exposure, permission escalation or automatic merge.

## Safe worker fallback ready (M2c)

- [ ] Reproducible installation and execution with pinned OpenCode 2.2.5.
- [ ] A 429 before a response switches A to B without losing context/permissions.
- [ ] Two failing models terminate within the limits.
- [ ] Restart preserves history and blocks dispatches with uncertain outcomes.
- [ ] Failure after a write/external effect does not repeat the action.
- [ ] Return to A happens only in a new safe operation after cooldown.
- [ ] Authentication, incompatible capabilities, cancellation, duplicate events and concurrency have tests.

## First use on this project ready (M3)

- [ ] A primary LLM delegated a real backlog task through the service interface, queried progress and retrieved results; direct work in this chat does not count.
- [ ] One authorized worker/model is sufficient; M2b is complete and fallback stays disabled unless M2c is validated.
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

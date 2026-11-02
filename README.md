# AI Orchestrator

A pluggable worker service for a supervising LLM. MIT licensed.

## Purpose and target architecture

Connect a primary LLM in a compatible local or web client to AI Orchestrator.
The primary LLM plans, delegates tasks, checks progress and reviews results;
workers perform the execution. The service should return task status, artifacts,
diffs and test evidence while respecting authorized models, tools and budgets.

**The primary acceptance test is developing AI Orchestrator itself:** delegate a
small backlog task to one worker, retrieve its diff and test report, and review
before merging. This workflow has not been implemented yet.

OpenCode 2.2.5 is the first candidate worker executor. MCP is the preferred
integration to evaluate for compatible clients; an API is an alternative.
Neither endpoint exists yet. Reuse existing infrastructure before building new
routing, task or memory systems. See [ADR-006](docs/adr/006-worker-service.md).

The diagram shows the **target architecture**, not a completed integration.
Green marks local implemented components or the verified host smoke; yellow marks
evaluation/integration work; dashed nodes are planned.

```mermaid
flowchart TD
    User["User: objective and permissions"] --> Main["Primary LLM: plans and supervises"]
    Main <-->|Submit, status, result, cancel| Interface["MCP or API task interface"]
    Interface <--> Service["AI Orchestrator task service<br/>Identity, authorization, lifecycle and artifacts"]
    Service --> Worker["One worker first<br/>OpenCode executor adapter"]
    Worker --> Host["OpenCode 2.2.5<br/>Host smoke passed"]
    Worker -.-> Core["Local policy, ledger and runner<br/>Implemented; task integration pending"]
    Host --> Workspace["Isolated repository branch and tools"]
    Workspace --> Evidence["Diff, tests, results and limitations"]
    Evidence --> Service
    Service --> Main
    Main --> Review["Human review"]
    Review --> Repo["AI Orchestrator repository<br/>Primary development workload"]
    Repo --> User
    Service -.-> More["Later: research and review workers"]
    Service -.-> Memory["Later: ai-memory integration"]
    Worker -.-> Routing["Later: reusable model routing and safe fallback"]
    classDef current fill:#e6f4ea,stroke:#237a3b,color:#111;
    classDef progress fill:#fff4ce,stroke:#9c6500,color:#111;
    classDef planned fill:#f3f4f6,stroke:#6b7280,stroke-dasharray:5 5,color:#111;
    class Host,Core current;
    class Interface,Worker progress;
    class Main,Service,Workspace,Evidence,Review,Repo,More,Memory,Routing planned;
```

Tasks should continue between status queries. Continuous supervision depends on
the primary client's invocation/notification support; polling is sufficient for
the first MVP. A web client needs a compatible interface and network access;
a local service is not automatically accessible from the web.

Operational state and semantic memory remain separate. Neither task instructions
nor worker results grant permissions. The first workflow has no automatic merge.

## Current status

Implemented: pure fallback policy, HTTP/Retry-After normalization, local checkpoint
ledger, operation runner, an in-memory demo and dependency-free local tests,
including loopback HTTP transport. **This is not an installed plugin or an
integrated OpenCode MVP.** No AI calls, keys, provider accounts or paid APIs are
required for these tests.

M2a is complete as a specification: the normative [task contract](docs/task-contract.md)
and [ADR-007](docs/adr/007-task-contract.md) define the four task operations,
lifecycle, ownership, limits and artifacts, select MCP over stdio with OpenCode 2.2.5
as the first client behind a capability gate, and record the pinned reuse/build
decision. As of 2026-11-02 the task store (`src/tasks.mjs`) and the task service
surface (`src/service.mjs`) are implemented; no task endpoint, transport or executor
adapter exists yet.

A separate [real OpenCode smoke test](integration/README.md) uses the 2.2.5 binary
and a simulated local provider. It validates session continuity, context, explicit
model switching and denied writes. It is not the fallback adapter.

Evaluated reference: OpenCode **2.2.5**, commit
`9bbb8ce18c80f099e0e448775f59d965ead40a21`. Candidate plugins remain disabled
until they meet the [audit criteria](docs/plugin-audit.md).

## Run

Use Node.js 24 (validated with 24.22.1) from the repository root:

```sh
node --test
node examples/fallback-demo.mjs
```

No npm install is required. The demo produces two records: `mock/preferred`
returns 429 and `mock/local` returns 200 in the same session. These are in-memory
responses, not HTTP servers or real models.

## Minimal policy

- An explicit, ordered allowlist of authorized models; no catalog is enabled automatically.
- Each model is attempted at most once per operation; the default limit is two attempts.
- 429/500/502/503/504 and timeouts allow fallback only before a response and without possible effects.
- 401/403, invalid input, quotas with unknown reset times and missing metadata stop execution.
- Cooldown respects the greater of the default and normalized Retry-After in milliseconds.
- Restarting with a pending dispatch blocks automatic continuation.
- Returning to the preferred model requires a new operation after explicit completion/reconciliation.

`src/policy.mjs` makes decisions; it does not run tools, timers, HTTP or persistence.
The consumer must persist dispatch state before calling a provider. `wait` is a
decision with a timestamp, not a scheduler. The trusted caller confirms the result
using `success(state, dispatch)`; only then is `nextOperation(state)` allowed.
The old `previousCompleted: true` argument does not unlock a pending dispatch.

State version 2 assigns a UUID to each operation. Dispatches carry sessionId,
operationId and attemptId. `success` and `failure` require the original dispatch
returned by `select`, not just its model. Never reconstruct its identity from
current state when a callback arrives. Version 1 checkpoints are rejected and
require manual reconciliation; pending operations are not migrated automatically.

For persistence and exclusion between processes, use
`openSession(directory, sessionId)` from `src/ledger.mjs`. Its handle provides
`select(models, options)`, `success(dispatch)`,
`failure(dispatch, error, options)`, `nextOperation()`, `snapshot()` and `close()`.
Keep it open during the call and close it in finally. Call the provider only after
select returns action=dispatch: the checkpoint has then been written. Persistence
errors invalidate the handle. See [ADR-004](docs/adr/004-local-ledger.md).

Tests cover local checkpoints and interprocess locks, not OpenCode session recovery
or power-loss durability. The host owns message history. Use a trusted local
directory with cooperative writers; NFS/SMB and third-party-controlled directories
are unsupported. Locks left after crashes require manual reconciliation and are
never removed automatically.

## Operation runner and development plan

`runOperation` in `src/runner.mjs` combines the ledger, fallback, cancellation and
a duration budget. It accepts directory, sessionId, models, invoke, budgetMs
(default 30000), maxAttempts (default 2) and an optional signal. The invoke adapter
receives dispatch/signal and returns `{ok:true,value}` or `{ok:false,error}`.
No OpenCode adapter is installed yet. See [ADR-005](docs/adr/005-operation-runner.md):
abort does not undo effects, deadlines cannot interrupt synchronous code, and
budgets are not persisted between invocations. In-flight cancellation requires
session reconciliation.

The project has a local runner but **no integrated self-development workflow yet**.
The first real task will use an isolated branch and human review. See the
[roadmap](docs/roadmap.md) and [Definition of Done](docs/definition-of-done.md)
for status, dependencies and acceptance gates.

## Next steps

1. Run the MCP capability gate against the pinned host (M2b step 1).
2. Implement the task store, the four operations and one executor adapter (M2b).
3. Complete a real self-development task with a diff, tests and human review (M3).
4. Validate safe model fallback separately (M2c), then memory and bounded multi-worker routing.

`src/http-failure.mjs` accepts Retry-After as integer seconds or canonical
IMF-fixdate. Invalid values, overflow and obsolete formats are conservatively
rejected. This is not a complete HTTP parser. Replay safety must come from the
host; a 429 status alone does not prove absence of effects. Private bodies and
headers are not copied.

See [requirements](docs/requirements.md), [task contract](docs/task-contract.md),
[ADR-001](docs/adr/001-composition.md), [validation](docs/validation.md) and
[contributing](CONTRIBUTING.md).

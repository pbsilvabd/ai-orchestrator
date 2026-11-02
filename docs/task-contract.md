# Task contract (M2a)

Date: 2026-11-02. Status: specified, not implemented. Decisions: [ADR-007](adr/007-task-contract.md).

This is the normative contract for the first worker service. Implementation is M2b.
Where this document and code disagree, the document is wrong until this document is
updated deliberately in the same change.

## Actors and trust boundary

| Actor | Responsibility | Cannot |
| --- | --- | --- |
| Supervisor client | Submits, polls, retrieves, cancels | Grant permissions, merge, reconcile |
| Service | Owns task records, authorization, lifecycle and artifacts | Infer safety from model text |
| Worker | Executes one authorized task in an isolated workspace | Widen its own permissions |
| Maintainer (human) | Owns allowlists, budgets and merges; reconciles blocked tasks | — |

M2b runs locally for the authenticated operating-system user. The service is not a
sandbox, an authentication server or a multi-tenant boundary. Task text, model output
and returned artifacts are data, never instructions to the service.

## Transport and first client

The first transport is MCP over stdio, protocol revision `2026-07-28`. The first
supported client is OpenCode 2.2.5, pinned at commit
`9bbb8ce18c80f099e0e448775f59d965ead40a21`. There is no listening socket, no tunnel
and no remote access in M2b. The client capability gate and the fallback to a
loopback HTTP transport are recorded in [ADR-007](adr/007-task-contract.md).

Operations are transport-neutral objects. In MCP each operation is one tool whose
arguments are the request object; results and errors are serialized as a single JSON
text content block, and error objects set `isError: true`.

## Common rules

- Unknown request fields are rejected instead of ignored.
- Every response carries `schemaVersion: 1`.
- Identifiers use `[A-Za-z0-9._:-]{1,128}`; task IDs are opaque UUIDv4 values and are
  never derived from content.
- Timestamps are epoch milliseconds (UTC), injected by the caller in tests.
- No long polling in M2b; the client polls `get_task_status`.
- Logs and errors never contain prompts, credentials, headers or absolute home paths.

## Operations

### submit_task

```js
{
  idempotencyKey: "goal-2026-11-02-01",       // required, client-scoped
  clientId: "opencode-primary",               // required, from service config
  objective: "Add a regression test for ...", // required, 1..4000 chars
  acceptanceCriteria: ["node --test passes"], // required, 1..20 items
  repository: { path: "/abs/repo", baseRef: "main", branch: "task/..." },
  authorization: {
    models: ["provider/model"],               // subset of the configured allowlist
    tools: ["read", "edit", "bash"],          // subset of the configured allowlist
    writablePaths: ["src/**", "test/**"]      // subset of the configured roots
  },
  limits: { maxAttempts: 2, budgetMs: 600000, maxOutputBytes: 1048576 },
  clientSessionId: "optional-correlation"      // not an authority
}
```

Result: `{ schemaVersion, taskId, status: "queued", acceptedAt, idempotentReplay }`.

- The record is persisted before any worker starts; a persistence failure accepts no task.
- Same `idempotencyKey` and same canonical payload returns the original `taskId` with
  `idempotentReplay: true` and starts no additional work.
- Same key with a different payload returns `idempotency_conflict` and changes nothing.
- `path` must resolve inside a configured root; `baseRef` must resolve to a commit;
  `branch` must not already exist unless this task created it.
- `authorization` is clamped to the configured allowlist; exceeding it is rejected
  with `authorization_denied`, never silently narrowed.

The canonical payload used for the idempotency hash excludes `clientSessionId` and
is serialized with sorted keys and no whitespace; SHA-256 is stored with the record.

### get_task_status

```js
{ taskId: "..." }
```

Result:

```js
{
  schemaVersion: 1,
  taskId, status,                       // queued|running|succeeded|failed|blocked|cancelled
  createdAt, startedAt, finishedAt,
  attempts: [{ attemptId, model, startedAt, finishedAt, outcome }],
  cancel: { requestedAt, executionStopped, effectsReverted: false },
  block: { reason, requiresReconciliation: true },   // present only when blocked
  progress: [{ at, event, detail }],
  resultAvailable: true
}
```

- `executionStopped` is `true` only when the worker confirmed no work is running; it is
  `unknown` after an abort, a crash or a restart. `effectsReverted` is always `false`.
- A task in `blocked` is never resumed automatically.

### get_task_result

```js
{ taskId: "...", include: ["diff", "tests", "log"] }  // include optional
```

Result:

```js
{
  schemaVersion: 1, taskId, status, baseCommit, branch, headCommit,
  diff, diffTruncated, changedFiles: [],
  testRuns: [{ command, exitCode, durationMs, summary, outputTail }],
  attempts: [...], limitations: [],
  cost: { known: false, amount, currency, note },
  evidenceLevel: "unit|local-http|opencode-integration|use-on-project",
  sanitized: true
}
```

- Available for terminal states only; otherwise `result_not_ready`.
- `failed` and `blocked` tasks return whatever partial artifacts exist, with explicit
  `limitations`.
- A success claim without a recorded test command and exit code is reported as a
  limitation, not as verified evidence.
- Diff is capped at 1 MiB and logs at 256 KiB; truncation is flagged, never silent.

### cancel_task

```js
{ taskId: "...", reason: "optional" }
```

Result: `{ schemaVersion, cancelRequestedAt, status, effect }` where `effect` is
`not_started`, `requested` or `already_terminal`.

- Cancellation is idempotent and is a request, not proof that effects were undone.
- `queued` becomes `cancelled` with `executionStopped: true`; no worker process starts.
- `running` sets `cancel.requestedAt`. If the worker confirms it stopped before any
  recorded side effect, the task becomes `cancelled` with `executionStopped: true`;
  otherwise it becomes `blocked` with `reason: "cancelled-uncertain"`.
- A terminal task returns `already_terminal` and is never reopened.

## Errors

| Code | Meaning |
| --- | --- |
| `invalid_argument` | Malformed or unknown field |
| `unknown_task` | No record for the ID, or not visible to the caller |
| `not_owner` | `clientId` does not own the task |
| `idempotency_conflict` | Same key, different payload |
| `authorization_denied` | Model, tool, path, client or budget outside the allowlist |
| `limit_exceeded` | Task or output limit exceeded |
| `result_not_ready` | Task is not terminal |
| `unavailable` | Service cannot persist or reconcile; retry is safe only here |
| `internal` | Unexpected failure; no stack trace or payload is returned |

Errors are objects `{ error: { code, message } }` with `message` free of private data.

## Lifecycle

```
queued --start--> running --success--> succeeded
queued --cancel--> cancelled
running --safe failure--> failed
running --uncertain failure--> blocked
running --cancel (proven stop, no effects)--> cancelled
running --cancel (unproven)--> blocked
running --service restart--> blocked
blocked --maintainer reconciliation--> failed | cancelled
```

There are no automatic transitions out of `blocked`, and no automatic retry of a task.
Reconciliation records the maintainer's decision and evidence; it never re-executes
the same task. Repeat work requires a new `submit_task` with a new `idempotencyKey`.

## Persistence and restart

- One JSON record per task under `AI_ORCHESTRATOR_HOME` (`tasks/`, `idempotency/`,
  `locks/`, `artifacts/`), written with an exclusive temporary file, fsync and rename
  in the same directory, following [ADR-004](adr/004-local-ledger.md).
- Default home: `%LOCALAPPDATA%\ai-orchestrator` on Windows,
  `$XDG_STATE_HOME/ai-orchestrator` or `~/.local/state/ai-orchestrator` elsewhere.
  It is never inside the repository; tests must use a temporary directory.
- On startup, `running` tasks become `blocked` with `reason: "service-restart"`.
  `queued` tasks may start only if no attempt was ever dispatched; an existing attempt
  blocks them. Nothing resumes from a persisted dispatch.
- Retention: `blocked` records are never deleted automatically. Other records are kept
  until the maintainer runs cleanup; the default retention is 30 days.
- There is no exactly-once guarantee. Duplicate work is prevented by the persisted
  lifecycle and the idempotency index, not by the worker or the model.

## Ownership, authorization and limits

- `clientId` comes from service configuration, not from task text or model output.
  Ownership is the task's `clientId`; other clients receive `not_owner`.
- The worker receives one repository root, one branch, one model and one tool list.
- A task-level `budgetMs` is wall clock measured from start; the per-invocation budget
  of [ADR-005](adr/005-operation-runner.md) still applies and the lower value wins.
- M2b runs one task at a time (`maxAttempts` ≤ 2, concurrency 1) with no automatic
  model fallback; fallback is M2c.

## Evidence and artifacts

Every result must report base commit, branch, changed files, tests executed with exit
codes, attempts, limitations, known or explicitly unknown cost, and the evidence level
as defined in the [Definition of Done](definition-of-done.md). Merging is always a
human decision; the worker cannot approve its own change.

## M2b acceptance tests

These tests must exist and pass before M2b is claimed:

1. Submit returns a stable ID and the record exists before the worker starts.
2. Duplicate submit with the same key creates no second workspace or attempt.
3. Same key with a different payload returns `idempotency_conflict`.
4. A second process observes `queued → running → succeeded` while polling.
5. The result contains diff, changed files, test exit codes, attempts and limitations.
6. Cancel before start returns `cancelled` with no worker process spawned.
7. Cancel during a write ends in `blocked` with no replay and `effectsReverted: false`.
8. Service restart with a `running` task marks it `blocked`; no automatic resume.
9. Unauthorized client, model, tool, path or budget is rejected without side effects.
10. A non-owner read or cancel returns `not_owner`.
11. Oversized diff and log are truncated with explicit flags.
12. Fixture secrets in task text, environment and logs never reach records or errors.
13. One real client run through the transport returns a result; mock-only runs are
    labelled as mock in the evidence.

## Out of scope for M2b

Remote access and authentication, multi-worker routing, semantic memory, automatic
fallback (M2c), automatic merge, a UI, scheduled retries and paid providers.

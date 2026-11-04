# Task contract (M2a)

Date: 2026-11-02. Status: normative for M2b; service implementation is under review.
Decisions: [ADR-007](adr/007-task-contract.md), [ADR-008](adr/008-task-store.md).

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
- Errors never echo request values, prompts, credentials, headers or absolute home paths.
- At ingestion, the service rejects request text containing recognizable Bearer/Basic
  credentials or values following `authorization`, `api_key`, `access_token`,
  `refresh_token` or `client_secret` labels. It does not mutate the request. At artifact
  return, it redacts those patterns from text fields. `sanitized: true` means this
  bounded pattern policy was applied; it is not a guarantee that arbitrary sensitive
  data is detected. The executor must still avoid emitting secrets.

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
    writablePaths: ["src/**", "test/**"]      // globs relative to repository.path
  },
  limits: { maxAttempts: 2, budgetMs: 600000, maxOutputBytes: 1048576 },
  clientSessionId: "optional-correlation"      // not an authority
}
```

Result: `{ schemaVersion, taskId, status: "queued", acceptedAt, idempotentReplay }`.

- The record is persisted before any worker starts; a persistence failure accepts no task.
- Validation follows strict ordering: request format, static identity and configured
  allowlist/budget limits are verified first, followed by client-scoped idempotency
  resolution using the canonical payload.
- Defer new-request filesystem/Git validation until after idempotency lookup: an identical
  replay returns the original `taskId` and `baseCommit` with `idempotentReplay: true` without
  revalidating repository existence, branch availability or moving refs. Same key with a
  different payload returns `idempotency_conflict` and changes nothing.
- For new requests, `repository.path` must resolve to an accessible Git work tree whose
  canonical path (after symlink/junction resolution) is strictly contained within a configured
  writable root (`authorization_denied` on boundary escape or path-prefix sibling matching).
- `repository.baseRef` must be a single commit-ish resolving to a commit (ranges like `a..b`,
  leading hyphens and non-commit objects are rejected with `invalid_argument`). The resolved
  full commit SHA is persisted on the task record as immutable metadata `baseCommit`; it does
  not mutate the user's `request.repository.baseRef` and does not alter canonical payload hashing.
  Older records without `baseCommit` remain readable.
- `repository.branch` must be a legal Git ref format, must not exist locally, and must not
  be checked out in any linked worktree (`invalid_argument`). Submitting against a dirty parent
  working tree is supported and leaves user files unchanged.
- The B09 workspace helper creates one real linked worktree from `baseCommit` on the accepted
  `branch`, outside the repository, with a versioned task receipt in the workspace root. Reuse
  requires an exact receipt match plus verification of path, Git common directory, branch and
  ancestry from `baseCommit`; an existing path without a valid receipt is never adopted.
  Cleanup is explicit and only removes a clean worktree still at its base and an unchanged
  task branch. Dirty or advanced output, moved paths, tampered receipts and uncertain setup
  failures are retained for inspection. Worktree cleanup does not prove that external effects
  were reversed or that any worker process stopped.
  Cleanup also refuses index entries marked skip-worktree or assume-unchanged, because
  ordinary Git status can hide modified tracked output. The helper does not clear those flags.
- Relative writable globs resolve from `repository.path`, and their static roots must remain
  within a configured root. Absolute writable paths remain accepted only when inside both the
  repository and a configured root.
- `authorization` is clamped to the configured allowlist; exceeding it is rejected
  with `authorization_denied`, never silently narrowed. Configuration changes affect future
  validations; existing tasks never silently widen permissions.

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
- Diff is capped at 1 MiB and log tails at 256 KiB. The task's `maxOutputBytes` is a
  combined UTF-8 byte budget for diff first, then logs in test-run order. Logs retain
  their tail. `diffTruncated`, per-run `outputTruncated` and `logsTruncated` indicate
  truncation; UTF-8 sequences are never cut mid-character.

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
queued --restart with a persisted attempt--> blocked
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

### Store enforcement (B04a, 2026-11-02)

The diagram describes the target lifecycle. Ordinary `updateTask` currently permits
`queued → running | cancelled`, dispatched `queued → blocked`, and
`running → succeeded | failed | blocked`. The guard also runs on startup reconciliation.
`running → cancelled` requires a future executor stop-proof operation (B14);
`blocked → failed | cancelled` requires a future maintainer-only operation (B18).
Neither is permitted through the generic update callback. There is no boolean
override that grants reconciliation authority.

- Task ID, client, idempotency key, payload hash, accepted request, createdAt and
  acceptedAt cannot change. startedAt cannot change once assigned.
- Persisted attempts retain their order, attemptId, model and startedAt; they cannot
  be erased or replaced to hide a dispatch. Active attempts may acquire result metadata.
  Queued work with a previously persisted attempt cannot transition to running;
  restart reconciliation must block it instead of allowing a replay.
- Queued work has no start timestamp; queued/running work has no finish timestamp.
  Running/succeeded/failed work requires startedAt; every terminal state, including
  blocked, requires finishedAt. This check enforces presence/types, not clock ordering.
- Block metadata is required exactly for blocked state, with executionStopped unknown.
  Cancelled state requires a cancellation request and executionStopped true. A queued
  cancellation cannot carry a previous or newly inserted dispatch.
- Ordinary updates cannot change a terminal status. Terminal lifecycle metadata
  (timestamps, cancellation, block and attempts) is immutable; partial artifacts can
  still be added without reopening work.
- Malformed records/identity changes are invalid_argument; forbidden transitions
  are internal service errors. Rejected updates write nothing.
- Existing incoherent v1 records fail closed on read/startup with unavailable;
  they are not silently migrated or rewritten. A maintainer must inspect the data.

These guards are not process exclusion, an authorization sandbox or proof of actual
execution. Persist-before-spawn attempt production is B12; stop proof is B14.
Success without test evidence remains an explicit limitation in get_task_result.

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
- A service exclusively creates `locks/service-owner.lock` before reconciliation and
  holds ownership until `service.close()`. A second service for that home fails with
  `unavailable`. A lock left by a crash is not removed automatically; inspect the
  recorded PID and state before a maintainer removes it and restarts the service.
  Closing permanently disables all four operations on that service instance, even
  after another instance acquires ownership. Direct store maintenance is cooperative:
  stop all services and workers before modifying state or removing a stale lock.
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
12. Fixture secrets matching the documented patterns in requests are rejected before
    persistence and in returned text artifacts are redacted; errors never echo request
    values. This pattern policy does not inspect arbitrary binary artifacts or prove
    complete secret detection.
13. One real client run through the transport returns a result; mock-only runs are
    labelled as mock in the evidence.

## Out of scope for M2b

Remote access and authentication, multi-worker routing, semantic memory, automatic
fallback (M2c), automatic merge, a UI, scheduled retries and paid providers.

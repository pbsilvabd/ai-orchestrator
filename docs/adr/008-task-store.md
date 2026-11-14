# ADR-008 — Durable task store and idempotency index

Date: 2026-11-02. Status: accepted for M2b step 2.

## Context

[ADR-007](007-task-contract.md) made [task-contract.md](../task-contract.md) normative
and the MCP capability gate passed, so M2b step 2 needs durable task records: one
record per task, a client-scoped idempotency index and startup reconciliation. The
existing ledger ([ADR-004](004-local-ledger.md)) solves a different problem: one
in-flight external call per session, held under an exclusive lock for the whole call.
A task lives across many writes and is read by the supervisor while the service works,
so it needs a record store, not a session lock.

## Decision

1. `src/tasks.mjs` exposes `openTaskStore({ home, retentionMs = DEFAULT_RETENTION_MS })`
   with `createTask`,
   `readTask`, `updateTask`, `listTasks`, `reconcile` and `prune`. It owns persistence
   only: no operation validation, no executor, no cancellation semantics.
2. Layout: `tasks/<taskId>.json` plus `idempotency/<sha256(clientId, key)>.json` under
   `AI_ORCHESTRATOR_HOME` (default `%LOCALAPPDATA%\ai-orchestrator`, or
   `$XDG_STATE_HOME`/`~/.local/state` elsewhere). The home is never inside the
   repository and tests always pass a temporary directory.
3. Writes reuse the ADR-004 pattern per record: exclusive temporary file in the same
   directory, fsync, close, rename. Reads are never allowed to rewrite a committed
   record.
4. `createTask` writes the record first and the index second. If the index write
   fails, the orphan record is deleted and the call reports `unavailable`, so a retry
   in the same process cannot create duplicate work. If the process dies between the
   two writes, `reconcile` rebuilds the missing entry from the record.
5. The idempotency hash covers the canonical payload: sorted keys, no whitespace and
   `clientSessionId` removed. The key is scoped per `clientId`, so two clients may use
   the same key.
6. `reconcile` runs once while the service initializes, before any request is accepted.
   It preflights existing indexes and returns conflicts without mutating task records.
   The service fails closed on conflicts. A running service does not reconcile again
   for each connection. Reconciliation turns `running` tasks
   and `queued` tasks that already carry an attempt into `blocked` with
   `reason: "service-restart"`; it never resumes or replays work. It also repairs the
   index and reports ambiguous entries instead of overwriting them.
7. `prune` is explicit maintenance. `blocked` records are never removed automatically;
   terminal records expire after 30 days by default when explicitly pruned; callers
   may configure a validated retention duration.
8. M2b originally assumed one service process, with no cross-process ownership lock.
   See the B05 amendment below for the implemented service lock; direct store handles
   remain cooperative tools for maintenance and tests. `artifacts/` stays deferred.

## Consequences

- An unreadable or invalid record is `unavailable`, never an absent task, and never
  reset. Recovery is a maintainer action, as in ADR-004.
- Duplicate-work safety depends on successful reconciliation before accepting any
  operation. A service that skips `reconcile` can create a second task for a key whose
  record survived a crash; an ambiguous index keeps the service unavailable until
  maintainer repair.
- Records are re-read from disk on every call, so a second process sees committed state
  without a shared cache. This is cooperative-writer visibility, not a transaction.
- Filesystem failure details are reduced to the OS error code (`error.osCode`),
  because Node messages repeat the absolute home path, which must not reach logs or
  clients.
- Store tests use injected timestamps and temporary directories; they do not validate
  the transport, the executor or the operation semantics.

## Amendment — 2026-11-02: B04a lifecycle guards

The store now validates legal ordinary transitions and immutable identity/request
fields before updating records; startup reconciliation uses the same guard.
State-dependent block/cancel/timestamp checks also apply on reads. Legacy invalid
v1 records fail closed as unavailable without automatic repair. Valid v1 records
retain their format. See the contract's Store enforcement section for exact scope.

This implements the immediate safety concern described in RFC-0002 (#9), using a
small private table without depending on RFC-0001's schema checker. It does not
adopt those RFCs wholesale. Terminal artifacts remain writable; terminal lifecycle
metadata does not. Ordinary callbacks cannot prove worker stop or authorize human
reconciliation, so those future operations are intentionally not exposed here.
Dispatch creation (B12), stop proof (B14) and maintenance
tooling (B18) remain separate work. No SQLite dependency or schema migration is added.

## Amendment — 2026-11-03: B05 service ownership

`createTaskService` exclusively creates `locks/service-owner.lock` before startup
reconciliation and keeps it until the returned `close()` function is called. A second
service for the same home fails closed with `unavailable`. Initialization failures
release the lock. The lock records PID and start time; stale locks are never reclaimed
automatically after a crash because process identity and worker outcome need maintainer
inspection. Direct `openTaskStore` handles remain available for explicit local
maintenance and tests; they do not acquire service ownership themselves.

## Amendment — 2026-11-03: B03 repository identity and immutable base commit

Task submission (`submit_task`) requires repository identity validation via `src/repository.mjs`:
the repository path must resolve to a valid Git work tree contained within configured writable roots
after canonical path resolution (preventing path-prefix sibling bypasses and symlink escapes).
The commit-ish `baseRef` is resolved to a full commit SHA (`baseCommit`) and stored as immutable metadata
on the task record without replacing `request.repository.baseRef` and without changing canonical payload hashing.
The target `branch` must be a valid ref format, absent locally, and not checked out in any linked worktree.
Submissions against a dirty parent working tree are accepted and leave user files untouched.

Idempotency resolution by original canonical payload precedes filesystem and Git inspections: identical
replays return the original task ID and base commit without revalidating repository existence, branch state
or moving refs. Older records lacking `baseCommit` remain readable by `readTask` and `get_task_result`.

## Amendment — 2026-11-04: B12 durable single-worker dispatch

The opt-in service scheduler records running state and one attempt with an immutable
planned B09 workspace binding in the same atomic JSON write before setup/spawn.
Attempt workspace metadata is optional for legacy v1 records; when present it must
match task identity/base/branch and valid absolute task/receipt paths. A workspace
receipt is not process stop proof. B09 retains its separate verified Git receipt.
The scheduler canonicalizes its workspace root before reserving an attempt, so
aliased/Windows short-name home paths cannot diverge from B09's canonical receipt.

The service schedules only newly accepted submissions, never persisted dispatches
or preexisting pristine queues on startup. Duplicate submissions do not enqueue.
One task runs at a time. Known process exits are recorded without inventing artifact
or test evidence. Unknown results/persistence errors halt dispatch and retain state.

Worker-enabled close disables new dispatch, persists active work as blocked before
abort, waits for scheduler settlement and retains ownership whenever stop is unknown.
It returns an explicit ownership-release result; callers must await it. Passive
services preserve synchronous close. This conservative B12 behavior deliberately
does not provide B14 stop proof or B18 recovery tooling. Maintainers must inspect
processes, workspaces, effects and records before manually removing a retained lock.
No background retry, stale-lock reclamation, cleanup or new dependency is added.

## Amendment — 2026-11-09: B14 active cancellation and late events

For an active task, `cancel_task` first durably records `blocked` with reason
`cancelled-uncertain`, request time, `executionStopped: "unknown"` and
`effectsReverted: false`; only after that write does it signal the scheduler's root
process with its abort controller. The scheduler halts queued dispatch. When the root
settles it may attach a bounded partial artifact snapshot, without launching configured
artifact tests, while preserving the blocked lifecycle fields. Cancellation of pristine
queued work remains a no-dispatch `cancelled` transition.

The B10 adapter reports root-exit evidence separately and always reports
`descendantsStopped: false`. B14 does not equate a root exit with a process-tree stop,
or a stop with effects being reverted. Therefore it adds no generic or public
`running → cancelled` proof path. Cancellation/deadline/crash uncertainty remains
blocked and unreplayed; a late success cannot replace a previously persisted block.

The partial artifact can carry an optional `workerLog` in a v1 record. It contains
bounded and redacted output the scheduler captured from the interrupted worker,
even when no task budget remains for Git collection. It is separate from test
runs and does not change the blocked lifecycle or its stop evidence.

## Amendment — 2026-11-14: B18 explicit recovery, exclusion and prune journal

The task store now has a dedicated local maintainer handle and CLI. The service and
maintenance lock files interlock through exclusive creation plus post-acquisition
checks; stale-owner takeover additionally uses an exclusive recovery gate that service
startup checks before and after acquiring ownership. Direct prune/reconciliation calls
require an opaque in-process maintenance capability, never a nonce read from the lock
file. Service startup reconciliation has distinct scoped authority. No maintenance
operation is reachable through the four service operations, MCP, or worker configuration.

Stale locks are never automatically reclaimed. Explicit recovery verifies the recorded
PID is absent using Node's process probe, requires operator-supplied complete process
inventory, empty live-worker list, process-tree and evidence assertions, writes an audit receipt bound to the exact lock bytes, then
removes only unchanged lock bytes. A PID probe does not establish process start
identity, descendant termination or external-effect status. Windows process-tree
inspection, backups and ambiguity refusal are in `docs/task-maintenance.md`. The
filesystem remains a trusted local cooperative-writer boundary; human evidence is
not OS authentication or cryptographic proof.

Only a dedicated store operation may transition `blocked` to `failed` or `cancelled`.
It binds the audit to exact task bytes/state/decision, preserves dispatch identity,
attempts, the original block and `effectsReverted: false`. A known failure requires
completed recorded failure outcomes; an explicitly investigated administrative
failure may close an interrupted attempt while preserving its unknown outcome and
unknown stop state. Cancellation still requires a persisted request. Result
limitations distinguish administrative closure from proven execution failure.
Generic updates and MCP remain unable to reconcile.

Pruning is explicit with 30 days as the validated configurable default and never
removes blocked work. A durable per-task journal precedes record removal. Reconciliation
clears an unused journal when the matching record remains, or completes conversion of
the exact matching idempotency index to a durable key-reservation tombstone when the
record is absent. Pruned keys cannot silently create duplicate tasks; changed payloads
remain conflicts. Conflicts and unjournaled orphans remain fail-closed. This is
interruption recovery, not a power-loss durability or hostile-writer guarantee.

## Revisit triggers

Revisit when: a second client or remote access requires authentication of `clientId`,
retention requirements change, or a future storage engine is considered.

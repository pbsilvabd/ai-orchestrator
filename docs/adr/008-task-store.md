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

1. `src/tasks.mjs` exposes `openTaskStore({ home, retentionMs })` with `createTask`,
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
   terminal records expire after 30 days by default.
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

## Revisit triggers

Revisit when: M2b carries
task artifacts (step 4) that need `artifacts/`; a second client or remote access
requires authentication of `clientId`; or retention needs a configurable per-task
override.

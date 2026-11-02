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
6. `reconcile` runs at startup, before any submit is accepted. It turns `running` tasks
   and `queued` tasks that already carry an attempt into `blocked` with
   `reason: "service-restart"`; it never resumes or replays work. It also repairs the
   index and reports ambiguous entries instead of overwriting them.
7. `prune` is explicit maintenance. `blocked` records are never removed automatically;
   terminal records expire after 30 days by default.
8. No cross-process lock and no concurrency control here: M2b runs one service process
   and one task at a time. `locks/` and `artifacts/` from the contract layout are not
   created until the step that uses them, so the store does not imply capabilities it
   lacks.

## Consequences

- An unreadable or invalid record is `unavailable`, never an absent task, and never
  reset. Recovery is a maintainer action, as in ADR-004.
- Duplicate-work safety depends on reconciling before accepting submits. A service that
  skips `reconcile` can create a second task for a key whose record survived a crash.
- Records are re-read from disk on every call, so a second process sees committed state
  without a shared cache. This is cooperative-writer visibility, not a transaction.
- Filesystem failure details are reduced to the OS error code (`error.osCode`),
  because Node messages repeat the absolute home path, which must not reach logs or
  clients.
- Store tests use injected timestamps and temporary directories; they do not validate
  the transport, the executor or the operation semantics.

## Revisit triggers

Revisit when: the service surface (step 3) needs cross-process exclusion; M2b carries
task artifacts (step 4) that need `artifacts/`; a second client or remote access
requires authentication of `clientId`; or retention needs a configurable per-task
override.

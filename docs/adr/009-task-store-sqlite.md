# ADR-009 — Task store evolution: SQLite via `node:sqlite` (proposed)

Date: 2026-11-02. Status: **proposed** — the decision is made by merging this RFC.
If accepted, implementation is scheduled **after** the M2b acceptance run and never
blocks the executor adapter. This ADR changes no normative document today:
[task-contract.md](../task-contract.md), code and tests change together at
implementation. It supersedes the storage mechanism of [ADR-008](008-task-store.md)
only through that future implementation change; [ADR-004](004-local-ledger.md) (the
operation ledger) is out of scope.

## Context (what already exists)

[ADR-008](008-task-store.md) selected the durable JSON store and it has landed:
`src/tasks.mjs` (step 2) and the service surface in `src/service.mjs` (step 3) with
independent review corrections (83 suite tests and nine reproductions passed). The
executor adapter (step 4) is next. An earlier draft of this proposal argued for
choosing SQLite *before* any store existed; that premise is gone — this text follows
the repository as it is.

The reason to still open the decision is that ADR-008's own revisit triggers have
arrived or are imminent:

- "*the service surface (step 3) needs cross-process exclusion*" is effectively
  here: step 3 shipped, and step 4 brings artifact writes and a second writer
  pattern around one task;
- artifacts (diff/log/test evidence) are about to be stored, and nothing binds
  their persistence atomically to the status transition that exposes them.

Three concrete seams in the shipped store are the substance behind those triggers.
They are code-observed facts, not hypotheticals:

1. `updateTask(taskId, mutate)` in `src/tasks.mjs` is a read–clone–mutate–write
   with no compare-and-swap and no lifecycle guard in the store. Every caller
   re-reads the record, mutates a clone and replaces the whole file; correctness
   rests on the single-process, one-task-at-a-time M2b contract. A second writer
   whose reads interleave loses an update silently.
2. A crash between the task-record write and the idempotency-index write is closed
   by the serving convention "run `reconcile` before accepting requests", not by a
   transaction; duplicate-safety inside that window depends entirely on the restart
   path being respected.
3. Startup reconciliation is a directory scan that rereads and rerevalidates every
   record and preflights every index entry; its cost grows linearly with record
   count and is paid on every boot.

None of these is a defect within the stated M2b scope: ADR-008 deferred exactly
these concerns. They are the places where the JSON pattern begins to be a
hand-rolled database without transactions, constraints or indexes — and the places
the proposed engine changes structurally.

## Proposal

Same primitives, new engine. `openTaskStore(...)` keeps its interface
(`createTask`, `readTask`, `updateTask`, `listTasks`, `reconcile`, `prune`) and its
M2b single-writer semantics promise; `src/service.mjs` is untouched. The change is
one module behind that interface.

1. **Engine**: SQLite through the bundled `node:sqlite` module (`DatabaseSync`) —
   no third-party runtime dependency and no new license surface (Node is
   MIT-licensed; the bundled SQLite is public domain). Database file:
   `AI_ORCHESTRATOR_HOME/tasks.db` plus SQLite sidecar files. Never inside a
   repository; tests use temporary directories and unit tests may use in-memory
   databases.
2. **Transactional creation**: the task record and its idempotency entry commit in
   one `BEGIN IMMEDIATE` with `UNIQUE(client_id, idempotency_key)`. Equal key and
   equal payload hash return the original `taskId` with no added work; equal key
   and different hash is `idempotency_conflict`. Seam 2 disappears as a category
   instead of being served around.
3. **Lifecycle remains in service code, and the store additionally enforces it**:
   transitions run as conditional updates; CHECK constraints and one trigger guard
   the contract lifecycle — including the restart transition `queued → blocked`
   that `reconcile` already performs for dispatched queued tasks. A contract gap
   is flagged here: the prose rule in `docs/task-contract.md` ("an existing attempt
   blocks" a `queued` task) requires this transition, but the contract's Lifecycle
   diagram has no `queued → blocked` row. The implementation change amends the
   contract in the same change to add the row; this documentation PR edits the
   contract neither in code nor in prose.
4. **Event log**: `task_events` rows are append-only, written in the same
   transaction as each transition; `get_task_status.progress` is assembled from
   them. An `UPDATE` guard trigger prohibits in-place edits (retention `DELETE`s
   remain allowed).
5. **Migrations are forward-only and owned here**:
   `schema_migrations(version, applied_at, checksum)`; each step runs in its own
   `BEGIN IMMEDIATE`; a checksum divergence or a failed migration refuses startup;
   `PRAGMA user_version` is kept in sync for external inspection. The storage
   schema version is independent of the response `schemaVersion`.
6. **Durability posture**: `journal_mode=WAL`, `synchronous=FULL`,
   `busy_timeout=5000`, `foreign_keys=ON`; modes 0600/0700 where honored (Windows
   ACLs depend on the host). ADR-004's status quo holds: no power-loss promise;
   network filesystems unsupported (WAL shares the constraint). Startup runs
   `PRAGMA quick_check`; corruption refuses startup, fail-closed, with manual
   reconciliation as in ADR-004/008. `reconcile`'s semantics are unchanged:
   `running` and dispatched-`queued` tasks become `blocked`, nothing resumes.
7. **`node:sqlite` is experimental** in the pinned Node line (an
   `ExperimentalWarning` is printed to stderr; the API may change). Mitigations:
   the narrow primitive seam above, a pinned Node version, the warning treated as
   expected stderr output (stdio stdout must stay pure for MCP), the storage
   capability gate below, and the revisit triggers.

## Driver sketches (validated probes, in-memory, 2026-11-02)

The probes are recorded as preliminary, non-gating evidence in validation.md. The
final DDL is delivered with the implementation; these sketches fix invariants, not
the full column list.

```sql
CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,              -- opaque UUIDv4
  client_id           TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN
                        ('queued','running','succeeded','failed','blocked','cancelled')),
  created_at          INTEGER NOT NULL,              -- epoch ms UTC
  started_at          INTEGER,
  finished_at         INTEGER,
  block_reason        TEXT,
  cancel_requested_at INTEGER,
  cancel_stopped      TEXT CHECK (cancel_stopped IS NULL
                                    OR cancel_stopped IN ('true','unknown')),
                                  -- shipped vocabulary verbatim: null | true | 'unknown'
  payload_sha256      TEXT NOT NULL,
  request_json        TEXT NOT NULL,                 -- canonical request body
  -- effectsReverted is not a column: shipped records validate it to stay false and
  -- the service reads it from the record, so no import path may store another value.
  CHECK (status <> 'blocked' OR block_reason IS NOT NULL),
  CHECK (status NOT IN ('succeeded','failed','cancelled') OR finished_at IS NOT NULL)
);

CREATE TRIGGER trg_task_transition
BEFORE UPDATE OF status ON tasks
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'queued'  AND NEW.status IN ('running','cancelled','blocked')) OR
  (OLD.status = 'running' AND NEW.status IN ('succeeded','failed','blocked','cancelled')) OR
  (OLD.status = 'blocked' AND NEW.status IN ('failed','cancelled'))
)
BEGIN
  SELECT RAISE(ABORT, 'illegal_task_transition');
END;
```

Transitions become compare-and-swap writes instead of whole-record replacement:

```js
const result = db.prepare(
  'UPDATE tasks SET status = ?, started_at = COALESCE(started_at, ?) ' +
  'WHERE id = ? AND status = ?'
).run(nextStatus, now, taskId, expectedStatus);
if (result.changes === 0) fail('unavailable', 'task state changed concurrently');
```

Migration runner sketch (fail-closed, per-step transaction):

```js
for (const m of pending) {
  const recorded = applied.get(m.version);
  if (recorded === m.checksum) continue;
  if (recorded !== undefined)
    throw new Error(`checksum mismatch on applied migration ${m.version}`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(m.sql);
    db.prepare(
      'INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?,?,?)'
    ).run(m.version, Date.now(), m.checksum);
    db.exec(`PRAGMA user_version = ${m.version}`); // integer literal, not user input
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
```

Probe watch-outs, recorded so the implementation does not rediscover them:
`changes` is a number (not BigInt); `PRAGMA user_version` returns an object; the
`ExperimentalWarning` arrives on stderr.

## Migration from the shipped store

Records already exist, so the second thing this ADR fixes is the import path.

- **One-time, maintainer-executed, all-or-nothing.** A documented script opens one
  `BEGIN IMMEDIATE`, reads every `tasks/*.json` (validated with the shipped v1
  checks) and every `idempotency/*.json`, inserts normalized rows, writes the
  authority-switch marker and commits. Any unreadable or ambiguous input rolls the
  transaction back; the service keeps running on JSON; a failed migration never
  mutates the existing store.
- **Normalization keeps semantics, rederives nothing.** `attempts[]` becomes
  attempt rows, `progress[]` becomes `task_events`, `block.reason` and the
  `cancel` fields become columns, the canonical request body is stored as JSON,
  hashes are carried over verbatim. Status values are imported exactly as written
  (including `blocked`); no state is recomputed at import.
- **Authority switch on cold start.** After the marker, `tasks.db` is authoritative
  and the JSON directories are frozen history: never written, never deleted
  automatically. Retention (`prune`) removes terminal rows from the database from
  then on and preserves the shipped behavior in one respect: a pruned task and its
  idempotency entry are removed together, in one transaction, instead of two file
  deletions.
- **No replay is introduced.** The next startup runs the existing `reconcile`
  semantics unchanged.

## Indexes and growth (proposal, measured — not normative)

Baseline, shipped with the first implementation, justified by correctness and known
access paths: primary keys; `UNIQUE(client_id, idempotency_key)`;
`task_events(task_id, seq)`; `attempts(task_id)`; `artifacts(task_id, kind)`.

Growth-sensitive indexes are explicitly deferred to measurement. The preliminary
probe (20,000 seeded rows plus `ANALYZE`) already recorded a trap worth writing
down: a partial index with predicate `status IN ('queued','running')` is used only
by queries written in that same `IN` form; `status = 'running'` scans, because the
SQLite planner does not infer the implication. A per-status partial index covers
the single-status query. Empty-table plans were misleading in an earlier probe and
are not trusted again; measurement happens on seeded data.

Candidates to measure (none promised here): the partial active index in its matching
query form, per-status partial indexes, a generated `is_active` column, a full
`status` index, and a retention index on `finished_at` restricted to the prunable
terminal statuses (`succeeded`, `failed`, `cancelled`); `blocked` is never pruned,
so it must stay out of the range and out of the scans that serve retention deletes. Growth expectations are recorded: `tasks` is monotonic because `blocked`
rows are never pruned; `task_events` grows fastest; artifacts stay bounded by the
contract caps (≤ 1 MiB diff, ≤ 256 KiB logs).

**Measurement protocol.** Synthetic datasets at 1k / 10k / 100k / 1M tasks (events
~5–10x; artifacts near caps); run `ANALYZE` and `EXPLAIN QUERY PLAN` for the four
operations, reconciliation and retention; record chosen plans, `sqlite_stat1` and
p95 latencies in validation.md; keep `PRAGMA optimize` as the maintenance hook.
Review triggers (calibrable): tasks > 100k; events > 1M; any hot query regressing
to `SCAN`; status p95 above the local budget; a persistently falling active-row
share. Adoption happens through a forward migration recorded in this ADR — never
by silent DDL.

## What stays, what waits

- **The executor adapter (step 4) proceeds on the shipped JSON store primitive.**
  This proposal does not block any M2b step. If accepted and implemented after M2b
  acceptance, the adapter gains atomic terminal-status-plus-evidence writes; the
  artifact persistence shape (bounded blobs inside the database vs. bounded files
  referenced by rows) is an implementation-time decision defaulting to blobs.
- **MCP transport instability — the current handoff next action — is untouched**
  by this proposal; it remains the prerequisite for executor/client integration.
- **[task-contract.md](../task-contract.md) changes only with the implementation**
  code and tests, in the same change, as the repository's rule requires.

## Storage capability gate (implementation step 0)

Using the same discipline as the MCP capability gate. Required evidence, executed
against file-backed temporary directories and recorded in validation.md (this gate
is gating; transcripts are the evidence, and it stays outside `node --test`):

1. the pinned Node version recorded explicitly (`fnm`-managed; the earlier probe
   shell reported v24.11.1 while the documented toolchain claims 24.22.1 — this
   must be reconciled before any support claim);
2. file-backed WAL database with a concurrent reader while a writer commits;
3. a process killed between record and index insert leaves no partial row, and the
   restarted service creates no duplicate task for the same idempotency key;
4. a process killed mid-transaction rolls back completely — no half-written task;
5. migrations apply exactly once across restarts; a checksum mismatch and a
   corrupted database file both refuse startup; `quick_check` failure refuses the
   service;
6. two connections contend and resolve through `busy_timeout` without corruption;
7. platform evidence on Windows to the extent Windows stays a declared platform.

Gate failure → an amendment either adopting the `better-sqlite3` driver (a new
third-party dependency, which would require its own decision) or keeping the JSON
store and closing this proposal with recorded findings. Never silently.

## Risks and accepted costs

- **Experimental core module.** `node:sqlite` may change API; mitigated by the
  narrow primitive seam, the pinned Node, expected stderr warning, the gate and the
  revisit triggers.
- **Two persistence engines coexist** while the ADR-004 ledger stays JSON. Their
  scopes are separate by design; unifying them later is a new decision.
- **Plain-file inspectability is traded away** in favor of queries. A maintainer
  read-only export procedure can be added if a need demonstrates itself (non-goal
  here).
- **The synchronous API holds the event loop** during writes. Acceptable under
  one-task-at-a-time with bounded payloads; revisit with M5 concurrency.
- **Migration discipline is real**: the import is all-or-nothing; the JSON
  directories are frozen, never deleted; the maintainer owns the switch point.

## Consequences

Positive: transactional deduplication and terminal-time evidence; structural
prevention of illegal transitions; reconciliation switches from rereading and
revalidating every record file to indexed row reads — an expected startup-cost
improvement, unmeasured by the probes and never claimed here as constant time;
WAL lets the polling reader proceed while a writer commits; a schema-evolution
path exists; an explicit, measured index policy replaces speculative tuning.

Negative/accepted: a second storage engine to own end to end (gate, migrations,
import script); an experimental core module behind a narrow seam; the migration day
is a distinct maintainer event; JSON records must be imported, not regenerated.

## Revisit triggers

- `node:sqlite` reaches stable, changes its API, or the storage gate fails;
- the maintainer declines: close this proposal, record findings, keep the JSON
  store as accepted by ADR-008;
- M5 proposes concurrency beyond a single writer;
- artifacts or events outgrow their caps, or the measurement triggers fire;
- remote access, or unifying the ledger with the task store, is proposed.

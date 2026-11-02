# ADR-004 — Local checkpoint and exclusive per-session lock

Date: 2026-11-02. Status: accepted for M1b.

openSession acquires a lock through exclusive creation (wx), named using the
SHA-256 of sessionId. It holds the lock during the external call, computes
transitions from current state, writes an exclusive temporary file in the same
directory, fsyncs and closes the file, then renames it over the checkpoint.
It never truncates the committed checkpoint. select returns dispatch only after
writing; persistence failures invalidate the handle. Snapshots are copies.
Invalid JSON, incompatible schemas and session mismatches stop without resetting.

The lock deliberately remains after a crash. There is no time/PID expiration,
because neither proves absence of effects. The operator must stop session writers,
confirm the owner has terminated, preserve copies and reconcile effects before
removing the lock. A pending checkpoint remains blocked even without the lock.
Never edit pending to false to force replay. Known results can be confirmed with
the original dispatch; unknown outcomes require external investigation.
There is no recovery CLI. Temporary files from dead processes are never promoted.

Scope: a local filesystem, cooperative writers and a trusted directory without
external changes to locks/checkpoints/symlinks. Modes 0600/0700 are requested;
Windows ACLs depend on the host. This is not authentication, defense against a
hostile agent or a distributed lock. Network filesystems are unsupported.
Directory metadata is not portably synchronized: power-loss/OS-crash durability
is not promised.

Persisting before dispatch may leave pending state even if the call never happened.
Failure to persist success also requires reconciliation. Reduced availability is
preferred over repeating uncertain effects. There is no exactly-once guarantee or
transaction with external services. OpenCode retains message history.

Evidence: Windows/Node tests cover reopening, interprocess locks, a process dying
without close, corruption, rename errors and persisted fallback/blocking.
Cancellation and time budgets were subsequently covered locally by ADR-005;
OpenCode integration remains pending.

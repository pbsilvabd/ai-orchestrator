# ADR-003 — Dispatch identity and state version 2

Date: 2026-11-02. Status: accepted.

Checking only model/pending lets a stale result from a previous operation complete
a new operation using the same model. Each operation now receives a UUID generated
by the Node runtime; each attempt receives operationId plus an ordinal. Dispatch
also carries sessionId and model. success/failure check all fields against current
state before changing anything.

The consumer must carry the original dispatch identity with the call.
Reconstructing it from current state inside a callback defeats the protection.
Identity provides correlation, not authentication: the consumer remains trusted.

State version 2 rejects v1 checkpoints. With no installed runtime or known
production data, we do not introduce automatic migration that might unlock an
uncertain old operation. Legacy checkpoints require manual reconciliation.

These transitions do not guarantee mutual exclusion: two writers using the same
copy could accept the same event. An atomic ledger and lock are the next gate
before connecting real OpenCode callbacks (subsequently covered by ADR-004).
There is no exactly-once guarantee.

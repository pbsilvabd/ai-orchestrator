# ADR-001 — Composition and a verifiable policy before integration

Date: 2026-11-02. Status: accepted for the scaffold.

## Context

The project intends to reuse OpenCode, plugins and ai-memory. Plugin inspection
found behaviors incompatible with our conservative policy: authentication fallback,
message-part conversion and replay. Declared compatibility does not establish
safety around side effects or restarts.

## Decision

Pin OpenCode 2.2.5 as the contract reference. Do not modify its core or enable
plugins automatically. Deliver a pure JavaScript ESM policy and a Node suite
without external libraries as an executable specification for the future adapter.
Do not build a proxy, production router, multi-agent system or memory in this increment.

Fallback is limited to authorized models, without retries on the same model at
this stage. This excludes loops and active backoff from the initial scope;
cooldown and Retry-After are represented as timestamps. Quotas without known reset
times require intervention. Never silently degrade message parts to obtain success.

Operational state is distinct from semantic memory. A persisted dispatch still
pending after a crash requires reconciliation. There is no exactly-once promise.
ai-memory remains a future candidate, not an installed dependency or a replacement
for an operational ledger and concurrency control.

## Consequences

Tests are inexpensive and reproducible, but approve no plugin and do not
demonstrate real OpenCode continuity. A small project-specific specification must
be maintained; it should become integration code only where existing components
are insufficient. Production requires atomic persistence, locks, capability/message
validation, time budgets, cancellation and evidence of replay safety.

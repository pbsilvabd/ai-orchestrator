# Scope and acceptance criteria

## Product objective

Provide a pluggable worker service for a primary LLM that delegates and supervises.
Workers execute scoped tasks and return status, artifacts and evidence. The primary
end-to-end acceptance workload is development of this repository, with human review.
OpenCode is the initial executor candidate, not a required supervising client.
See [ADR-006](adr/006-worker-service.md).

## Delegation MVP (M2a complete; M2b next)

M2a fixed the contract in [task-contract.md](task-contract.md) and the decisions in
[ADR-007](adr/007-task-contract.md): MCP over stdio (revision `2026-07-28`) with
OpenCode 2.2.5 as the first supported client, behind a capability gate, and a
loopback HTTP fallback for the transport adapter only.

M2b must implement submit/status/result/cancel for one worker. Task submission
returns a stable ID; work continues between polls. Persistent lifecycle, result
retrieval, duplicate-request handling, task ownership, authorized actions/models,
budgets, cancellation without claims of reverted effects, and uncertain-outcome
recovery are specified and must be tested. Real client integration is required;
mock-only evidence does not satisfy M2b.

Remote access requires an explicit authenticated deployment design and remains out of
scope. No universal web compatibility or continuous background supervision is promised.

B12 local implementation adds an explicitly configured single-worker queue with
durable dispatch, no duplicate scheduling and conservative shutdown/ownership.
B13 artifacts, B14 stop handling and B15 MCP stdio transport are merged. B16's
pinned OpenCode 2.2.5 fixture-provider workflow has six initial review corrections
published, and three blocking follow-ups are now corrected locally: case-insensitive Git
environment isolation, client-carried task IDs and cleanup after the host leader exits.
The new corrections still need publication, current-head CI and re-review;
B17's executable acceptance matrix remains required for M2b. A normal worker exit without recorded
test evidence is reported with a limitation.

## Delivery 0: scaffold (current)

- Pure policy, explicit allowlist, attempt limit and cooldown.
- Conservative blocking for authentication, unknown quotas, partial responses and effects.
- Tests using synthetic data, file checkpoints and new processes.
- Audit of pinned sources and ADRs; no enabled plugins or committed credentials.

## Safe worker fallback: OpenCode integration (M2c, pending)

M1a is complete: HTTP/Retry-After normalization and loopback tests. M1b includes
correlation, checkpoints, locking and a runner with local cancellation/budget.
See the [roadmap](roadmap.md) and [Definition of Done](definition-of-done.md).
The priority destination is a real task executed by the project in its own repository (M3).

| Scenario | Acceptance criterion in the real host |
| --- | --- |
| 429 before a response | B takes over in the same session, preserving context and permissions |
| A and B fail | Stops without loops or attempts beyond the budget |
| Restart | History preserved; uncertain dispatch blocked |
| Failure after a write | No automatic replay of the action |
| A recovers | Returns only in a new safe operation, after cooldown |

Use a local failure endpoint and test tools instead of exhausting real quotas.
The adapter must normalize Retry-After (seconds/HTTP date), observe effect
boundaries, reject incompatible capabilities and persist before dispatch. It must
handle duplicate callbacks, concurrency, expiration and cancellation. The current
policy assumes a single trusted caller and prevalidated compatible models.

## Outside the immediate delivery (M2b)

Real providers, OAuth, paid APIs, automatic discovery, multi-agent execution,
intelligent classification, semantic memory, UI, same-model retries with backoff,
and publishing the private repository. Do not treat subscriptions as generic APIs
or switch accounts to bypass limits.

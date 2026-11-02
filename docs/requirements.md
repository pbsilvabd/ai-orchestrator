# Scope and acceptance criteria

## Product objective

Provide a pluggable worker service for a primary LLM that delegates and supervises.
Workers execute scoped tasks and return status, artifacts and evidence. The primary
end-to-end acceptance workload is development of this repository, with human review.
OpenCode is the initial executor candidate, not a required supervising client.
See [ADR-006](adr/006-worker-service.md).

## Delegation MVP (M2a/M2b, pending)

Specify and implement submit/status/result/cancel operations for one supported
client and one worker. Task submission returns an ID; work continues between polls.
Define persistent lifecycle and result retrieval, duplicate-request handling,
task ownership, authorized actions/models, budgets and uncertain-outcome recovery.
Cancellation must not claim effects were undone. Real client integration and
self-development evidence are required; mocks alone are insufficient.

MCP is the preferred interface to evaluate; an API is an alternative. Client and
transport selection remain pending. Remote access requires an explicit
authenticated deployment design. No universal web compatibility or continuous
background LLM supervision is promised.

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

## Outside the immediate contract increment (M2a)

Real providers, OAuth, paid APIs, automatic discovery, multi-agent execution,
intelligent classification, semantic memory, UI, same-model retries with backoff,
and publishing the private repository. Do not treat subscriptions as generic APIs
or switch accounts to bypass limits.

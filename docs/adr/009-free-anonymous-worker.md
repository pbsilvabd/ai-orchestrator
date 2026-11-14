# ADR-009 — Anonymous free OpenCode worker route is prepared but not live

Date: 2026-11-14. Status: proposed; the maintainer must approve the live-route decision
before any real inference. The fixture composition described below is implemented and
pinned-host tested only against a loopback fixture.

## Context

The maintainer authorized investigation and fixture validation of one anonymous free
OpenCode model, `opencode/deepseek-v4.1-flash-free`, with no paid call, fallback, login or
account credential. Public metadata reports zero input, output and cache prices, tool
support, and an OpenAI-compatible endpoint at `https://opencode.ai/inference/openai/v1`.
Catalog availability and quota are not proven by that metadata.

OpenCode 2.2.5 has a built-in `opencode` provider. Without credentials it uses the public
key `public` and enables its models, and it fetches remote Console configuration only when
a connection exists ([pinned source](../plugin-audit.md#b29-free-route-evidence)). The
existing B11 builder accepts only loopback fixture providers, and ADR-008 and ADR-007 keep
task text unable to grant authority. Task text must therefore not select the route, the
approval or the guard.

## Decision

1. The free route is exactly `opencode/deepseek-v4.1-flash-free`, with the fixed endpoint
   `https://opencode.ai/inference/openai/v1`, the public anonymous key `public`, and
   `@opencode/ai/providers/openai-compatible`. A catalog snapshot must show that model and
   zero prices; otherwise admission fails closed. The snapshot is trusted operator input,
   valid for five minutes, and never fetched by the composition path.
2. A new submission on the free worker requires an operator approval file whose canonical
   request hash, model, zero paid budget, privacy acknowledgement and expiry (at most 24
   hours) match the payload. Admission happens after idempotent replay resolution and before
   persistence, workspace or branch creation. Launch repeats the same check.
3. The launch configuration disables title, summary, compaction, warming, snapshots, MCP,
   skills, other plugins and other providers, and places a service-owned guard plugin in a
   private runtime directory. The guard is loaded through the `plugins` array with a
   `plugin.use` allow statement for that directory only.
4. The guard allows only primary requests for the one model without a variant (the host
   reports the default variant as `default`, a no-op), only the fixed chat-completions URL,
   POST, the public bearer credential and a body with the same model; it refuses repeated
   bodies, expiry, and more than 12 requests, and latches after 401, 402, 429, other
   non-2xx responses and any host retry decision.
5. **Live composition is closed.** `createConfiguredTaskService` refuses a free worker
   configuration without an explicit loopback fixture endpoint, before reading approval or
   metadata. `mcp-server.mjs` therefore cannot start the live free route. The passive
   default is unchanged.
6. Public catalog reads and the free route are not contacted by any repository test, by the
   integration harness, or by the composition code. Live availability, quota and privacy
   remain `not_run` until a separately approved experiment.

## Alternatives considered

- Enable the live route now with the guard as the only redirect control. Rejected: the
  pinned host follows a 307 from the model endpoint and sends the prompt body to the target
  origin. The guard cannot prevent this request, and the host rebuilds the response before
  hooks see it, so the guard cannot detect it either (see Consequences).
- Set `redirect: "error"` on the guarded request. Rejected: the pinned host ignores that
  field for model requests and the B29 harness observed the redirect with it in place.
- Route model traffic through a trusted loopback relay owned by the service, which
  forwards only to the fixed endpoint with redirects disabled. Not implemented: it adds a
  listener and a new trust boundary that the maintainer must approve, and a relay is only
  as strong as its own egress control.
- Network egress control (firewall or proxy allowing only the fixed origin) on the
  worker host. Not implemented here: it is outside this repository and the B11 document
  already states that the builder is not an outbound firewall.
- Keep a single approval file for the whole service lifetime. Accepted with a limit: the
  approval is bound to one canonical payload, so only that request can be admitted; a
  restart is needed to refresh metadata.

## Consequences

- Redirect following is an unmitigated egress path for the live route on OpenCode 2.2.5.
  It stays a blocker until a decision selects a relay, an egress control or a host change.
- The guard depends on host behavior observed on the pinned 2.2.5 binary only. A different
  build, or a change to the default variant name, `model.request`, `http.request` or the
  retry hook, invalidates the guard evidence.
- The free route has no live evidence. The public key, the endpoint, the quota and the
  zero prices are external claims.
- Metadata becomes stale after five minutes; a long-lived service refuses new admissions
  until restarted with fresh trusted metadata.
- Experimental websocket hooks (`experimental.ws.*`) are not guarded. The free
  configuration does not select a websocket transport, but live approval must verify it.
- The public catalog fetch function `fetchFreeMetadata` exists but is unreachable from the
  composition path. Re-enabling it is a new decision.
- Fixture composition is available only through trusted application code with an
  explicit loopback endpoint and injected metadata; it is not exposed through MCP.

## Related documents

- [task card B29](../tasks/B29.md) — scope, matrix and execution status.
- [task contract](../task-contract.md) — admission clause for configured workers.
- [plugin audit](../plugin-audit.md#b29-free-route-evidence) — pinned plugin and provider evidence.
- [integration README](../../integration/README.md#b29-free-route-fixture-harness) — harness and its exit status.
- [validation record for B29](../validation.md) — commands, results and not-rerun checks.

## Revisit triggers

- The maintainer approves or rejects the redirect-control options above.
- A new OpenCode release or host patch exposes redirect control to plugins or config.
- Any live free-route experiment is proposed; it needs its own approval record.

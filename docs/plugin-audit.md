# Preliminary fallback audit

Date: 2026-11-02. Method: static inspection of checkouts pinned by SHA.
We did not run upstream suites, install the plugins or conduct a complete
security/supply-chain audit. Bun was unavailable in the environment.

## Pinned references

| Component | Version in package.json | Commit |
| --- | --- | --- |
| OpenCode / @opencode/plugin | 2.2.5 | `9bbb8ce18c80f099e0e448775f59d965ead40a21` |
| VastFuture / opencode-runtime-fallback | 1.0.0 | `f700bf1593be4f7622fa743eb4557900732b5698` |
| Smart-Coders-HQ / @smart-coders-hq/opencode-model-fallback | 0.1.0 | `4920240fb95c48b42f8d9e9d7648aa473740afe0` |

Versions come from inspected sources; equivalence with published tarballs was not verified.

## OpenCode 2.2.5

The [package.json](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/plugin/package.json)
confirms `@opencode/plugin` 2.2.5. The
[session contract](https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/plugin/src/promise/session.ts)
exposes `SessionRetry` with `decision` (`retry: false` or `retry: true; delay`)
and a readonly model. Do not assume changing the retry decision switches models
atomically. Switching, context and replay require real host tests that respect
the session queue.

## VastFuture: conditional candidate, not approved

- [package.json](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/package.json):
  V2 peer dependency and optional legacy SDK; development versions use ranges.
- [constants.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/constants.ts):
  default retries include 401 and 402, conflicting with our authentication/billing stop requirement.
- [error-classifier.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/error-classifier.ts):
  missing_api_key and model_not_found may be classified as retryable;
  removing 401 from configuration does not address every classification path.
- [index.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/index.ts):
  explicit V2 setup/adaptation exists. `promptAsync` filters text parts, switches
  models and submits a prompt through a delivery queue. This does not generically
  preserve images or other parts; context and multimodal messages need coverage.
  Operational state uses in-memory Maps/Sets.
- [message-replay.ts](https://github.com/VastFuture/opencode-model-fallback/blob/f700bf1593be4f7622fa743eb4557900732b5698/message-replay.ts):
  replay tries progressively smaller tiers after errors. This helper does not
  establish that a failed submission produced no effects before another attempt.

Decision: do not enable by default. Investigate minimal adaptation or an upstream
contribution after testing execution paths in the host. These findings describe
incompatibilities with our requirements, not a demonstrated exploit.

## Smart-Coders-HQ: do not select for this V2 target

- [package.json](https://github.com/Smart-Coders-HQ/opencode-model-fallback/blob/4920240fb95c48b42f8d9e9d7648aa473740afe0/package.json):
  peer `@opencode-ai/plugin >=1.2.0`, legacy SDK.
- [orchestrator.ts](https://github.com/Smart-Coders-HQ/opencode-model-fallback/blob/4920240fb95c48b42f8d9e9d7648aa473740afe0/src/replay/orchestrator.ts):
  locking and a deduplication window are useful; abort → revert → prompt repeats
  the last user message. Session revert does not prove external service effects
  were undone. We found no gate in that sequence proving absence of effects before resubmission.

Decision: do not assume 2.2.5 compatibility; retain only for comparison.

## Integration gate

Before enabling a candidate, pin dependencies/tarballs and run its upstream suite
plus OpenCode 2.2.5 tests: 429 before response, two failing models, 401/403,
Retry-After, connection loss after acceptance, file writes, external effects,
duplicate/concurrent events, restarts, tool/image messages, preserved permissions,
and returning to the preferred model only in a new safe operation. Also verify
log redaction, model discovery versus authorization and global provider limits.
Local policy tests do not implicitly satisfy any of these gates.

## B29 free-route evidence

Date: 2026-11-14. Scope: the guard plugin and the built-in `opencode` provider for the
single anonymous route `opencode/deepseek-v4.1-flash-free`
([ADR-009](adr/009-free-anonymous-worker.md)). Source: the OpenCode 2.2.5 tree in the
maintainer's audit directory, extracted from the pinned release archive; its commit was
not re-verified in this session. The release ZIP SHA-256 matched the published digest in
`SHA256SUMS`. Dynamic behavior was observed only on the pinned binary, with a loopback
fixture and no network call to the free route.

- Plugin loading (`packages/core/src/plugin/module.ts`): a local absolute directory is
  loaded without npm installation. `plugin.use` decisions use the last matching policy
  statement (`packages/core/src/managed-policy.ts`), so a directory-specific allow after a
  wildcard deny works. A denied plugin returns `{ blocked: true }`; how callers report it was
  not traced. The worker has no guard in that case, and its inert endpoint `127.0.0.1:1`
  should fail closed (not observed on the pinned binary).
- Hooks (`packages/plugin/src/promise/session.ts`, `packages/core/src/session/model-request.ts`):
  `model.request` may replace `baseURL`; `http.request` may replace the `Request`; `retry`
  honors `decision`; `title` honors `result`. The `http.response` event passes a `Response`
  rebuilt from status and headers, so `redirected` and the final URL are not visible.
- Model reference (`packages/schema/src/model.ts`): `{ providerID, id, variant? }`. The host
  reports the default variant as `"default"`, and `withVariant`
  (`packages/core/src/model-resolver.ts`) treats it as no overlay.
- Built-in provider (`packages/core/src/plugin/provider/opencode.ts`): without a key it sets
  `apiKey: "public"` and enables the provider; models with positive input cost are disabled
  when no key exists. Remote Console configuration is fetched only with a connection.
- Redirects: model requests use the default fetch client. Only specific calls set
  `FetchHttpClient.RequestInit` (for example websearch `redirect: "error"`, webfetch
  `manual`). The guard's `Request` redirect field is not honored. Observed: a 307 from the
  fixture was followed and the prompt body reached a second loopback origin without the
  bearer credential (B29 harness, `redirect-307`).
- Websocket: `experimental.ws.*` hooks apply only when the durable runner selects a
  websocket transport. Not guarded; the free configuration does not select it.

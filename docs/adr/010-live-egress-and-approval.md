# ADR-010 — Isolated worker egress and offline signed live approval

Date: 2026-11-14. Status: accepted as the B30 design gate only; no deployment,
live approval, inference or merge is authorized. Decided by: technical/security
decision requested by the maintainer. Reconcile the partial change to ADR-009's
loopback-listener wording in a dated amendment after B29 is available on main.

## Context

The pinned OpenCode 2.2.5 host follows a model endpoint 307 and delivers the
prompt to another origin before the B29 plugin can reject it. B29 closes live
composition. ADR-009 selects a trusted relay with independently verifiable
egress restriction, but does not specify a deployable isolation mechanism or
a cryptographically verifiable human approval. Loopback alone does not
authenticate a local peer, and an HTTP proxy environment variable does not
prevent a worker from connecting directly. A network-layer IP allowlist alone
also cannot reliably express an HTTPS origin backed by changing/shared IPs.

## Decision

1. **Worker compartment.** On Windows, the live worker runs in a disposable,
   non-administrator Hyper-V VM with one dedicated **Internal** virtual switch
   connected only to a dedicated relay VM. Do not use the Hyper-V Default
   Switch (it can include NAT/Internet Connection Sharing), an External switch,
   a second NIC, a default route, a guest DNS resolver or host IP forwarding,
   ICS or WinNAT for that switch. On Ubuntu, run the entire OpenCode process
   tree in a dedicated root-created network namespace with one veth peer to
   a separate relay namespace, no default IPv4/IPv6 route or external DNS,
   and default-drop
   IPv4/IPv6 OUTPUT/FORWARD filtering beyond the relay address/port. Remove
   network-administration capabilities from the worker; root/admin, VM or
   host-network administrators remain trusted. If Hyper-V, namespace controls
   or privileged deployment are unavailable, the platform remains fixture-only.
2. **Relay ingress.** The service-owned relay binds an explicitly configured
   private interface/address inside its own VM/namespace, not `0.0.0.0` or
   the public interface. On Windows its disposable relay VM has exactly two
   NICs: one on the worker's dedicated Internal switch, the other on a
   *different* Internal switch connecting only to a host-side gateway. On
   Ubuntu its relay namespace has one veth from the worker namespace and a
   separate veth to the host-side gateway. The relay VM/namespace has no
   direct Internet/default route; an outbound rule allows only the gateway's
   fixed private address/port. No NAT, ICS or host IP forwarding is enabled
   between these links. The service must own and verify the relay's lifecycle;
   a local in-process listener cannot satisfy this cross-compartment design.
   Allow only the one worker compartment's source address and the fixed model
   request shape. The B29 fixture keeps its loopback endpoint. This is an
   explicit *partial change* to ADR-009's future live loopback listener: the
   worker cannot reach the service's `127.0.0.1` across a VM/namespace boundary.
   Binding to a private address is not peer authentication; the host's local
   administrator/other processes remain inside the trusted machine boundary.
   A different local-peer threat model needs a separately reviewed transport.
3. **Relay egress.** The relay permits only the fixed upstream origin, method
   and path, rejects redirects without forwarding the body, and accepts no
   arbitrary destinations or
   inherited proxy/credential settings, and bounds request/response bytes,
   duration and count. For *independent* relay egress containment, deploy a
   separately administered layer-7 egress gateway on the host: the relay VM/
   namespace has no direct Internet route and can connect only to that fixed
   private gateway address/port; the gateway itself resolves `opencode.ai`,
   establishes HTTPS with certificate and hostname validation, and refuses
   all other destinations, redirects or CONNECT tunnels. No generic proxy or
   alternate upstream is permitted. Record its policy digest and negative
   bypass test. The gateway sees prompt bytes and is explicitly trusted; its
   logs must omit bodies, authorization and other private data.
   An IP-only firewall rule, DNS result or proxy setting is insufficient.
   Neither gateway nor relay exists today: absent a verified gateway, live
   composition remains closed. A compromised gateway/host administrator is
   outside this local trusted boundary, not a mitigated risk.
4. **Offline human signature.** The maintainer signs the *exact bytes* of a
   strict canonical UTF-8 approval JSON with OpenSSH SSHSIG under namespace
   `ai-orchestrator-live@pbsilvabd`, using an enrolled FIDO2-backed SSH signing
   key requiring user presence and user verification. B30 must establish
   that these flags are enforced for every accepted SSHSIG, not merely that
   the hardware key type was enrolled; otherwise refuse live approval.
   `ssh-keygen -Y verify` must validate against a separately provisioned,
   ACL-protected single-principal `allowed_signers` file with that namespace
   and pinned public key, plus a protected key-revocation list. A revoked
   signer, missing user-presence/verification evidence or failed/unavailable
   verification refuses. The key
   handle/private key never enters the repository, worker VM, service state,
   task text, logs or CI. A GitHub comment/review, JSON `actor` or filesystem
   ACL alone is **not** the service's authorization signature. No GitHub API,
   online account or repository-stored secret is required at run time.
5. **Signed fields and checks.** The versioned approval includes a unique
   approval ID, maintainer principal, canonical task/request hash and readable
   objective, exact model and endpoint, repository/base/branch, explicit
   acknowledgement that repository content is disclosed to the external
   provider with no privacy/quota guarantee, zero paid USD, one attempt,
   wall-time/output/request limits, issued/expiry timestamps (at most 15
   minutes apart), pinned host binary hash/version, relay policy digest,
   egress-gateway policy/attestation digest, and a digest of fresh zero-price
   metadata (no older than five minutes). Reject unknown/noncanonical fields,
   expired signatures, stale metadata, policy drift, changed payload and
   unapproved signer before persistence and again immediately before spawn.
   Reserve the approval ID durably for at most one accepted task; identical
   idempotent reads do not dispatch, and an uncertain outcome cannot be replayed.
   Signature proves the enrolled maintainer signed those bytes, not that the
   provider will remain free/private or the host has no other vulnerabilities.
6. **Activation gate.** Keep B29 and B20 unchanged and live closed until the
   B30 card, revised normative contract, deployment procedure, OS observations
   and pinned-host fixtures pass reviewed-head acceptance. Before any first
   live inference, require a *separate* signed approval for that exact task and
   a separately authorized fresh catalog read. No signed record exists now.

## Alternatives considered

- Host firewall by process and IP alone: rejected as a universal Windows/Linux
  origin allowlist; DNS churn/shared IPs and per-process rule precedence cannot
  establish one HTTPS origin.
- Proxy environment variables or `redirect: error` in the plugin: rejected;
  a worker can bypass a proxy and the pinned host ignores that RequestInit on
  model traffic.
- GitHub PR approval as the live signature: rejected because a mutable remote
  review is not a task-bound, offline-verifiable service capability.
- Plain unverified `approvalFile.actor`: rejected because the worker or any
  local writer could claim the maintainer name without signing the payload.

## Consequences

This design is intentionally demanding: Windows requires two managed Hyper-V
VMs, Ubuntu needs two privileged network namespaces, the service's B10/B11 local-spawn/workspace
path cannot simply be assumed to work inside a VM, and a separately managed
layer-7 gateway and signing key must exist. B30 may need to split implementation
from deployment into sequential task cards if it cannot fit one reviewed PR;
the safety gate must not be weakened to fit a schedule. Host-root/admin and the
gateway remain trusted; local malicious peers on the host are not separately
authenticated. No containment, gateway, signature or provider metadata has
been exercised by this documentation decision. A failed preflight is a refusal,
not authority to use the ordinary host network or an unsigned approval.

## Related documents

- [B30 acceptance card](../tasks/B30.md) — implementation and platform gates.
- [Task contract](../task-contract.md) — admission/lifecycle; update with code.
- [Validation record](../validation.md) — what this decision did not test.

## Revisit triggers

- B29's ADR-009 amendment reaches main: reconcile its live listener clause with
  this host-only boundary before implementation review.
- A platform cannot provide the specified isolation, L7 gateway or FIDO2 SSHSIG
  verifier: stay fixture-only and request a new, reviewed ADR rather than fall back.

## Amendment — 2026-11-14: fixture-only implementation and WSL2 containment observation

The B30 card and this ADR are now backed by fixture-only code, tests and one
isolated WSL2 deployment observation. Live composition remains closed; no public
catalog read, provider inference, live activation or merge is authorized.

Implemented and tested (fixture/loopback and temporary-process only):

- `src/relay.mjs` — a service-owned relay with one fixed upstream, no arbitrary
  target, `redirect: manual` with terminal refusal on 301/302/303/307/308,
  explicit `Bearer public` only, independent request/byte/time bounds, rejection of
  unspecified/wildcard bind addresses (all-zero IPv4/IPv6 including compressed IPv6
  aliases), and a fail-closed lifecycle (port-conflict refusal, upstream-failure
  latch, terminal stop). Tested by `test/relay.test.mjs` (B30-01, B30-02, B30-04).
- `src/egress-gateway.mjs` — a layer-7 egress gateway with one fixed origin, a fixed
  ingress `Bearer public` credential that it forwards upstream (never inheriting
  arbitrary client headers), CONNECT/redirect/unapproved-path refusal, an independent
  request cap, rejection of unspecified/wildcard bind addresses (all-zero IPv4/IPv6
  including compressed IPv6 aliases), body-free sanitized logging and a policy digest;
  live mode requires an HTTPS non-IP origin, never exercised here. Tested by
  `test/egress-gateway.test.mjs`, including an end-to-end relay→gateway→fixture-origin
  chain (B30-01/B30-07).
- `src/live-approval.mjs` — strict canonical approval schema, `ssh-keygen -Y verify`
  SSHSIG verification against a single-principal `allowed_signers` plus KRL, FIDO2
  presence/verification flag enforcement parsed from the SSHSIG blob, policy/metadata
  binding, and a durable **atomic no-replace single-use** approval ledger (a
  write-then-hard-link claim fails with `EEXIST` on collision and re-reads to return
  only an exact replay; never overwrites an existing reservation). Tested by
  `test/live-approval.test.mjs` (B30-05), including a two-process competition and a
  restart re-read, with disposable test-only keys.

Observed deployment containment (isolated WSL2 Ubuntu, routing- and nftables-based, no
host changes):

- `integration/b30-egress-namespaces.sh` creates three temporary network namespaces
  (`b30-worker`, `b30-relay`, `b30-gw`) with a unique per-run suffix. Each veth pair is
  created **inside** an already-created disposable namespace (`ip netns exec <ns> ip
  link add ...`) and only the peer is moved to the other compartment, so `ip link add`
  never runs in the WSL initial/host namespace and no host address, route or link is
  ever assigned. It assigns private addresses with no default IPv4/IPv6 route, installs a
  per-namespace nftables default-drop `inet b30fw` table in the worker and relay
  namespaces (OUTPUT and FORWARD `policy drop`; allow only worker→relay:18081 and
  relay→gateway:18082 via `counter accept`; a final `counter drop`), records the full
  routing + nftables inventory and counters, then runs real socket attempts: the worker
  reaches only the relay, the relay reaches only the gateway, and the gateway reaches only
  the relay; worker/relay/gateway are each denied a direct Internet/TEST-NET destination.
  Worker-side probes run as the unprivileged `nobody` identity via `setpriv` (real/effective
  UID/GID 65534, `--clear-groups`, `--no-new-privs`, `--bounding-set=-net_admin,-sys_admin`);
  the fail-closed verdict requires a successful, parseable `/proc/self/status` inventory and
  asserts UID/GID 65534, `CapInh`/`CapPrm`/`CapEff` all-zero (a missing or malformed mask is
  rejected, never defaulted to zero), `NoNewPrivs` 1, and NET_ADMIN (bit 12) / SYS_ADMIN
  (bit 21) absent from `CapBnd` — where `CapBnd` is first validated as a complete 16-hex-digit
  mask so any non-hex character anywhere (not only the two checked nibbles) fails closed; it
  asserts an unprivileged `nft add`/`ip route add` mutation
  is refused ("Operation not permitted", `nft` rc=1, `ip` rc=2), and requires the
  post-mutation `nft list tables` / `ip route show` reads to themselves succeed before
  treating unauthorized state as absent (a read failure is uncertainty, not absence). Any
  mutation success, wrong identity/capability, retained capability, or read failure fails
  the run; a controlled `--self-test-capability` mode proves the check rejects simulated
  missing/malformed inventory, retained permitted/inheritable/bounding capability, whole-mask
  non-hex corruption, mutation success and read failures — while the fixed worker→relay path
  remains reachable. Active
  negative egress probes from the worker — direct IPv4/IPv6 (`curl` to `192.0.2.1` /
  `2001:db8::1`), DNS resolution (an RFC 2606 `.invalid` hostname), a WebSocket-like
  `Upgrade` request to TEST-NET, and a routable-but-not-allowed relay port (`:18099`, whose
  listener is first verified bound via `ss -ltn`) — are each denied: `rc=7` for unrouted
  connections, `rc=6` for the unresolved DNS name, and `rc=28` (timeout) for the nft-dropped
  forbidden port, whose SYN is confirmed to increment the nft drop counter; the nftables
  counters record the accepted and dropped packets. No external address is contacted.
  Teardown
  removes only the namespaces this run created (refusing name collisions without
  touching pre-existing state), which also removes the per-namespace nftables rulesets; a
  failed `ip netns del` or an unreadable `ip netns list` is reported with the owned-name
  inventory and treated as uncertain (ownership is not cleared), and the `EXIT` trap forces
  a nonzero process status on cleanup or inventory uncertainty, so unresolved teardown
  requires manual reconciliation and is never claimed complete. The WSL initial/host
  nftables ruleset is verified empty before and after. `--self-test` exercises collision
  refusal and owned-only cleanup, and the `--self-test-fault` / `--self-test-delete-fault` /
  `--self-test-inventory-fault` / `--self-test-trap-status` modes exercise early-failure,
  failed-delete, unreadable-inventory and trap-forces-nonzero paths with mocked `ip`
  outcomes, each confined to disposable namespaces.

Relay failure/lifecycle fixtures (B30-04, established at the relay level): `test/relay.test.mjs`
covers port-conflict refusal, upstream-failure latch, an upstream-timeout latch with a
terminal 502 and no second request, an upstream partial-body drop that latches without
replay, and a terminal stop that releases the port (a second relay binds it, so no
dangling unowned listener remains). These are local HTTP/process fixtures; the relay is
not spawned as a child of the service, so service-level uncertain-child-stop integration
is not proven here.

Not run / not established by this amendment (recorded `not_run`):

- Bare-metal Ubuntu or Windows Hyper-V deployment: the nftables/routing observation is
  WSL2 Ubuntu (kernel `6.6.87.2-microsoft-standard-WSL2`, nftables v1.0.9 installed
  inside the distribution), not a validated standalone Ubuntu or a two-VM Hyper-V
  deployment; the gateway namespace has no external route in the fixture (it is the
  terminal point).
- A real FIDO2-backed hardware-key signing dry run: the flag enforcement and
  `ssh-keygen -Y verify` plumbing are tested with disposable non-hardware keys and a
  synthesized sk-signature blob; a real `-sk` signature is refused unless it carries
  presence+verification, but no hardware key was exercised. The cryptographic positive
  admission path therefore remains `not_run`.
- Service-level uncertain-child-stop integration (B30-04) and the gateway TLS ingress
  chain (B30-07): not exercised here. The signed-approval service admission integration
  (B30-05) is now wired and tested at the service level (see the assessment above), but
  only its refusal paths and a mock-verified single-use path; the hardware positive path
  remains `not_run`.
- Public catalog GET and live inference: remain prohibited and `not_run`. (Dated note,
  2026-11-15: one bounded catalog GET was later performed at `8e358a4` under staged
  authorization; see the 2026-11-15 amendment. Live inference remains `not_run`.)

Signed-approval service integration assessment (B30-05): the SSHSIG verification,
policy/metadata binding, resolved-base-commit binding, effective-request binding (readable
objective, branch, attempt/limits) and measured host-binary binding, admission ordering and
the atomic no-replace single-use ledger are implemented and tested standalone in
`src/live-approval.mjs` / `test/live-approval.test.mjs` (with disposable non-hardware keys
and a synthesized sk-signature blob). The host identity is derived by the factory itself:
`createSignedApprovalAdmission` measures the SHA-256 of the trusted configured
`hostExecutable` path both at admission and again at revalidation (never a caller-supplied
digest/callback). The standalone admission is bound to service dispatch as an optional
synchronous `createTaskService({ admission })` gate (`createConfiguredTaskService` passes a
supplied `admission` through). It runs for new tasks after idempotent replay resolution and
repository inspection but before task persistence, workspace or spawn; a missing/forged/
expired/stale/mismatched/already-consumed approval is refused before persistence, an
identical replay remains readable without re-admission, and one approval ID cannot admit a
second task. A successful admission MUST return `{ admitted: true, revalidate }`; any other
return (`false`, `true`, `undefined`, `null`, or an object without a callable verifier) is
refused before persistence. The returned trusted in-memory receipt (never persisted, never
in task text) is re-checked synchronously **twice**: before the dispatch reservation/
workspace, and **again just before `runSubprocess`** (after `createTaskWorkspace` and
`worker.prepare`), re-asserting approval expiry, metadata freshness and the re-measured
host-binary digest. The relay/gateway policy digests are fixed at factory creation and are
immutable configuration, so they cannot drift within a service lifetime and are not
re-measured; a real policy identity is established only with a deployed relay/gateway
(`not_run`). A refusal before any dispatch is recorded `cancelled`/
`executionStopped:true`; a refusal after the dispatch reservation is recorded `blocked`
(`executionStopped:unknown`, dispatch attempt preserved) — never `cancelled`, never
replayed. The service-level wiring, ordering, error mapping, single-use and pre-spawn
revalidation (including drift/expiry during `worker.prepare`) are exercised in
`test/live-approval-service.test.mjs` and `test/live-approval-pre-spawn.test.mjs` with a
clearly-labelled mock verifier over the real ledger, plus the real factory's negative
refusal paths and its self-measured host-executable path. The cryptographic positive path
still requires a real FIDO2 hardware-key signature (presence + verification), which remains
`not_run`; a non-hardware signature is always refused and no signature or hardware is
invented to close this gap. The gate exposes its canonical measured executable
(`gate.hostExecutable`), and `createConfiguredTaskService` enforces that it equals the
canonical `settings.executable` the configured worker actually starts (resolved through
symlink/junction/alias identity); a signed admission measuring A while the worker starts B is
refused before any service/task/child exists. Negative (`A != B`) and positive (`A == B`)
composition fixtures live in `test/free-provider.test.mjs`.

Deployment prerequisites ([deployment-prerequisites.md](deployment-prerequisites.md)) are
recorded as a plan only: no independent Ubuntu/Hyper-V environment or enrolled FIDO2
hardware key has been provisioned. A one-shot read-only catalog GET (2026-11-15, HTTP 200,
104,821 bytes, `redirect:error`, no retry) confirmed the fixed free model
`deepseek-v4.1-flash-free` is zero-price and matches the fixed endpoint/package; this is
dated evidence, not live activation. A non-invasive FIDO2 tooling inventory found OpenSSH
9.5p2 `ssh-keygen` and `ssh-sk-helper` present on Windows; hardware-key presence is not
established from helper existence and remains `not_run`.

Pinned-host-through-relay fixture (established, not `not_run`): on the pinned OpenCode
2.2.5 host (Windows x64), `integration/opencode-free-relay.mjs` routes the free route
through the relay→gateway→fixture-origin loopback chain. The normal run succeeded with
three `Bearer public` POST `/v1/chat/completions` origin requests; each of
301/302/303/307/308 made the task `failed` with exactly one attempt and one origin
request, and the alternate origin received zero connections, zero raw socket bytes, zero
requests and zero body bytes (counted at connection/entry and per data chunk, so an
aborted partial body is not missed). This closes the B29 307 prompt-leak baseline through
the relay. The active worker-compartment WebSocket-bypass negative remains `not_run`: the
fixture origin seeing no `Upgrade` header on normal POSTs shows no spontaneous upgrade in
that run, not an attempted direct WebSocket bypass.

Until a platform provides verified firewall-filtered isolation, a real hardware-key
signing dry run and the separately signed live approval, the live composition stays
closed.

## Amendment — 2026-11-15: listener supervision and offline gateway TLS fixtures (B30-04/07)

Decision (listener ownership). The relay and egress gateway may run as a child process
of the service only through `src/listener-supervisor.mjs`, which forks
`src/listener-child.mjs`. The child binds the listener and reports `ready` with its
bound port and policy digest, or `error` and exits 2 on refusal. Ownership is a lock file
`listeners/<name>.lock.json` under a supervisor-owned home: it is created exclusively
before any spawn, records the child pid before the `start` message, and is removed only
after the child's exit is confirmed. A refused or early-exited child releases its lock;
an unconfirmed exit (after stop, kill or ready timeout) keeps the lock and the handle
becomes `unknown`. A held lock refuses any restart, a home that cannot be created refuses
before any spawn, and nothing restarts automatically. A maintainer may release an
unresolved lock only through `reconcileListenerLock`, which requires `confirmedStopped:
true` and the exact token and pid, after the process tree is verified stopped. A child
whose supervisor disconnects stops its listener, so an orphan does not hold the port.
The supervisor's `env`, `execArgv`, `fork` and timeout options are trusted-composition
inputs; task text cannot set them. The supervisor is wired only into the fixture-only
`createConfiguredTaskService` path (see the second 2026-11-15 amendment below).

Decision (gateway TLS and DNS latches). Gateway upstream failures are classified into
distinct terminal latches: `dns-failure` (`ENOTFOUND`, `EAI_AGAIN`), `tls-failure`
(`ERR_TLS_*`, `ERR_SSL_*`, `UNABLE_TO_*`, `SELF_SIGNED*`, `DEPTH_ZERO_*`, `CERT_*`) and
`upstream-unavailable` for everything else. All three fail closed with a 502, a latched
state and no replay. Live mode refuses an ambient certificate-verification bypass
(`NODE_TLS_REJECT_UNAUTHORIZED=0`) at creation and before each request (`tls-policy`).
Certificate and hostname verification remain Node's defaults; the gateway adds no
insecure option. Operators may trust a private CA only through process-start
configuration (`NODE_EXTRA_CA_CERTS`); that widens trust and must be a maintainer
decision in deployment.

Evidence (offline, `test/gateway-tls.test.mjs`, `test/listener-supervisor.test.mjs`).
The TLS fixtures generate a disposable CA and a leaf for `tls-host.fixture.test` with
openssl at test time (no certificate or key is committed). A child process runs the
live-mode gateway with `NODE_EXTRA_CA_CERTS` set to that CA and `--import` of
`integration/tls-fixture-resolver.mjs`, which maps two fixture names to 127.0.0.1 inside
that child only, fails every other name without an external query, and passes IP
literals through. Verified cases: trusted CA with the matching hostname forwards exactly one
`Bearer public` request over TLS; an untrusted CA and a hostname the certificate does not
cover latch `tls-failure` with zero origin requests; a DNS-failing name latches
`dns-failure`; a latched gateway refuses later requests without replay. The bypass refusal
is tested in-process. The resolver shim changes lookup results only; TLS verification is
real. The supervisor tests cover confirmed stop with lock release and port release, a
port conflict that keeps the first listener, a held lock with no second child, restart
with a new token, an uncertain stop and a silent child that keep the lock and port
ownership, reconciliation with a wrong token refused, an unusable home that spawns nothing,
and an orphaned child stopping on disconnect. A mutation check in a scratch copy (release
of the lock on an unconfirmed stop; collapsing DNS/TLS into `upstream-unavailable`) made
the corresponding tests fail.

Not run / not established by this amendment (recorded `not_run`):

- The deployed cross-namespace TLS chain (a relay in its own namespace or VM, the gateway
  on the host, a real HTTPS origin and a real certificate chain): not exercised. The offline
  fixtures do not test a real DNS resolver, a real trust store or a real origin.
- Expired or not-yet-valid certificates: not covered; the generator uses a fixed 2-day
  window and a clock-controlled fixture is not in scope.
- Service-level uncertain-child-stop through the task service (a worker child whose stop
  is unconfirmed): the worker path relies on the scheduler's existing uncertain-outcome
  handling from merged B12 (the scheduler keeps ownership and never replays); the listener
  supervisor is wired only into the fixture-only composition (second 2026-11-15 amendment),
  and B14 cancellation evidence is not merged.
- The WebSocket bypass experiment, bare-metal/VM deployment, real FIDO2 signing and live
  inference remain `not_run`, as recorded above. The public catalog GET is not `not_run`:
  one bounded GET was performed at `8e358a4` under staged authorization (HTTP 200, 104,821
  bytes; receipt in `docs/validation.md`, section "M3 preparation: B30 signed-approval
  pre-spawn revalidation + host/readable binding (B30-05) — 2026-11-15", line 2862). This
  amendment does not repeat it. The snapshot is dated and expires; a fresh read needs its
  own narrow authorization. No live inference is authorized.

## Amendment — 2026-11-15 (second): fixture-only service wiring, dated catalog snapshot and deployment gates

Decision (fixture-only wiring). The supervised relay → gateway chain may be composed into
the trusted service only through the `freeListeners` option of `createConfiguredTaskService`
(`src/free-listeners.mjs`). It is reachable only with an operator approval artifact (shape,
expiry and zero budget only, not a signature) and an admission gate that exposes relay and
gateway policy digests equal to the plan's digests (the factory now exposes both as read-only
properties). Listeners bind `127.0.0.1` only, the gateway runs
in fixture mode with a loopback origin, ports are fixed and non-zero, and task text has no
channel to ports, addresses, origin, provider or model. The option is mutually exclusive with
`fixtureEndpoint`. Without it, live composition is unchanged and still refused. Each dispatch
refuses while a listener is not running: the reserved dispatch is recorded `blocked`, with no
spawn and no replay. `close()` stops the listeners after the scheduler is idle. A launch that
fails stops what already started. An unconfirmed stop keeps its lock and surfaces
`uncertain-stop`, and a later start is refused until an operator reconciles the lock.

Decision (startup authority and ownership, 2026-11-15 correction). Listener infrastructure
startup is a separate authority from task admission. Before either child may bind, the service
takes exclusive task-home ownership and reconciles the store (`openTaskHome`); a competing
task-home owner or a corrupt store refuses with zero new child, port or lock, and ownership is
held until the listeners have stopped. The handoff to the service is an opaque, frozen,
single-use capability minted only after that acquisition and reconciliation; shaped, copied,
released, reused and wrong-home handoffs are refused, so a second service cannot be constructed
beside an active owner. Task-home ownership is released only after a confirmed
listener stop; an unconfirmable stop, at close or during failed-startup cleanup, keeps the
task-home owner lock and every listener lock.
Startup is gated by an unsigned operator approval artifact (shape, expiry and zero paid budget)
plus a gate exposing the relay and gateway policy digests. Those digests identify the policy,
not a signature: startup is **not** SSHSIG-verified and is not described as a signed-approved
start. The same gate verifies the SSHSIG for each submitted task; a missing, malformed,
non-FIDO2 or forged task signature is refused before persistence with zero task/workspace/worker
effect. `service.freeListenerAuthority` records the actual authority, and a gate without an
exposed host-executable identity is labelled a test double or generic gate. The positive
FIDO2 signature path remains `not_run`.

Not decided here. A deployed relay must listen on a worker-facing private address in a
separate compartment, and the current composition does not provide that. Choosing that
listener, its trust boundary and its approval binding is a new decision. It needs an ADR
amendment and the deployment evidence in `docs/deployment-prerequisites.md` before any code
changes. Live activation remains closed.

Catalog snapshot (second bounded GET, user-authorized 2026-11-15). One call to the existing
`fetchFreeMetadata` against `https://opencode.ai/inference/v1/models`: `redirect: 'error'`,
10 s timeout, a 2,000,000-byte cap, no credentials, no prompt, no retry. Outcome: validated.
Observed at `2026-11-15T19:14:36.242Z` (request started `19:14:35.804Z`). Selected model
`deepseek-v4.1-flash-free`: type `chat`, `owned_by` `opencode`, tools supported, text input
and output modalities, zero price for text input, text output and cache read, and the
`chat-completions` base URL and SDK package equal to the fixed endpoint and package. The HTTP
status is not recorded separately because `fetchFreeMetadata` requires a successful
`response.ok`. An earlier invocation failed at module resolution before any request, so
it made no network call. This GET is dated evidence only and expires with the metadata TTL.
It is not repeated, and any fresh read needs its own narrow authorization. It authorizes no
live inference.

Still `not_run` (no evidence in this amendment): the independent Ubuntu deployment and its
namespace, nftables and socket-probe rows (checklist items 1–3 and 8 in
`docs/deployment-prerequisites.md`); the deployed TLS chain with a real resolver, trust store
and origin (item 4); expired and wrong-host certificates against a real origin (item 5); the
FIDO2 positive signature dry run (item 6); the active provider WebSocket-bypass experiment
(item 7); live inference; B20; ready-for-review; and merge. The offline TLS and wiring tests
are Local HTTP evidence (loopback child processes, real lock files, a disposable CA and a
labelled admission test double that carries digests only). They do not establish deployed
behavior.

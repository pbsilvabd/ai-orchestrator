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

Observed deployment containment (isolated WSL2 Ubuntu, routing-based, no host changes):

- `integration/b30-egress-namespaces.sh` creates three temporary network namespaces
  (`b30-worker`, `b30-relay`, `b30-gw`) with a unique per-run suffix. Each veth pair is
  created **inside** an already-created disposable namespace (`ip netns exec <ns> ip
  link add ...`) and only the peer is moved to the other compartment, so `ip link add`
  never runs in the WSL initial/host namespace and no host address, route or link is
  ever assigned. It assigns private addresses with no default IPv4/IPv6 route, records
  the full inventory, then runs real socket attempts: the worker reaches only the
  relay, the relay reaches only the gateway, and the gateway reaches only the relay;
  worker/relay/gateway are each denied a direct Internet/TEST-NET destination. Teardown
  removes only the namespaces this run created (refusing name collisions without
  touching pre-existing state); a failed `ip netns del` or an unreadable `ip netns list`
  is reported with the owned-name inventory and treated as uncertain (ownership is not
  cleared), and the `EXIT` trap forces a nonzero process status on cleanup or inventory
  uncertainty, so unresolved teardown requires manual reconciliation and is never claimed
  complete. `--self-test` exercises collision refusal and owned-only cleanup, and the
  `--self-test-fault` / `--self-test-delete-fault` / `--self-test-inventory-fault` /
  `--self-test-trap-status` modes exercise early-failure, failed-delete, unreadable-
  inventory and trap-forces-nonzero paths with mocked `ip` outcomes, each confined to
  disposable namespaces.

Not run / not established by this amendment (recorded `not_run`):

- `nftables`/`iptables` default-drop filtering: neither binary is present in the
  observed distribution, and installing packages is not authorized. Containment is
  routing-based (no default route), not firewall-filtered.
- Bare-metal Ubuntu or Windows Hyper-V deployment: the observation is WSL2 Ubuntu
  (kernel `6.6.87.2-microsoft-standard-WSL2`), not a validated standalone Ubuntu or
  a two-VM Hyper-V deployment.
- A real FIDO2-backed hardware-key signing dry run: the flag enforcement and
  `ssh-keygen -Y verify` plumbing are tested with disposable non-hardware keys and a
  synthesized sk-signature blob; a real `-sk` signature is refused unless it carries
  presence+verification, but no hardware key was exercised.
- IPv6/DNS/WebSocket negatives and firewall inventory (B30-03), partial-body/deadline/
  uncertain-stop behavior (B30-04), real service admission integration (B30-05), and
  the gateway TLS ingress chain (B30-07): not exercised here.
- Public catalog GET and live inference: remain prohibited and `not_run`.

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

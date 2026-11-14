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

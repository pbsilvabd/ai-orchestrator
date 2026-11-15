# B30 deployment prerequisites and setup plan (not executed)

Status: plan only. No independent Ubuntu host/VM or two-VM Hyper-V environment has been
provisioned yet ("Preciso preparar ambiente"), and FIDO2 hardware availability is not
established. The isolated WSL2 netns/veth fixture is an observation, **not** a substitute
for a bare-metal/VM deployment. Nothing below changes any host network or installs packages.

## What must exist before any live-route work

1. **Windows two-VM Hyper-V** (ADR-010 §1–3) **or** **Ubuntu two-netns** deployment:
   - Windows: a disposable non-administrator worker VM on a dedicated **Internal** switch,
     and a relay VM with two NICs (worker Internal switch + a *different* Internal switch to
     a host-side gateway). No Default switch, External switch, NAT/ICS/WinNAT, second NIC on
     the worker, default route, guest DNS, or host IP forwarding.
   - Ubuntu: a root-created worker network namespace with one veth to a relay namespace, no
     default IPv4/IPv6 route or external DNS, and default-drop OUTPUT/FORWARD filtering.
2. **Trusted executable** to measure: a pinned OpenCode binary whose SHA-256 becomes the
   approval's `hostBinaryDigest` (re-measured at admission and again before spawn).
3. **Host-side L7 egress gateway** with one fixed origin, certificate/hostname validation,
   no CONNECT/redirect, body-free logs, and a recorded policy digest.
4. **Enrolled FIDO2-backed SSH signing key** (`-sk`) with user-presence + user-verification,
   a single-principal `allowed_signers` file, and a key-revocation list (never in the repo).

## Fresh confirmation required before touching any host network

- That the operator is root/admin on the target host and authorized to create/destroy the
  VM switches or namespaces.
- The exact Internal switch names/IDs and that they are empty (not Default/External/NAT).
- That `nftables`/`iptables` (Ubuntu) or Hyper-V switch isolation (Windows) is present and
  can be configured without affecting the initial/host namespace.
- The pinned OpenCode binary path + measured digest, and the exact relay/gateway policy
  digests to sign into an approval.
- That a FIDO2 hardware key is physically present, enrolled, and reachable by
  `ssh-sk-helper` **without** enumerating private keys, reading credentials, or generating/
  signing a hardware key during planning.

## Ownership / privilege / network checks to record (not run yet)

- `ip netns list` (Ubuntu) or `Get-VMSwitch` (Windows) before and after setup — initial
  namespace/switches unchanged; only the newly created compartments are modified.
- Worker/relay/gateway address, route and nftables inventory, captured with actual exits.
- Post-setup real socket probes: worker direct IPv4/IPv6/DNS/WebSocket-upgrade denied;
  worker→relay and relay→gateway reachable; gateway refuses CONNECT/unapproved origin.
- Teardown removes only objects this run created; host `nft list ruleset` empty before/after.

## What stays `not_run` until these exist

Bare-metal/VM deployment, a real FIDO2 hardware-key signing dry run (the cryptographic
positive admission path), the active provider WebSocket-bypass experiment, and live
inference. The signed-admission code path is implemented and tested with mock/negative
fixtures only.

## Independent Ubuntu host: checklist and minimum permissions (plan only, 2026-11-15)

Nothing below is installed, configured or run. It states what a future, separately
authorized independent Ubuntu host must provide before the B30-03/04/07 deployment rows can
be evidenced. The WSL2 fixture does not satisfy these rows.

Host facts to record (read-only): distribution and release, kernel, architecture, `nft`
and `ip` versions, whether the host firewall is empty, `ip netns list`, and the account
used. The host must be dedicated to this test and must not be the developer workstation.

Minimum privileges:
- Root (or an equivalent single-purpose sudo rule) only for creating and deleting the
  worker, relay and gateway namespaces and their nftables tables, and for teardown. Nothing
  else runs as root.
- Worker probes run as the unprivileged identity (UID/GID 65534) with `no_new_privs` and
  NET_ADMIN/SYS_ADMIN removed from the bounding set, as the existing fixture does.
- The gateway alone holds the approved upstream TLS path. It needs DNS resolution of the
  fixed origin hostname and the system trust store; no private key, provider credential or
  `NODE_TLS_REJECT_UNAUTHORIZED` setting is permitted.
- No Windows or WSL host network, firewall, Hyper-V switch or Default switch change.

Deployment checklist (each item needs its own authorization and evidence):
1. Root-created worker, relay and gateway namespaces with one veth per link, no default
   route on the worker or relay, no external DNS on the worker, and nftables default-drop
   with recorded counters. Initial-namespace ruleset empty before and after.
2. Real socket probes from inside the worker compartment: direct IPv4/IPv6, DNS, WebSocket
   upgrade and an unapproved port, each denied with real exits.
3. The relay listens only on the worker-facing address. The current code and composition
   accept loopback only; a non-loopback deployment listener is a decision that needs its
   own ADR amendment before code changes.
4. Real TLS: the gateway reaches the fixed origin through the system trust store. Record the
   certificate chain, the hostname validated and the resolver used. Offline disposable-CA
   fixtures do not establish this.
5. Pinned OpenCode 2.2.5 binary measured for `hostBinaryDigest` and run through the relay
   chain. Expired, not-yet-valid and wrong-host certificates must fail closed.
6. FIDO2 hardware dry run: an `ssh-keygen -Y sign` with a `-sk` key using presence and
   verification, and `-Y verify` against a single-principal allowed-signers file. Requires
   the physical key and separate maintainer authorization. Not performed.
7. Active provider WebSocket-bypass experiment: requires separate authorization because it
   contacts the provider from the worker compartment. Not performed.
8. Teardown of only objects this run created, with verified-empty host residue.

Remaining gates status (2026-11-15): items 1–8 are `not_run`. The public catalog GET for the
fixed free model was performed once at `8e358a4` (dated snapshot, not repeated) and a second
bounded GET is recorded in the 2026-11-15 validation entry. Neither authorizes live
inference, and no live activation, ready or merge is authorized while these gates are open.

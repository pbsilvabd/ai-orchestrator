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

# B30 deployment prerequisites and setup plan (not executed)

Status: partly executed for the Windows two-VM path only. On 2026-11-15 a Hyper-V
`B30-Worker` / `B30-Relay` pair was provisioned under ADR-010's internal-only topology and
probed from inside both guests, and on 2026-11-16 a host-side L7 gateway was deployed on the
relay link in fixture mode for one authorized session; the deployment inventory is recorded
below and the raw results are in [validation.md](validation.md). The real
resolver/trust-store/hostname chain to the fixed origin was exercised on 2026-11-16 (one empty
JSON request, provider 400, no generation), but a deployed relay→gateway TLS leg in the ADR-010
topology, a positive FIDO2 signature, the active WebSocket-bypass experiment, binding the relay on
a real private NIC and live inference remain `not_run`. No independent Ubuntu host has
been provisioned, and the isolated WSL2 netns/veth fixture remains an observation, **not**
a substitute for a deployment. Nothing below changes any host network or installs packages.

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

## Windows two-VM environment: what exists (2026-11-15)

| Item | Recorded state |
| --- | --- |
| Guests | `B30-Worker` and `B30-Relay`, Generation 2, Ubuntu Server 24.04.5, kernel `6.8.0-139-generic`; the install ISO was ejected and the SCSI system disk is first in boot order. |
| Switches | `B30-Worker-Relay` (worker and relay worker-side NIC) and `B30-Relay-Gateway` (relay gateway-side NIC and the host), both `Internal`, neither bound to a physical adapter. WSL's own `WSL (Hyper-V firewall)` switch also exists and is not part of this topology. |
| Addresses | relay `eth0 10.30.1.1/30`, `eth1 10.30.2.2/30`; worker `eth0 10.30.1.2/30`; host gateway `10.30.2.1/30`. No default route, no DNS server on either guest; `ip_forward=0` and IPv6 forwarding `0`. |
| Host isolation | No WinNAT instance; `SharedAccess` running with no share configured, no `192.168.137.*` address and no share key naming a B30 adapter; host forwarding `Disabled` on the gateway adapter and the host's worker-side adapter `Disabled` with no address. |
| NICs | Worker: one adapter `00:15:5D:64:5F:02`. Relay: `…5F03` toward the worker and `…5F04` toward the host. The adapter Hyper-V creates automatically for the host on the worker switch is disabled and unaddressed. |
| Removal path | Both guests were reached only through FAT32 VHDX media (`B30CFG`, then `B30PROBE`), never over the network; the temporary deployment key was removed from `/root` and every human account on both guests, and the media disks are detached and deleted after collection. |

### Host firewall requirement for the L7 gateway

Deployed probes showed the relay reaching the worker but not receiving replies from
`10.30.2.1`, and the read-only host inventory explains why: the `vEthernet (B30-Relay-Gateway)`
adapter is classified `Public` (`Rede nao identificada`), the Public profile is enabled with
`DefaultInboundAction NotConfigured` (block) and the built-in inbound ICMPv4 echo rules are
disabled. Kaspersky is also registered as a firewall product, so the exact filter is not
attributed by this evidence.

Consequences, and what has since been done (2026-11-16):

1. A gateway listening on `10.30.2.1` needs an explicit inbound allow rule for its single port,
   scoped to `10.30.2.2/32`, in the profile that the adapter actually has. Without it the relay's
   connections are dropped by the default inbound policy, not by the gateway.
2. The relay-to-gateway leg is now demonstrated on Windows in fixture mode (see the 2026-11-16
   entry in [validation.md](validation.md)); the deployed TLS chain is still `not_run`.
3. Granting that inbound rule is a firewall change on the operator's machine and needs its own
   authorization. Preferring a dedicated `Private`-classified adapter with the narrowest rule, or
   an Ubuntu host where the gateway rule is part of the same reviewed nftables policy, avoids
   widening the Windows host's inbound surface.

### The rule that was used, and its removal (2026-11-16)

Created for one evidence session with explicit maintainer authorization, then removed in the same
session:

```powershell
New-NetFirewallRule -DisplayName 'B30-Relay-Gateway-Inbound' `
  -Direction Inbound -Action Allow -Protocol TCP `
  -LocalAddress 10.30.2.1 -RemoteAddress 10.30.2.2 -LocalPort 18082 `
  -InterfaceAlias 'vEthernet (B30-Relay-Gateway)' -Profile Public -Enabled True
# ... gateway run and relay probes ...
Remove-NetFirewallRule -DisplayName 'B30-Relay-Gateway-Inbound'
```

Read back after creation: `LocalAddress 10.30.2.1`, `RemoteAddress 10.30.2.2`, `Protocol TCP`,
`LocalPort 18082`, `Program Any`, `Enabled True`; adapter `vEthernet (B30-Relay-Gateway)` `Up` with
connection profile `Public`; port `18082` free before the run. Read back after removal: 712 -> 711
total rules, zero `B30` rules, adapter unchanged; the gateway instance still held `18082` while
round 5 waited, and no listener or gateway process remained once the run ended. No other firewall,
switch, NAT, ICS or forwarding setting was touched.

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

The host-side L7 gateway's deployed TLS chain to the real origin, a real FIDO2 hardware-key signing
dry run (the cryptographic positive admission path), the active provider WebSocket-bypass
experiment, and live inference. The signed-admission code path is implemented and tested with
mock/negative fixtures only. The Windows two-VM network layer and the host-side gateway boundary in
fixture mode are no longer in this list: they were provisioned and probed on 2026-11-15 and
2026-11-16, and only the TLS leg and the real origin remain open as described above.

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
3. The relay listens only on the worker-facing address. The decision is recorded (ADR-010
   amendment, 2026-11-16): the trusted composition accepts an explicit private/loopback
   `relayHost` (default loopback), derives the worker base URL from it, refuses
   wildcard/unspecified, public, IPv4-mapped and hostname forms, and binds the address into the
   relay policy digest. Binding it on a real private NIC in the two-VM/namespace topology is
   still `not_run`.
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

Remaining gates status (2026-11-16): on Windows, item 1 in its Hyper-V form and item 2 in its
IPv4/IPv6/DNS/alternate-origin/WebSocket/unapproved-port form have deployed evidence — two Internal
switches, no Default/External switch, no NAT/ICS/share, no forwarding, no worker default route or
DNS, and guest-written probe logs showing every off-link attempt denied while the relay stays
reachable. Item 2's WebSocket-upgrade and unapproved-port attempts were run from inside both guests
on 2026-11-15: an off-link upgrade has no transport at all and the reachable peer refuses the
unapproved ports. Separately, the host-side gateway boundary has a fixture-mode deployment
observation on the relay link (2026-11-16): the approved request is forwarded once to a controlled
loopback origin and an unapproved path, absolute-URI request, `CONNECT` and credential are refused
before any upstream fetch. Items 3–8 remain `not_run`: binding the relay on a real private NIC
(the policy and implementation exist in the trusted composition; the deployment does not), the
deployed relay→gateway TLS leg (the direct real-origin resolver/trust/hostname check ran on
2026-11-16 with an empty JSON request and provider 400), the application-level provider
WebSocket experiment (the gateway refuses a handshake with 405, but the active bypass experiment
did not run), the FIDO2 dry run, live activation and the Ubuntu host checklist. The public catalog
GET for the fixed free model was performed once at `8e358a4` (dated
snapshot, not repeated); a third bounded read on 2026-11-16 revalidated the same model as
zero-price. None authorizes live inference, and no live activation, ready or merge is authorized
while these gates are open.

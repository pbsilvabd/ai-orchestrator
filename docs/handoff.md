# Continuation point - 2026-11-28

## Active FIX48 checkpoint

FIX48 is draft PR #52. Run `46107344778` passed five consecutive full-suite
samples on each OS at merge SHA `bfbeda97d78137de92e9be9fbbf4d94e0515e8672`
(PR head `1a2bd5f`); run `46108300145` passed five per OS at merge SHA
`7366b2218583d924614105a4d8dc17c5ff4ca858` (PR receipt head `9b34a8c`).
Every sample exited 0 and checked the same clean/unchanged revision. Windows
samples were 310/309/0/1 (tests/pass/fail/skip); Ubuntu 310/306/0/4. On #45,
run `46109110028` passed five samples per OS at merge checkout
`8edcf05ee863dabc9c093b1b10204270b985eab7` (PR code head `784cdb4`): 442
tests per sample, zero failures, five platform skips. Both demos passed. Focused
and full local checks passed. Next propagate the same correction into stacked
#51 and verify its head/checks. Keep both drafts; no merge. Full records are in
[validation](validation.md) and [worklog](worklog.md).

Verified remote main `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` includes
B12-B19, B29/#44 fixture-only preparation and the 2026-11-22 reassessment
(#46-#48). M2a remains complete; M2b technical
fixture evidence exists but milestone sign-off is not newly declared. M3 remains
incomplete: B20/#43 is draft with no real worker-produced project diff.
B30/#45 is draft; pre-merge head `9a83ac9b95a3d00738080b64286544fde28fdb25` was
merged with `main` `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672` as
`2f8d7aea4f75b53e391d32873bbecd38e4736d39` to clear the stale-base conflict. The
independent critical review requested changes at that merge head (abort-test
determinism, approval lifetime bounds, merge-history restoration); four rounds of
correction and re-review closed every finding with no new blocking issues, and the
reviewed head `7660b39874eecd48c408c1500d30da96c8423d2c` passed exact-head CI on
Windows and Ubuntu. The fixture-only implementation is still not accepted: merge,
ready and live remain unauthorized while #46/#47/#48 stay open. Full deployment and positive FIDO2 approval are not
established. See the
[reassessment](project-reassessment-2026-11-22.md) for the evidence/disposition table.

## Next action: decide approval profile and specify deployable composition

1. Resolve [#47](https://github.com/pbsilvabd/ai-orchestrator/issues/47) against
   B30's ADR-010 and `src/live-approval.mjs`: evaluate software SSH signing for
   supervised local use versus the current hardware profile. Keep the current
   FIDO2 UP/UV gate until a deliberate ADR/code/test/contract change is delivered.
2. Specify and implement [#46](https://github.com/pbsilvabd/ai-orchestrator/issues/46):
   actual service/worker/relay/gateway compartments, trusted launch channel,
   workspace/artifact mapping, measured binary and lifecycle/ownership. Current
   `freeListenerPlan` uses a local fixture-mode loopback gateway; a private bind
   alone is not cross-compartment composition. Continue B30 in #45.
3. Correct the readiness/maintenance races in
   [#48](https://github.com/pbsilvabd/ai-orchestrator/issues/48), preserving all
   failure assertions and original run results. Refresh CI foundation #32/#33;
   #34 remains blocked, not merge-ready.
4. Only after that plan is executable, obtain narrow infrastructure permission
   for one deployment path, then run a single controlled end-to-end evidence
   campaign, including active pinned-worker bypass, real TLS failures and
   owned-only teardown. Historical VM observations are not current host inventory.
5. Re-review B30's exact final head and every required row, reconcile B17/M2b
   acceptance, then obtain a new exact run approval and continue B20/#43.

No live provider, catalog refresh, key enrollment, VM/firewall change, automatic
fallback or merge is authorized by this documentation. #6/#9 are obsolete proposal
tracks, not prerequisites to resume; SQLite/memory/routing stay deferred.
B17/M2b fixture acceptance reconciliation can proceed independently now; do not
turn B30 deployment or FIDO2 into an unrelated fixture milestone prerequisite.

## Historical checkpoints - superseded by the continuation above

The following dated text preserves prior evidence/context, **not current task
selection, remote status or authorization**. Follow the next-action section above.

Remote `main` is `688da04bea29b300eb4cb1815bfbcb9fd0cd35ca` (B19 included). B12–B19 are
merged. B20 remains draft PR #43 and unmerged. B29 is a draft preparation PR on
`task/B29-opencode-free-provider` (see below); it does not claim live availability or M3.
B17/#40 Windows/Ubuntu PR checks passed, and B18/#41 post-merge Windows run
`43589015912` passed. M2b/M3 remain incomplete; the worker provider is fixture-only,
not production model-quality/provider evidence. ADR-007 still selects MCP stdio
revision `2026-07-28`.

## Current implementation status: B29 fixture preparation, blocked for live use

B29 (`task/B29-opencode-free-provider`, base `688da04`) prepares one anonymous free route,
`opencode/deepseek-v4.1-flash-free`, with zero-price metadata validation, expiring
payload-bound operator approval, a service-owned guard plugin and the B11 launch
builder. The pinned OpenCode 2.2.5 host loads the guard through `plugins`, sends only the
fixed model with `Bearer public`, and makes one request after 401/402/429 or a dropped
connection. At the earlier B29 preparation checkpoint, the full suite had 299
passes, 0 failures and 1 platform skip; that is not a result for the current PR
head. Later default-concurrency runs exposed the B10-03 timing failure, and
the Windows CI at `762c133` failed in the maintenance recovery test.

Blocker: on the pinned host a 307 from the model endpoint is followed and the prompt body
reaches the alternate origin. The guard cannot prevent or detect it. Live composition is
therefore refused by `createConfiguredTaskService`, and
[ADR-009](adr/009-free-anonymous-worker.md) is accepted only for fixture
preparation; live activation remains prohibited. The integration harness
`integration/opencode-free.mjs` exits 1 on this scenario by design. B20 remains unexecuted.

2026-11-16 update: draft PR #45 (B30) still carries the fixture-only relay/gateway/approval work
and is not ready or merged. With maintainer authorization, the real TLS path to `opencode.ai`
(Node default verification, TLS 1.3, Google Trust Services), one live-gateway empty JSON request
(provider 400 with no generation), an application-level WebSocket refusal (405) and a fresh
zero-price catalog read were recorded in `docs/validation.md`. The non-loopback worker-facing
listener decision is now implemented in the trusted composition: `freeListeners` accepts an
explicit private/loopback `relayHost` (default `127.0.0.1`), refuses wildcard/unspecified, public,
IPv4-mapped and hostname forms, derives the worker base URL and binds the address into the relay
policy digest; tests cover the policy and a real bind on `127.0.0.2`. Still `not_run`: positive
FIDO2 hardware signature (no device present), provider WebSocket bypass from a worker compartment
(no VMs), deployment on a real private NIC/Ubuntu host, and live inference. Next action: obtain
the FIDO2 dry run and the deployment environment, then re-review; merge needs explicit
authorization.

2026-11-15 fifth correction (release-authority transfer; same draft PR #45). The independent
re-review at `f6fdd1e` confirmed the forged-handoff fix but found that the original capability
holder could still call `cap.releaseOwner()` after `createTaskService` had consumed it, removing
the active service's lock and letting a second service acquire the home. Release authority now
transfers at consumption: the creator-facing `releaseOwner` is valid only while the capability
is minted and unconsumed (failed-construction cleanup), and only the consuming service's private
close path releases after scheduler idle, running `beforeRelease` listener stop while ownership
is held. A private release is memoized, so repeated `close()` and concurrent close share one
release; an early or concurrent creator release is refused with `invalid_argument` without
touching the lock. Passive default close stays synchronous; a capability handoff returns the
release Promise. `test/service-ownership-handoff.test.mjs` now covers the early-release bypass,
close idempotency, `beforeRelease` ordering, and failed-construction cleanup in addition to the
forged/copied/reused/released/mismatched/competing-owner and uncertain-release cases. Exact-head
CI run `43768061960` at `352c212` passed on Windows and Ubuntu; the docs-only receipt commit has
its own PR run. All
deployment gates remain `not_run`; PR #45 stays draft and unmerged.

2026-11-15 fourth correction (ownership handoff capability; same draft PR #45). The independent
re-review at `6ea76d8` confirmed the two earlier P1s in the configured path but found that the
exported `ownership` option accepted a caller-shaped `{ store, releaseOwner }` object, allowing a
second service beside an active owner. `createTaskService` now accepts only the opaque, frozen,
single-use capability that `openTaskHome` mints after the exclusive lock and reconciliation;
shaped or copied objects, released or reused capabilities and wrong-home handoffs are refused
with `invalid_argument` and never release or replace an active owner. The configured path passes
that capability directly with listener stop bound as `beforeRelease`, which runs while ownership
is still held; a failed cleanup or lock release leaves the capability unusable and the lock
retained. Passive default close is synchronous again; a capability handoff returns the release
Promise. `test/service-ownership-handoff.test.mjs` covers forged/copied/reused/released/
mismatched/competing-owner and uncertain-release cases, and the existing B12/B30 lock and
listener-lock tests still pass. Exact-head CI run `43764489116` at `0c90518` passed on Windows
and Ubuntu; the docs-only receipt commit has its own PR run. All deployment gates remain
`not_run`; PR #45 stays draft and unmerged.

2026-11-15 third correction (ownership and startup authority; same draft PR #45). Corrected the
two P1 findings from the independent re-review at `c8645d6`. (1) `openTaskHome` now acquires
exclusive task-home ownership and reconciles the store **before** either supervised listener
child may bind. Ownership is held through listener startup and stop, released only after a
confirmed stop; a competing owner or corrupt store refuses with zero new child, port or lock,
and an unconfirmable stop at close or during failed-startup cleanup keeps the task-home and
listener locks. (2) Listener startup
authority is now explicitly separated from task admission: the operator approval artifact is
unsigned JSON (shape/expiry/zero budget) and the gate contributes policy digests, not an
SSHSIG. `service.freeListenerAuthority` reports that actual authority; startup is not described
as signature-verified. The same real gate refuses missing, malformed, non-FIDO2 and forged task
signatures before persistence with zero task/workspace/worker effect (already-started listeners
stay running). Focused tests cover competing owner, corrupt store, ownership-held composition,
close-time and failed-startup uncertain stop and the real-gate refusal matrix. Exact-head CI
run `43760697682` at `b9e8483` passed on Windows and Ubuntu; independent re-review of this
head is the next action. The positive FIDO2 signature path and
every deployment gate remain `not_run`; PR #45 stays draft and unmerged. No FIDO2 hardware,
network, VM, switch/reboot, provider inference or catalog action was performed.

2026-11-15 B30-04/07 offline correction on `task/B30-free-relay` (draft PR #45, base
`11fcb42`). Added `src/listener-supervisor.mjs` and `src/listener-child.mjs`: a relay or
gateway runs in a supervised child with a durable lock created before spawn. Only a confirmed
exit releases the lock; an unconfirmed stop, kill or ready timeout keeps the lock and
refuses restart; `reconcileListenerLock` is the explicit operator release (exact token and
pid, stop verified). An orphaned child stops on IPC disconnect. The gateway names DNS
(`dns-failure`) and TLS (`tls-failure`) upstream failures as distinct fail-closed latches
and refuses live-mode `NODE_TLS_REJECT_UNAUTHORIZED=0` (`tls-policy`). Offline fixtures
(`test/gateway-tls.test.mjs`, `test/listener-supervisor.test.mjs`) use a disposable CA and
`integration/tls-fixture-resolver.mjs` inside a child process; no DNS, hosts, firewall or
network change and no external query. Live composition stays closed; the supervisor is wired
only into the fixture-only `freeListeners` path of `createConfiguredTaskService` (second
correction below). Evidence is local loopback/process fixture only:
the deployed cross-namespace TLS chain, expired certificates, a real resolver/origin, the
WebSocket-bypass experiment, bare-metal/VM deployment, FIDO2 signing, live inference and
merge remain `not_run`. The public catalog GET for the fixed free model was performed once,
under a staged bounded authorization, at prior head `8e358a4` (HTTP 200, 104,821 bytes,
zero-price metadata; receipt in the `M3 preparation: B30 signed-approval pre-spawn
revalidation + host/readable binding (B30-05) — 2026-11-15` section of
`docs/validation.md`, line 2862). That snapshot is dated and expires. It was not repeated in
this correction. A fresh read needs its own narrow authorization; neither the old GET nor this
correction authorizes live inference. Recorded per ADR-010's 2026-11-15 amendment.

2026-11-15 second correction (fixture-only wiring; same draft PR #45). `src/free-listeners.mjs`
composes the supervised gateway and then relay through `createConfiguredTaskService(…,
{ freeListeners })`. It needs an operator approval artifact and an admission gate whose exposed
relay and gateway digests equal the plan's digests; it refuses before any effect otherwise.
Startup is not SSHSIG-verified (corrected above: trusted composition only). Both
listeners bind `127.0.0.1` on fixed ports, the worker base URL comes from the relay port, a
launch failure stops what started, an uncertain stop keeps its lock, a dead listener blocks
the reserved dispatch (no spawn, no replay), and `close()` stops the listeners after the
scheduler is idle, releasing task-home ownership only after a confirmed stop. Task text has
no channel to ports, addresses, provider or model. Nine focused tests cover these paths
(`test/free-listeners.test.mjs`); the serial suite is recorded
in the validation entry. The admission in those tests is a labelled double that carries digests
only. The signed SSHSIG path remains `not_run`. The second bounded catalog GET was performed at
`2026-11-15T19:14:36Z` and validated `deepseek-v4.1-flash-free` as zero-price. It is dated and
not repeated, and it authorizes no live inference (ADR-010, second 2026-11-15 amendment).

## Historical next action (2026-11-16, after the host-side gateway deployment run; superseded by the 2026-11-22 continuation above)

1. Keep PR #45 draft. Do not mark it ready and do not merge: the B30 gates below are not all
   satisfied, and the user's merge condition ("all gates pass") is therefore not met.
2. Deployment progress: the Windows two-VM network layer is now evidenced, not planned. Two
   Internal switches, no Default/External switch, no NAT/ICS/share, no host forwarding, no
   worker default route or DNS, single worker NIC, and guest-written probe logs showing the
   worker's and the relay's off-link attempts denied while both keep their one permitted link
   (`docs/validation.md`, the 2026-11-15/16 two-VM entries). A second media round covered the
   remaining B30-03 probe row inside both compartments: a plaintext WebSocket upgrade to two
   off-link origins is `Network is unreachable` at connect, and the reachable peer on the
   permitted link refuses `18099` and `8080`. A host-side L7 gateway was then deployed on the
   relay link in fixture mode for one authorized session: the approved request was forwarded
   once to a controlled loopback origin, an unapproved path, absolute-URI request, `CONNECT`
   and credential were refused before any upstream fetch, the policy digest was recorded and
   the temporary inbound firewall rule was removed afterwards. Remaining, all `not_run`:
   - the gateway's TLS chain to the real origin (resolver, trust store, certificate
     validation); the fixture-mode deployment did not exercise it;
   - an application-level WebSocket rejection (the VM probes only show there is no transport);
   - the independent Ubuntu host checklist (items 1–3 and 8) if that path is chosen instead;
   - a real FIDO2 `-sk` signature dry run (item 6) and the active provider WebSocket-bypass
     experiment (item 7);
   - a deployment decision for a non-loopback, worker-facing listener (requires an ADR
     amendment before any code change).
3. A further catalog read needs its own narrow authorization. No live inference is authorized.

Earlier 2026-11-14 state (superseded for next action): B30 fixture-only implementation on `task/B30-free-relay` (base `688da04`, merged
with B29 main `11fcb42`), corrected after the supervisor reviews at `cff5265` and
`32c0339`. The relay, egress gateway, SSHSIG approval/admission and an isolated WSL2
netns/veth containment observation are implemented and tested; live composition remains
closed and no merge is authorized.

- `src/relay.mjs` — fixed single-upstream relay, redirect refusal (301/302/303/
  307/308), independent request/byte/time bounds, rejects all-zero IPv4/IPv6 bind
  (including compressed IPv6 aliases), fail-closed lifecycle.
- `src/egress-gateway.mjs` — L7 egress gateway, fixed `Bearer public` forwarded
  upstream, CONNECT/redirect/unapproved-path refusal, independent request cap,
  rejects all-zero IPv4/IPv6 bind (including compressed IPv6 aliases), sanitized logs,
  policy digest.
- `src/live-approval.mjs` — canonical SSHSIG live approval with `ssh-keygen -Y
  verify`, FIDO2 presence/verification flag enforcement, policy/metadata binding
  and a durable atomic no-replace single-use approval ledger.
- `integration/b30-egress-namespaces.sh` — isolated WSL2 worker/relay/gateway
  netns + veth fixture: three disposable namespaces with unique per-run names, each
  veth pair created **inside** a disposable namespace (only the peer moved), so no
  `ip link add` runs in the WSL initial/host namespace; per-namespace nftables default-drop
  (OUTPUT/FORWARD, allow only worker→relay and relay→gateway, with counters); owned-only
  collision-safe teardown, `--self-test` mode, real socket probes (including active
  IPv4/IPv6/DNS/WebSocket-upgrade and a routable-but-not-allowed port negative egress
  probes, all denied) and verified-empty teardown (host nftables ruleset stays empty).
- `integration/opencode-free-relay.mjs` — pinned OpenCode 2.2.5 routed through the
  relay→gateway→fixture-origin loopback chain: normal run succeeds with three
  `Bearer public` origin requests; each of 301/302/303/307/308 fails the task with one
  attempt and zero alternate-origin connections / raw socket bytes / requests / body bytes
  (counted at connection/entry and per data chunk; the B29 307 prompt leak is closed
  through the relay). `--self-test` proves an aborted partial body increments the
  alternate-origin counters.

- `integration/b30-gateway-host.mjs` — deployment harness (not a test, not wired into
  composition): instances `src/egress-gateway.mjs` in `fixture` mode on one fixed address,
  serves one guest request per instance, and writes a JSONL event log plus one evidence JSON
  (policy digest, per-round counters, metadata-only fixture-origin records). `--smoke` is a
  loopback self-probe that needs no host firewall rule.

`not_run` / still closed (ADR-009/010): bare-metal Ubuntu deployment and the deployed TLS chain
to the real origin (the Windows two-VM network layer and the fixture-mode gateway boundary are
evidenced in 2026-11-15/16; the nftables/routing observation remains WSL2-only and the gateway
namespace has no external route); the active worker-compartment provider WebSocket-bypass
experiment; signed-approval service admission integration; a real FIDO2 hardware-key signing dry
run; public catalog GET; live inference and B20/#43. The live route stays closed until a platform
provides verified firewall-filtered isolation in a bare-metal/VM deployment and a separately
signed live approval.

Remote `main` is `11fcb422de47c2a9b79389de8470802d48ead730` (B29/#44 merged).
B12–B19 are merged; B29 is merged as fixture-only preparation. B20 remains draft
PR #43 and unmerged. M2b/M3 remain incomplete; the worker provider is fixture-only.

## Previous next action (2026-11-14, superseded by the 2026-11-15 section above)

1. The supervisor reviews at `cff5265`, `32c0339`, `ad010a7` and `cc3e917` (P1 ledger; P2
   gateway/bind/WSL scope; residual in-namespace veth + compressed IPv6 aliases; cleanup
   reporting + fault injection; and EXIT-trap status + inventory-error handling) have
   been corrected on this branch, and the pinned-host-through-relay fixture now passes
   (normal succeeds; 301/302/303/307/308 fail the task with zero alternate-origin bytes).
   The reply with the new head SHA and evidence is posted on PR #45. Re-review the
   corrected head, then the maintainer decides draft-to-ready. The draft lists the unmet
   criteria (firewall filtering, hardware signing, catalog, live activation) as `not_run`,
   not passed.
2. Remaining B30 gates are platform/hardware, not code: nftables (or an approved
   alternative), a real FIDO2 `-sk` signing dry run, and a separately authorized
   catalog read before any live experiment.

## Historical B29 checkpoint (merged as PR #44)

B29 (`task/B29-opencode-free-provider`, base `688da04`) prepares one anonymous free route,
`opencode/deepseek-v4.1-flash-free`, with zero-price metadata validation, expiring
payload-bound operator approval, a service-owned guard plugin and the B11 launch
builder. On the pinned host a 307 from the model endpoint is followed and the prompt
body reaches the alternate origin; the guard cannot prevent or detect it, so live
composition is refused by `createConfiguredTaskService` and
[ADR-009](adr/009-free-anonymous-worker.md) is accepted only for fixture
preparation. `integration/opencode-free.mjs` exits 1 on this scenario by design.
B20 remains unexecuted.

## Historical B19 checkpoint (merged as PR #42)

The B19 manual pulse implementation is on `task/B19-opt-in-harness-pulse`, based on
`c268239`, with correction work on top of supervisor checkpoint `91e43e4`. It uses
Windows creation-time Job Object or POSIX process-group containment, halts on timeout
or unverified cleanup, and records original and cleanup phases separately. Retry
eligibility now requires the whole originals run to remain certain; an uncertain retry
produces one `not_run` result for each remaining candidate. POSIX settlement is bounded
and explicitly limited to process-group members (escaped descendants may remain).
History is a distinct B17-gated read-only mode using store validation and an exclusive
report outside the selected home. R5 focused tests passed twice, the full suite and
demo passed, B16's shared-helper workflow was rerun successfully, and the new
`docs/pulses/B19-r5-final.json` pinned-host artifact passed its assertions. The earlier
pinned-host artifacts remain unchanged. The supervisor's earlier focused-test failure
is recorded with its cause still unconfirmed because termination details were not
provided.
GPT-6.1 Sol verified the Luna high corrections and reviewed the complete diff and all
four acceptance rows. Independent final checks: six focused tests passed; full suite
290 passed with one existing POSIX-only skip; demo, syntax and diff checks passed.
Current-code B17 passed 13/13, including the changed shared Windows helper. The
supervisor pulse is `docs/pulses/B19-supervisor-final.json`: 7 pass, 1 injected original
fail, 0 not_run, one separate passing retry, denominator eight. No all-pass gate or
real provider/project service use is claimed.

## Historical next action (2026-11-14): B29 feedback

2026-11-14 fixture correction: `integration/mcp-free-workflow.mjs` now ran with
the pinned OpenCode 2.2.5 client through real MCP stdio and loopback-only
fixture composition. It observed queued/running/succeeded, a scoped diff and
passing test exit, a denied out-of-scope write and two duplicate submissions
without extra attempts/workspaces/model requests. New pinned fixtures preserved
partial effects after a drop and blocked/retained ownership after an uncertain
deadline. One local `node --test` run at `3c30866` passed 303 with one Windows
platform skip; later default-concurrency runs failed the pre-existing B10-03
timing case, while a serial run at `762c133` passed 304 with one skip. The
historical 307 still failed, delivering 7121 body bytes to a second loopback
origin. See the validation entries for native exits. Production `mcp-server.mjs` remains
passive/live-closed; no catalog, real provider, B20, relay or merge was run.
At `113e926`, PR #44's description and remote head were verified and Actions run
`43630565937` passed on Windows (305 tests/304 pass/0 fail/1 skip) and Ubuntu
(305 tests/301 pass/0 fail/4 skip), with the demo returning 429 then 200 on both. This is a green
rerun, not a repair of the create-then-write race in
`test/task-maintenance.test.mjs`: Windows run `43628743462` at `762c133`
failed and the test file is unchanged. Local default-concurrency runs can fail
on pre-existing B10-03 output timing and on five MCP-server output-wait
timeouts (B15-01c/01d/01e/01f/03b); the serial suite passed 304/1 skip.
Next, reply to the three P3 findings at `113e926`, verify the new head and
its CI, and obtain re-review before the maintainer decides draft-to-ready for
the fixture-only PR. Keep PR #44 draft until that decision, not because the
previous head's Windows check was red; neither a green rerun nor a developer
reply establishes deterministic default-concurrency stability or approval.
B30's separate branch cannot implement live use until
B29 is merged and verifiable deployment infrastructure exists; this Windows
host currently reports the required Hyper-V feature disabled. The following
decision checkpoint is historical and remains a live safety gate.

Review follow-up at `3c30866`: an independent reviewer reproduced the pinned
fixture MCP path and the 307 failure; Windows/Ubuntu CI passed at that head.
Four non-blocking P3 findings were published. This correction clarifies ADR-009
and the CLI header, exercises the real service outcome when approval expires
after admission, and records an independent full-suite run that failed the
pre-existing B10-03 timing case before a passing rerun. Revalidate the
correction head and reply to all four review threads before changing draft
status. No B30 gateway or live approval has been exercised.

Re-review at `762c133` verified those four replies, but reported three new
findings: Windows CI run `43628743462` failed in
`test/task-maintenance.test.mjs:183` (`Unexpected end of JSON input` while a
competing process was writing the file); Ubuntu passed. PR #44's body still
named `3c30866` and a green default suite, and the earlier status lines above
were misleading without their historical scope. The PR remains draft. Do not
interpret the independent local fixture-only verdict as a passing CI receipt
or redirect containment; the 307 still sent 7121 body bytes to another origin.

2026-11-14 decision update: ADR-009 is accepted **for fixture-only preparation**;
the live route remains closed. B29 is narrowed without rewriting its original
FAIL: complete B29-04 with an actual fixture MCP client, then re-review the new
head of draft PR #44. B30 is the separate live relay plus independently
verified worker-egress gate; the B30 card is prepared on its own branch, not
implemented in B29. Require pinned-host redirect and WebSocket-negative tests,
fresh authorized catalog evidence, and a maintainer-signed live approval bound
to the relay/egress policy before any real inference. The historical steps below
record the pre-decision state and do not supersede this update.

Historical pre-decision instructions (superseded by the update above):

1. Choose one option in [ADR-009](adr/009-free-anonymous-worker.md): a trusted loopback
   relay owned by the service (new trust boundary, needs its own card), a worker-host
   egress allowlist, a pinned host change exposing redirect control, or recorded
   acceptance of the redirect egress risk. Until a decision is recorded, keep the live
   composition closed and the B29 PR as draft.
2. Do not run the free route, a catalog GET, or B20 without a separate approval naming the
   model, privacy acknowledgement, objective and budget. Real inference is `not_run`.
3. B20 [PR #43](https://github.com/pbsilvabd/ai-orchestrator/pull/43) remains a draft and
   unmerged; its proposed `test/redaction-regression.test.mjs` was not implemented in B29.
   B19 is merged; its supporting diagnostics are not M3 evidence.

## Historical FIX23 checkpoint before PR #24 merged

Review `task/FIX23-authorization` under [FIX23](tasks/FIX23.md). It rejects multiply
linked files before host launch, restricts provider environment to FIXTURE_API_KEY,
and gives subprocess-test cleanup bounded retries for transient Windows cwd locks.
Local validation: 193 passed, one POSIX-only skip; pinned OpenCode 2.2.5 harness
passed hard-link/config-override rejection and original denied/allowed writes.
Independent review and current-head CI are required before merging this correction.
Proceed to B12 only after FIX23 is reviewed and merged. No merge is authorized by
this handoff. The original B11 checkpoint below is historical context.

## B11 checkpoint before FIX23 review

Branch: `task/B11-authorized-opencode`, base `093e050`. The B11 builder and test
fixture implement one exact configured model, `read`/`edit` only, exact relative
writable globs, bounded time/output and an isolated OpenCode environment. `bash` is
rejected. The pinned OpenCode 2.2.5 fixture denied a write outside `src/**` while
ambient configuration and a credential sentinel were present in the parent process.
All model requests went to the loopback fixture provider; no paid or external request
was made. Unit, full-suite, demo, diff and review evidence is recorded in
[validation](validation.md).

The B11 builder is not integrated with `createTaskService` or the scheduler. It only
accepts a loopback fixture provider today, is not an OS sandbox/network firewall, and
does not support production provider credentials. B11 is published as [PR #23](https://github.com/pbsilvabd/ai-orchestrator/pull/23);
review and CI are pending. Do not claim B11/M2b complete until required review,
acceptance and checks are satisfied. PR CI run 41756163116 passed on Windows and
Ubuntu at head `8eb9ac0`; review is pending. Proceed to B12 only after PR #23 is
reviewed and merged by a maintainer. Follow [the feedback protocol](pr-review.md).

The planned two-model development/review cycle requires B11–B20 delegation work,
then a scoped controller design. See the protocol and roadmap. These instructions
do not advance a runtime milestone or authorize merge.

## B03 checkpoint (2026-11-03, branch `task/B03-repo-identity`)

Repository identity validation is enforced on new task submissions. `src/repository.mjs` executes Git commands
via argument arrays without a shell. `baseRef` commit-ish resolves to a full commit SHA stored as immutable
metadata `task.baseCommit`. Branches are checked against Git ref rules, local existence and linked worktrees.
Idempotent replays bypass repository inspection and return the original record. Sibling paths and symlink escapes
fail closed with `authorization_denied`. Dirty parent working trees are accepted with user files unchanged.
141 tests pass; fallback demo returns 429 then 200.

## Earlier B05 checkpoint (merged through PR #14)

B05 checkpoint (2026-11-03), branch `task/B05-service-owner`: service ownership uses an exclusive lock file created before reconciliation. A second owner fails closed; call `service.close()` on graceful shutdown. Initialization failures release the lock. Crash leaves a stale lock for maintainer inspection; no automatic deletion. 129 tests and fallback demo pass.

Proceed with the detailed B03/B06/B07/B10 cards. Executor integration still depends
on the MCP gate and the declared executor prerequisites.
## Earlier B04a checkpoint (merged through PR #13)

B04a implementation checkpoint (2026-11-02), branch `task/B04-lifecycle-guards`:
the store rejects illegal ordinary transitions, immutable identity/request edits,
incoherent state metadata and late terminal lifecycle rewrites. 126 local tests
pass; the fallback demo prints 429 then 200. See the task contract's Store
enforcement section and ADR-008 amendment. This is not completion of M2b.

B01 diagnostics were corrected on the schemas branch (#8). B03 repository identity
and B06 MCP diagnosis are the next independent development items.

Remaining B04-related work is scoped to B12 dispatch production, B14 stop proof
and B18 maintainer-only reconciliation. No generic callback may leave blocked.

Review checkpoint (2026-11-02): see [PR review](review-2026-11-02.md) and
[agent backlog](backlog.md). The review baseline is main `a4cae9c`; its 83 local
tests pass. The old executor/client/acceptance branches are incomplete and must
not be merged as completed steps. Pick an unblocked backlog task from current
main. No milestone, MCP gate result or maintainer decision changed in this review.

1. B04a was merged through PR #13.
2. B05 ownership is implemented and reviewed in PR #14; service handles become
   unavailable after close, and crash locks require maintainer inspection.
3. B03 repository validation and B06 gate diagnosis can proceed independently. The
   MCP gate still has one recorded pass and one failure; resolve the cause before
   real transport integration. B01's existing correction remains on open #8.
4. Build the executor with isolated workspaces and fixture subprocesses; real host
   acceptance follows only when the prerequisites and MCP gate are verified.

Do not add routing, memory, remote access, fallback or automatic merge in M2b. The
HTTP fallback is not selected; change transport only through a new ADR-007 amendment.

## Contract rules that must not drift

- Persist the task before any worker starts; a persistence failure accepts no task.
- Same idempotency key and payload returns the same task ID; a different payload is a
  conflict. No silent duplicate work.
- `blocked` is terminal until a human reconciles it; nothing resumes automatically
  after a restart, and a persisted dispatch is never replayed.
- Only the dedicated B18 maintenance path can reconcile `blocked`; generic updates and
  transports have no override. Recovery evidence, retention and lock limits are in
  [ADR-008](adr/008-task-store.md) and the [maintenance procedure](task-maintenance.md).
- Cancellation is a request. `executionStopped` is `unknown` after abort/crash and
  `effectsReverted` stays `false`.
- Task text and artifacts never grant permissions; authorization is clamped to the
  configured allowlist.
- Success claims need a recorded command and exit code; otherwise report a limitation.
- Result and status access are owner-only; `clientId` comes from configuration.

## Run and validate

`node --test` and `node examples/fallback-demo.mjs` (Node 24.22.1, via fnm). No
dependency installation or credentials are required. Tests must use temporary state
directories, never the developer's real `AI_ORCHESTRATOR_HOME`.

The real smoke harness remains useful as the executor reference:
`node integration/opencode-smoke.mjs <absolute-path-to-opencode.exe>`. The verified
2.2.5 binary lives outside the repository (see integration/README.md). The MCP
capability gate runs separately:
`node integration/mcp-gate.mjs <absolute-path-to-opencode.exe>`.

## Existing API (reuse, do not bypass)

`createState(sessionId)`, `select(state, models, options)`, `success(state, dispatch)`,
`failure(state, dispatch, error, options)`, `nextOperation(state)` in
`src/policy.mjs`. `openSession(directory, sessionId)` in `src/ledger.mjs` provides the
exclusive lock and atomic checkpoint. `runOperation` in `src/runner.mjs` adds
cancellation and the per-invocation budget (ADR-005). Dispatch identity is the original
object from `select`; never rebuild it from current state. State version 1 is rejected
without migration.

The smoke test proved session/context continuity, explicit model switching and denied
writes against the pinned host. SDK retry changes retry/delay, not the readonly model.
Close `child.stdin` because the run waits for EOF. Abort does not undo effects.
`openTaskMaintenance({ home })` in `src/tasks.mjs` provides exclusive local maintenance,
evidence-bound blocked recovery and journaled pruning; use the CLI/procedure instead of
direct file edits. Locks left by a crash require explicit PID/process-tree inspection
and audited recovery; PID absence alone does not prove descendants stopped.

There is no event authentication, exactly-once guarantee or power-loss guarantee.
Ledger scope is a trusted local directory with cooperative writers; network
filesystems are unsupported.

## Workflow

Work on a branch, open a PR and never force push. Every change appends an entry to
[worklog](worklog.md), updates [roadmap](roadmap.md) and this handoff when the next
action changes, and records commands/results in [validation](validation.md). Decisions
and dependency changes need an ADR amendment. Documentation is maintained in English.

Evidence levels stay separate: unit, local HTTP, OpenCode integration and use on this
project. Mocks do not satisfy an integration gate, and direct edits in a development
chat do not count as M3.

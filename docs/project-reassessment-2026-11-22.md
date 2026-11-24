# Project reassessment — 2026-11-22

## Scope and observed revisions

This is a repository/queue reassessment, not a full security review or milestone
sign-off. Main: `11fcb422de47c2a9b79389de8470802d48ead730`. B30/#45:
`a4f3954514e2109a5f0112dcea0534d291a9fcf4`. B20/#43:
`1dd96140e0fe47a77a27c3efc0b4adc21481a8d3`.

GitHub heads, merge receipts, checks and conversations were inspected alongside
the code. B30's 67 conversation comments and empty submitted-review/inline-comment
channels were read; earlier review verdicts apply only to their named heads.
No new complete B30 approval is claimed.

## What exists, and what does not

| Area | Actual status | Next consequence |
| --- | --- | --- |
| Policy/ledger/runner and M2a contract | Delivered within documented local scope | Reuse; do not rebuild |
| B01–B07 (B04a replaces broad B04), B09–B19, B26 and corrective work | Merged, including B17 acceptance harness, B18 recovery and B19 diagnostics | Do not assign these implementations again |
| B29/#44 anonymous free-worker preparation | Merged at main `11fcb42`; pinned fixture/MCP evidence | Not live-provider support; old redirect-leak receipt remains valid for the uncontained path |
| M2b | Technical fixture acceptance evidence exists; current docs still withhold milestone completion | Reconcile B17 evidence against the DoD explicitly; neither hardware nor a real inference is an intrinsic fixture-acceptance requirement |
| B30/#45 | Large draft: 37 files, 9,750 additions/83 deletions at inspected head; fixture relay/gateway, approval and ownership mechanisms plus partial deployment evidence | Finish composition and evidence, not another generic architecture framework |
| B20/#43 / M3 | Draft checkpoint; no real delegated project diff or human review | Continue the same PR only after an authorized executable path exists |
| Runtime fallback, memory, multi-worker routing and automated developer/reviewer controller | Not delivered | Keep outside the critical path to first supervised use |
| SQLite, schema adoption and expanded CI | Proposals/supporting work, not shipped by open PRs | Prioritize measured needs, not age of proposal |

No M2b/M3 completion, free-provider availability, zero session cost or production
safety is inferred from these observations.

## Reassessment of the B30 diagnosis

The quoted diagnosis is substantially correct, but “only integration validation
remains” is too strong. At the inspected head:

1. **Recorded deployment evidence exists:** Windows two-VM routing isolation,
   IPv4/IPv6/DNS/off-link Upgrade negatives, and a host gateway on the relay
   link forwarding once to a fixture origin. These are historical runs, not a
   current inventory of the operator's host.
2. **Direct real TLS and gateway Upgrade refusal also exist:** the 2026-11-16
   receipt records an authorized TLS handshake to `opencode.ai`, one empty-JSON
   gateway request returning provider 400 (no generation), and Upgrade GET 405.
   The older PR-body list calling all application-level rejection `not_run` is
   stale. None establishes the full worker/relay/gateway deployment.
3. **A private listener decision is implemented:** `relayHost` is policy-bound.
   Binding/using it on the intended private NIC remains untested.
4. **Deployable composition is still missing, not merely its test receipt.**
   `src/free-listeners.mjs:85-114` fixes the gateway to fixture mode, a loopback
   origin and loopback relay upstream; its supervisor forks local children.
   A private relay bind does not place the gateway/relay/worker in separate
   compartments. Worker launch, repository/workspace mapping, artifact return,
   process ownership and uncertain-stop behavior need a concrete reviewed
   deployment path. Track this in [#46](https://github.com/pbsilvabd/ai-orchestrator/issues/46).
5. **The cryptographic positive FIDO2 path remains absent.** Negative real-key
   tests, synthetic flag blobs and mock-positive admission cannot prove it.
6. **Active pinned-worker WebSocket bypass remains absent.** A raw Upgrade
   denial and the absence of spontaneous Upgrade on normal POSTs are different
   observations. Most of the active negative can use controlled origins; a real
   provider contact requires separate permission.
7. **Certificate-date failure handshakes remain absent.** The TLS file tests
   real trusted/untrusted CA and wrong-host handshakes; `CERT_HAS_EXPIRED` in a
   classifier unit test is not an expired-certificate handshake.

The full B30 acceptance/review remains incomplete despite successful exact-head
Windows/Ubuntu CI run `43806088953`.

## Are physical devices required?

**No dedicated physical computers are required for the VM/network tests.** One
adequately provisioned host can run the Hyper-V pair. A dedicated Linux test host
may itself be a disposable VM and host worker/relay namespaces. Select and declare
one supported deployment path first; validating both is needed only to claim both.
The existing WSL fixture is retained at its actual evidence level.

**A physical FIDO2 key is required for the currently selected approval profile.**
ADR-010 requires UP/UV and the verifier explicitly rejects non-`-sk` signatures.
That is an architectural assurance choice, not a universal requirement for a
single-user local worker service.

Recommendation: evaluate a task-bound software-SSH-signature profile for supervised
local use, with the signer and private material outside worker reach, retaining
FIDO2 as the stronger profile. This loses hardware presence/verification and must
not be represented as equivalent. [#47](https://github.com/pbsilvabd/ai-orchestrator/issues/47)
records the threat-model, ADR, code/test/contract and real positive-signature
acceptance requirements. Until that replacement is accepted and implemented,
the existing FIDO2 gate stays in force. No plain `actor`, unsigned file or GitHub
comment becomes runtime authority.

TLS expiry/wrong-host tests should use a controlled CA/origin with real TLS and
production verification enabled. There is no need to wait for, or interfere with,
the external provider's real certificate expiry. Deployment connectivity still
needs its own resolver/trust-store evidence. This is a recommended test design;
existing required variants cannot be silently dropped.
In the documented architecture, the gateway validates HTTPS to the origin;
the private relay-to-gateway link is not automatically a separate TLS hop.
Test the actual designed chain rather than add an accidental encryption requirement.

## Queue disposition

| Item | Disposition | Reason / revisit trigger |
| --- | --- | --- |
| #45 B30 | Keep draft; do not close/recreate or merge | Useful work and review history; #46 makes remaining implementation explicit |
| #43 B20 | Keep one blocked draft | It is still the primary product-value experiment; no duplicate evidence PR |
| #9 lifecycle RFC | Retire as superseded | B04a/B14/B18 implement guarded lifecycle and privileged recovery; old generic edges/dependencies are no longer the plan |
| #6 SQLite RFC | Retire obsolete proposal, not SQLite forever | Single service owns writes; old migration/authority/CAS objections remain; its proposed ADR-009 number now collides with accepted free-route ADR-009 |
| B21/B22a–c | Park | Reopen with measured storage/transaction/migration need, a new design identity and seven-item capability gate; no automatic migration |
| #30 | Keep, narrow to unresolved output bounds and public diagnostics decision | B13–B17 implementation is merged; `progress`/metadata bounds and omitted attempt diagnostics still need explicit resolution |
| #31 / #32 / #33 | Retain CI foundation track; refresh before approval | SHA action pins, redacted secret scan and coherent check/toolchain entry points still help; #33 conflicts with current main |
| #34 B28 | Blocked draft, not ready | Depends on unmerged #33, conflicts with main; old macOS jobs were cancelled and smoke skipped, not all green |
| #48 test stability | Prioritize alongside composition | Documented readiness/timing/maintenance races impair evidence; a passing rerun is not a fix |
| B08 schema adoption | Supporting, not M3 blocker | Differential corpus first; no second validation architecture merely for uniformity |
| B23 fallback | After basic use and two approved models | Pure policy exists, executor integration does not; not needed for one worker |
| B24/B25 and two-model controller | Defer until B20 yields a useful baseline | No demonstrated need yet for memory/routing/concurrency; sequential roles do not require general routing |
| macOS, coverage thresholds, local hook | Later CI slice | Useful only with defined support/coverage goals; not prerequisites for first Windows/Linux use; never install hooks silently |

Closing a stale proposal does not resolve its technical objections or adopt a
replacement. The merged architecture and contract remain authoritative.

## Shortest defensible path forward

1. Resolve the approval-profile design in #47; until then develop/test offline
   without claiming that FIDO2 has passed. In parallel, specify the compartment
   mapping and ownership plan in #46 before provisioning. B17/M2b fixture
   acceptance can be reconciled independently now; it need not wait for B30,
   hardware or live-provider use.
2. Implement the missing composition in bounded reviewed scope, preserving #45
   as the B30 checkpoint; fix the test synchronization issues tracked in #48.
3. Run controlled end-to-end requests through the **actual pinned worker**
   and chosen deployment. Prove allowed traffic works, forbidden destinations/
   ports/IPv4/IPv6/DNS/Upgrade paths fail, redirects leak zero bytes, and
   timeout/drop/restart/uncertain-stop retains ownership and never replays.
4. In the same planned environment session, collect private-NIC bind, policy
   digests, TLS success/failure, logs/counters and teardown evidence. Use a
   non-inference request for any separately authorized real-origin connectivity
   check. Keep signing off the network critical path where possible; signatures
   expire and final approval must bind the eventual exact task/policies.
5. Re-review the final B30 head, acceptance rows, outstanding feedback and exact-head
   CI. No live inference is needed to test security controls. No merge is
   authorized by this reassessment.
6. With M2b acceptance reconciled, obtain a fresh exact objective/model/privacy/
   budget approval and execute B20 through the service. Return a useful scoped
   diff and real test evidence for human review. Only then expand automation.

No VMs, firewall rules, provider calls, catalog refreshes, key enrollments or live
tasks were performed by this reassessment. Historical catalog snapshots are expired
observations, not fresh permission. Local validation and limits are appended to
[validation.md](validation.md).

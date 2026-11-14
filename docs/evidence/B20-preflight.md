# B20 supervised-use checkpoint — 2026-11-14

**Blocked/incomplete. No real worker task was submitted. M3 is incomplete.**
Supervisor: GPT-6.1 Sol. Branch: `task/B20-first-supervised-use`.
Base: `688da04bea29b300eb4cb1815bfbcb9fd0cd35ca`.
This is the single B20 draft checkpoint, not a separate evidence delivery. Continue
the same branch/PR with the eventual worker-produced change; do not merge this
checkpoint as completed B20 or create a competing evidence-only PR.

## Remote prerequisites

Fetch and the GitHub main-commit API independently returned the base above; no B20
branch/PR existed at pickup. B19/#42 is merged, not still awaiting publication.

| Prerequisite | Remote receipt | Scope and remaining limit |
| --- | --- | --- |
| B17/#40 | Merge `190370fae1fe44272dbaed22889156397f143c2f`; reviewed head `23158e6404afe3a7963910b331833131a25a6012`; Windows/Ubuntu PR CI run `43568129937` and post-merge run `43568386630` successful | Published correction review resolves all four findings. Tracked matrix has 13 pass, 0 fail, 0 not_run; fixture evidence, not real-provider use. |
| B18/#41 | Merge `c268239b3a15d9e507bee703016f6bbeccb266d7`; reviewed head `305e78af9bebf60ed661874a59f4e764b13c75ae`; PR run `43579177589` and post-merge run `43589015912` successful on both platforms | Maintainer-only recovery is implemented; process inventory remains a trusted human assertion, not rollback or machine proof. |
| B19/#42 | Merge/base `688da04bea29b300eb4cb1815bfbcb9fd0cd35ca`; reviewed head `f7f41aa1fabe5a36f46a9de1c6cf92b88a210927`; PR run `43599392443` and post-merge run `43599861407` successful on both platforms | Diagnostic fixture evidence only. Preserved injected failure and separate retry do not constitute real project use. |

The complete PR bodies/conversation/reviews and all review threads for #40–42 were
read; thread queries returned no nodes and `hasNextPage: false`. B17's correction
review, not just green CI, is part of prerequisite verification. M2b's technical
matrix evidence is available; the repository's milestone acceptance remains open.
Neither merged cards nor this checkpoint silently mark M2b/M3 complete.

Fresh local prerequisite verification also passed: [B20-prerequisite-B17.json](B20-prerequisite-B17.json)
records 13 pass, 0 fail, 0 not_run on this base (dirty evidence checkout), actual
OpenCode 2.2.5 MCP calls, client-observed queued/running/succeeded, one attempt and
one workspace for duplicates, cancellation and restart without replay. The B18
maintenance suite passed 21/21. These do not approve a real provider or close M3.

## Real-model preflight: stop before dispatch

| Required input | Observed state |
| --- | --- |
| Implemented adapter path | **Unavailable.** `src/opencode.mjs` requires the OpenAI-compatible fixture package and an `http://127.0.0.1:<port>/v1` URL; external URLs are rejected. A loopback forwarding proxy would not be a validated real-provider path and is not used. |
| Credentials | The adapter permits only `FIXTURE_API_KEY`. No real credential was requested, read, supplied or verified; ambient credentials are not authority. |
| Provider/model/version | No real provider or exact service model ID is configured/authorized/validated. GPT-6 Luna is a preference, not an available service configuration. Host model listings would not establish service support. |
| Effort `high` | No effort/variant field is passed by the launch builder; `high` is not an implemented, validated service option. |
| Financial budget | No amount/currency or provider-side hard cap is approved. `budgetMs` is wall time, not a monetary cap. |
| Execution/permissions | No real task limits or writable scope have been specifically approved. Existing adapter permits only `read`/`edit`; `bash` is refused. |
| Transport wiring | `mcp-server.mjs` creates a passive service without a worker. Integration fixtures explicitly wire a trusted worker; the stock JSON entry point does not enable a real one. |

**Exact unblock prerequisite:** separately scope, authorize, implement and validate a
real-provider adapter and service/transport composition, deliberate out-of-repository
credential handling, exact provider/model ID and supported effort configuration,
and enforceable spending/execution limits. Then obtain the maintainer's specific
approval of the objective and complete run configuration below. This B20 assignment
does not authorize those support changes. Do not relabel an external proxy as a
fixture, inherit the supervisor's provider, use a chat subagent, enable fallback,
or replay an uncertain dispatch.

## Proposed tiny task — NOT approved or executed

Objective: add a table-driven regression fixture for repeated credential-pattern
recognition/redaction, including mixed case, Basic/Bearer, supported credential
labels and benign text. Exercise repeated calls so global-regexp state cannot make
the same credential-shaped input alternate between accepted and rejected.

- Expected worker edit: **only `test/redaction-regression.test.mjs`**, a new file.
  No runtime, configuration, policy, contract, dependency or documentation edits by
  the worker. The supervisor has not created this file or implemented its tests.
- Observable acceptance: each supported synthetic pattern is consistently detected
  across repeated/interleaved calls; redaction omits every fake value; benign text
  remains unchanged; assertions use synthetic data only. Focused test, full suite,
  fallback demo and whitespace check return actual zero exits, collected by trusted
  service-configured commands in the isolated workspace.
- Proposed worker: GPT-6 Luna / `high` **only if separately supported and authorized**;
  exact provider/model/version remains unresolved. No substitute model is approved.
- Proposed bounds (not authorization): one worker, one attempt, 600,000 ms total,
  1,048,576 output bytes, fallback off; financial ceiling USD 1.00 only with an
  independently enforceable provider hard cap. Revisit feasibility before approval;
  wall-clock limits cannot enforce that ceiling.
- Proposed tools: `read`/`edit`; only the exact new test file writable. No shell,
  plugins, skills, MCP calls by the worker, provider-policy changes or merge power.
  Test commands are trusted service configuration, not task-provided shell authority.
- Approval receipt: **absent**. No objective/model/budget approval is inferred from
  the request to investigate B20. Reconfirm base/branch availability at submission.
  The existing B20 delivery branch cannot be the service's new workspace branch;
  select a fresh worker branch and retain its binding when incorporating the
  worker-produced change into this same delivery PR, without supervisor rewrites.

## Real-task correlation receipt

| Field | Value |
| --- | --- |
| taskId / idempotency key | Not allocated; no real submission, reservation or dispatch |
| Base | `688da04bea29b300eb4cb1815bfbcb9fd0cd35ca` (checkpoint, not a dispatched task base) |
| Workspace / worker branch / worker head | not_run; no real worker workspace exists |
| Transport submit / status / attempts / result | not_run; no real-task receipts exist |
| Returned diff / changed files / tests | not_run; no worker-produced project change |
| Correction dispatches / receipts | not_run; no real result exists to correct |
| Model version / token use / real-worker cost | Unknown/unavailable; zero real-worker calls were made by this checkpoint |
| Supervisor session cost | Unknown; not represented as a zero-cost model session |

The fixture UUIDs in the negative report and prerequisite B17 report are **not** a
real B20 taskId. No synthetic successful fixture is promoted to `use-on-project`.

## Acceptance matrix

| Row | Result | Observable evidence and missing gate |
| --- | --- | --- |
| B20-01 | **not_run** | Real-provider path, specific approval and financial budget are missing. No transport submission or worker diff is invented. |
| B20-02 | **pass (safe-stop/fixture)** | Actual adapter rejects external provider, unapproved model/budget and unsupported credential environment before launch. Missing real availability/authorization/budget stops this session without provider calls. Live provider availability/billing probes remain not_run. |
| B20-03 | **pass (negative fixtures only)** | Real temporary Node/Git/service artifacts return an unrelated file, an actual test exit 7 and a credential-shaped fake artifact. Supervisor rejects all three, preserves sanitized evidence and makes no merge/retry. Real-worker correction-path exercise is not_run. |
| B20-04 | **not_run** | No useful real-worker diff exists for human review. Model review and negative-fixture rejection cannot satisfy this row. Human objective/config approval and later diff/merge decision remain required. |

`integration/supervised-use-preflight.mjs` is a fixed local negative harness, not a
real worker adapter. It cannot accept provider credentials, a model executable or
an arbitrary task. Its deliberately noncompliant trusted Node fixtures bypass host
edit policy to exercise supervisor rejection of returned artifacts. This proves no
OS sandbox or pinned-host permission behavior. Service status `succeeded` records
the fixture process's zero exit, not acceptance of its changes/tests. The failed
test's actual **exit 7 stays 7**; fixture-scenario `pass` means the rejection was
observed, not that the worker change passed. Redaction does not make a secret-bearing
change acceptable, and is not comprehensive secret detection.

Reports are exclusively created; do not overwrite observations or retry failures.
The initial report is preserved in `B20-negative-fixtures.json`; later review and
revalidation reports are distinct observations, never replacement task attempts.
The final-code observation is [B20-negative-reviewed.json](B20-negative-reviewed.json):
four prelaunch refusals and three supervisor rejections, each observed once in a
new temporary fixture service. Earlier `B20-negative-fixtures-final.json` predates
the final failure-receipt correction. The distinct
[missing-Git setup failure](B20-negative-setup-failure.json) remains a failed harness
run (native exit 1, `success: false`, all seven scenarios not_run, scratch retained),
not a successful run or a retry of that failure. Existing-report refusal returned
exit 1 without changing report bytes or the temporary-root inventory.
See [validation](../validation.md) for commands/exits and final review results.
All published inputs are public/synthetic; reports omit credentials, private
payloads and absolute state/workspace paths. No service runtime behavior/contract/ADR is
changed. Publication remains draft; **do not merge**.

## Two review passes (model review, not B20-04)

1. Implementation/authority review checked the real-provider preflight against the
   builder, MCP entry point and contract, then inspected every negative fixture's
   actual returned diff/test exit. Found report-path reuse was detected only after
   fixture execution. Moved exclusive reservation before any fixture effects and
   verified an existing report refuses unchanged before a new scratch root appears.
2. Completed-diff review inspected all new code/reports/docs and every B20 row.
   Found failure cleanup could prevent receipt publication and omit remaining
   scenarios. Preserved failure receipts, made unexecuted scenarios explicit and
   tested a real missing-Git setup failure. Removed stale B19-current-delivery wording,
   and rechecked that the proposed worker file is absent. No service/provider
   authority was broadened. Final harness success is 7/7 fixture scenarios; full
   suite was rerun after the code correction: 290 pass, 0 fail, 1 existing POSIX-only
   skip. Demo and syntax/whitespace checks passed. Review does not resolve the
   external provider/approval blockers or substitute for human review of a real diff.

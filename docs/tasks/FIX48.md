# FIX48 — Make default-concurrency acceptance deterministic

## Pickup and delivery

- Status and observed base SHA: authorized from remote `main`
  `f61e5e14f8c9ca0b3e9be9fbbf4d94e0515e8672`; initial Windows x64 Node 24.22.1
  run reproduced B10-03 (`'' !== 'before'`), 303 passed, 1 failed, 1 skipped.
- Prerequisites: B10, B12, B15 and B18 are merged; issue #48 documents the
  cross-task timing and test-harness races. No B30/B31 or live-use prerequisite.
- Existing PR or new branch: new branch `task/FIX48-concurrency-stability`,
  based on current `origin/main`. One correction PR; no merge authorization.
- Required code/contract/ADR references: `test/subprocess.test.mjs`,
  `test/scheduler.test.mjs`, `test/mcp-server.test.mjs`,
  `test/task-maintenance.test.mjs`, `scripts/repeat-default-suite.mjs`,
  `.github/workflows/ci.yml`, and #48.
- Files owned: affected test synchronization and CI repeated-sample runner.
  Production behavior may change only if a real failing case proves a defect;
  any such change must preserve the task contract and be justified by a focused
  regression. Propagate the final reviewed correction into stacked PRs #45/#51.
- One task ID, one branch, one PR; follow [task execution](../task-execution.md)
  through publication. Do not merge.

## Objective and scope

Resolve the default-concurrency failures coordinated in #48 across B10/B12/B15/B18.
The current B10-03 test assumes the child has started and emitted stdout before a
150 ms abort; B18 cross-process fixtures expose create-then-write JSON to readers;
MCP output polling drains and discards incomplete collections. Readiness/polling
windows must be predicate-based and bounded, without converting a failure into a
skip or weakening assertions. Preserve process stop uncertainty, output evidence,
ownership exclusion, no-replay behavior, and every original observed result.
The B10 deadline case uses the helper's existing 3-second bound and asserts an
actual flushed-output marker; no repository-wide timeout window is lengthened.

No blanket timeout increase, CI serialization workaround, assertion weakening,
test skip, provider/network/VM/firewall activity, or change to deployment/live
policy is in scope.

## Implementation sequence

1. Reproduce and characterize each reported boundary with the actual process,
   stream, filesystem or protocol fixture; inspect issue #48 before editing.
2. Replace time-only assumptions and destructive polling with explicit readiness,
   atomic fixture publication and bounded waits that retain observations.
3. Add a CI runner that performs five sequential, default-concurrency
   `node --test` originals on each declared OS at the same commit, preserves every
   result, continues after a failing sample and fails the gate if any sample fails.
4. Verify focused failure assertions, full suite, demo, and CI campaign. Propagate
   the correction to #45/#51 only after the correction commit is identified.
5. Update backlog, roadmap, handoff, worklog and validation with exact row evidence,
   commands, exits, review notes and remaining gates.

## Required acceptance matrix

| ID | Concrete input or trigger | Observable output/state | Forbidden side effects | Verification method |
| --- | --- | --- | --- | --- |
| FIX48-01 | B10-03 deadline and abort while real child emits output under default suite load | Bounded settlement, actual emitted partial output retained, timers/listeners cleaned; readiness observed before the abort assertion | No weakened output assertion, omitted failure, or false stop/tree claim | Named real-child test; focused repeated runs |
| FIX48-02 | B12 real worker readiness and deadline/cancel boundary under concurrent suite load | Existing status, durable-dispatch, cancellation and no-replay assertions remain reliable | No duplicate spawn, replay, or altered lifecycle semantics | Named scheduler tests and focused repeated runs |
| FIX48-03 | B15 protocol output arrives across polls/chunks under concurrent suite load | Every observed response is retained until the required count; timeout remains bounded | No dropped line, payload echo, or protocol/service side effect | Named MCP test(s), including split/partial collections |
| FIX48-04 | B18 two real recovery contenders publish result JSON while parent observes files | Readers parse only complete records; exactly one owner wins and replacement lock bytes remain unchanged | No weakened exclusion, lock release, record overwrite or skipped assertion | Named multi-process maintenance test |
| FIX48-05 | Five consecutive full default-concurrency suite originals on Windows and Ubuntu at one clean SHA | All ten outcomes retained independently; every sample exits 0 and confirms the same unchanged clean checkout; demo and final-SHA CI pass | No serial test mode, rerun substitution, hidden failed sample or cross-SHA aggregation | CI matrix, five sequential native `node --test` commands per OS, demo |
| FIX48-06 | Corrected commit is applied to stacked B30/B31 branches | PR #45 and #51 contain the same correction commit(s), with verified branch heads | No force push, merge, ready/live transition or unrelated B31/B30 edits | Git ancestry/diff checks and remote PR head verification |

## Validation and evidence to publish

- Capture each baseline/focused/full-suite/demo/whitespace command's native exit.
- Run Node.js 24.22.1; preserve all original failed and successful samples.
- CI must execute five default-concurrency full suites sequentially on both
  Windows and Ubuntu at the same task SHA; a passing rerun never replaces a
  failed original.
- Perform implementation and completed-diff review; fix and revalidate findings.
- Record the FIX48 PR URL/base/head and propagation SHAs for #45/#51. Keep #51
  draft while any acceptance row or #46 gate remains incomplete.
- No provider/catalog, live key, hardware, VM, firewall or network-policy action.
  Merge remains separately unauthorized.

## Final completion check

Every row has observed evidence, all ten full-suite samples pass at one SHA,
review findings are corrected, docs are current, and the one FIX48 PR is published
and verified. Propagation is separately verified in #45/#51. If either platform
campaign is unavailable or fails, keep the correction PR draft/incomplete and
record every result; do not waive or replace a sample.

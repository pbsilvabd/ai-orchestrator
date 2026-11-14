# B19 pulse evidence

The pulse is manually run and is not a scheduled service feature. Each capability
report contains eight original slots; history-only reports have no capability summary.
A diagnostic retry is stored in a
separate `retries` array and never changes the original denominator or outcome.
Artifacts are created exclusively and must not already exist.

## Acceptance evidence map

| Card row | Evidence | Observation |
| --- | --- | --- |
| B19-01 | `test/harness-pulse.test.mjs` — `B19-01: eight real child invocations retain original failure and separately count retry`; [`B19-supervisor-final.json`](B19-supervisor-final.json) | Eight real pinned-host original processes: 7 pass, 1 injected probe failure, 0 not_run; separate diagnostic retry for original slot 4 passed. The pulse exits 1 because it truthfully retains the original failure. Denominator remains 8. |
| B19-02 | `test/harness-pulse.test.mjs` — B19-02 test group | Missing/wrong hosts preserve eight `not_run` records; a real temporary gate and spawned descendant are torn down; timeout and signal-error paths settle boundedly and halt the pulse; uncertain originals suppress every retry, and an uncertain diagnostic produces exactly one result per candidate. Fixture execution budgets are generous; only dedicated timeout fixtures use short deadlines. |
| B19-03 | `test/harness-pulse.test.mjs` — `B19-03: history-only CLI is read-only, lifecycle-safe and does not run the capability gate` | Separate CLI/API history mode is B17-gated, launches no supplied gate, refuses malformed/uncertain/incoherent records and in-home output, preserves a coherent known-failure reconciliation projection, and leaves all task-home bytes unchanged. |
| B19-04 | `test/harness-pulse.test.mjs` — `B19-04: output is sanitized, UTF-8 bounded, exclusive, manual and non-ranking`; `B19-r5-final.json` | Credential split across writes is redacted; transcript stays ≤8192 UTF-8 bytes on a code-point boundary, output collision refuses, invalid version text is not persisted, and source/report inspection finds no scheduler, external provider credential or ranking path. |

## Pinned host fixture experiment

`B19-pinned-host.json` is the original review-checkpoint artifact and remains
unchanged. `B19-r5-final.json` is the new R5 final correction run. OpenCode
was independently exercised again in `B19-supervisor-final.json` after complete-diff
review; all nine original/diagnostic processes confirmed empty Windows Job Objects.
OpenCode
2.2.5 is supplied from an externally verified release binary; the gate uses only its local
loopback fixture provider. The expected injected failure makes the command exit 1;
that is not a passing eight-run capability gate. The correction run additionally
records separate original/cleanup phase metadata and containment status. This
experiment supports B19 failure/retry accounting and observed gate outcomes, not an
all-pass B06 gate, production provider behavior, model quality, M2b/M3 completion or
use of the task service on this project.

The B17 baseline is independently reconfirmed on archived base `c268239` in the
supervisor's external temporary snapshot (13 pass, 0 fail, 0 not_run); it is separate
from this B19 pulse. The B19 history track refuses blocked, incoherent or uncertain
records, including administrative recovery that retains unknown outcomes; coherent
known-failure reconciliation is reportable. `observed` means
recorded test command/exit metadata exists; it does not mean the tests passed.

No real credentials, external/paid provider calls, task execution, task-store writes,
automation or model ranking were used. The gate's fixture key is a local fake sentinel.
See [validation](../validation.md) for exact
commands, exits, environment, and limitations.

# B19 pulse evidence

The pulse is manually run and is not a scheduled service feature. Each JSON report
contains eight original capability-gate slots. A diagnostic retry is stored in a
separate `retries` array and never changes the original denominator or outcome.
Artifacts are created exclusively and must not already exist.

## Acceptance evidence map

| Card row | Evidence | Observation |
| --- | --- | --- |
| B19-01 | `test/harness-pulse.test.mjs` — `B19-01: eight real child invocations retain original failure and separately count retry`; `B19-pinned-host.json` | Eight real pinned-host original processes: 7 pass, 1 injected probe failure, 0 not_run; separate diagnostic retry for original slot 4 passed. The gate process exits 1 because it truthfully retains the required original failure. Denominator remains 8. |
| B19-02 | `test/harness-pulse.test.mjs` — `B19-02: missing binary leaves eight not_run slots and timeout/oversized output are bounded` | Missing binary, missing/wrong version and invalid host cases preserve all eight not_run records; a real temporary child times out, and oversized raw output is bounded, flagged and omitted safely. |
| B19-03 | `test/harness-pulse.test.mjs` — `B19-03: pre-B17 refusal and blocked/uncertain task history have no child effects or writes` | Missing B17 evidence refuses the history track; blocked/uncertain temporary task remains byte-identical, with no task child launched. The history reader is direct read-only file parsing and never opens the store. |
| B19-04 | `test/harness-pulse.test.mjs` — `B19-04: output is sanitized, UTF-8 bounded, exclusive, manual and non-ranking`; `B19-pinned-host.json` | Credential split across writes is redacted; transcript stays ≤8192 UTF-8 bytes on a code-point boundary, output collision refuses, and source/report inspection finds no scheduler, external provider credential or ranking path. |

## Pinned host fixture experiment

`B19-pinned-host.json` records the eight original gate outcomes and separate retry.
OpenCode 2.2.5 was supplied from an externally verified release binary; the gate
uses only its local loopback fixture provider. The expected injected failure makes
the command exit 1; that is not a passing eight-run capability gate. This experiment
proves B19 failure/retry accounting and the seven observed original gate passes, not
an all-pass B06 gate, production provider behavior, model quality, M2b/M3 completion
or use of the task service on this project.

The B17 baseline is independently reconfirmed on archived base `c268239` in the
supervisor's external temporary snapshot (13 pass, 0 fail, 0 not_run); it is separate
from this B19 pulse. The B19 history track still refuses blocked or uncertain records,
including administrative recovery that retains unknown attempts. `observed` means
recorded test command/exit metadata exists; it does not mean the tests passed.

No real credentials, external/paid provider calls, task execution, task-store writes,
automation or model ranking were used. The gate's fixture key is a local fake sentinel.
See [validation](../validation.md) for exact
commands, exits, environment, and limitations.

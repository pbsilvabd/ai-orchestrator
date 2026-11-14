# Local task-store maintenance (B18)

This helper is for an operator at the trusted local state directory. It is not an
MCP tool, service method or worker capability. Maintenance never resumes or retries
work. It requires exclusive cooperative ownership and refuses while a service-owner
lock or recovery gate exists. Prune/reconciliation authority is an opaque in-process
capability held by the active maintenance closure; a readable lock-file nonce is not
authority. Closed/stale handles and direct-store calls cannot reuse a later lock.

## Before touching state on Windows

1. Stop the service gracefully if possible. If shutdown is uncertain, preserve the
   state directory and do not start another service or run maintenance.
2. Back up the whole `AI_ORCHESTRATOR_HOME` while no writer is active. Keep the copy
   separate and do not edit committed task/index files by hand.
3. Inspect `locks/service-owner.lock`, `locks/maintenance-owner.lock` and
   `locks/owner-recovery.lock`. Never delete a lock based only on age or its recorded
   PID. A live PID, inaccessible PID, malformed lock, PID reuse ambiguity, network
   filesystem or uncertain writer means stop and preserve the state.
4. On Windows, inspect the recorded PID in Task Manager or with an approved process
   inspection tool, check the process command line/start time, and inspect the worker
   process tree (for example, Process Explorer). A useful inventory is
   `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine`;
   inspect all process entries and walk parent relationships for the service PID,
   including children whose parent already exited. Node's `process.kill(pid, 0)` only
   checks that the recorded PID is absent/present. A controlled Windows experiment
   confirmed the root can exit while a detached child stays alive. Check task workspace
   paths, worker command lines and external effects separately. If the process inventory
   is incomplete, a descendant is live, or any check is ambiguous, refuse recovery.
   Human-supplied inventory is an audit assertion, not OS authentication or a
   machine-verified process-tree proof.
5. Keep an independent backup and record operator, reason, task ID/state, decision,
   process observations and the evidence digest printed by `inspect`.

The filesystem and writers must be local and cooperative. This is not a distributed
lock or a defense against hostile processes modifying files/locks concurrently.
There is no power-loss guarantee, OS identity authentication or exactly-once claim.

## Inspect and reconcile

Set `AI_ORCHESTRATOR_HOME` to the trusted state directory, then:

```powershell
node scripts/task-maintenance.mjs inspect
$inputFile = Join-Path $env:TEMP 'task-maintenance-input.json'
@{ taskId = '<task-id>' } | ConvertTo-Json -Compress |
    Set-Content -LiteralPath $inputFile -Encoding UTF8
node scripts/task-maintenance.mjs inspect --input-file $inputFile
```

`--input-file` reads UTF-8 JSON and accepts the optional BOM written by Windows
PowerShell 5.1's `Set-Content -Encoding UTF8`. Structured PowerShell examples below
use this option so spaces and quotes are not altered by legacy native argument passing.
The raw `[JSON]` argument remains available to compatible shells, but requires native
argument passing or escaping that preserves the JSON quotes; do not copy raw-JSON
examples into Windows PowerShell 5.1.

For an uncertain service-owner lock, first check the process tree and backups. Only
after the PID is verifiably absent and the process/effect review is complete, record a
human attestation and explicitly invoke:

```powershell
$inputFile = Join-Path $env:TEMP 'task-maintenance-input.json'
$maintenanceInput = @{
    actor = '<operator>'
    reason = '<why>'
    evidence = '<observations and backup location>'
    processTreeChecked = $true
    inventoryComplete = $true
    inventorySource = '<tool and observation time>'
    liveWorkerPids = @()
}
$maintenanceInput | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $inputFile -Encoding UTF8
node scripts/task-maintenance.mjs recover-owner --input-file $inputFile
```

For an interrupted maintenance process, add `"lockKind":"maintenance"`. The helper
refuses live or ambiguous owner PIDs, incomplete inventories or listed live worker
PIDs. Competing recoveries serialize through `owner-recovery.lock`; service startup
checks the gate before and after acquisition. The helper writes a durable audit
receipt before removing exact unchanged owner-lock bytes and creating the replacement
maintenance owner.

For a crashed service with a persisted dispatch, owner recovery only removes the
verified stale service-owner lock; it does not change the task record. Continue with
the distinct guarded store-reconciliation command to mark interrupted work `blocked`,
then inspect its exact record and digest before making any administrative decision:

```powershell
node scripts/task-maintenance.mjs reconcile-store
$inputFile = Join-Path $env:TEMP 'task-maintenance-input.json'
@{ taskId = '<task-id>' } | ConvertTo-Json -Compress |
    Set-Content -LiteralPath $inputFile -Encoding UTF8
node scripts/task-maintenance.mjs inspect --input-file $inputFile
```

Use the returned `recordDigest` in the evidence-bound blocked-task `reconcile` example
below. Only after that decision is committed should the service be restarted or the
original idempotency key resubmitted; startup/replay must return the same task and
never invoke a worker again.

If a crash leaves `owner-recovery.lock`, the CLI deliberately refuses to remove it.
After backup, independently establish that its exact recorded recovery PID is absent,
inspect all descendants and confirm no service/maintenance/recovery process is active.
Only then may the operator remove that exact stale gate file out-of-band. Do not remove
either owner lock in this procedure. If any process inventory is incomplete or state
is ambiguous, preserve the gate and state directory and stop. This gate-recovery step
is a human-controlled offline procedure, not automatic reclamation.

To reconcile a `blocked` task, inspect it and prepare an evidence object bound to the
exact task ID, `blocked` state, intended decision and current `recordDigest`:

```powershell
$inputFile = Join-Path $env:TEMP 'task-maintenance-input.json'
$taskId = '<task-id>'
$maintenanceInput = @{
    taskId = $taskId
    decision = 'failed'
    actor = '<operator>'
    reason = '<decision rationale>'
    evidence = @{
        taskId = $taskId
        fromStatus = 'blocked'
        decision = 'failed'
        recordDigest = '<digest from inspect>'
        observation = '<specific process stop and external-effect investigation>'
        outcomeAssessment = 'unknown'
        workerStopped = $true
        processTreeChecked = $true
        inventoryComplete = $true
        inventorySource = '<tool and observation time>'
        liveWorkerPids = @()
        observedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
}
$maintenanceInput | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $inputFile -Encoding UTF8
node scripts/task-maintenance.mjs reconcile --input-file $inputFile
```

For `failed`, set `outcomeAssessment` to `known-failure` only when every attempt has a
recorded completed `failed`, `spawn-error` or `launch-failed` outcome. For an
interrupted dispatched attempt, use `unknown` only after explicit stop/effects
investigation. Administrative closure preserves attempt timestamps/outcomes and the
original block; `executionStopped` stays `unknown`, including queued records with a
persisted dispatch and no `startedAt`. The result limitation identifies this as
administrative failure and does not claim that execution failed, succeeded or caused
no effects. `cancelled` uses `cancel-request` and requires a persisted cancellation
request. Both decisions require a complete process inventory, a checked process tree
and an empty live-worker PID list; a live descendant, incomplete inventory or
ambiguous outcome must remain blocked. These are human assertions, not machine proof.
`effectsReverted` always remains `false`. Missing, stale, altered or conflicting
evidence refuses without a write; repeating the exact accepted actor/reason/evidence
returns the committed decision without rewriting the record.

## Retention and interruption recovery

Pruning is explicit; retention defaults to 30 days and can be configured. `blocked`
tasks are never pruned. Prune retains a durable idempotency tombstone (key and payload
hash) after record/result retention, so a pruned key cannot create another task. A
same-payload submission reports the old result was pruned; changed payload conflicts.
Run only after inspection and backup:

```powershell
node scripts/task-maintenance.mjs prune
```

Prune writes a durable journal before removing an expired terminal task, then replaces
the matching index with a tombstone and removes the journal. If interrupted, inspect
the journal and backup, explicitly recover the stale maintenance owner, then run the
distinct index/journal repair operation:

```powershell
node scripts/task-maintenance.mjs repair-index
node scripts/task-maintenance.mjs inspect
```

`reconcile-store` is the explicit service-startup lifecycle/index reconciliation: it
changes interrupted running or dispatched-queued records to `blocked` and repairs
missing task indexes, but does not make a blocked-task decision. `reconcile` is the
separate evidence-bound blocked-task decision. `repair-index` completes a valid prune
journal or clears an unused one, verifies tombstones, and fails closed on mismatches
without changing unrelated task lifecycle state. Never delete records, indexes,
tombstones or journals manually to force a retry. An idempotency tombstone is retained
after task data expires.

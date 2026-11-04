# FIX23 — Post-merge B11 authorization and Windows cleanup corrections

Base: `05d5cda3508ae5fee8547bc05be5299739ef0093` (PR #23 merged).
Branch: `task/FIX23-authorization`. One task, one corrective PR; no merge authority.

## Scope

Address PR #23 review comments 6620563686 and 6620563922: a hard-linked file can
escape writable globs, and provider environment entries can override host config.
Also correct the Windows fixture cleanup failure recorded in main CI 41757914172.
No scheduler, real provider, sandbox or production runner behavior is added.

## Acceptance matrix

| ID | Trigger | Required result / evidence |
| --- | --- | --- |
| FIX23-01 | Regular file inside workspace hard-linked to an outside sentinel | Builder rejects before launch; outside bytes unchanged; unit plus real temporary B09 worktree in pinned host harness |
| FIX23-02 | Provider environment contains OPENCODE_CONFIG_CONTENT, runtime controls or an unlisted key | Reject rather than pass through; explicit FIXTURE_API_KEY still works; unit tests and host harness |
| FIX23-03 | Windows fixture descendant briefly retains cwd after root exit | Bounded cleanup retries; persistent errors still fail; existing B10-04 plus Windows CI |
| FIX23-04 | Ordinary authorized invocation and prior path protections | Original pinned-host denied/allowed writes and symlink/junction rejection still pass |

## Delivery

Follow AGENTS.md, docs/task-execution.md and docs/pr-review.md. Validate focused tests,
the complete suite, fallback demo, pinned host integration and diff checks. Record both
self-review passes and CI evidence. Publish this task's PR and reply on the original
findings with commit/evidence. Request independent review; keep merge separate.

# ADR-005 — Runner with a time budget and conservative cancellation

Date: 2026-11-02. Status: accepted for local execution.

runOperation opens a ledger and executes one operation with an attempt limit and
a single per-invocation time budget measured by a monotonic clock. Fallback does
not reset the budget. It does not automatically start a new operation after
completion. A wait decision is returned to the caller without sleeping or retrying
the same model.

The adapter receives a dispatch copy and AbortSignal; it returns {ok:true,value}
or {ok:false,error} with structured safety metadata. It is trusted and must
preserve context/permissions; the runner never infers safety from HTTP status.
Exceptions/invalid responses stop as uncertain outcomes without logging private
messages. The internal identity is not exposed for mutation by the adapter.

Cancellation before dispatch does not call the provider. After dispatch is
persisted, cancellation/deadline persist blocked state before releasing the lock.
Abort is only a request: it neither undoes effects nor proves the provider stopped.
Late responses/rejections are consumed without altering the ledger. Reopening
the blocked session does not authorize fallback or a new operation.

Limits: JavaScript timers cannot interrupt blocking synchronous code, external
processes or slow filesystems. The deadline is checked again after a response;
strict real-time execution is not promised. External work ignoring abort may
continue and require reconciliation. Budgets are not persisted between invocations;
there is no resume scheduler, financial limit or process isolation. Do not use an
outer resume loop to bypass the budget.

M1b is validated within its documented local scope. M2 still requires real tests
of hooks/queues/permissions and context in OpenCode 2.2.5; connecting invoke to a
model API alone does not complete integration.

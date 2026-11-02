# Continuation point — 2026-11-02

M0/M1a/M1b are complete within the local scope of the ADRs. The runner in
src/runner.mjs combines ledger/fallback/cancellation and a per-invocation budget.
M2 began with a passing real smoke test (session/context/explicit switch/deny-write).
There is no fallback adapter or self-development use yet. Read
[roadmap](roadmap.md) and [Definition of Done](definition-of-done.md).

Run `node --test` and `node examples/fallback-demo.mjs` (Node 24).
No dependency installation or credentials are required. GitHub:
pbsilvabd/ai-orchestrator, branch main. Use remote HEAD as the reference and check
for changes before editing.

Next increment is M2a, not immediate fallback adapter coding. Read
[ADR-006](adr/006-worker-service.md): the accepted objective is a worker service
for a supervising primary LLM. Specify submit/status/result/cancel, task identity,
ownership, lifecycle, duplicate handling, limits and artifacts. Evaluate reuse,
choose one client/transport and record the decision before implementing M2b.
The primary end-to-end test is a delegated task that develops this repository.
M3 can use one worker/model with fallback disabled; M2c covers safe fallback later.

The existing smoke harness remains useful for the executor. For M2c, inject a
controlled 429 and establish safe effect boundaries; do not resubmit a failed
prompt using another run. SDK retry changes retry/delay, not the readonly model.
Read ADR-004/005. Close child.stdin because run waits for EOF. Keep the ledger
handle open during calls, dispatch only after persistence, never auto-remove locks
and keep uncertain pending state blocked. A task lifecycle is not yet implemented.

Current API: createState(sessionId), select(state, models, options),
success(state, dispatch), failure(state, dispatch, error, options), nextOperation(state).
Dispatch is the original object from select: carry its IDs into callbacks. State
version 1 is not accepted. Never silently migrate old events/checkpoints.

43 local tests and the real smoke test passed. The official 2.2.5 binary was
downloaded and its hash verified; it is outside the repository at
../.audit/bin/opencode-2.2.5/opencode.exe.
Command: `node integration/opencode-smoke.mjs /absolute/path/opencode.exe`.
Ledger: src/ledger.mjs; runner: src/runner.mjs. There is no event authentication,
exactly-once guarantee or power-loss guarantee. Yuri's reference is recorded in
the roadmap for M3/M5; nothing has been imported.

Do not enable audited plugins automatically. Keep synced sources/ files read-only.
Never publish credentials or treat mocks as proof of OpenCode integration.
Priority destination: M3, the first real task in this repository.

Documentation is now maintained in English. The README includes the target
architecture diagram; its planned components are not implemented features.

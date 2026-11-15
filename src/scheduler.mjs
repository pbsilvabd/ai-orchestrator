import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createTaskWorkspace } from './workspace.mjs';
import { isDefiniteSpawnFailure, runSubprocess } from './subprocess.mjs';
import { collectTaskArtifacts } from './artifacts.mjs';

// Private service-owned queue. The adapter is trusted application code, never task
// text. It prepares a synchronous invocation; this module alone starts the child.
export function createTaskScheduler({ store, clientId, worker, now, revalidate }) {
  if (typeof worker?.prepare !== 'function') throw new TypeError('worker.prepare is required');
  // Match B09's canonical receipt identity, including Windows short-name aliases
  // and configured home/workspace junctions, before persisting the reservation.
  const configuredRoot = join(store.home, 'workspaces');
  mkdirSync(configuredRoot, { recursive: true, mode: 0o700 });
  const workspaceRoot = realpathSync.native(configuredRoot);
  const queue = [];
  let stopped = false;
  let active = null;
  let scheduled = null;
  let fault = null;
  let uncertain = false;
  let closing;
  const waiters = [];
  const wake = () => {
    if (!active && !scheduled) for (const resolve of waiters.splice(0)) resolve();
  };
  const halt = error => {
    stopped = true;
    // Never surface adapter exceptions, prompts, paths or provider output.
    fault = error?.code === 'unavailable' ? 'unavailable' : 'internal';
  };
  const block = (taskId, reason, artifact = undefined) => store.updateTask(taskId, draft => {
    if (draft.status === 'blocked' && artifact !== undefined) {
      draft.artifact = artifact;
      return;
    }
    if (draft.status !== 'running') return;
    const at = now();
    draft.status = 'blocked';
    draft.finishedAt = at;
    draft.cancel.executionStopped = 'unknown';
    draft.block = { reason, requiresReconciliation: true };
    if (artifact !== undefined) draft.artifact = artifact;
    draft.progress.push({ at, event: 'blocked', detail: reason });
  });

  const execute = async taskId => {
    if (stopped) return;
    const task = store.readTask(taskId);
    if (task.clientId !== clientId || task.status !== 'queued' || task.attempts.length) return;
    // Revalidate signed admission immediately before spawn (B30-05): an expiry, metadata
    // staleness or host drift after submission must fail closed with a durable terminal
    // record and zero workspace/spawn, never replay. The check is synchronous and runs
    // before the dispatch reservation.
    if (revalidate !== undefined) {
      const at = now();
      try {
        revalidate(taskId, at);
      } catch (error) {
        uncertain = true;
        stopped = true; // Never spawn a task whose signed admission is no longer valid.
        // A queued task with no dispatch cannot become `blocked` (the store reserves that
        // for uncertain execution), so record a durable service-side refusal as `cancelled`
        // with executionStopped: true (no worker process started) and never replay.
        try {
          store.updateTask(taskId, draft => {
            if (draft.status !== 'queued') return;
            draft.status = 'cancelled';
            draft.finishedAt = at;
            draft.cancel.requestedAt = at;
            draft.cancel.executionStopped = true;
            draft.cancel.effectsReverted = false;
            draft.block = null;
            draft.progress.push({ at, event: 'admission-refused', detail: 'signed-approval-invalid-before-spawn' });
          });
        } catch { /* retain the queued record for inspection */ }
        return;
      }
    }
    const started = performance.now();
    const at = now();
    const attemptId = randomUUID();
    // Persist the dispatch reservation and planned workspace receipt in ONE write.
    // A crash before actual launch still requires reconciliation, never replay.
    const running = store.updateTask(taskId, draft => {
      draft.status = 'running';
      draft.startedAt = at;
      draft.attempts.push({ attemptId, model: task.request.authorization.models[0],
        startedAt: at, finishedAt: null, outcome: null,
        workspace: { taskId, baseCommit: task.baseCommit,
          branch: task.request.repository.branch,
          workspacePath: join(workspaceRoot, taskId),
          receiptPath: join(workspaceRoot, `${taskId}.workspace.json`) } });
      draft.progress.push({ at, event: 'dispatched', detail: attemptId });
    });
    try {
      if (running.request.authorization.models.length !== 1) throw new Error('one model required');
      const workspace = createTaskWorkspace({ taskId, workspaceRoot,
        repositoryPath: running.request.repository.path, baseCommit: running.baseCommit,
        branch: running.request.repository.branch });
      const invocation = worker.prepare({ task: structuredClone(running), workspace: structuredClone(workspace) });
      if (!invocation || invocation instanceof Promise || invocation.cwd !== workspace.workspacePath)
        throw new Error('invalid worker invocation');
      const remaining = running.request.limits.budgetMs - Math.ceil(performance.now() - started);
      if (remaining <= 0) throw new Error('budget exhausted during preparation');
      if (stopped) return;
      // Revalidate signed admission AGAIN just before the child process starts (ADR-010 §5):
      // a slow/blocking workspace creation or worker.prepare can pass the approval deadline
      // or the host binary can change during preparation. A failure here must NOT be
      // reported as `cancelled`; a dispatch reservation is already durable, so block it as
      // uncertain and never spawn/replay.
      if (revalidate !== undefined) {
        const at2 = now();
        try {
          revalidate(taskId, at2);
        } catch (error) {
          uncertain = true;
          stopped = true; // No next worker while a task with a dispatch reservation is uncertain.
          try { block(taskId, 'signed-approval-invalid-before-spawn'); } catch { /* retain dispatch record */ }
          return;
        }
      }
      // Adapter configuration cannot increase accepted output or duration limits.
      const result = await runSubprocess({ ...invocation,
        timeoutMs: Math.min(invocation.timeoutMs ?? remaining, remaining),
        stdoutMaxBytes: Math.min(invocation.stdoutMaxBytes ?? 0, running.request.limits.maxOutputBytes),
        stderrMaxBytes: Math.min(invocation.stderrMaxBytes ?? 0, running.request.limits.maxOutputBytes),
        signal: active.controller.signal });
      const current = store.readTask(taskId);
      const knownExit = result.termination.reason === 'exited' &&
        result.termination.rootExitObserved && Number.isInteger(result.code) &&
        performance.now() - started < running.request.limits.budgetMs;
      const spawnFailed = isDefiniteSpawnFailure(result);
      if ((!knownExit && !spawnFailed) || current.status === 'blocked') {
        uncertain = true;
        stopped = true; // No next worker while an old worker may still be running.
      }
      // Cancellation is durably blocked before the abort signal is sent. Once the
      // root settles, collect only the partial Git snapshot (never launch tests) and
      // append it to that blocked record without changing its lifecycle evidence.
      if (current.status === 'blocked' && current.cancel.requestedAt !== null) {
        let partialArtifact;
        try {
          partialArtifact = await collectTaskArtifacts({ task: running, workspace,
            testCommands: [], workerResult: result, evidenceLevel: worker.evidenceLevel ?? 'unit',
            remainingBudgetMs: Math.max(0,
              running.request.limits.budgetMs - Math.ceil(performance.now() - started)) });
        } catch { /* retain the original cancellation record */ }
        if (partialArtifact !== undefined) block(taskId, current.block.reason, partialArtifact);
        return;
      }
      // A cancel/shutdown/other terminal decision wins over a late completion.
      if (current.status !== 'running' || current.attempts.at(-1)?.attemptId !== attemptId) return;
      const remainingForArtifacts = Math.max(0,
        running.request.limits.budgetMs - Math.ceil(performance.now() - started));

      // Gate test execution on a known worker outcome: never launch tests when the
      // worker outcome is uncertain, but collect available partial Git artifacts.
      if (!knownExit && !spawnFailed) {
        let partialArtifact;
        try {
          partialArtifact = await collectTaskArtifacts({ task: running, workspace,
            testCommands: [], workerResult: result, evidenceLevel: worker.evidenceLevel ?? 'unit',
            remainingBudgetMs: remainingForArtifacts });
        } catch { /* retain original record on collection failure */ }
        block(taskId, 'worker-outcome-uncertain', partialArtifact);
        return;
      }

      let testOutcomeUncertain = false;
      const artifact = await collectTaskArtifacts({ task: running, workspace,
        testCommands: spawnFailed ? [] : (worker.testCommands ?? []),
        evidenceLevel: worker.evidenceLevel ?? 'unit',
        remainingBudgetMs: remainingForArtifacts,
        signal: active.controller.signal,
        onUncertainTest: () => { testOutcomeUncertain = true; },
        shouldContinue: () => {
          const latest = store.readTask(taskId);
          return latest.status === 'running' && latest.attempts.at(-1)?.attemptId === attemptId;
        } });
      const afterArtifacts = store.readTask(taskId);
      if (afterArtifacts.attempts.at(-1)?.attemptId !== attemptId) return;
      if (afterArtifacts.status === 'blocked' || testOutcomeUncertain) {
        uncertain = true;
        stopped = true;
        block(taskId, 'artifact-test-outcome-uncertain', artifact);
        return;
      }
      if (afterArtifacts.status !== 'running') return;
      const finishedAt = now();
      store.updateTask(taskId, draft => {
        draft.status = knownExit && result.code === 0 ? 'succeeded' : 'failed';
        draft.finishedAt = finishedAt;
        const attempt = draft.attempts.at(-1);
        attempt.finishedAt = finishedAt;
        attempt.outcome = spawnFailed ? 'spawn-error' : draft.status;
        attempt.exitCode = result.code;
        attempt.spawnErrorCode = result.spawnErrorCode;
        draft.artifact = artifact;
        draft.progress.push({ at: finishedAt, event: draft.status, detail: null });
      });
    } catch (error) {
      // Setup or completion persistence may have changed external state. Keep all
      // receipts/workspaces and the owner lock; neither retry nor cleanup is safe.
      uncertain = true;
      halt(error);
      try { block(taskId, 'worker-outcome-uncertain'); } catch { /* original record is recovery evidence */ }
    }
  };

  const pump = () => {
    if (stopped || active || scheduled) return;
    scheduled = setImmediate(() => {
      scheduled = null;
      if (stopped || !queue.length) { wake(); return; }
      const taskId = queue.shift();
      active = { taskId, controller: new AbortController(), done: null };
      // Defer execute until active is assigned, including synchronous failure paths.
      active.done = Promise.resolve().then(() => execute(taskId)).catch(error => {
        uncertain = true;
        halt(error); // Failed dispatch write: no worker was started. No retry loop.
      }).finally(() => { active = null; if (!stopped && queue.length) pump(); wake(); });
    });
  };
  const whenIdle = () => !active && !scheduled ? Promise.resolve() : new Promise(resolve => waiters.push(resolve));
  return {
    enqueue(taskId) { if (!stopped && !queue.includes(taskId) && active?.taskId !== taskId) { queue.push(taskId); pump(); } },
    requestCancellation(taskId) {
      if (active?.taskId !== taskId) return false;
      uncertain = true;
      stopped = true;
      queue.length = 0;
      active.controller.abort();
      return true;
    },
    whenIdle,
    snapshot: () => ({ stopped, activeTaskId: active?.taskId ?? null, errorCode: fault, requiresReconciliation: uncertain }),
    close() {
      if (closing) return closing;
      stopped = true;
      queue.length = 0;
      if (scheduled) { clearImmediate(scheduled); scheduled = null; }
      if (active) {
        // Mark terminal before abort. A later zero exit cannot resurrect this task.
        uncertain = true;
        try { block(active.taskId, 'service-shutdown'); } catch (error) { halt(error); }
        active.controller.abort();
      }
      closing = whenIdle().then(() => ({ releaseOwnership: !uncertain }));
      wake();
      return closing;
    },
  };
}

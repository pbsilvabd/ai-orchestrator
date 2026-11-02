import { performance } from 'node:perf_hooks';
import { openSession } from './ledger.mjs';

// One operation, one total time budget. Adapter owns provider/context translation.
// It must return {ok:true,value} or {ok:false,error:<structured safety metadata>}.
export async function runOperation({ directory, sessionId, models, invoke,
  budgetMs = 30_000, maxAttempts = 2, signal } = {}) {
  if (typeof invoke !== 'function' || !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 2_147_483_647)
    throw new TypeError('Invalid invocation or time budget');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Invalid signal');
  if (signal?.aborted) return { action: 'stop', reason: 'cancelled' };
  const deadline = performance.now() + budgetMs;
  const ledger = openSession(directory, sessionId);
  try {
    for (;;) {
      if (signal?.aborted) return { action: 'stop', reason: 'cancelled' };
      if (performance.now() >= deadline) return { action: 'stop', reason: 'deadline' };
      const dispatch = ledger.select(models, { now: Date.now(), maxAttempts });
      if (dispatch.action !== 'dispatch') return dispatch;
      const controller = new AbortController();
      let timer;
      let onAbort;
      let outcome;
      try {
        outcome = await new Promise(resolve => {
          let settled = false;
          const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
          };
          const stop = reason => {
            finish({ interrupted: reason });
            controller.abort(); // Advisory: provider may ignore this.
          };
          onAbort = () => stop('cancelled');
          signal?.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => stop('deadline'), Math.max(0, deadline - performance.now()));
          if (signal?.aborted) { stop('cancelled'); return; }
          if (performance.now() >= deadline) { stop('deadline'); return; }
          // Keep our original dispatch identity private from adapter mutation.
          Promise.resolve().then(() => {
            if (settled) return;
            return invoke({ dispatch: structuredClone(dispatch), signal: controller.signal });
          }).then(value => finish({ value }), () => finish({ thrown: true }));
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      // Also catch callbacks that blocked the event loop beyond the deadline.
      const interrupted = outcome.interrupted ?? (signal?.aborted ? 'cancelled' :
        performance.now() >= deadline ? 'deadline' : undefined);
      if (interrupted) {
        controller.abort();
        ledger.failure(dispatch, { effects: 'unknown' }, { now: Date.now() });
        return { action: 'stop', reason: interrupted };
      }
      if (outcome.value?.ok === true) {
        ledger.success(dispatch);
        return { action: 'completed', model: dispatch.model, value: outcome.value.value };
      }
      // Exceptions and malformed results cannot prove replay is safe.
      const error = outcome.value?.ok === false ? outcome.value.error : { effects: 'unknown' };
      const result = ledger.failure(dispatch, error, { now: Date.now() });
      if (result.action !== 'fallback') return result;
    }
  } finally { ledger.close(); }
}

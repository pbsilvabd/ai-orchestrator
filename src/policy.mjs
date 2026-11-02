import { randomUUID } from 'node:crypto';
// No network, tools, credentials or OpenCode hooks.
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_./:-]{1,128}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;

export function createState(sessionId) {
  if (!id(sessionId)) throw new TypeError('Invalid session ID');
  return { version: 2, sessionId, operationId: randomUUID(), attempts: [], cooldowns: {}, blocked: false, pending: false, completed: false };
}

function validate(state, models, now, maxAttempts) {
  if (state?.version !== 2 || !id(state.sessionId) || !id(state.operationId) ||
      !Array.isArray(state.attempts) || !state.attempts.every(id) ||
      new Set(state.attempts).size !== state.attempts.length ||
      !state.cooldowns || typeof state.cooldowns !== 'object' || Array.isArray(state.cooldowns) ||
      !Object.entries(state.cooldowns).every(([key, value]) => id(key) && time(value)) ||
      typeof state.blocked !== 'boolean' || typeof state.pending !== 'boolean' ||
      (state.completed !== undefined && typeof state.completed !== 'boolean') ||
      (state.completed === true && (state.pending || state.blocked || !state.attempts.length)))
    throw new TypeError('Invalid state');
  if (!Array.isArray(models) || models.length === 0 || !models.every(id) ||
      new Set(models).size !== models.length) throw new TypeError('Invalid authorized models');
  if (!time(now) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)
    throw new TypeError('Invalid limits');
}

export function validateState(state) {
  validate(state, ['validation-only'], 0, 2);
  if (typeof state.completed !== 'boolean' || (state.pending && !state.attempts.length))
    throw new TypeError('Invalid state');
}

// Call before dispatch and persist returned state BEFORE any provider/tool call.
// Models are the explicitly authorized ordered allowlist, not discovered models.
export function select(state, models, { now, maxAttempts = 2 } = {}) {
  validate(state, models, now, maxAttempts);
  if (state.blocked) return { action: 'stop', reason: 'blocked', state };
  if (state.completed) return { action: 'stop', reason: 'completed', state };
  if (state.pending) return { action: 'stop', reason: 'in-flight-or-unknown', state };
  if (state.attempts.length >= maxAttempts)
    return { action: 'stop', reason: 'attempt-limit', state };
  const remaining = models.filter(model => !state.attempts.includes(model));
  if (!remaining.length) return { action: 'stop', reason: 'exhausted', state };
  const model = remaining.find(model => (state.cooldowns[model] ?? 0) <= now);
  if (!model) return {
    action: 'wait', until: Math.min(...remaining.map(model => state.cooldowns[model])), state,
  };
  return {
    action: 'dispatch', model, sessionId: state.sessionId, operationId: state.operationId,
    attemptId: `${state.operationId}:${state.attempts.length + 1}`,
    state: { ...state, attempts: [...state.attempts, model], pending: true },
  };
}

// Adapter must supply structured metadata. Never infer safety from error text.
// Unknown/partial response or possible tool effects always require manual reconciliation.
function matchDispatch(state, dispatch) {
  if (!dispatch || dispatch.sessionId !== state.sessionId || dispatch.operationId !== state.operationId ||
      dispatch.attemptId !== `${state.operationId}:${state.attempts.length}` ||
      dispatch.model !== state.attempts.at(-1) || state.blocked || !state.pending)
    throw new TypeError('Result must match the current dispatch');
}

export function failure(state, dispatch, error, { now, cooldownMs = 60_000 } = {}) {
  const model = dispatch?.model;
  validate(state, [model], now, 2);
  matchDispatch(state, dispatch);
  if (!time(cooldownMs) || !time(now + cooldownMs)) throw new TypeError('Invalid cooldown');
  const stop = reason => ({ action: 'stop', reason, state: { ...state, blocked: true } });
  if (!error || error.responseStarted !== false || error.effects !== 'none') return stop('unsafe-replay');
  if (error.status === 401 || error.status === 403) return stop('authentication');
  if (error.kind === 'quota') return stop('quota-requires-reset-policy');
  if (!(TRANSIENT.has(error.status) || (error.status === undefined && error.kind === 'timeout')))
    return stop('non-retryable');
  const retryAfter = error.retryAfterMs ?? 0;
  if (!time(retryAfter) || !time(now + retryAfter)) return stop('invalid-retry-after');
  return {
    action: 'fallback',
    state: { ...state, pending: false, cooldowns: { ...state.cooldowns, [model]: now + Math.max(cooldownMs, retryAfter) } },
  };
}

// Return the original dispatch identity, never reconstruct it from current state.
export function success(state, dispatch) {
  validate(state, [dispatch?.model], 0, 2);
  matchDispatch(state, dispatch);
  return { ...state, pending: false, completed: true };
}

// A caller-supplied boolean can no longer bypass pending/unknown dispatches.
export function nextOperation(state) {
  validate(state, ['validation-only'], 0, 2);
  if (state.completed !== true || state.pending || state.blocked)
    throw new Error('Previous operation is not safely complete');
  return { ...state, operationId: randomUUID(), attempts: [], pending: false, completed: false };
}

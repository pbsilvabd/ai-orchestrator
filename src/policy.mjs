// Pure reference policy. No network, tools, credentials or OpenCode hooks.
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_./:-]{1,128}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;

export function createState(sessionId) {
  if (!id(sessionId)) throw new TypeError('Invalid session ID');
  return { version: 1, sessionId, attempts: [], cooldowns: {}, blocked: false, pending: false, completed: false };
}

function validate(state, models, now, maxAttempts) {
  if (state?.version !== 1 || !id(state.sessionId) ||
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
    action: 'dispatch', model,
    state: { ...state, attempts: [...state.attempts, model], pending: true },
  };
}

// Adapter must supply structured metadata. Never infer safety from error text.
// Unknown/partial response or possible tool effects always require manual reconciliation.
export function failure(state, model, error, { now, cooldownMs = 60_000 } = {}) {
  validate(state, [model], now, 2);
  if (state.blocked || !state.pending || state.attempts.at(-1) !== model)
    throw new TypeError('Failure must match the current dispatch');
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

// Trusted caller confirms completion; no asynchronous event correlation yet.
export function success(state, model) {
  validate(state, [model], 0, 2);
  if (state.blocked || !state.pending || state.attempts.at(-1) !== model)
    throw new TypeError('Success must match the current dispatch');
  return { ...state, pending: false, completed: true };
}

// A caller-supplied boolean can no longer bypass pending/unknown dispatches.
export function nextOperation(state) {
  validate(state, ['validation-only'], 0, 2);
  if (state.completed !== true || state.pending || state.blocked)
    throw new Error('Previous operation is not safely complete');
  return { ...state, attempts: [], pending: false, completed: false };
}

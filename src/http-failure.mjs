// Deliberately conservative HTTP boundary; does not infer tool safety from status.
export function retryAfterMs(value, now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid clock');
  if (value == null) return 0;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let delay;
  if (/^\d+$/.test(text)) {
    delay = Number(text) * 1000;
  } else {
    // Only canonical IMF-fixdate in this increment; obsolete dates fail closed.
    if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return null;
    const stamp = Date.parse(text);
    if (!Number.isFinite(stamp) || new Date(stamp).toUTCString() !== text) return null;
    delay = Math.max(0, stamp - now);
  }
  return Number.isSafeInteger(delay) && delay >= 0 && Number.isSafeInteger(now + delay) ? delay : null;
}

export function httpFailure(response, { now, responseStarted, effects } = {}) {
  if (!response || !Number.isInteger(response.status) || response.status < 400 || response.status > 599 ||
      typeof response.headers?.get !== 'function') throw new TypeError('Expected HTTP failure response');
  const delay = retryAfterMs(response.headers.get('retry-after'), now);
  return {
    status: response.status,
    retryAfterMs: delay === null ? -1 : delay,
    responseStarted,
    effects,
  };
}

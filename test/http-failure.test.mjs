import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { retryAfterMs, httpFailure } from '../src/http-failure.mjs';
import { createState, select, failure } from '../src/policy.mjs';

test('Retry-After: seconds, canonical date, past date and absent header', () => {
  const now = Date.UTC(2026, 10, 2);
  assert.equal(retryAfterMs(' 120 ', now), 120_000);
  assert.equal(retryAfterMs(new Date(now + 120_000).toUTCString(), now), 120_000);
  assert.equal(retryAfterMs(new Date(now - 1000).toUTCString(), now), 0);
  assert.equal(retryAfterMs(null, now), 0);
  assert.equal(retryAfterMs('0', now), 0);
});

test('Retry-After rejects malformed, ambiguous and overflowing values', () => {
  for (const value of ['', '-1', '1.5', '1e3', '120, 240', '2026-11-02', 'Infinity',
    '9999999999999999999999999', 'Mon, 31 Feb 2026 00:00:00 GMT', 120]) {
    assert.equal(retryAfterMs(value, 0), null, String(value));
  }
  assert.throws(() => retryAfterMs('1', NaN));
  assert.equal(retryAfterMs('1', Number.MAX_SAFE_INTEGER), null);
});

test('HTTP status does not imply safety; error body and headers are not forwarded', () => {
  const response = new Response('private error payload', { status: 429, headers: { authorization: 'private' } });
  const normalized = httpFailure(response, { now: 0 });
  const choice = select(createState('s'), ['mock/a'], { now: 0 });
  assert.equal(failure(choice.state, choice, normalized, { now: 0 }).reason, 'unsafe-replay');
  assert.equal(JSON.stringify(normalized).includes('private'), false);
  assert.throws(() => httpFailure(new Response(), { now: 0 }));
});

// Real HTTP on loopback, synthetic providers, no tool execution or OpenCode host.
for (const scenario of [
  { name: '429 to B', status: 429, retry: '120', expected: 'fallback' },
  { name: '503 to B', status: 503, retry: '120', expected: 'fallback' },
  { name: '401 stops', status: 401, retry: '120', expected: 'stop' },
  { name: 'invalid header stops', status: 429, retry: 'broken', expected: 'stop' },
  { name: 'possible effects stop', status: 429, retry: '120', effects: 'possible', expected: 'stop' },
]) test(`loopback: ${scenario.name}`, { timeout: 5000 }, async () => {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url);
    res.writeHead(req.url === '/a' ? scenario.status : 200, { 'Retry-After': scenario.retry });
    res.end('fixture');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const a = select(createState('http-session'), ['mock/a', 'mock/b'], { now: 0 });
    const response = await fetch(`${base}/a`, { signal: AbortSignal.timeout(2000) });
    await response.text();
    const normalized = httpFailure(response, {
      now: 0, responseStarted: false, effects: scenario.effects ?? 'none',
    }); // Safety is known from the controlled fixture, never inferred from 429.
    const result = failure(a.state, a, normalized, { now: 0 });
    assert.equal(result.action, scenario.expected);
    if (result.action === 'fallback') {
      assert.equal(result.state.cooldowns['mock/a'], 120_000);
      const b = select(result.state, ['mock/a', 'mock/b'], { now: 0 });
      assert.equal(b.model, 'mock/b');
      assert.equal(b.state.sessionId, a.state.sessionId);
      const ok = await fetch(`${base}/b`, { signal: AbortSignal.timeout(2000) });
      assert.equal(ok.status, 200);
      await ok.text();
      assert.deepEqual(calls, ['/a', '/b']);
    } else {
      assert.equal(select(result.state, ['mock/a', 'mock/b'], { now: 0 }).action, 'stop');
      assert.deepEqual(calls, ['/a']);
    }
  } finally {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
});

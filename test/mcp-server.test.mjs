// Tests for the MCP stdio adapter (B15).
// B15-01: Discovery/list and all four tool calls with correct schema/envelopes.
// B15-02: Malformed/oversized frame, unknown operation/field — bounded rejection.
// B15-03: Foreign task, concurrent polling and disconnect — ownership and single service.
// B15-04: Pinned-client compatibility — observed revision/tool-call/result wire format.
//
// All tests use temporary directories; never the developer's real state home.
// The service is created in-process; no second service is created per call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createTaskService } from '../src/service.mjs';
import { createMcpServer } from '../src/mcp-server.mjs';

const VERSION = '2026-07-28';
const META = { 'io.modelcontextprotocol/protocolVersion': VERSION };

function initGitRepo(dir) {
  execFileSync('git', ['init', dir], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test Runner'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'Initial commit'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'branch', '-M', 'main'], { stdio: 'ignore', windowsHide: true });
}

// Create an in-memory readable/writable pair for the MCP server.
// send(obj) writes a JSON-RPC message to the server's stdin.
// collect() drains all JSON-RPC messages written to stdout so far.
function makeTransport() {
  const chunks = [];
  let partialLine = '';
  const output = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString('utf8')); cb(); },
  });
  const inputBuffers = [];
  let inputPush = null;
  const input = new Readable({
    read() {
      if (inputBuffers.length) this.push(inputBuffers.shift());
      else inputPush = data => { inputPush = null; this.push(data); };
    },
  });
  const send = obj => {
    const line = JSON.stringify(obj) + '\n';
    if (inputPush) inputPush(Buffer.from(line));
    else inputBuffers.push(Buffer.from(line));
  };
  const collect = () => {
    const all = partialLine + chunks.join('');
    chunks.length = 0;
    const lines = all.split('\n');
    partialLine = lines.pop();
    return lines.filter(line => line.trim()).map(line => JSON.parse(line));
  };
  const closeInput = () => {
    if (inputPush) inputPush(null);
    else inputBuffers.push(null);
  };
  return { input, output, send, collect, closeInput };
}

// Wait for at least one line to appear in the output.
async function waitForOutput(collect, minLines = 1, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  const received = [];
  while (Date.now() < deadline) {
    received.push(...collect());
    if (received.length >= minLines) return received;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for ${minLines} output line(s)`);
}

test('B15-02: partial output lines survive collection between polls', async () => {
  const transport = makeTransport();
  let notifyFirst;
  const firstCollected = new Promise(resolve => { notifyFirst = resolve; });
  const collect = () => {
    const lines = transport.collect();
    if (lines.some(line => line.id === 6)) notifyFirst();
    return lines;
  };
  const pending = waitForOutput(collect, 2, 1000);
  transport.output.write('{"jsonrpc":"2.0","id":6,"result":{}}\n{"jsonrpc":"2.0","id":7,');
  await Promise.race([
    firstCollected,
    pending.then(() => { throw new Error('wait returned before both responses were collected'); }),
  ]);
  transport.output.write('"result":{"ok":true}}\n');
  assert.deepEqual(await pending, [
    { jsonrpc: '2.0', id: 6, result: {} },
    { jsonrpc: '2.0', id: 7, result: { ok: true } },
  ]);
});

function makeFixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-b15-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  initGitRepo(dir);
  const service = createTaskService({
    home: dir,
    config: {
      clientId: 'opencode-primary',
      authorization: { models: ['mock/a'], tools: ['read', 'edit'], writableRoots: [dir] },
      limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
    },
    now: 1_000,
    ...options,
  });
  t.after(() => service.close());
  return { dir, service };
}

function makeServer(t, service, overrides = {}) {
  const transport = makeTransport();
  const server = createMcpServer({ service, input: transport.input, output: transport.output, ...overrides });
  t.after(() => server.close());
  return { server, ...transport };
}

const validRequest = dir => ({
  idempotencyKey: 'goal-b15-01',
  clientId: 'opencode-primary',
  objective: 'Add a regression test',
  acceptanceCriteria: ['node --test passes'],
  repository: { path: dir, baseRef: 'main', branch: 'task/b15-example' },
  authorization: { models: ['mock/a'], tools: ['read', 'edit'], writablePaths: ['src'] },
  limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
});

// ─── B15-01: Discovery, list, and all four tool calls ───────────────────────

test('B15-01a: server/discover returns exactly the supported version and capabilities', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.jsonrpc, '2.0');
  assert.equal(msg.id, 1);
  assert.deepEqual(msg.result.supportedVersions, [VERSION]);
  assert.ok(msg.result.capabilities?.tools !== undefined, 'capabilities.tools present');
  assert.ok(msg.result._meta?.['io.modelcontextprotocol/serverInfo'], 'serverInfo present');
  assert.equal(msg.result._meta['io.modelcontextprotocol/serverInfo'].name, 'ai-orchestrator');
});

test('B15-01b: tools/list returns exactly four operations with correct names', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: META } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.result.resultType, 'complete');
  const names = msg.result.tools.map(t => t.name);
  assert.deepEqual(names.sort(), ['cancel_task', 'get_task_result', 'get_task_status', 'submit_task']);
  for (const tool of msg.result.tools) {
    assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `${tool.name} has description`);
    assert.ok(tool.inputSchema?.type === 'object', `${tool.name} has object schema`);
    assert.ok(tool.inputSchema?.additionalProperties === false, `${tool.name} rejects extra fields`);
  }
});

test('B15-01c: submit_task returns queued status with taskId and configured clientId', async t => {
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { _meta: META, name: 'submit_task', arguments: validRequest(dir) },
  });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.result.isError, false);
  const payload = JSON.parse(msg.result.content[0].text);
  assert.equal(payload.schemaVersion, 1);
  assert.match(payload.taskId, /^[0-9a-f-]{36}$/);
  assert.equal(payload.status, 'queued');
  assert.equal(typeof payload.acceptedAt, 'number');
});

test('B15-01d: get_task_status returns status envelope for a submitted task', async t => {
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  // Submit first — wait for response before sending the next request.
  const req = validRequest(dir);
  req.idempotencyKey = 'goal-b15-01d';
  req.repository.branch = 'task/b15-status';
  send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: req } });
  const submitResponses = await waitForOutput(collect, 1, 3000);
  const { taskId } = JSON.parse(submitResponses[0].result.content[0].text);

  // Poll status
  send({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: { taskId } } });
  const statusResponses = await waitForOutput(collect, 1, 3000);

  assert.equal(statusResponses[0].result.isError, false);
  const status = JSON.parse(statusResponses[0].result.content[0].text);
  assert.equal(status.taskId, taskId);
  assert.ok(['queued', 'running'].includes(status.status));
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.resultAvailable, false);
});

test('B15-01e: get_task_result returns result_not_ready for a non-terminal task', async t => {
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  const req = validRequest(dir);
  req.idempotencyKey = 'goal-b15-01e';
  req.repository.branch = 'task/b15-result-not-ready';
  send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: req } });
  const [submitMsg] = await waitForOutput(collect);
  const { taskId } = JSON.parse(submitMsg.result.content[0].text);

  send({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { _meta: META, name: 'get_task_result', arguments: { taskId } } });
  const [resultMsg] = await waitForOutput(collect);

  assert.equal(resultMsg.result.isError, true);
  const payload = JSON.parse(resultMsg.result.content[0].text);
  assert.equal(payload.error.code, 'result_not_ready');
});

test('B15-01f: cancel_task on a queued task returns not_started effect', async t => {
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  const req = validRequest(dir);
  req.idempotencyKey = 'goal-b15-01f';
  req.repository.branch = 'task/b15-cancel';
  send({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: req } });
  const [submitMsg] = await waitForOutput(collect);
  const { taskId } = JSON.parse(submitMsg.result.content[0].text);

  send({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { _meta: META, name: 'cancel_task', arguments: { taskId } } });
  const [cancelMsg] = await waitForOutput(collect);

  assert.equal(cancelMsg.result.isError, false);
  const payload = JSON.parse(cancelMsg.result.content[0].text);
  assert.equal(payload.effect, 'not_started');
  assert.equal(payload.status, 'cancelled');
  assert.equal(payload.schemaVersion, 1);
});

// ─── B15-02: Malformed/oversized frame, unknown operation/field ───────────────

test('B15-02a: non-JSON input produces a parse error without echoing payload', async t => {
  const { service } = makeFixture(t);
  const { input, collect } = makeServer(t, service);

  // Send a raw non-JSON line.
  input.push('this is not json\n');
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.error.code, -32700);
  assert.doesNotMatch(JSON.stringify(msg), /this is not json/);
});

test('B15-02b: oversized frame is rejected with bounded error message', async t => {
  const { service } = makeFixture(t);
  const { input, collect } = makeServer(t, service, { maxFrameBytes: 100 });

  // A line that exceeds the 100-byte limit.
  const bigLine = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: { _meta: META, padding: 'x'.repeat(200) } });
  assert.ok(Buffer.byteLength(bigLine, 'utf8') > 100);
  input.push(bigLine + '\n');
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.error.code, -32600);
  assert.ok(msg.error.message.length < 200, 'error message is short');
});

test('B15-02b: streamed oversized frames are discarded incrementally and the next frame remains usable', async t => {
  const { service } = makeFixture(t);
  const { input, collect } = makeServer(t, service, { maxFrameBytes: 128 });

  input.push(Buffer.alloc(1024, 0x61));
  input.push(Buffer.from('\n'));
  input.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 31, method: 'server/discover', params: { _meta: META } }) + '\n'));
  const [oversized, valid] = await waitForOutput(collect, 2);

  assert.equal(oversized.error.code, -32600);
  assert.equal(oversized.error.message, 'frame too large');
  assert.equal(JSON.stringify(oversized).includes('a'.repeat(20)), false);
  assert.equal(valid.id, 31);
  assert.deepEqual(valid.result.supportedVersions, [VERSION]);
});

test('B15-02b: invalid UTF-8 is rejected without terminating the transport', async t => {
  const { service } = makeFixture(t);
  const { input, collect } = makeServer(t, service);

  input.push(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d, 0x0a]));
  input.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 32, method: 'server/discover', params: { _meta: META } }) + '\n'));
  const [malformed, valid] = await waitForOutput(collect, 2);

  assert.equal(malformed.error.code, -32700);
  assert.equal(malformed.error.message, 'parse error');
  assert.equal(valid.id, 32);
});

test('B15-02c: missing protocol version in _meta produces an error', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 50, method: 'tools/list', params: {} });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.error.code, -32602);
  assert.match(msg.error.message, /protocol version/i);
});

test('B15-02d: unsupported protocol version returns version error with supported list', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 51, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 'private-secret-probe' } } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.error.code, -32022);
  assert.deepEqual(msg.error.data?.supported, [VERSION]);
  assert.equal(JSON.stringify(msg).includes('private-secret-probe'), false);
});

test('B15-02d: unknown protocol parameter fields are rejected without reflecting values', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 56, method: 'server/discover', params: { _meta: META, privateField: 'secret-field' } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.error.code, -32602);
  assert.equal(JSON.stringify(msg).includes('secret-field'), false);
});

test('B15-02d: invalid object request IDs are not reflected in the response', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: { secret: 'private-id' }, method: 'server/discover', params: { _meta: META } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.id, null);
  assert.equal(msg.error.code, -32600);
  assert.equal(JSON.stringify(msg).includes('private-id'), false);
});

test('B15-02d: invalid call IDs are rejected before service dispatch', async t => {
  let calls = 0;
  const { send, collect } = makeServer(t, {
    submitTask() { calls++; return { status: 'queued' }; },
  });
  const args = { idempotencyKey: 'b15-invalid-id', clientId: 'opencode-primary' };

  send({ jsonrpc: '2.0', id: null, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: args } });
  send({ jsonrpc: '2.0', id: 1e999, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: args } });
  const [nullId, infiniteId] = await waitForOutput(collect, 2);

  assert.equal(nullId.error.code, -32600);
  assert.equal(nullId.id, null);
  assert.equal(infiniteId.error.code, -32600);
  assert.equal(infiniteId.id, null);
  assert.equal(calls, 0);
});

test('B15-02d: malformed envelopes receive bounded errors with readable IDs', async t => {
  const { input, collect } = makeServer(t, {
    getTaskStatus() { throw new Error('must not dispatch'); },
  });

  input.push('{}\n');
  input.push('{"jsonrpc":"2.0","method":42}\n');
  input.push('{"jsonrpc":"2.0","id":"request-7","method":"server/discover","extra":true,"params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}\n');
  const responses = await waitForOutput(collect, 3);

  assert.deepEqual(responses.map(response => response.id), [null, null, 'request-7']);
  assert.ok(responses.every(response => response.error.code === -32600));
});

test('B15-02d: circular service result is serialized as a sanitized protocol error', async t => {
  const circular = {};
  circular.self = circular;
  const { send, collect } = makeServer(t, {
    getTaskStatus() { return circular; },
  });

  send({ jsonrpc: '2.0', id: 57, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: { taskId: '00000000-0000-4000-8000-000000000000' } } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.error.code, -32603);
  assert.equal(msg.error.message, 'internal error');
  assert.equal(JSON.stringify(msg).includes('self'), false);
});

test('B15-02e: unknown method returns method-not-found error', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 52, method: 'totally/unknown', params: { _meta: META } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.error.code, -32601);
});

test('B15-02f: unknown tool name returns invalid_argument via isError result', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 53, method: 'tools/call', params: { _meta: META, name: 'destroy_everything', arguments: {} } });
  const [msg] = await waitForOutput(collect);

  // Tool errors use isError:true on the result, not error field
  assert.equal(msg.result.isError, true);
  const payload = JSON.parse(msg.result.content[0].text);
  assert.equal(payload.error.code, 'invalid_argument');
  assert.doesNotMatch(payload.error.message, /destroy_everything/); // name not echoed
});

test('B18-04: real MCP wire exposes exactly four tools and rejects maintainer recovery without state changes', async t => {
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);
  const request = validRequest(dir);
  request.idempotencyKey = 'b18-wire-blocked';
  request.repository.branch = 'task/b18-wire';
  const submitted = service.submitTask(request);
  service.store.updateTask(submitted.taskId, draft => {
    draft.status = 'running'; draft.startedAt = 1_100;
    draft.attempts.push({ attemptId: 'attempt-b18-wire', model: 'mock/a', startedAt: 1_100,
      finishedAt: null, outcome: null });
  });
  service.store.updateTask(submitted.taskId, draft => {
    draft.status = 'blocked'; draft.finishedAt = 1_200;
    draft.cancel.executionStopped = 'unknown';
    draft.block = { reason: 'service-restart', requiresReconciliation: true };
  });
  const recordPath = join(dir, 'tasks', `${submitted.taskId}.json`);
  const before = readFileSync(recordPath);
  send({ jsonrpc: '2.0', id: 900, method: 'tools/list', params: { _meta: META } });
  const [listed] = await waitForOutput(collect);
  assert.deepEqual(listed.result.tools.map(tool => tool.name).sort(),
    ['cancel_task', 'get_task_result', 'get_task_status', 'submit_task']);
  send({ jsonrpc: '2.0', id: 901, method: 'tools/call', params: { _meta: META,
    name: 'reconcile_blocked', arguments: { taskId: submitted.taskId, decision: 'failed' } } });
  const [rejected] = await waitForOutput(collect);
  assert.equal(rejected.result.isError, true);
  assert.equal(JSON.parse(rejected.result.content[0].text).error.code, 'invalid_argument');
  assert.deepEqual(readFileSync(recordPath), before);
});

test('B15-02g: submit_task with unknown extra field is rejected with invalid_argument', async t => {
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  const req = { ...validRequest(dir), idempotencyKey: 'goal-b15-02g', repository: { ...validRequest(dir).repository, branch: 'task/b15-unknown-field' }, unknownExtraField: 'oops' };
  send({ jsonrpc: '2.0', id: 54, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: req } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.result.isError, true);
  const payload = JSON.parse(msg.result.content[0].text);
  assert.equal(payload.error.code, 'invalid_argument');
  // Secret payload must not be echoed
  assert.doesNotMatch(JSON.stringify(payload), /oops/);
});

test('B15-02h: non-object tool arguments are rejected', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 55, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: ['not', 'an', 'object'] } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.result.isError, true);
  const payload = JSON.parse(msg.result.content[0].text);
  assert.equal(payload.error.code, 'invalid_argument');
});

// ─── B15-03: Foreign task, concurrent polling and disconnect ─────────────────

test('B15-03a: foreign task IDs are hidden from the configured client', async t => {
  const { dir, service: original } = makeFixture(t);
  await original.close();
  const config = clientId => ({
    clientId,
    authorization: { models: ['mock/a'], tools: ['read', 'edit'], writableRoots: [dir] },
    limits: { maxAttempts: 2, budgetMs: 600_000, maxOutputBytes: 1_048_576 },
  });
  const foreign = createTaskService({ home: dir, config: config('other-client'), now: 1_000 });
  const request = validRequest(dir);
  request.clientId = 'other-client';
  request.idempotencyKey = 'goal-b15-03a-foreign';
  request.repository.branch = 'task/b15-foreign-owner';
  const { taskId } = foreign.submitTask(request);
  await foreign.close();

  const owner = createTaskService({ home: dir, config: config('opencode-primary'), now: 1_000 });
  t.after(() => owner.close());
  const { send, collect } = makeServer(t, owner);
  send({ jsonrpc: '2.0', id: 60, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: { taskId } } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.result.isError, true);
  const payload = JSON.parse(msg.result.content[0].text);
  assert.ok(['unknown_task', 'not_owner'].includes(payload.error.code));
  assert.equal(JSON.stringify(payload).includes(taskId), false);
});

test('B15-03b: multiple sequential polls use the same service instance (no second owner)', async t => {
  // If a second service were created per call, it would fail with 'unavailable'
  // because the lock file would already be held by the first service.
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  const req = validRequest(dir);
  req.idempotencyKey = 'goal-b15-03b';
  req.repository.branch = 'task/b15-poll';
  send({ jsonrpc: '2.0', id: 70, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: req } });
  const [submit] = await waitForOutput(collect);
  const { taskId } = JSON.parse(submit.result.content[0].text);

  // Three back-to-back status polls — all must succeed without locking conflicts.
  for (let i = 0; i < 3; i++) {
    send({ jsonrpc: '2.0', id: 71 + i, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: { taskId } } });
  }
  const responses = await waitForOutput(collect, 3);
  for (const r of responses) {
    assert.equal(r.result.isError, false);
  }
});

test('B15-03b: concurrent status polls remain available while a real fixture worker runs', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-b15-active-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  execFileSync('git', ['init', repo], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test Runner'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(join(repo, 'README.md'), '# Test\n');
  execFileSync('git', ['-C', repo, 'add', '.'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', repo, 'commit', '-m', 'Initial commit'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', repo, 'branch', '-M', 'main'], { stdio: 'ignore', windowsHide: true });
  const marker = join(dir, 'worker-running');
  const worker = { prepare({ workspace }) { return {
    executable: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setTimeout(()=>process.exit(0),1500)`],
    cwd: workspace.workspacePath, env: {}, timeoutMs: 5_000, stdoutMaxBytes: 4096, stderrMaxBytes: 4096,
  }; } };
  const service = createTaskService({
    home,
    config: { clientId: 'opencode-primary', authorization: { models: ['mock/a'], tools: ['read'], writableRoots: [repo] },
      limits: { maxAttempts: 1, budgetMs: 600_000, maxOutputBytes: 4096 } },
    worker,
  });
  t.after(() => service.close());
  const transport = makeTransport();
  const server = createMcpServer({ service, input: transport.input, output: transport.output });
  t.after(() => server.close());
  const req = { ...validRequest(repo), idempotencyKey: 'goal-b15-active-worker', repository: { path: repo, baseRef: 'main', branch: 'task/b15-active-worker' } };
  req.authorization.tools = ['read'];
  req.limits.maxAttempts = 1;
  req.limits.maxOutputBytes = 4096;
  transport.send({ jsonrpc: '2.0', id: 61, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: req } });
  const [submit] = await waitForOutput(transport.collect);
  assert.equal(submit.result.isError, false, submit.result.content?.[0]?.text);
  const { taskId } = JSON.parse(submit.result.content[0].text);
  const deadline = Date.now() + 5000;
  while (!existsSync(marker) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 10));
  assert.equal(existsSync(marker), true, 'the real worker subprocess should be active');

  transport.send({ jsonrpc: '2.0', id: 62, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: { taskId } } });
  transport.send({ jsonrpc: '2.0', id: 63, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: { taskId } } });
  const responses = await waitForOutput(transport.collect, 2);
  assert.deepEqual(responses.map(response => response.id).sort(), [62, 63]);
  for (const response of responses) {
    assert.equal(response.result.isError, false);
    assert.equal(JSON.parse(response.result.content[0].text).status, 'running');
  }
  await service.whenIdle();
});

test('B15-03c: notifications (no id) receive no response', async t => {
  const { service } = makeFixture(t);
  const { input, collect } = makeServer(t, service);

  // Send a notification (no id field)
  input.push(JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: { _meta: META } }) + '\n');
  await new Promise(r => setTimeout(r, 50));
  const lines = collect();
  assert.equal(lines.length, 0, 'no response for a notification');
});

test('B15-03d: stdin close discards a partial frame cleanly', async t => {
  const { service } = makeFixture(t);
  const { input, closeInput, collect } = makeServer(t, service);
  input.push(Buffer.from('{"jsonrpc":"2.0","id":99'));
  closeInput();
  await new Promise(r => setTimeout(r, 50));
  // No crash; output is empty.
  const lines = collect();
  assert.equal(lines.length, 0);
});

// ─── B15-04: Pinned-client compatibility ─────────────────────────────────────

test('B15-04a: wire format matches observed 2026-07-28 revision — jsonrpc 2.0, resultType complete, single text block', async t => {
  const { dir, service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 80, method: 'server/discover', params: { _meta: META } });
  const [discover] = await waitForOutput(collect);

  // Verify exact wire shape confirmed by the B06 gate transcript.
  assert.equal(discover.jsonrpc, '2.0');
  assert.equal(discover.id, 80);
  assert.ok(discover.result, 'result field present');
  assert.equal(discover.error, undefined, 'no top-level error on success');

  // tools/call result carries a single text content block.
  const req = validRequest(dir);
  req.idempotencyKey = 'goal-b15-04a';
  req.repository.branch = 'task/b15-wire';
  send({ jsonrpc: '2.0', id: 81, method: 'tools/call', params: { _meta: META, name: 'submit_task', arguments: req } });
  const [callResult] = await waitForOutput(collect);

  assert.equal(callResult.jsonrpc, '2.0');
  assert.equal(callResult.id, 81);
  assert.ok(Array.isArray(callResult.result.content), 'content array present');
  assert.equal(callResult.result.content.length, 1);
  assert.equal(callResult.result.content[0].type, 'text');
  assert.ok(typeof callResult.result.content[0].text === 'string', 'text field is a string');
  // Parse the JSON payload to verify schemaVersion.
  const payload = JSON.parse(callResult.result.content[0].text);
  assert.equal(payload.schemaVersion, 1);
});

test('B15-04b: error envelopes carry code and message without stack or private data', async t => {
  const { service } = makeFixture(t);
  const { send, collect } = makeServer(t, service);

  send({ jsonrpc: '2.0', id: 82, method: 'tools/call', params: { _meta: META, name: 'get_task_status', arguments: { taskId: '00000000-0000-4000-8000-ffffffffffff' } } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.result.isError, true);
  const payload = JSON.parse(msg.result.content[0].text);
  assert.ok(typeof payload.error.code === 'string', 'error.code is string');
  assert.ok(typeof payload.error.message === 'string', 'error.message is string');
  assert.equal(payload.error.stack, undefined, 'no stack in error envelope');
  // Error messages must not contain absolute paths or home directories.
  assert.doesNotMatch(payload.error.message, /[A-Za-z]:\\|\/home\//);
});

test('B15-04c: get_task_result with include parameter selects artifacts correctly', async t => {
  const { dir, service } = makeFixture(t);
  // Manually finish a task so result is available.
  const req = validRequest(dir);
  req.idempotencyKey = 'goal-b15-04c';
  req.repository.branch = 'task/b15-include';
  const { taskId } = service.submitTask(req);
  // Transition queued → running → succeeded (store requires startedAt for running tasks).
  service.store.updateTask(taskId, draft => {
    draft.status = 'running';
    draft.startedAt = 1_500;
  });
  service.store.updateTask(taskId, draft => {
    draft.status = 'succeeded';
    draft.finishedAt = 2_000;
    draft.artifact = {
      baseCommit: draft.baseCommit ?? 'a'.repeat(40),
      branch: draft.request?.repository?.branch ?? 'task/b15-include',
      headCommit: null,
      diff: 'diff --git a/x.txt b/x.txt\n',
      diffTruncated: false,
      changedFiles: ['x.txt'],
      testRuns: [{ command: 'node --test', exitCode: 0, durationMs: 100, summary: 'ok', outputTail: 'ok 1', outputTruncated: false }],
      logsTruncated: false,
      limitations: [],
      cost: { known: false, amount: null, currency: 'unknown', note: 'n/a' },
      evidenceLevel: 'unit',
    };
  });

  const { send, collect } = makeServer(t, service);
  // Request only 'diff' artifact.
  send({ jsonrpc: '2.0', id: 90, method: 'tools/call', params: { _meta: META, name: 'get_task_result', arguments: { taskId, include: ['diff'] } } });
  const [msg] = await waitForOutput(collect);

  assert.equal(msg.result.isError, false);
  const result = JSON.parse(msg.result.content[0].text);
  assert.ok(typeof result.diff === 'string', 'diff present');
  assert.ok(result.sanitized === true, 'sanitized flag set');
  assert.equal(result.schemaVersion, 1);
});

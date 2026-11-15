// B29-only trusted fixture wiring. The pinned OpenCode 2.2.5 MCP client spawns this
// stdio server to drive the real configured free-worker composition against a loopback
// fixture. The loopback endpoint is read once from B29_FIXTURE_ENDPOINT, which only this
// test module consumes; it is never read from AI_ORCHESTRATOR_CONFIG, MCP arguments or
// task text. Production mcp-server.mjs remains live-closed and does not import this file.
import { appendFileSync, readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { createConfiguredTaskService } from '../../src/configured-service.mjs';
import { createMcpServer } from '../../src/mcp-server.mjs';
import { FREE_ENDPOINT, FREE_MODEL_ID, FREE_PACKAGE } from '../../src/free-provider.mjs';

const home = process.env.AI_ORCHESTRATOR_HOME;
const configPath = process.env.AI_ORCHESTRATOR_CONFIG;
const approvalFile = process.env.AI_ORCHESTRATOR_APPROVAL;
const fixtureEndpoint = process.env.B29_FIXTURE_ENDPOINT;
const logDir = process.env.B29_MCP_LOG_DIR;
if (!home || !configPath || !approvalFile || !fixtureEndpoint || !logDir)
  throw new Error('B29 fixture composition paths and endpoint are required');
// The test-only seam is explicit: a loopback endpoint and nothing else. This check is
// deliberately repeated before the composition call so a malformed harness variable
// cannot reach the worker builder.
if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(fixtureEndpoint))
  throw new Error('B29 fixture endpoint must be an explicit loopback URL');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.fixtureEndpoint !== undefined || config.worker?.fixtureEndpoint !== undefined)
  throw new Error('fixture endpoint must not come from the orchestrator config');
const callLog = `${logDir}/mcp-calls.jsonl`;
const responseLog = `${logDir}/mcp-responses.jsonl`;

// Local copy of the public catalog shape. It is never fetched and is not live evidence.
function fixtureMetadata() {
  return { observedAt: Date.now(), model: { id: FREE_MODEL_ID, owned_by: 'opencode', type: 'chat',
    modalities: { input: ['text'], output: ['text'] }, capabilities: { tools: { supported: true } },
    limit: { context: 200_000, output: 32_000 },
    cost: { text: { input: { price: 0, cache: { read: 0 } }, output: { price: 0 } } },
    api: { 'chat-completions': { base_url: FREE_ENDPOINT, sdk: { opencodeai: FREE_PACKAGE } } } } };
}

const hostEnvironment = {};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC']) {
  if (process.env[key]) hostEnvironment[key] = process.env[key];
}
const service = await createConfiguredTaskService({ home, config, approvalFile, hostEnvironment },
  { metadata: async () => fixtureMetadata(), fixtureEndpoint });

// Hold the real scheduler callback until the pinned client has observed its persisted
// queued status. This is a fixture-only dispatch barrier: no status is synthesized and
// runtime policy or task-service behavior is unchanged.
const submitTask = service.submitTask;
let heldDispatch = null;
let dispatchReleased = false;
service.submitTask = input => {
  if (input?.idempotencyKey !== 'b29-free-mcp-task' || heldDispatch || dispatchReleased)
    return submitTask(input);
  const schedule = globalThis.setImmediate;
  try {
    globalThis.setImmediate = (callback, ...args) => {
      if (heldDispatch) throw new Error('unexpected setImmediate during held submission');
      heldDispatch = { callback, args };
      return { ref() { return this; }, unref() { return this; }, hasRef() { return true; } };
    };
    const accepted = submitTask(input);
    if (heldDispatch) heldDispatch.taskId = accepted.taskId;
    return accepted;
  } finally {
    globalThis.setImmediate = schedule;
  }
};

const input = new PassThrough();
const output = new PassThrough();
let pending = '';
let pendingOutput = '';
const callById = new Map();
input.on('data', chunk => {
  pending += chunk.toString('utf8');
  for (;;) {
    const end = pending.indexOf('\n');
    if (end < 0) break;
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    try {
      const message = JSON.parse(line);
      if (message.method === 'tools/call') {
        callById.set(String(message.id), message.params?.name);
        appendFileSync(callLog, `${JSON.stringify({ id: message.id, name: message.params?.name })}\n`);
      }
    } catch { /* the adapter owns protocol errors and parsing */ }
  }
});
output.on('data', chunk => {
  pendingOutput += chunk.toString('utf8');
  for (;;) {
    const end = pendingOutput.indexOf('\n');
    if (end < 0) break;
    const line = pendingOutput.slice(0, end); pendingOutput = pendingOutput.slice(end + 1);
    if (!line) continue;
    try {
      const response = JSON.parse(line);
      const name = callById.get(String(response.id));
      if (name) {
        appendFileSync(responseLog, `${JSON.stringify({ id: response.id, name, response })}\n`);
        const payload = response.result?.content?.map(item => item.text ?? '').join('');
        if (name === 'get_task_status' && !dispatchReleased && payload) {
          try {
            const status = JSON.parse(payload);
            if (status.taskId === heldDispatch?.taskId && status.status === 'queued') {
              dispatchReleased = true;
              const dispatch = heldDispatch;
              heldDispatch = null;
              scheduleDispatch(dispatch);
            }
          } catch { /* the MCP adapter owns response validation */ }
        }
        callById.delete(String(response.id));
      }
    } catch { /* the adapter owns protocol framing and serialization */ }
  }
});
function scheduleDispatch(dispatch) {
  if (dispatch) globalThis.setImmediate(dispatch.callback, ...dispatch.args);
}
output.pipe(process.stdout);
process.stdin.pipe(input);

const server = createMcpServer({ service, input, output });
let closing;
async function close() {
  if (closing) return closing;
  server.close();
  closing = Promise.resolve(service.close());
  return closing;
}
process.stdin.once('end', () => { void close(); });
process.stdin.once('close', () => { void close(); });
process.once('SIGTERM', () => { void close(); });

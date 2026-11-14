// B16-only trusted fixture wiring. The worker is a harmless local Node process.
import { createTaskService } from '../../src/service.mjs';
import { createMcpServer } from '../../src/mcp-server.mjs';
import { appendFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';

const home = process.env.AI_ORCHESTRATOR_HOME;
const repository = process.env.B16_REPOSITORY;
const callLog = process.env.B16_MCP_CALL_LOG;
const responseLog = process.env.B16_MCP_RESPONSE_LOG;
const workerCounter = process.env.B16_WORKER_COUNTER;
const evidenceDir = process.env.B16_WORKER_EVIDENCE_DIR;
const primaryRelease = process.env.B16_PRIMARY_RELEASE;
if (!home || !repository) throw new Error('B16 fixture paths are required');
if (!callLog || !responseLog || !workerCounter || !evidenceDir || !primaryRelease)
  throw new Error('B16 fixture evidence paths are required');

const options = {
  home,
  config: {
    clientId: 'opencode-primary',
    authorization: {
      models: ['fixture/mock'], tools: ['read', 'edit'], writableRoots: [repository],
    },
    limits: { maxAttempts: 1, budgetMs: 60_000, maxOutputBytes: 65_536 },
  },
};
options.worker = {
  evidenceLevel: 'opencode-integration',
  testCommands: [{
    label: 'verify B16 fixture output', executable: process.execPath,
    args: ['-e', "require('node:assert/strict').equal(require('node:fs').readFileSync('src/b16-output.txt','utf8'),'B16_FIXTURE_OUTPUT')"],
    env: {},
  }],
  prepare({ task, workspace }) {
    const key = task.request.idempotencyKey;
    const started = `${evidenceDir}/${key}.started`;
    const release = primaryRelease;
    const output = key === 'b16-primary-task' ? 'src/b16-output.txt' : `src/${key}.partial.txt`;
    const content = key === 'b16-primary-task' ? 'B16_FIXTURE_OUTPUT' : `PARTIAL_${key}`;
    const behavior = key === 'b16-primary-task'
      ? `while(!fs.existsSync(${JSON.stringify(release)})) await new Promise(r=>setTimeout(r,10)); fs.writeFileSync(${JSON.stringify(output)},${JSON.stringify(content)});`
      : `fs.writeFileSync(${JSON.stringify(output)},${JSON.stringify(content)});`;
    const keepAlive = key === 'b16-primary-task' ? 'process.exit(0);' : 'setInterval(()=>{},1000);';
    const code = `(async()=>{const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(workerCounter)},${JSON.stringify(`${key}\n`)}); fs.writeFileSync(${JSON.stringify(started)},JSON.stringify({pid:process.pid})); ${behavior} ${keepAlive}})().catch(error=>{console.error(error);process.exitCode=1});`;
    return {
      executable: process.execPath, args: ['-e', code], cwd: workspace.workspacePath,
      env: {}, timeoutMs: task.request.limits.budgetMs,
      stdoutMaxBytes: 4096, stderrMaxBytes: 4096,
    };
  },
};

const service = createTaskService(options);
// Hold the real scheduler callback until the pinned client has made a status
// poll and the service has returned its persisted queued record. This is a
// fixture-only dispatch barrier: no status is synthesized and runtime policy
// or task-service behavior is unchanged.
const submitTask = service.submitTask;
let heldDispatch = null;
let dispatchReleased = false;
service.submitTask = input => {
  if (input?.idempotencyKey !== 'b16-primary-task' || heldDispatch || dispatchReleased)
    return submitTask(input);
  const schedule = globalThis.setImmediate;
  try {
    globalThis.setImmediate = (callback, ...args) => {
      heldDispatch ??= { callback, args };
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

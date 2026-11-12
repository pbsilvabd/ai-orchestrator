// B16-only trusted fixture wiring. The worker is a harmless local Node process.
import { createTaskService } from '../../src/service.mjs';
import { createMcpServer } from '../../src/mcp-server.mjs';
import { appendFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';

const home = process.env.AI_ORCHESTRATOR_HOME;
const repository = process.env.B16_REPOSITORY;
const callLog = process.env.B16_MCP_CALL_LOG;
if (!home || !repository) throw new Error('B16 fixture paths are required');

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
if (process.env.B16_RECOVERY !== '1') options.worker = {
  evidenceLevel: 'opencode-integration',
  testCommands: [{
    label: 'verify B16 fixture output', executable: process.execPath,
    args: ['-e', "require('node:assert/strict').equal(require('node:fs').readFileSync('src/b16-output.txt','utf8'),'B16_FIXTURE_OUTPUT')"],
    env: {},
  }],
  prepare({ task, workspace }) {
    const delayed = /cancel|interrupt/i.test(task.request.objective);
    const code = delayed
      ? 'setTimeout(()=>process.exit(0),30000)'
      : `setTimeout(()=>{require('node:fs').writeFileSync('src/b16-output.txt','B16_FIXTURE_OUTPUT');process.exit(0)},4000)`;
    return {
      executable: process.execPath, args: ['-e', code], cwd: workspace.workspacePath,
      env: {}, timeoutMs: task.request.limits.budgetMs,
      stdoutMaxBytes: 4096, stderrMaxBytes: 4096,
    };
  },
};

const service = createTaskService(options);
const input = new PassThrough();
let pending = '';
input.on('data', chunk => {
  pending += chunk.toString('utf8');
  for (;;) {
    const end = pending.indexOf('\n');
    if (end < 0) break;
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    try {
      const message = JSON.parse(line);
      if (message.method === 'tools/call') appendFileSync(callLog, `${JSON.stringify({ name: message.params?.name })}\n`);
    } catch { /* the adapter owns protocol errors and parsing */ }
  }
});
process.stdin.pipe(input);

const server = createMcpServer({ service, input });
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

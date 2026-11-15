// B29-04/B29-02 focused process tests for the production MCP entry point.
// The fixture composition seam used by integration/mcp-free-workflow.mjs must not be
// reachable from AI_ORCHESTRATOR_CONFIG, an environment variable or MCP input here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { FREE_MODEL } from '../src/free-provider.mjs';

const entry = fileURLToPath(new URL('../mcp-server.mjs', import.meta.url));
const PROTOCOL = '2026-07-28';
const fixtureEnvironment = { B29_FIXTURE_ENDPOINT: 'http://127.0.0.1:43111/v1' };

function temporaryHome(t) {
  const root = mkdtempSync(join(tmpdir(), 'b29-cli-'));
  const home = join(root, 'state');
  mkdirSync(home);
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { root, home };
}

function startCli(home, extraEnvironment = {}) {
  const environment = { ...process.env, AI_ORCHESTRATOR_HOME: home, ...extraEnvironment };
  for (const key of ['AI_ORCHESTRATOR_CONFIG', 'AI_ORCHESTRATOR_APPROVAL']) {
    if (!Object.hasOwn(extraEnvironment, key)) delete environment[key];
  }
  const child = spawn(process.execPath, [entry], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const closed = new Promise(resolveClose => child.once('close', code => resolveClose(code)));
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  return { child, closed: closed.finally(() => clearTimeout(timer)), output: () => ({ stdout, stderr }) };
}

async function waitForLines(proc, count, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const lines = proc.output().stdout.split(/\r?\n/).filter(Boolean);
    if (lines.length >= count) return lines.map(line => JSON.parse(line));
    if (proc.child.exitCode !== null) throw new Error(`CLI exited early: ${proc.output().stderr}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for ${count} MCP replies: ${proc.output().stderr}`);
}

function frame(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method,
    params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL } } })}\n`;
}

function freeWorkerConfig(root, extraWorker = {}) {
  return { clientId: 'opencode-b29',
    authorization: { models: [FREE_MODEL], tools: ['read', 'edit'], writableRoots: [root] },
    limits: { maxAttempts: 1, budgetMs: 60_000, maxOutputBytes: 65_536 },
    worker: { type: 'opencode-free', executable: process.execPath,
      writablePaths: ['src/**'], ...extraWorker } };
}

test('B29-04: production MCP CLI stays passive without a configured worker', async t => {
  const { home } = temporaryHome(t);
  const proc = startCli(home, fixtureEnvironment);
  proc.child.stdin.write(frame(1, 'server/discover'));
  proc.child.stdin.write(frame(2, 'tools/list'));
  const replies = await waitForLines(proc, 2);
  const discover = replies.find(reply => reply.id === 1);
  const tools = replies.find(reply => reply.id === 2);
  assert.deepEqual(discover.result.supportedVersions, [PROTOCOL]);
  assert.deepEqual(tools.result.tools.map(tool => tool.name).sort(),
    ['cancel_task', 'get_task_result', 'get_task_status', 'submit_task']);
  assert.equal(tools.result.tools.length, 4);
  proc.child.stdin.end();
  assert.equal(await proc.closed, 0, proc.output().stderr);
  assert.equal(existsSync(join(home, 'locks', 'service-owner.lock')), false,
    'Passive CLI should release ownership on stdin EOF');
  assert.equal(readdirSync(join(home, 'tasks')).length, 0,
    'Passive CLI must not create tasks while serving discovery only');
});

test('B29-04: production MCP CLI refuses a live free worker despite fixture-like input', async t => {
  for (const withApproval of [false, true]) {
    const { root, home } = temporaryHome(t);
    const configPath = join(root, 'service.json');
    const approvalPath = join(root, 'approval.json');
    writeFileSync(configPath, JSON.stringify(freeWorkerConfig(root)));
    if (withApproval) {
      writeFileSync(approvalPath, JSON.stringify({ schemaVersion: 1, model: FREE_MODEL,
        requestHash: 'a'.repeat(64), expiresAt: Date.now() + 60_000, paidBudgetUSD: 0,
        privacyAcknowledged: true, actor: 'b29-cli-test' }));
    }
    const proc = startCli(home, { ...fixtureEnvironment,
      AI_ORCHESTRATOR_CONFIG: configPath,
      ...(withApproval && { AI_ORCHESTRATOR_APPROVAL: approvalPath }),
    });
    const code = await proc.closed;
    assert.equal(code, 1, 'Live free composition must fail at startup');
    assert.match(proc.output().stderr, /Failed to start task service/);
    assert.equal(proc.output().stdout, '', 'A refused startup must not write protocol output');
    assert.equal(existsSync(join(home, 'locks', 'service-owner.lock')), false);
    assert.equal(existsSync(join(home, 'tasks')), false,
      'A refused startup must fail before task persistence');
  }
});

test('B29-04: production config cannot supply the fixture endpoint', async t => {
  for (const location of ['config', 'worker']) {
    const { root, home } = temporaryHome(t);
    const repository = join(root, 'repository');
    mkdirSync(join(repository, 'src'), { recursive: true });
    const config = freeWorkerConfig(repository);
    if (location === 'config') config.fixtureEndpoint = 'http://127.0.0.1:43111/v1';
    else config.worker.fixtureEndpoint = 'http://127.0.0.1:43111/v1';
    const configPath = join(root, 'service.json');
    writeFileSync(configPath, JSON.stringify(config));
    const proc = startCli(home, { ...fixtureEnvironment, AI_ORCHESTRATOR_CONFIG: configPath,
      AI_ORCHESTRATOR_APPROVAL: join(root, 'missing-approval.json') });
    assert.equal(await proc.closed, 1, 'Config-selected fixture endpoint must be refused');
    assert.match(proc.output().stderr, /Failed to start task service/);
    assert.equal(existsSync(join(home, 'locks', 'service-owner.lock')), false);
    assert.equal(readFileSync(configPath, 'utf8').includes('fixtureEndpoint'), true,
      'The refused config must actually contain the hostile endpoint field');
    assert.equal(existsSync(join(home, 'tasks')), false,
      'A refused startup must fail before task persistence');
  }
});

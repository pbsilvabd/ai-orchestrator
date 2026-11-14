// Explicit opt-in: node integration/mcp-free-workflow.mjs /absolute/path/opencode.exe
// B29-04 acceptance through the pinned OpenCode 2.2.5 MCP client, real MCP stdio,
// the configured free-worker service and a loopback fixture model. The composition
// endpoint comes only from this harness through the test-only fixture server; no MCP
// request, task field or production mcp-server.mjs path can select it. The public free
// endpoint, public catalog and every external host are not contacted.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { FREE_MODEL, FREE_MODEL_ID, FREE_MAX_REQUESTS,
  freeRequestHash } from '../src/free-provider.mjs';

const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const fixtureServer = fileURLToPath(new URL('./fixtures/b29-free-mcp-server.mjs', import.meta.url));
const windowsJobSource = fileURLToPath(new URL('./fixtures/b16-windows-job.cs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'b29-mcp-'));
const work = join(root, 'repository');
const stateHome = join(root, 'state');
const configPath = join(root, 'service.json');
const approvalPath = join(root, 'approval.json');
const logDir = join(root, 'mcp-logs');
const releasePath = join(root, 'release-first-response');
const fixtureKey = 'b29-local-client-fixture-only';
mkdirSync(join(work, 'src'), { recursive: true });
mkdirSync(logDir, { recursive: true });

const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
gitEnvironment.GIT_CONFIG_NOSYSTEM = '1';
gitEnvironment.GIT_CONFIG_GLOBAL = join(root, 'empty-gitconfig');
writeFileSync(gitEnvironment.GIT_CONFIG_GLOBAL, '');
const git = (...args) => execFileSync('git', args, { cwd: work, env: gitEnvironment,
  encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).trim();
git('init', '--initial-branch=main');
git('config', 'user.name', 'B29 MCP Fixture');
git('config', 'user.email', 'b29-mcp@example.invalid');
writeFileSync(join(work, 'src', 'base.txt'), 'b29 mcp fixture baseline\n');
writeFileSync(join(work, 'src', 'free-output.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
test('B29 free fixture output is present', () => {
  assert.equal(readFileSync(fileURLToPath(new URL('./free-output.txt', import.meta.url)), 'utf8'), 'FREE_FIXTURE');
});
`);
git('add', '.');
git('-c', 'commit.gpgsign=false', 'commit', '-m', 'B29 MCP fixture base');
const baseCommit = git('rev-parse', 'HEAD');

const request = { clientId: 'opencode-b29', idempotencyKey: 'b29-free-mcp-task',
  objective: 'B29_FREE_MCP_FIXTURE: write "src/free-output.txt" with "FREE_FIXTURE"; a fixture out-of-scope write to "outside-free.txt" must be denied.',
  acceptanceCriteria: ['src/free-output.txt is written inside the allowed glob.',
    'The configured node --test command passes in the task workspace.'],
  repository: { path: work, baseRef: baseCommit, branch: 'task/b29-free-mcp' },
  authorization: { models: [FREE_MODEL], tools: ['read', 'edit'], writablePaths: ['src/**'] },
  limits: { maxAttempts: 1, budgetMs: 120_000, maxOutputBytes: 65_536 } };
writeFileSync(approvalPath, JSON.stringify({ schemaVersion: 1, model: FREE_MODEL,
  requestHash: freeRequestHash(request), expiresAt: Date.now() + 600_000, paidBudgetUSD: 0,
  privacyAcknowledged: true, actor: 'b29-mcp-harness' }));
writeFileSync(configPath, JSON.stringify({
  clientId: 'opencode-b29',
  authorization: { models: [FREE_MODEL], tools: ['read', 'edit'], writableRoots: [work] },
  limits: { maxAttempts: 1, budgetMs: 120_000, maxOutputBytes: 65_536 },
  worker: { type: 'opencode-free', executable: binary, writablePaths: ['src/**'] },
}));

const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC'])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  HOME: root, USERPROFILE: root, TEMP: root, TMP: root,
  XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  XDG_STATE_HOME: join(root, 'host-state'), XDG_CACHE_HOME: join(root, 'cache'),
  APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
  OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_PASSWORD: 'b29-local-password',
  OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_FILEWATCHER: '1',
  FIXTURE_API_KEY: fixtureKey,
  AI_ORCHESTRATOR_HOME: stateHome, AI_ORCHESTRATOR_CONFIG: configPath,
  AI_ORCHESTRATOR_APPROVAL: approvalPath,
  B29_MCP_LOG_DIR: logDir,
});

const timeoutMs = Number(process.env.B29_TIMEOUT_MS ?? 120_000);
assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000,
  'B29_TIMEOUT_MS must be an integer from 1 to 120000');

function start(file, args, cwd, { processGroup = false } = {}) {
  const windowsJob = process.platform === 'win32' && processGroup;
  const cleanupMarker = windowsJob ? randomBytes(16).toString('hex') : null;
  const child = spawnProcess(windowsJob, file, args, cwd, processGroup, cleanupMarker);
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const proc = { child, windowsJob, processGroup, cleanupMarker,
    output: () => ({ stdout, stderr }) };
  child.on('error', error => { proc.error = error; });
  proc.closed = new Promise(resolveClose => child.once('close', resolveClose));
  return proc;
}

let windowsJobLauncher;
function spawnProcess(windowsJob, file, args, cwd, processGroup, cleanupMarker) {
  if (!windowsJob) return spawn(file, args, { cwd, env, windowsHide: true,
    detached: processGroup && process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  windowsJobLauncher ??= compileWindowsJobLauncher();
  return spawn(windowsJobLauncher, [file, ...args], { cwd,
    env: { ...env, B19_JOB_CLEANUP_MARKER: cleanupMarker }, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] });
}

function compileWindowsJobLauncher() {
  const compiler = join(env.SystemRoot ?? env.WINDIR, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  const executable = join(root, 'b16-windows-job.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:anycpu', '/out:' + executable, windowsJobSource],
    { cwd: root, env, windowsHide: true, timeout: 30_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return executable;
}

function waitForClose(child, maxWait = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolveClose => {
    const timer = setTimeout(() => finish(false), maxWait);
    const onClose = () => finish(true);
    function finish(closed) { clearTimeout(timer); child.off('close', onClose); resolveClose(closed); }
    child.once('close', onClose);
  });
}

async function stop(proc) {
  const { child } = proc;
  if (proc.stopped) return;
  if (proc.error) { await proc.closed; proc.stopped = true; return; }
  if (proc.windowsJob) {
    child.stdin.on('error', () => { /* launcher exit is checked below */ });
    child.stdin.end();
    let timer;
    try {
      await Promise.race([proc.closed, new Promise((resolveWait, rejectWait) => {
        timer = setTimeout(() => {
          child.kill('SIGKILL');
          rejectWait(new Error('Windows job launcher did not confirm process-tree cleanup'));
        }, 7000);
      })]);
    } finally { clearTimeout(timer); }
    if (child.signalCode !== null || child.exitCode === 125)
      throw new Error('Windows job launcher did not confirm cleanup');
    const emptyMarker = `B19_JOB_EMPTY:${proc.cleanupMarker}`;
    if (!proc.output().stderr.split(/\r?\n/).some(line => line.trim() === emptyMarker))
      throw new Error('Windows job launcher exited without an empty-job confirmation');
  } else if (proc.processGroup && child.pid !== undefined) {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  } else if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    if (!child.kill('SIGKILL')) throw new Error('Could not signal the fixture process');
  }
  if (!await waitForClose(child)) throw new Error('Process did not close within five seconds');
  proc.stopped = true;
}

function run(file, args, cwd, timeout = timeoutMs) {
  const proc = start(file, args, cwd);
  const { child, output } = proc;
  child.stdin.end();
  return new Promise((resolveRun, rejectRun) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stop(proc).then(() => rejectRun(new Error(`Timed out: ${args.join(' ')}`)), rejectRun);
    }, timeout);
    child.once('error', error => { clearTimeout(timer); rejectRun(error); });
    child.once('close', code => { clearTimeout(timer); if (!timedOut) resolveRun({ code, ...output() }); });
  });
}

function codeFor(mode) {
  if (mode === 'submit') return `const accepted=await tools.orchestrator.submit_task(${JSON.stringify(request)}); return JSON.stringify(accepted);`;
  if (mode === 'poll') return `const taskId=${JSON.stringify(primaryClientTaskId)}; const status=await tools.orchestrator.get_task_status({taskId}); const result=status.resultAvailable?await tools.orchestrator.get_task_result({taskId,include:['diff','tests']}):null; return JSON.stringify({status,result});`;
  if (mode === 'duplicate') return `const request=${JSON.stringify(request)}; const first=await tools.orchestrator.submit_task(request); const second=await tools.orchestrator.submit_task(request); const status=await tools.orchestrator.get_task_status({taskId:first.taskId}); return JSON.stringify({first,second,status});`;
  return undefined;
}

let host;
let freeProvider;
let clientProvider;
let primaryClientTaskId;
let mode = 'warmup';
const generated = new Map();
const clientRequests = [];
const freeRequests = [];
let clientAnomalies = 0;
let freeAnomalies = 0;
const hosts = [];

const clientProviderServer = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  try {
    assert.equal(req.url, '/v1/chat/completions');
    const input = JSON.parse(body); clientRequests.push(input);
    const context = JSON.stringify(input);
    const catalogued = ['submit_task', 'get_task_status', 'get_task_result', 'cancel_task']
      .every(name => context.includes(`tools.orchestrator.${name}`));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'b29-client-fixture',
      object: 'chat.completion.chunk', created: 0, model: input.model,
      choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    const code = catalogued && codeFor(mode);
    if (code && !generated.has(mode)) {
      generated.set(mode, true);
      res.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: `b29-${mode}-call`,
        type: 'function', function: { name: 'execute', arguments: JSON.stringify({ code }) } }] }) +
        frame({}, 'tool_calls') + 'data: [DONE]\n\n');
    } else {
      res.end(frame({ role: 'assistant', content: `b29-${mode}-ok` }) +
        frame({}, 'stop') + 'data: [DONE]\n\n');
    }
  } catch {
    clientAnomalies++;
    if (!res.headersSent) res.writeHead(400);
    res.end('invalid local fixture request');
  }
});

const frame = (input, delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'b29-free-fixture',
  object: 'chat.completion.chunk', created: 0, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;

const freeProviderServer = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const record = { method: req.method, url: req.url, authorization: req.headers.authorization ?? null, body };
  freeRequests.push(record);
  let input;
  try { input = JSON.parse(body); } catch { freeAnomalies++; res.writeHead(400); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    freeAnomalies++; res.writeHead(404); res.end(); return;
  }
  if (record.authorization !== 'Bearer public' || input.model !== FREE_MODEL_ID) freeAnomalies++;
  if (freeRequests.length > FREE_MAX_REQUESTS) { freeAnomalies++; res.writeHead(429); res.end(); return; }
  const step = freeRequests.length;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (step === 1) {
    // Hold the real worker in a running state until the pinned MCP client has
    // observed it. This is a fixture response gate, not a synthesized task state.
    if (!await waitForRelease(res)) return;
    res.end(frame(input, { role: 'assistant', tool_calls: [{ index: 0, id: 'b29-denied-write',
      type: 'function', function: { name: 'write',
        arguments: JSON.stringify({ path: 'outside-free.txt', content: 'DENIED_FIXTURE' }) } }] }) +
      frame(input, {}, 'tool_calls') + 'data: [DONE]\n\n');
  } else if (step === 2) {
    res.end(frame(input, { role: 'assistant', tool_calls: [{ index: 0, id: 'b29-allowed-write',
      type: 'function', function: { name: 'write',
        arguments: JSON.stringify({ path: 'src/free-output.txt', content: 'FREE_FIXTURE' }) } }] }) +
      frame(input, {}, 'tool_calls') + 'data: [DONE]\n\n');
  } else {
    res.end(frame(input, { role: 'assistant', content: 'free fixture completed' }) +
      frame(input, {}, 'stop') + 'data: [DONE]\n\n');
  }
});

async function waitForRelease(response) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (existsSync(releasePath)) return true;
    if (response.destroyed || response.writableEnded) return false;
    if (Date.now() >= deadline) return false;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
}

async function waitForCondition(predicate, description, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function mcpReplies() {
  const path = join(logDir, 'mcp-responses.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function mcpCallNames() {
  const path = join(logDir, 'mcp-calls.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    .map(line => JSON.parse(line).name);
}

function replyPayload(reply) {
  assert.equal(reply.response.id, reply.id, `MCP ${reply.name} reply must match its request ID`);
  assert.equal(reply.response.result?.isError, false, `MCP ${reply.name} returned an error response`);
  assert.ok(reply?.response?.result?.content?.[0]?.text, `MCP call ${reply?.name} has no JSON result text`);
  return JSON.parse(reply.response.result.content[0].text);
}

function taskRecordFor(key) {
  const tasks = join(stateHome, 'tasks');
  if (!existsSync(tasks)) return undefined;
  for (const name of readdirSync(tasks).filter(entry => entry.endsWith('.json'))) {
    const task = JSON.parse(readFileSync(join(tasks, name), 'utf8'));
    if (task.request?.idempotencyKey === key) return task;
  }
  return undefined;
}

function providerToolPayloads(slice) {
  return slice.flatMap(entry => entry.messages ?? [])
    .filter(message => message.role === 'tool' && typeof message.content === 'string')
    .flatMap(message => {
      try { return [JSON.parse(message.content)]; }
      catch { return []; }
    });
}

async function startHost(endpoint) {
  const proc = start(binary, ['serve', '--hostname', '127.0.0.1',
    '--port', String(new URL(endpoint).port), '--print-logs', '--log-level', 'info'], work,
  { processGroup: true });
  hosts.push(proc);
  try {
    const deadline = Date.now() + 30_000;
    while (!proc.output().stdout.includes(`server listening on ${endpoint}`)) {
      if (proc.error) throw proc.error;
      if (proc.child.exitCode !== null || proc.child.signalCode !== null) {
        if (proc.windowsJob) await proc.closed;
        throw new Error(`OpenCode exited during startup: ${proc.output().stderr}`);
      }
      if (Date.now() >= deadline) throw new Error(`OpenCode did not listen: ${proc.output().stderr}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    return proc;
  } catch (error) {
    await stop(proc);
    throw error;
  }
}

async function waitForMcp(proc) {
  const deadline = Date.now() + 30_000;
  while (!`${proc.output().stdout}\n${proc.output().stderr}`.includes('server=orchestrator tools=4')) {
    if (proc.child.exitCode !== null) throw new Error(`OpenCode exited before MCP connected: ${proc.output().stderr}`);
    if (Date.now() >= deadline) throw new Error(`Task MCP server did not connect: ${proc.output().stderr}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
}

async function runClient(endpoint, currentMode, prompt) {
  mode = currentMode;
  generated.delete(currentMode);
  const result = await run(binary, ['run', '--server', endpoint, '--format', 'json',
    '--model', 'fixture/mock', prompt], work);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result;
}

function clientStatuses(slice) {
  return providerToolPayloads(slice).flatMap(payload => {
    if (payload?.taskId && typeof payload.status === 'string') return [payload];
    if (payload?.status?.taskId && typeof payload.status.status === 'string') return [payload.status];
    return [];
  });
}

let gateFailure;
let successResult;
try {
  freeProvider = freeProviderServer; freeProvider.listen(0, '127.0.0.1'); await once(freeProvider, 'listening');
  clientProvider = clientProviderServer; clientProvider.listen(0, '127.0.0.1'); await once(clientProvider, 'listening');
  env.B29_FIXTURE_ENDPOINT = `http://127.0.0.1:${freeProvider.address().port}/v1`;
  writeFileSync(join(root, 'opencode.json'), JSON.stringify({
    update: 'disable', share: 'disabled', model: 'fixture/mock',
    permissions: [{ action: '*', resource: '*', effect: 'allow' }],
    mcp: { servers: { orchestrator: { type: 'local',
      command: [process.execPath, fixtureServer], protocol: '2026-07-28' } } },
    providers: { fixture: { name: 'B29 local client fixture',
      env: ['FIXTURE_API_KEY'], package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${clientProvider.address().port}/v1` },
      models: { mock: { name: 'mock',
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        limit: { context: 32000, output: 1000 } } } } },
  }));
  env.OPENCODE_CONFIG = join(root, 'opencode.json');
  env.OPENCODE_MODELS_PATH = join(root, 'models.json');
  writeFileSync(env.OPENCODE_MODELS_PATH, '{}');
  const port = await new Promise((resolvePort, rejectPort) => {
    const probe = createServer(); probe.on('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolvePort(value)); });
  });
  const endpoint = `http://127.0.0.1:${port}`;
  host = await startHost(endpoint);
  const warm = await runClient(endpoint, 'warmup', 'Say hello briefly.');
  assert.ok(warm.stdout.includes('b29-warmup-ok'), warm.stderr + warm.stdout);
  await waitForMcp(host);

  // Submit through the pinned client and real MCP stdio. The fixture server holds the
  // scheduler callback until the client has observed the persisted queued status.
  await runClient(endpoint, 'submit', 'Submit the B29 free fixture task through MCP.');
  const submitReply = replyPayload(mcpReplies().find(reply => reply.name === 'submit_task'));
  assert.equal(submitReply.status, 'queued');
  assert.equal(submitReply.idempotentReplay, false);
  assert.equal(typeof submitReply.taskId, 'string');
  primaryClientTaskId = submitReply.taskId;
  const submittedTask = taskRecordFor('b29-free-mcp-task');
  assert.equal(submittedTask.taskId, primaryClientTaskId, 'MCP submit did not persist the expected task');
  assert.equal(submittedTask.status, 'queued', 'Task must stay queued until the client observes queued');
  assert.equal(submittedTask.attempts.length, 0, 'A queued submission must not have dispatched');

  const firstPollStart = clientRequests.length;
  await runClient(endpoint, 'poll', `Poll task ${primaryClientTaskId} through MCP.`);
  const firstPollStatuses = clientStatuses(clientRequests.slice(firstPollStart));
  assert.equal(firstPollStatuses[0]?.status, 'queued',
    `The pinned client must observe queued before dispatch; saw ${JSON.stringify(firstPollStatuses)}`);

  // The barrier released dispatch after the queued reply crossed MCP. Wait for the real
  // free worker to reach its gated first fixture response, then observe running.
  await waitForCondition(() => freeRequests.length >= 1, 'the free fixture worker request');
  const runningPollStart = clientRequests.length;
  await runClient(endpoint, 'poll', `Poll running task ${primaryClientTaskId} through MCP.`);
  const runningStatuses = clientStatuses(clientRequests.slice(runningPollStart));
  assert.equal(runningStatuses[0]?.status, 'running',
    `The pinned client must observe running before the fixture is released; saw ${JSON.stringify(runningStatuses)}`);
  writeFileSync(releasePath, 'release');

  let terminalTask;
  let finalStatus;
  let finalResult;
  const statusSequence = [...firstPollStatuses, ...runningStatuses].map(status => status.status);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const before = clientRequests.length;
    await runClient(endpoint, 'poll', `Retrieve the terminal result for task ${primaryClientTaskId} through MCP.`);
    const polled = clientStatuses(clientRequests.slice(before));
    for (const status of polled) statusSequence.push(status.status);
    terminalTask = taskRecordFor('b29-free-mcp-task');
    const polledTerminal = polled.find(status => status.taskId === primaryClientTaskId &&
      ['succeeded', 'failed', 'blocked', 'cancelled'].includes(status.status));
    assert.ok(!polledTerminal || polledTerminal.status === 'succeeded',
      `Free fixture task ended ${polledTerminal?.status}: ${JSON.stringify(terminalTask.block ?? null)}`);
    if (polledTerminal?.status === 'succeeded') {
      finalStatus = polledTerminal;
      const messages = clientRequests.slice(before).flatMap(entry => entry.messages ?? []);
      const terminalPayload = providerToolPayloads(clientRequests.slice(before))
        .find(payload => payload?.status?.taskId === primaryClientTaskId && payload?.result);
      finalResult = terminalPayload?.result;
      const terminalContext = messages.find(message => message.role === 'tool' &&
        String(message.content).includes(primaryClientTaskId) && String(message.content).includes('"status":"succeeded"'));
      assert.ok(terminalContext,
        `The pinned client must receive the terminal status through MCP; observed ${JSON.stringify(
          messages.map(message => ({ role: message.role, content: String(message.content).slice(0, 240) })))}`);
      assert.ok(finalResult, 'The terminal client poll must carry the result payload');
      break;
    }
    assert.ok(terminalTask.status !== 'failed' && terminalTask.status !== 'blocked',
      `Free fixture task ended ${terminalTask.status}: ${JSON.stringify(terminalTask.block ?? null)}`);
  }
  assert.equal(terminalTask?.status, 'succeeded');
  assert.ok(finalStatus, 'The terminal poll must carry the succeeded status');
  assert.equal(finalStatus.taskId, primaryClientTaskId);
  assert.equal(finalStatus.status, 'succeeded');
  assert.ok(statusSequence.indexOf('queued') < statusSequence.indexOf('running') &&
    statusSequence.indexOf('running') < statusSequence.lastIndexOf('succeeded'),
  `Pinned-client polls must observe queued -> running -> succeeded; saw ${statusSequence.join(' -> ')}`);

  assert.ok(finalResult, 'The terminal poll must return the task result');
  assert.equal(finalResult.taskId, primaryClientTaskId);
  assert.equal(finalResult.status, 'succeeded');
  assert.ok(String(finalResult.diff).includes('src/free-output.txt'), 'Result diff must list the allowed file');
  assert.ok(String(finalResult.diff).includes('+FREE_FIXTURE'), 'Result diff must include the committed content');
  assert.ok(finalResult.changedFiles.includes('src/free-output.txt'));
  assert.equal(finalResult.testRuns[0].command, 'node --test');
  assert.equal(finalResult.testRuns[0].exitCode, 0, 'The configured fixture test must exit 0');
  assert.equal(finalResult.changedFiles.includes('outside-free.txt'), false,
    'Out-of-scope write must not appear in the result');

  const workspacePath = terminalTask.attempts[0].workspace.workspacePath;
  const workspaceOutside = join(workspacePath, 'outside-free.txt');
  assert.equal(existsSync(workspaceOutside), false, 'Out-of-scope host write created a file');
  assert.equal(existsSync(join(work, 'outside-free.txt')), false, 'Out-of-scope write reached the repository');
  const freeToolMessages = freeRequests.flatMap(record => {
    try { return JSON.parse(record.body).messages ?? []; } catch { return []; }
  }).filter(message => message.role === 'tool').map(message => String(message.content));
  assert.ok(freeToolMessages.some(content => /denied|not allowed|permission/i.test(content)),
    'The free host did not report the out-of-scope denial');
  assert.ok(freeRequests.every(record => record.authorization === 'Bearer public'),
    'Free fixture requests must use only the anonymous public credential');
  assert.equal(freeAnomalies, 0, 'Free fixture observed an unexpected request');
  assert.equal(clientAnomalies, 0, 'Client fixture observed an unexpected request');
  assert.ok(freeRequests.length >= 3 && freeRequests.length <= FREE_MAX_REQUESTS,
    `Unexpected free request count ${freeRequests.length}`);
  assert.equal(terminalTask.attempts.length, 1, 'One task must produce exactly one attempt');

  // A separate pinned-client process repeats the exact submission twice. Idempotent
  // replay must return the original task and must not dispatch a second worker.
  const freeRequestsBeforeDuplicate = freeRequests.length;
  await runClient(endpoint, 'duplicate', 'Reconnect and submit the identical B29 task twice.');
  const duplicateReplies = mcpReplies().filter(reply => reply.name === 'submit_task').slice(-2);
  assert.equal(duplicateReplies.length, 2);
  for (const reply of duplicateReplies) {
    const duplicate = replyPayload(reply);
    assert.equal(duplicate.taskId, primaryClientTaskId, 'Reconnect must receive the original task ID');
    assert.equal(duplicate.idempotentReplay, true, 'Reconnect response must identify an idempotent replay');
  }
  const duplicateTask = taskRecordFor('b29-free-mcp-task');
  assert.equal(duplicateTask.taskId, primaryClientTaskId);
  assert.equal(duplicateTask.attempts.length, 1, 'Duplicate submission must not add an attempt');
  assert.equal(readdirSync(join(stateHome, 'workspaces')).filter(name => !name.endsWith('.workspace.json')).length, 1,
    'Duplicate submission must not create a second workspace');
  assert.equal(freeRequests.length, freeRequestsBeforeDuplicate,
    'Duplicate submission must not reach the free fixture worker again');
  assert.equal(mcpCallNames().filter(name => name === 'submit_task').length, 3,
    'The submit plus both duplicate submissions must cross MCP transport');

  // The loopback endpoint is a trusted harness input only. Prove it is absent from
  // the production-shaped config, task text, MCP call arguments and provider bodies.
  const fixtureEndpoint = env.B29_FIXTURE_ENDPOINT;
  assert.equal(readFileSync(configPath, 'utf8').includes(fixtureEndpoint), false,
    'The orchestrator config must not carry the fixture endpoint');
  assert.equal(JSON.stringify(request).includes(fixtureEndpoint), false,
    'Task text must not carry the fixture endpoint');
  assert.equal(readFileSync(join(logDir, 'mcp-calls.jsonl'), 'utf8').includes(fixtureEndpoint), false,
    'MCP call input must not carry the fixture endpoint');
  assert.ok(freeRequests.every(record => !record.body.includes(fixtureEndpoint)),
    'The worker provider body must not select the endpoint');
  assert.equal(existsSync(join(stateHome, 'tasks')), true);

  successResult = JSON.stringify({ version: '2.2.5', model: FREE_MODEL,
    endpoint: 'loopback fixture',
    transportCalls: mcpCallNames().length, submitPollResult: true,
    pollStatuses: statusSequence, duplicateStableId: true, attempts: duplicateTask.attempts.length,
    workspacesForDuplicate: 1, freeFixtureRequests: freeRequests.length,
    clientFixtureAnomalies: clientAnomalies, freeFixtureAnomalies: freeAnomalies,
    endpointAbsentFromConfigTaskAndMcp: true,
    deniedOutOfScopeWrite: true, testExitCode: finalResult.testRuns[0].exitCode,
    taskId: primaryClientTaskId });
} catch (error) {
  gateFailure ??= error;
} finally {
  const cleanupErrors = [];
  if (host) try { await stop(host); } catch (error) { cleanupErrors.push(error); }
  for (const proc of hosts) if (!proc.stopped)
    try { await stop(proc); } catch (error) { cleanupErrors.push(error); }
  for (const [label, server] of [['free provider', freeProvider], ['client provider', clientProvider]]) {
    if (!server) continue;
    try {
      await new Promise(resolveClose => {
        server.close(resolveClose);
        server.closeAllConnections();
      });
    } catch (error) { cleanupErrors.push(new Error(`${label}: ${error.message}`)); }
  }
  if (!cleanupErrors.length && !process.env.B29_DEBUG) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { cleanupErrors.push(error); }
  } else if (existsSync(root)) console.error(`Temporary B29 MCP fixture retained: ${root}`);
  if (cleanupErrors.length) {
    const details = cleanupErrors.map(error => `${error.name}: ${error.message}`).join('; ');
    gateFailure = new Error(gateFailure ? `B29 MCP failure: ${gateFailure.message}; cleanup: ${details}`
      : `B29 MCP cleanup failure: ${details}`);
  }
}
if (gateFailure) throw gateFailure;
console.log(successResult);

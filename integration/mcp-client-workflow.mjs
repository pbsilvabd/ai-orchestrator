// Explicit opt-in: node integration/mcp-client-workflow.mjs /absolute/path/opencode.exe
// B16 acceptance through pinned OpenCode, real MCP stdio, service, and fixture workers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, unlinkSync, appendFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { resolve, join, relative as relativePath, sep, isAbsolute } from 'node:path';

const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const root = mkdtempSync(join(tmpdir(), 'orchestrator-b16-'));
const work = join(root, 'repository'); mkdirSync(join(work, 'src'), { recursive: true });
let stateHome = join(root, 'state');
const configPath = join(root, 'service.json');
const callLog = join(root, 'mcp-calls.jsonl');
const responseLog = join(root, 'mcp-responses.jsonl');
const workerCounter = join(root, 'worker-invocations.txt');
const primaryRelease = join(root, 'primary-release');
const password = 'b16-local-password';
const fixtureKey = 'b16-local-fixture-only';
const redact = value => String(value).replaceAll(password, '[redacted]').replaceAll(fixtureKey, '[redacted]');
const timeoutMs = Number(process.env.B16_TIMEOUT_MS ?? 120_000);
assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000,
  'B16_TIMEOUT_MS must be an integer from 1 to 120000');

function inside(parent, child) {
  const relative = relativePath(parent, child);
  return relative === '' || (!relative.startsWith(`..${sep}`) && relative !== '..' && !isAbsolute(relative));
}

const gitEnv = { ...process.env };
for (const key of Object.keys(gitEnv)) if (key.startsWith('GIT_')) delete gitEnv[key];
Object.assign(gitEnv, {
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
  GIT_TEMPLATE_DIR: join(root, 'git-template'),
});
mkdirSync(gitEnv.GIT_TEMPLATE_DIR, { recursive: true });
writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
function fixtureGit(args) {
  return execFileSync('git', args, { env: gitEnv, stdio: 'ignore', windowsHide: true });
}

function canarySnapshot(canary, canaryEnv) {
  const git = args => execFileSync('git', ['-C', canary, ...args], {
    env: canaryEnv, encoding: 'utf8', windowsHide: true,
  }).trim();
  return {
    config: readFileSync(join(canary, '.git', 'config')),
    index: readFileSync(join(canary, '.git', 'index')),
    head: git(['rev-parse', 'HEAD']),
    main: git(['rev-parse', 'refs/heads/main']),
    feature: git(['rev-parse', 'refs/heads/feature']),
    status: git(['status', '--porcelain=v1']),
    branch: git(['branch', '--show-current']),
  };
}

async function verifyGitIsolation() {
  const canary = join(root, 'git-canary');
  mkdirSync(canary);
  fixtureGit(['init', '--initial-branch=main', canary]);
  fixtureGit(['-C', canary, 'config', 'user.name', 'B16 Canary']);
  fixtureGit(['-C', canary, 'config', 'user.email', 'b16-canary@example.invalid']);
  writeFileSync(join(canary, 'tracked.txt'), 'base');
  fixtureGit(['-C', canary, 'add', 'tracked.txt']);
  fixtureGit(['-C', canary, 'commit', '-m', 'Canary base']);
  fixtureGit(['-C', canary, 'switch', '-c', 'feature']);
  writeFileSync(join(canary, 'staged.txt'), 'staged');
  fixtureGit(['-C', canary, 'add', 'staged.txt']);
  const canaryEnv = { ...gitEnv, GIT_DIR: join(canary, '.git'), GIT_WORK_TREE: canary };
  const before = canarySnapshot(canary, canaryEnv);
  const child = spawnSync(process.execPath,
    [resolve('integration/mcp-client-workflow.mjs'), `${binary}.missing-canary`], {
      cwd: process.cwd(), env: { ...process.env, GIT_DIR: canaryEnv.GIT_DIR,
        GIT_WORK_TREE: canaryEnv.GIT_WORK_TREE, B16_GIT_CANARY_CHILD: '1' },
      encoding: 'utf8', windowsHide: true, timeout: 30_000,
    });
  assert.notEqual(child.status, 0, 'Missing-binary canary run must fail');
  assert.match(child.stderr, /ENOENT/, 'Missing-binary canary run must fail at executable launch');
  const after = canarySnapshot(canary, canaryEnv);
  for (const key of ['config', 'index']) assert.deepEqual(after[key], before[key], `Canary ${key} must remain byte-identical`);
  for (const key of ['head', 'main', 'feature', 'status', 'branch'])
    assert.equal(after[key], before[key], `Canary ${key} must remain unchanged`);
}

const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC'])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  HOME: root, USERPROFILE: root, TEMP: root, TMP: root,
  XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  XDG_STATE_HOME: join(root, 'host-state'), XDG_CACHE_HOME: join(root, 'cache'),
  APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
  OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_PASSWORD: password,
  OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_FILEWATCHER: '1',
  FIXTURE_API_KEY: fixtureKey,
  AI_ORCHESTRATOR_HOME: stateHome, AI_ORCHESTRATOR_CONFIG: configPath,
  B16_REPOSITORY: work, B16_MCP_CALL_LOG: callLog,
  B16_MCP_RESPONSE_LOG: responseLog, B16_WORKER_COUNTER: workerCounter,
  B16_WORKER_EVIDENCE_DIR: root, B16_PRIMARY_RELEASE: primaryRelease,
});

fixtureGit(['init', work]);
const gitTop = execFileSync('git', ['-C', work, 'rev-parse', '--show-toplevel'], { env: gitEnv, encoding: 'utf8', windowsHide: true }).trim();
const gitDir = execFileSync('git', ['-C', work, 'rev-parse', '--absolute-git-dir'], { env: gitEnv, encoding: 'utf8', windowsHide: true }).trim();
assert.ok(inside(root, resolve(gitTop)), 'Fixture Git worktree must resolve inside its temporary root');
assert.ok(inside(root, resolve(gitDir)), 'Fixture Git directory must resolve inside its temporary root');
assert.equal(resolve(gitTop), resolve(work), 'Fixture Git worktree must be the scratch repository');
assert.equal(resolve(gitDir), resolve(work, '.git'), 'Fixture Git metadata must stay in the scratch repository');
fixtureGit(['-C', work, 'config', 'user.name', 'B16 Fixture']);
fixtureGit(['-C', work, 'config', 'user.email', 'b16-fixture@example.invalid']);
writeFileSync(join(work, 'README.md'), '# B16 MCP fixture\n');
writeFileSync(join(work, 'src', 'README.md'), 'Fixture source directory.\n');
fixtureGit(['-C', work, 'add', '.']);
fixtureGit(['-C', work, 'commit', '-m', 'Initial fixture']);
fixtureGit(['-C', work, 'branch', '-M', 'main']);
writeFileSync(configPath, JSON.stringify({
  clientId: 'opencode-primary',
  authorization: { models: ['fixture/mock'], tools: ['read', 'edit'], writableRoots: [work] },
  limits: { maxAttempts: 1, budgetMs: 60_000, maxOutputBytes: 65_536 },
}));

async function verifyGracefulStdioShutdown() {
  const shutdownHome = join(root, 'shutdown-home');
  const child = spawn(process.execPath, [resolve('mcp-server.mjs')], {
    cwd: work, env: { ...env, AI_ORCHESTRATOR_HOME: shutdownHome }, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lock = join(shutdownHome, 'locks', 'service-owner.lock');
  const deadline = Date.now() + 5000;
  while (!existsSync(lock) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 10));
  assert.ok(existsSync(lock), 'MCP entry point should acquire service ownership before reading requests');
  child.stdin.end();
  const code = await new Promise((resolveCode, rejectCode) => {
    const timer = setTimeout(() => rejectCode(new Error('MCP entry point did not close after stdin EOF')), 5000);
    child.once('error', error => { clearTimeout(timer); rejectCode(error); });
    child.once('close', (value, signal) => { clearTimeout(timer); resolveCode({ value, signal }); });
  });
  assert.equal(code.value, 0, redact(stderr));
  assert.equal(code.signal, null);
  assert.equal(stdout, '', 'stdout must stay protocol-only when no request was sent');
  assert.equal(existsSync(lock), false, 'safe idle shutdown should release service ownership');
}

function start(file, args, cwd, { processGroup = false } = {}) {
  const child = spawn(file, args, { cwd, env, windowsHide: true,
    detached: processGroup && process.platform !== 'win32' });
  child.processGroup = processGroup;
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  return { child, output: () => ({ stdout, stderr }) };
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

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    const code = await new Promise((resolveCode, rejectCode) => {
      const timer = setTimeout(() => rejectCode(new Error('taskkill timed out')), 5000);
      killer.once('error', error => { clearTimeout(timer); rejectCode(error); });
      killer.once('close', value => { clearTimeout(timer); resolveCode(value); });
    });
    if (code !== 0 && child.exitCode === null && child.signalCode === null && !await waitForClose(child, 1000))
      throw new Error('taskkill failed to stop host process tree');
  } else if (child.processGroup) {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  } else if (!child.kill('SIGKILL')) throw new Error('Could not signal OpenCode');
  if (!await waitForClose(child)) throw new Error('OpenCode did not close within five seconds');
}

function run(file, args, cwd, timeout = timeoutMs) {
  const { child, output } = start(file, args, cwd);
  child.stdin.end();
  return new Promise((resolveRun, rejectRun) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stop(child).then(() => rejectRun(new Error(`Timed out: ${args.join(' ')}\n${redact(output().stderr)}`)), rejectRun);
    }, timeout);
    child.once('error', error => { clearTimeout(timer); rejectRun(error); });
    child.once('close', code => { clearTimeout(timer); if (!timedOut) resolveRun({ code, ...output() }); });
  });
}

function requestFor(key, objective, branch) {
  return {
    idempotencyKey: key, clientId: 'opencode-primary', objective,
    acceptanceCriteria: ['The task produces a recorded workspace diff.', 'The configured fixture test passes.'],
    repository: { path: work, baseRef: 'main', branch },
    authorization: { models: ['fixture/mock'], tools: ['read', 'edit'], writablePaths: ['src'] },
    limits: { maxAttempts: 1, budgetMs: 60_000, maxOutputBytes: 65_536 },
  };
}

function taskRecordFor(key) {
  const tasks = join(stateHome, 'tasks');
  if (!existsSync(tasks)) return undefined;
  for (const name of readdirSync(tasks).filter(entry => entry.endsWith('.json'))) {
    const task = JSON.parse(readFileSync(join(tasks, name), 'utf8'));
    if (task.request?.idempotencyKey === key) return task;
  }
}

async function waitForTask(key, predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let task;
  while (Date.now() < deadline) {
    task = taskRecordFor(key);
    if (task && predicate(task)) return task;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  assert.ok(task && predicate(task), `Timed out waiting for task evidence: ${key}`);
  return task;
}

function mcpCallNames() {
  return readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).name);
}

function mcpReplies() {
  if (!existsSync(responseLog)) return [];
  return readFileSync(responseLog, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function replyPayload(reply) {
  assert.equal(reply.response.id, reply.id, `MCP ${reply.name} reply must match its request ID`);
  assert.equal(reply.response.result?.isError, false, `MCP ${reply.name} returned an error response`);
  assert.ok(reply?.response?.result?.content?.[0]?.text, `MCP call ${reply?.name} has no JSON result text`);
  return JSON.parse(reply.response.result.content[0].text);
}

function waitForFile(path, timeout = 5000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolveWait, rejectWait) => {
    const check = () => {
      if (existsSync(path)) return resolveWait();
      if (Date.now() >= deadline) return rejectWait(new Error(`Timed out waiting for fixture evidence: ${path}`));
      setTimeout(check, 20);
    };
    check();
  });
}

async function waitForExit(pid, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (pidIsAlive(pid) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  assert.equal(pidIsAlive(pid), false, `Worker root ${pid} should have exited`);
}

let host;
let provider;
let gateFailure;
let successResult;
let mode = 'warmup';
const hosts = [];
const requests = [];
const generated = new Map();
const primary = requestFor('b16-primary-task', 'Create src/b16-output.txt with the fixture output and run the configured test.', 'task/b16-primary');
const cancelRequest = requestFor('b16-cancel-task', 'Exercise active cancellation without writing output.', 'task/b16-cancel');
const interruptRequest = requestFor('b16-interrupt-task', 'Exercise host interruption and conservative recovery.', 'task/b16-interrupt');

function codeFor(currentMode) {
  if (currentMode === 'submit') return `const accepted=await tools.orchestrator.submit_task(${JSON.stringify(primary)}); return JSON.stringify(accepted);`;
  if (currentMode === 'poll') return `const status=await tools.orchestrator.get_task_status({taskId:${JSON.stringify(taskRecordFor('b16-primary-task')?.taskId)}}); const result=status.resultAvailable?await tools.orchestrator.get_task_result({taskId:status.taskId,include:['diff','tests']}):null; return JSON.stringify({status,result});`;
  if (currentMode === 'duplicate') return `const request=${JSON.stringify(primary)}; const first=await tools.orchestrator.submit_task(request); const second=await tools.orchestrator.submit_task(request); const status=await tools.orchestrator.get_task_status({taskId:first.taskId}); return JSON.stringify({first,second,status});`;
  if (currentMode === 'cancelSubmit') return `const accepted=await tools.orchestrator.submit_task(${JSON.stringify(cancelRequest)}); return JSON.stringify(accepted);`;
  if (currentMode === 'cancel') { const taskId = taskRecordFor('b16-cancel-task')?.taskId; return `const status=await tools.orchestrator.get_task_status({taskId:${JSON.stringify(taskId)}}); const cancel=await tools.orchestrator.cancel_task({taskId:${JSON.stringify(taskId)},reason:'B16 active cancellation fixture'}); const after=await tools.orchestrator.get_task_status({taskId:${JSON.stringify(taskId)}}); return JSON.stringify({status,cancel,after});`; }
  if (currentMode === 'interruptSubmit') return `const accepted=await tools.orchestrator.submit_task(${JSON.stringify(interruptRequest)}); return JSON.stringify(accepted);`;
  if (currentMode === 'interruptPoll') return `const status=await tools.orchestrator.get_task_status({taskId:${JSON.stringify(taskRecordFor('b16-interrupt-task')?.taskId)}}); const result=status.resultAvailable?await tools.orchestrator.get_task_result({taskId:status.taskId,include:['diff','tests']}):null; return JSON.stringify({status,result});`;
  return undefined;
}

async function startHost(endpoint, { executable = binary, args, readinessTimeoutMs = 30_000 } = {}) {
  const proc = start(executable, args ?? ['serve', '--hostname', '127.0.0.1', '--port', String(new URL(endpoint).port), '--print-logs', '--log-level', 'info'], work,
    { processGroup: true });
  hosts.push(proc);
  try {
    const deadline = Date.now() + readinessTimeoutMs;
    while (!proc.output().stdout.includes(`server listening on ${endpoint}`)) {
      if (proc.child.exitCode !== null || proc.child.signalCode !== null)
        throw new Error(`OpenCode exited during startup: ${redact(proc.output().stderr)}`);
      if (Date.now() >= deadline) throw new Error(`OpenCode did not listen: ${redact(proc.output().stderr)}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    return proc;
  } catch (error) {
    await stop(proc.child);
    throw error;
  }
}

async function waitForMcp(proc) {
  const connectDeadline = Date.now() + 30_000;
  while (!`${proc.output().stdout}\n${proc.output().stderr}`.includes('server=orchestrator tools=4')) {
    if (proc.child.exitCode !== null) throw new Error(`OpenCode exited before MCP connected: ${redact(proc.output().stderr)}`);
    if (Date.now() >= connectDeadline) throw new Error(`Task MCP server did not connect: ${redact(proc.output().stderr)}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
}

async function runClient(endpoint, currentMode, prompt) {
  mode = currentMode;
  generated.delete(currentMode);
  const result = await run(binary, ['run', '--server', endpoint, '--format', 'json', '--model', 'fixture/mock', prompt], work);
  assert.equal(result.code, 0, redact(result.stderr + result.stdout));
  return result;
}

function pidIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

try {
  await verifyGracefulStdioShutdown();
  if (process.env.B16_GIT_CANARY_CHILD !== '1') await verifyGitIsolation();

  // A live child that never reports readiness must be stopped before startup fails.
  await assert.rejects(startHost('http://127.0.0.1:1', {
    executable: process.execPath,
    args: ['-e', "const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000)"],
    readinessTimeoutMs: 200,
  }), /did not listen/);
  const failedStartupHost = hosts.at(-1);
  assert.ok(failedStartupHost.child.exitCode !== null || failedStartupHost.child.signalCode !== null,
    'Failed host startup must stop and reap the spawned process before returning');
  const failedStartupDescendant = Number(failedStartupHost.output().stdout.trim());
  assert.ok(Number.isInteger(failedStartupDescendant) && failedStartupDescendant > 0,
    'The failed host must have spawned a live descendant for cleanup verification');
  await waitForExit(failedStartupDescendant);

  // A nonexistent executable must fail at host startup instead of passing on path truthiness.
  await assert.rejects(run(`${binary}.missing`, ['--version'], work, 10_000), error => error.code === 'ENOENT');
  const version = await run(binary, ['--version'], work, 60_000);
  assert.equal(version.code, 0, redact(version.stderr));
  assert.equal(version.stdout.trim(), 'opencode v2.2.5');

  provider = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    try {
      assert.equal(req.url, '/v1/chat/completions');
      const input = JSON.parse(body); requests.push(input);
      const context = JSON.stringify(input);
      if (process.env.B16_DEBUG) writeFileSync(join(root, 'provider-last.json'), redact(context));
      const catalogued = ['submit_task', 'get_task_status', 'get_task_result', 'cancel_task'].every(name => context.includes(`tools.orchestrator.${name}`));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'b16-fixture-response', object: 'chat.completion.chunk', created: 0, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      const code = catalogued && codeFor(mode);
      if (code && !generated.has(mode)) {
        generated.set(mode, true);
        res.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: `b16-${mode}-call`, type: 'function', function: { name: 'execute', arguments: JSON.stringify({ code }) } }] }) + frame({}, 'tool_calls') + 'data: [DONE]\n\n');
      } else {
        const marker = mode === 'warmup' ? 'warm-up-ok' : `b16-${mode}-ok`;
        res.end(frame({ role: 'assistant', content: marker }) + frame({}, 'stop') + 'data: [DONE]\n\n');
      }
    } catch (error) {
      if (!res.headersSent) res.writeHead(400);
      res.end('invalid local fixture request');
      gateFailure ??= error;
    }
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const config = {
    update: 'disable', share: 'disabled', model: 'fixture/mock',
    permissions: [{ action: '*', resource: '*', effect: 'allow' }],
    mcp: { servers: { orchestrator: { type: 'local', command: [process.execPath, resolve('integration/fixtures/b16-mcp-server.mjs')], protocol: '2026-07-28' } } },
    providers: { fixture: { name: 'B16 local fixture', env: ['FIXTURE_API_KEY'], package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1` },
      models: { mock: { name: 'mock', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 1000 } } },
    } },
  };
  writeFileSync(join(root, 'opencode.json'), JSON.stringify(config));
  env.OPENCODE_CONFIG = join(root, 'opencode.json');
  env.OPENCODE_MODELS_PATH = join(root, 'models.json'); writeFileSync(env.OPENCODE_MODELS_PATH, '{}');
  const port = await new Promise((resolvePort, rejectPort) => {
    const probe = createServer(); probe.on('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolvePort(value)); });
  });
  const endpoint = `http://127.0.0.1:${port}`;
  host = await startHost(endpoint);

  const warm = await runClient(endpoint, 'warmup', 'Say hello briefly.');
  assert.ok(warm.stdout.includes('warm-up-ok'), redact(warm.stderr + warm.stdout));
  await waitForMcp(host);

  await runClient(endpoint, 'submit', 'Submit the B16 task through MCP and return the stable task ID.');
  let primaryTask = taskRecordFor('b16-primary-task');
  assert.ok(primaryTask, 'MCP submit did not persist the task');
  assert.equal(primaryTask.clientId, 'opencode-primary');
  assert.equal(primaryTask.request.repository.branch, 'task/b16-primary');
  const primaryAccepted = replyPayload(mcpReplies().find(reply => reply.name === 'submit_task'));
  assert.equal(primaryAccepted.taskId, primaryTask.taskId);
  assert.equal(primaryAccepted.status, 'queued');
  assert.equal(primaryAccepted.idempotentReplay, false);
  let pollCount = 0;
  let runningReply;
  const primaryDeadline = Date.now() + 30_000;
  while (primaryTask.status !== 'succeeded' && Date.now() < primaryDeadline) {
    const before = mcpReplies().length;
    await runClient(endpoint, 'poll', `Poll task ${primaryTask.taskId} through MCP and retrieve its terminal result.`);
    pollCount++;
    for (const reply of mcpReplies().slice(before).filter(item => item.name === 'get_task_status')) {
      const status = replyPayload(reply);
      assert.equal(status.taskId, primaryTask.taskId, 'Status reply must correlate to the original submission');
      if (status.status === 'running') runningReply = status;
    }
    if (runningReply && !existsSync(primaryRelease)) writeFileSync(primaryRelease, 'release');
    primaryTask = taskRecordFor('b16-primary-task');
  }
  assert.equal(primaryTask.status, 'succeeded');
  assert.ok(runningReply, 'MCP must return a running status before the fixture worker is released');
  // A poll can observe running immediately before the worker commits success. Make
  // a final transport call after the durable terminal state to fetch its artifacts.
  const beforeFinalPoll = mcpReplies().length;
  const beforeFinalProviderRequest = requests.length;
  await runClient(endpoint, 'poll', `Retrieve the terminal result for task ${primaryTask.taskId} through MCP.`);
  pollCount++;
  const finalReplies = mcpReplies().slice(beforeFinalPoll);
  const finalStatus = replyPayload(finalReplies.find(reply => reply.name === 'get_task_status'));
  const finalResult = replyPayload(finalReplies.find(reply => reply.name === 'get_task_result'));
  assert.equal(finalStatus.taskId, primaryTask.taskId);
  assert.equal(finalStatus.status, 'succeeded');
  assert.ok(finalResult.diff.includes('+B16_FIXTURE_OUTPUT'));
  assert.ok(finalResult.changedFiles.includes('src/b16-output.txt'));
  assert.equal(finalResult.testRuns[0].command, 'verify B16 fixture output');
  assert.equal(finalResult.testRuns[0].exitCode, 0);
  const clientToolContext = requests.slice(beforeFinalProviderRequest)
    .flatMap(request => request.messages ?? [])
    .find(message => message.role === 'tool' && message.content.includes(primaryTask.taskId) &&
      message.content.includes('"status":"succeeded"'));
  assert.ok(clientToolContext, 'The pinned client must pass the correlated success reply into its provider context');
  assert.ok(clientToolContext.content.includes('+B16_FIXTURE_OUTPUT'));
  assert.ok(clientToolContext.content.includes('src/b16-output.txt'));
  assert.ok(clientToolContext.content.includes('"exitCode":0'));
  assert.equal(primaryTask.attempts.length, 1);
  assert.equal(primaryTask.artifact.testRuns[0].exitCode, 0);
  assert.ok(primaryTask.artifact.diff.includes('+B16_FIXTURE_OUTPUT'));
  assert.ok(primaryTask.artifact.changedFiles.includes('src/b16-output.txt'));
  assert.ok(pollCount > 0);

  // A distinct CLI process reconnects and repeats the exact request twice.
  const submitRepliesBeforeDuplicate = mcpReplies().filter(reply => reply.name === 'submit_task').length;
  await runClient(endpoint, 'duplicate', 'Reconnect and submit the identical B16 task twice.');
  const duplicateReplies = mcpReplies().filter(reply => reply.name === 'submit_task').slice(submitRepliesBeforeDuplicate);
  assert.equal(duplicateReplies.length, 2, 'Both reconnect submissions must return a transport response');
  for (const reply of duplicateReplies) {
    const duplicate = replyPayload(reply);
    assert.equal(duplicate.taskId, primaryAccepted.taskId, 'Reconnect must receive the original task ID');
    assert.equal(duplicate.idempotentReplay, true, 'Reconnect response must identify an idempotent replay');
  }
  const duplicateTask = taskRecordFor('b16-primary-task');
  assert.equal(duplicateTask.taskId, primaryTask.taskId);
  assert.equal(duplicateTask.attempts.length, 1);
  assert.equal(duplicateTask.attempts[0].workspace.taskId, primaryTask.taskId);
  assert.equal(readdirSync(join(stateHome, 'workspaces')).filter(name => !name.endsWith('.workspace.json')).length, 1,
    'Duplicate/reconnect must not create a second workspace');
  assert.equal(mcpCallNames().filter(name => name === 'submit_task').length, 3,
    'The primary submit plus both duplicate submissions must cross MCP transport');

  // Wait for worker-written evidence before cancelling so the gate must signal a live process.
  await runClient(endpoint, 'cancelSubmit', 'Submit a long-running fixture task.');
  const cancelTaskBefore = taskRecordFor('b16-cancel-task');
  assert.ok(cancelTaskBefore, 'Cancellation submit did not persist the task');
  await waitForFile(join(root, 'b16-cancel-task.started'));
  await waitForFile(join(cancelTaskBefore.attempts[0].workspace.workspacePath, 'src', 'b16-cancel-task.partial.txt'));
  assert.equal(taskRecordFor('b16-cancel-task').status, 'running');
  await runClient(endpoint, 'cancel', 'Submit a long-running fixture task and cancel it while running.');
  const cancelledTask = taskRecordFor('b16-cancel-task');
  const cancellationReplies = mcpReplies();
  const cancelAccepted = replyPayload(cancellationReplies.filter(reply => reply.name === 'submit_task').at(-1));
  const cancelResponse = replyPayload(cancellationReplies.filter(reply => reply.name === 'cancel_task').at(-1));
  const cancelStatus = replyPayload(cancellationReplies.filter(reply => reply.name === 'get_task_status').at(-1));
  assert.equal(cancelAccepted.taskId, cancelledTask.taskId);
  assert.equal(cancelResponse.status, 'blocked');
  assert.equal(cancelResponse.effect, 'requested');
  assert.equal(cancelStatus.taskId, cancelledTask.taskId);
  assert.equal(cancelStatus.status, 'blocked');
  assert.equal(cancelStatus.cancel.executionStopped, 'unknown');
  assert.equal(cancelStatus.block.reason, 'cancelled-uncertain');
  assert.equal(cancelledTask.status, 'blocked');
  assert.equal(cancelledTask.cancel.executionStopped, 'unknown');
  assert.ok(cancelledTask.cancel.requestedAt);
  assert.equal(cancelledTask.attempts.length, 1);
  const cancelWorkerPid = JSON.parse(readFileSync(join(root, 'b16-cancel-task.started'), 'utf8')).pid;
  await waitForExit(cancelWorkerPid);
  const cancelledWithArtifact = await waitForTask('b16-cancel-task', task => task.artifact?.diff?.includes('+PARTIAL_b16-cancel-task'));
  const cancelledWorkspace = cancelledTask.attempts[0].workspace.workspacePath;
  assert.ok(existsSync(join(cancelledWorkspace, 'src', 'b16-cancel-task.partial.txt')),
    'Worker-written partial output must survive active cancellation');
  assert.ok(cancelledWithArtifact.artifact.diff.includes('+PARTIAL_b16-cancel-task'),
    'Partial Git evidence must survive worker-root termination');

  // Cancellation deliberately halts its scheduler. Isolate interruption recovery in
  // a fresh home so the recovery path can prove it never dispatches the old attempt.
  const firstLockPath = join(stateHome, 'locks', 'service-owner.lock');
  const firstLock = JSON.parse(readFileSync(firstLockPath, 'utf8'));
  await stop(host.child); host = undefined;
  assert.equal(pidIsAlive(firstLock.pid), false, 'The first MCP service process must stop before handoff');
  unlinkSync(firstLockPath);
  stateHome = join(root, 'interrupt-state');
  env.AI_ORCHESTRATOR_HOME = stateHome;
  host = await startHost(endpoint);
  await runClient(endpoint, 'warmup', 'Start a fresh fixture task service for interruption testing.');
  await waitForMcp(host);

  // Submit an active task, kill the actual OpenCode host/MCP process tree, then reconnect.
  await runClient(endpoint, 'interruptSubmit', 'Submit a long-running task for host interruption recovery.');
  let interruptedTask = await waitForTask('b16-interrupt-task', task => task.status === 'running');
  await waitForFile(join(root, 'b16-interrupt-task.started'));
  assert.equal(interruptedTask.status, 'running', 'Interruption scenario must stop a running task');
  const interruptWorkspace = interruptedTask.attempts[0].workspace.workspacePath;
  await waitForFile(join(interruptWorkspace, 'src', 'b16-interrupt-task.partial.txt'));
  assert.ok(existsSync(join(interruptWorkspace, 'src', 'b16-interrupt-task.partial.txt')),
    'The worker must write partial output before host interruption');
  const interruptCount = readFileSync(workerCounter, 'utf8').split(/\r?\n/).filter(line => line === 'b16-interrupt-task').length;
  assert.equal(interruptCount, 1, 'The interruption worker must start once before restart');
  const lockPath = join(stateHome, 'locks', 'service-owner.lock');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  await stop(host.child); host = undefined;
  assert.equal(pidIsAlive(lock.pid), false, 'The interrupted MCP service process must be stopped');
  unlinkSync(lockPath); // fixture-only stale lock cleanup after proving its owning PID is dead
  host = await startHost(endpoint); // Dispatch remains enabled; startup must reconcile without replay.
  await runClient(endpoint, 'warmup', 'Reconnect the OpenCode host after service restart.');
  await waitForMcp(host);
  const beforeRecoveryPoll = mcpReplies().length;
  await runClient(endpoint, 'interruptPoll', `Reconnect after interruption and inspect task ${interruptedTask.taskId}.`);
  const recoveryReplies = mcpReplies().slice(beforeRecoveryPoll);
  const recoveryStatus = replyPayload(recoveryReplies.find(reply => reply.name === 'get_task_status'));
  const recoveryResult = replyPayload(recoveryReplies.find(reply => reply.name === 'get_task_result'));
  interruptedTask = taskRecordFor('b16-interrupt-task');
  assert.equal(recoveryStatus.taskId, interruptedTask.taskId);
  assert.equal(recoveryStatus.status, 'blocked');
  assert.equal(recoveryStatus.block.reason, 'service-restart');
  assert.equal(recoveryStatus.cancel.executionStopped, 'unknown');
  assert.equal(recoveryResult.taskId, interruptedTask.taskId);
  assert.equal(recoveryResult.status, 'blocked');
  assert.equal(recoveryResult.diff, null, 'Recovery must report absent artifact collection honestly');
  assert.equal(interruptedTask.status, 'blocked');
  assert.equal(interruptedTask.cancel.executionStopped, 'unknown');
  assert.equal(interruptedTask.attempts.length, 1, 'Recovery must never replay the dispatched attempt');
  assert.equal(interruptedTask.attempts[0].workspace.workspacePath, interruptWorkspace);
  assert.ok(existsSync(join(interruptWorkspace, 'src', 'b16-interrupt-task.partial.txt')),
    'Interrupted worker output must remain available after restart');
  const invocationCountAfterRecovery = readFileSync(workerCounter, 'utf8').split(/\r?\n/).filter(line => line === 'b16-interrupt-task').length;
  assert.equal(invocationCountAfterRecovery, 1, 'Dispatch-enabled recovery must not replay the interrupted worker');

  const names = mcpCallNames();
  for (const name of ['submit_task', 'get_task_status', 'get_task_result', 'cancel_task'])
    assert.ok(names.includes(name), `No real MCP tools/call observed for ${name}`);
  assert.equal(names.filter(name => name === 'submit_task').length, 5, 'Expected five deliberate submissions across all scenarios');
  assert.ok(!requests.some(request => JSON.stringify(request).includes(password) || JSON.stringify(request).includes(fixtureKey)),
    'Fixture credentials leaked to the provider');
  successResult = JSON.stringify({ version: '2.2.5', protocol: '2026-07-28', server: 'B16 task stdio',
    discovered: true, fourToolsCatalogued: true, transportCalls: names.length, submitPollResult: true,
    duplicateStableId: true, attempts: duplicateTask.attempts.length, workspacesForDuplicate: 1,
    cancellation: { status: cancelledTask.status, requested: true, stopped: cancelledTask.cancel.executionStopped },
    interruption: { status: interruptedTask.status, attempts: interruptedTask.attempts.length, preserved: true },
    unavailableHost: 'ENOENT diagnosed', taskId: primaryTask.taskId });
} catch (error) {
  gateFailure ??= error;
} finally {
  const cleanupErrors = [];
  if (host) try { await stop(host.child); } catch (error) { cleanupErrors.push(error); }
  for (const proc of hosts) {
    if (proc.child.exitCode !== null || proc.child.signalCode !== null) continue;
    try { await stop(proc.child); } catch (error) { cleanupErrors.push(error); }
  }
  if (provider) try { await new Promise((resolveClose, rejectClose) => provider.close(error => error ? rejectClose(error) : resolveClose())); }
    catch (error) { cleanupErrors.push(error); }
  if (!cleanupErrors.length && !process.env.B16_DEBUG) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { cleanupErrors.push(error); }
  } else if (existsSync(root)) console.error(`Temporary B16 fixture retained: ${root}`);
  if (cleanupErrors.length) {
    const details = cleanupErrors.map(error => `${error.name}: ${redact(error.message)}`).join('; ');
    gateFailure = new Error(gateFailure ? `B16 failure: ${redact(gateFailure.message)}; cleanup: ${details}` : `B16 cleanup failure: ${details}`);
  }
}
if (gateFailure) throw gateFailure;
console.log(successResult);

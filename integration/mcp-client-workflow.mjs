// Explicit opt-in: node integration/mcp-client-workflow.mjs /absolute/path/opencode.exe
// B16 acceptance through pinned OpenCode, real MCP stdio, service, and fixture workers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, unlinkSync, appendFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const root = mkdtempSync(join(tmpdir(), 'orchestrator-b16-'));
const work = join(root, 'repository'); mkdirSync(join(work, 'src'), { recursive: true });
let stateHome = join(root, 'state');
const configPath = join(root, 'service.json');
const callLog = join(root, 'mcp-calls.jsonl');
const password = 'b16-local-password';
const fixtureKey = 'b16-local-fixture-only';
const redact = value => String(value).replaceAll(password, '[redacted]').replaceAll(fixtureKey, '[redacted]');
const timeoutMs = Number(process.env.B16_TIMEOUT_MS ?? 120_000);
assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000,
  'B16_TIMEOUT_MS must be an integer from 1 to 120000');

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
});

execFileSync('git', ['init', work], { stdio: 'ignore', windowsHide: true });
execFileSync('git', ['-C', work, 'config', 'user.name', 'B16 Fixture'], { stdio: 'ignore', windowsHide: true });
execFileSync('git', ['-C', work, 'config', 'user.email', 'b16-fixture@example.invalid'], { stdio: 'ignore', windowsHide: true });
writeFileSync(join(work, 'README.md'), '# B16 MCP fixture\n');
writeFileSync(join(work, 'src', 'README.md'), 'Fixture source directory.\n');
execFileSync('git', ['-C', work, 'add', '.'], { stdio: 'ignore', windowsHide: true });
execFileSync('git', ['-C', work, 'commit', '-m', 'Initial fixture'], { stdio: 'ignore', windowsHide: true });
execFileSync('git', ['-C', work, 'branch', '-M', 'main'], { stdio: 'ignore', windowsHide: true });
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

function start(file, args, cwd) {
  const child = spawn(file, args, { cwd, env, windowsHide: true });
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

function mcpCallNames() {
  return readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).name);
}

let host;
let provider;
let gateFailure;
let successResult;
let mode = 'warmup';
const requests = [];
const observed = { submit: false, running: false, succeeded: false, duplicate: false, cancel: false, interrupted: false };
const generated = new Map();
const primary = requestFor('b16-primary-task', 'Create src/b16-output.txt with the fixture output and run the configured test.', 'task/b16-primary');
const cancelRequest = requestFor('b16-cancel-task', 'Exercise active cancellation without writing output.', 'task/b16-cancel');
const interruptRequest = requestFor('b16-interrupt-task', 'Exercise host interruption and conservative recovery.', 'task/b16-interrupt');

function codeFor(currentMode) {
  if (currentMode === 'submit') return `const accepted=await tools.orchestrator.submit_task(${JSON.stringify(primary)}); return JSON.stringify(accepted);`;
  if (currentMode === 'poll') return `const status=await tools.orchestrator.get_task_status({taskId:${JSON.stringify(taskRecordFor('b16-primary-task')?.taskId)}}); const result=status.resultAvailable?await tools.orchestrator.get_task_result({taskId:status.taskId,include:['diff','tests']}):null; return JSON.stringify({status,result});`;
  if (currentMode === 'duplicate') return `const request=${JSON.stringify(primary)}; const first=await tools.orchestrator.submit_task(request); const second=await tools.orchestrator.submit_task(request); const status=await tools.orchestrator.get_task_status({taskId:first.taskId}); return JSON.stringify({first,second,status});`;
  if (currentMode === 'cancel') return `const accepted=await tools.orchestrator.submit_task(${JSON.stringify(cancelRequest)}); let status; for(let i=0;i<100;i++){status=await tools.orchestrator.get_task_status({taskId:accepted.taskId}); if(status.status==='running') break;} const cancel=await tools.orchestrator.cancel_task({taskId:accepted.taskId,reason:'B16 active cancellation fixture'}); const after=await tools.orchestrator.get_task_status({taskId:accepted.taskId}); return JSON.stringify({accepted,status,cancel,after});`;
  if (currentMode === 'interruptSubmit') return `const accepted=await tools.orchestrator.submit_task(${JSON.stringify(interruptRequest)}); return JSON.stringify(accepted);`;
  if (currentMode === 'interruptPoll') return `const status=await tools.orchestrator.get_task_status({taskId:${JSON.stringify(taskRecordFor('b16-interrupt-task')?.taskId)}}); const result=status.resultAvailable?await tools.orchestrator.get_task_result({taskId:status.taskId,include:['diff','tests']}):null; return JSON.stringify({status,result});`;
  return undefined;
}

async function startHost(endpoint, recovery = false) {
  if (recovery) env.B16_RECOVERY = '1'; else delete env.B16_RECOVERY;
  const proc = start(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(new URL(endpoint).port), '--print-logs', '--log-level', 'info'], work);
  const deadline = Date.now() + 30_000;
  while (!proc.output().stdout.includes(`server listening on ${endpoint}`)) {
    if (proc.child.exitCode !== null) throw new Error(`OpenCode exited during startup: ${redact(proc.output().stderr)}`);
    if (Date.now() >= deadline) throw new Error(`OpenCode did not listen: ${redact(proc.output().stderr)}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  return proc;
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
      if (mode === 'submit' && context.includes('b16-primary-task')) observed.submit = true;
      if (mode === 'poll' && context.includes(taskRecordFor('b16-primary-task')?.taskId ?? '\0')) {
        observed.running ||= context.includes('running');
        if (context.includes('B16_FIXTURE_OUTPUT') && context.includes('succeeded')) observed.succeeded = true;
      }
      if (mode === 'duplicate' && context.includes('idempotentReplay') && context.includes('true')) observed.duplicate = true;
      if (mode === 'cancel' && context.includes('cancelRequestedAt') && context.includes('unknown')) observed.cancel = true;
      if (mode === 'interruptPoll' && context.includes('blocked') && context.includes('unknown')) observed.interrupted = true;

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
  let pollCount = 0;
  const primaryDeadline = Date.now() + 30_000;
  while (primaryTask.status !== 'succeeded' && Date.now() < primaryDeadline) {
    await runClient(endpoint, 'poll', `Poll task ${primaryTask.taskId} through MCP and retrieve its terminal result.`);
    pollCount++;
    primaryTask = taskRecordFor('b16-primary-task');
  }
  assert.equal(primaryTask.status, 'succeeded');
  // A poll can observe running immediately before the worker commits success. Make
  // a final transport call after the durable terminal state to fetch its artifacts.
  await runClient(endpoint, 'poll', `Retrieve the terminal result for task ${primaryTask.taskId} through MCP.`);
  pollCount++;
  assert.equal(primaryTask.attempts.length, 1);
  assert.equal(primaryTask.artifact.testRuns[0].exitCode, 0);
  assert.ok(primaryTask.artifact.diff.includes('+B16_FIXTURE_OUTPUT'));
  assert.ok(primaryTask.artifact.changedFiles.includes('src/b16-output.txt'));
  assert.ok(observed.submit && observed.running && observed.succeeded,
    `Client context did not show submit/running/result: ${JSON.stringify(observed)}`);
  assert.ok(pollCount > 0);

  // A distinct CLI process reconnects and repeats the exact request twice.
  await runClient(endpoint, 'duplicate', 'Reconnect and submit the identical B16 task twice.');
  const duplicateTask = taskRecordFor('b16-primary-task');
  assert.equal(duplicateTask.taskId, primaryTask.taskId);
  assert.equal(duplicateTask.attempts.length, 1);
  assert.equal(duplicateTask.attempts[0].workspace.taskId, primaryTask.taskId);
  assert.equal(readdirSync(join(stateHome, 'workspaces')).filter(name => !name.endsWith('.workspace.json')).length, 1,
    'Duplicate/reconnect must not create a second workspace');
  assert.ok(observed.duplicate, 'Duplicate replay result did not return to the pinned client context');
  assert.equal(mcpCallNames().filter(name => name === 'submit_task').length, 3,
    'The primary submit plus both duplicate submissions must cross MCP transport');

  // The worker advertises a 30-second fixture delay, so cancel must target an active attempt.
  await runClient(endpoint, 'cancel', 'Submit a long-running fixture task and cancel it while running.');
  const cancelledTask = taskRecordFor('b16-cancel-task');
  assert.equal(cancelledTask.status, 'blocked');
  assert.equal(cancelledTask.cancel.executionStopped, 'unknown');
  assert.ok(cancelledTask.cancel.requestedAt);
  assert.equal(cancelledTask.attempts.length, 1);
  assert.ok(cancelledTask.attempts[0].workspace && existsSync(cancelledTask.attempts[0].workspace.workspacePath),
    'Uncertain cancelled workspace must be preserved');
  assert.ok(observed.cancel, 'Cancellation request and unknown stop evidence did not reach the client context');

  // Cancellation deliberately halts the scheduler. Isolate host-interruption recovery
  // in a fresh task home so the service's safety stop does not prevent a new dispatch.
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
  let interruptedTask = taskRecordFor('b16-interrupt-task');
  const runningDeadline = Date.now() + 5000;
  while (interruptedTask.status !== 'running' && Date.now() < runningDeadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
    interruptedTask = taskRecordFor('b16-interrupt-task');
  }
  assert.equal(interruptedTask.status, 'running', 'Interruption scenario must stop a running task');
  const lockPath = join(stateHome, 'locks', 'service-owner.lock');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  await stop(host.child); host = undefined;
  assert.equal(pidIsAlive(lock.pid), false, 'The interrupted MCP service process must be stopped');
  unlinkSync(lockPath); // fixture-only stale lock cleanup after proving its owning PID is dead
  host = await startHost(endpoint, true); // recovery service starts without a worker and reconciles uncertainty
  await runClient(endpoint, 'warmup', 'Reconnect the OpenCode host after service restart.');
  await waitForMcp(host);
  await runClient(endpoint, 'interruptPoll', `Reconnect after interruption and inspect task ${interruptedTask.taskId}.`);
  interruptedTask = taskRecordFor('b16-interrupt-task');
  assert.equal(interruptedTask.status, 'blocked');
  assert.equal(interruptedTask.cancel.executionStopped, 'unknown');
  assert.equal(interruptedTask.attempts.length, 1, 'Recovery must never replay the dispatched attempt');
  assert.ok(existsSync(interruptedTask.attempts[0].workspace.workspacePath), 'Interrupted workspace evidence must be preserved');
  assert.ok(observed.interrupted, 'Recovered blocked state did not reach the client through MCP');

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

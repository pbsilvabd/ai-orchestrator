// Explicit opt-in: node integration/mcp-task-gate.mjs /absolute/path/opencode.exe
// Exercises the actual B15 task server through the pinned OpenCode 2.2.5 MCP client
// with a local fixture provider. No real model or paid API is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const root = mkdtempSync(join(tmpdir(), 'orchestrator-mcp-task-'));
const work = join(root, 'repository'); mkdirSync(work);
const stateHome = join(root, 'state');
const configPath = join(root, 'service.json');
const password = 'b15-local-password';
const fixtureKey = 'b15-local-fixture-only';
const redact = value => String(value).replaceAll(password, '[redacted]').replaceAll(fixtureKey, '[redacted]');
const timeoutMs = Number(process.env.MCP_TASK_GATE_TIMEOUT_MS ?? 120_000);
assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000,
  'MCP_TASK_GATE_TIMEOUT_MS must be an integer from 1 to 120000');

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
  AI_ORCHESTRATOR_HOME: stateHome,
  AI_ORCHESTRATOR_CONFIG: configPath,
});

execFileSync('git', ['init', work], { stdio: 'ignore', windowsHide: true });
execFileSync('git', ['-C', work, 'config', 'user.name', 'B15 Fixture'], { stdio: 'ignore', windowsHide: true });
execFileSync('git', ['-C', work, 'config', 'user.email', 'b15-fixture@example.invalid'], { stdio: 'ignore', windowsHide: true });
writeFileSync(join(work, 'README.md'), '# B15 MCP fixture\n');
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
  const shutdownEnv = { ...env, AI_ORCHESTRATOR_HOME: shutdownHome };
  const child = spawn(process.execPath, [resolve('mcp-server.mjs')], { cwd: work, env: shutdownEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
    function finish(closed) {
      clearTimeout(timer);
      child.off('close', onClose);
      resolveClose(closed);
    }
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
    if (code !== 0) throw new Error('taskkill failed to stop OpenCode');
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
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      resolveRun({ code, ...output() });
    });
  });
}

let host;
let server;
let gateFailure;
let successResult;
const requests = [];
let taskCallSent = false;
let taskResultObserved = false;
let taskProbeEnabled = false;

try {
  await verifyGracefulStdioShutdown();
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    try {
      assert.equal(req.url, '/v1/chat/completions');
      const input = JSON.parse(body);
      requests.push(input);
      const context = JSON.stringify(input);
      const catalogued = ['submit_task', 'get_task_status', 'get_task_result', 'cancel_task']
        .every(name => context.includes(`tools.orchestrator.${name}`));
      taskResultObserved ||= taskCallSent && context.includes('queued') && /taskId.{0,30}[a-f0-9-]{36}/.test(context);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({
        id: 'b15-fixture-response', object: 'chat.completion.chunk', created: 0, model: input.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`;
      if (catalogued && taskProbeEnabled && !taskCallSent && !taskResultObserved) {
        taskCallSent = true;
        const branch = `task/b15-host-${process.pid}`;
        const task = {
          idempotencyKey: `b15-host-${process.pid}`,
          clientId: 'opencode-primary',
          objective: 'Verify the B15 MCP stdio adapter using the pinned OpenCode client.',
          acceptanceCriteria: ['The task is accepted and remains queued.'],
          repository: { path: work, baseRef: 'main', branch },
          authorization: { models: ['fixture/mock'], tools: ['read', 'edit'], writablePaths: ['src'] },
          limits: { maxAttempts: 1, budgetMs: 60_000, maxOutputBytes: 65_536 },
        };
        assert.ok((input.tools ?? []).some(tool => tool.function?.name === 'execute'), 'OpenCode did not expose Code Mode execute');
        const code = `const result = await tools.orchestrator.submit_task(${JSON.stringify(task)}); return JSON.stringify(result);`;
        res.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'b15-task-call', type: 'function',
          function: { name: 'execute', arguments: JSON.stringify({ code }) },
        }] }) + frame({}, 'tool_calls') + 'data: [DONE]\n\n');
      } else if (taskResultObserved) {
        res.end(frame({ role: 'assistant', content: 'mcp-task-result-ok' }) + frame({}, 'stop') + 'data: [DONE]\n\n');
      } else {
        res.end(frame({ role: 'assistant', content: taskProbeEnabled ? 'waiting-for-task-result' : 'warm-up-ok' }) + frame({}, 'stop') + 'data: [DONE]\n\n');
      }
    } catch (error) {
      res.writeHead(400); res.end('invalid local fixture request');
      gateFailure ??= error;
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = {
    update: 'disable', share: 'disabled', model: 'fixture/mock',
    permissions: [{ action: '*', resource: '*', effect: 'allow' }],
    mcp: { servers: { orchestrator: { type: 'local', command: [process.execPath, resolve('mcp-server.mjs')], protocol: '2026-07-28' } } },
    providers: { fixture: { name: 'B15 local fixture', env: ['FIXTURE_API_KEY'], package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${server.address().port}/v1` },
      models: { mock: { name: 'mock', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 1000 } } },
    } },
  };
  writeFileSync(join(root, 'opencode.json'), JSON.stringify(config));
  env.OPENCODE_CONFIG = join(root, 'opencode.json');
  env.OPENCODE_MODELS_PATH = join(root, 'models.json');
  writeFileSync(env.OPENCODE_MODELS_PATH, '{}');

  const version = await run(binary, ['--version'], work, 60_000);
  assert.equal(version.code, 0, redact(version.stderr));
  assert.equal(version.stdout.trim(), 'opencode v2.2.5');

  const port = await new Promise((resolvePort, rejectPort) => {
    const probe = createServer(); probe.on('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolvePort(value)); });
  });
  const endpoint = `http://127.0.0.1:${port}`;
  host = start(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port), '--print-logs', '--log-level', 'info'], work);
  const deadline = Date.now() + 30_000;
  while (!host.output().stdout.includes(`server listening on ${endpoint}`)) {
    if (host.child.exitCode !== null) throw new Error(`OpenCode exited: ${redact(host.output().stderr)}`);
    if (Date.now() >= deadline) throw new Error(`OpenCode did not listen: ${redact(host.output().stderr)}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }

  const warm = await run(binary, ['run', '--server', endpoint, '--format', 'json', '--model', 'fixture/mock', 'Say hello briefly.'], work);
  assert.equal(warm.code, 0, redact(warm.stderr + warm.stdout));
  assert.ok(warm.stdout.includes('warm-up-ok'), redact(warm.stderr + warm.stdout));
  taskProbeEnabled = true;

  const connectDeadline = Date.now() + 30_000;
  while (!`${host.output().stdout}\n${host.output().stderr}`.includes('server=orchestrator tools=4')) {
    if (Date.now() >= connectDeadline) throw new Error(`Task MCP server did not connect: ${redact(host.output().stderr)}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }

  const call = await run(binary, ['run', '--server', endpoint, '--format', 'json', '--model', 'fixture/mock',
    'Submit the B15 MCP integration task once and report its queued task ID.'], work);
  assert.equal(call.code, 0, redact(call.stderr + call.stdout));
  assert.ok(call.stdout.includes('mcp-task-result-ok'), redact(call.stderr + call.stdout));
  assert.ok(taskCallSent && taskResultObserved, 'Provider did not observe the submitted task result in model context');

  const taskFiles = readdirSync(join(stateHome, 'tasks')).filter(name => name.endsWith('.json'));
  assert.equal(taskFiles.length, 1, 'Expected exactly one persisted task from the host tool call');
  const record = JSON.parse(readFileSync(join(stateHome, 'tasks', taskFiles[0]), 'utf8'));
  assert.equal(record.status, 'queued');
  assert.equal(record.clientId, 'opencode-primary');
  assert.equal(record.request.repository.branch, `task/b15-host-${process.pid}`);
  assert.ok(existsSync(join(stateHome, 'locks', 'service-owner.lock')), 'Service ownership lock should remain while host is connected');
  assert.ok(!requests.some(request => JSON.stringify(request).includes(password) || JSON.stringify(request).includes(fixtureKey)),
    'Fixture credentials leaked to the provider');

  successResult = JSON.stringify({ version: '2.2.5', protocol: '2026-07-28', server: 'B15 task stdio',
    discovered: true, fourToolsCatalogued: true, submitCalled: true, queuedResultObserved: true,
    persistedClientId: record.clientId, taskId: record.taskId });
} catch (error) {
  gateFailure ??= error;
} finally {
  const cleanupErrors = [];
  if (host) try { await stop(host.child); } catch (error) { cleanupErrors.push(error); }
  if (server) try { await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())); }
    catch (error) { cleanupErrors.push(error); }
  if (!cleanupErrors.length && !process.env.MCP_TASK_GATE_DEBUG) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { cleanupErrors.push(error); }
  } else if (existsSync(root)) console.error(`Temporary task gate retained: ${root}`);
  if (cleanupErrors.length) {
    const details = cleanupErrors.map(error => `${error.name}: ${redact(error.message)}`).join('; ');
    gateFailure = new Error(gateFailure ? `Gate failure: ${redact(gateFailure.message)}; cleanup: ${details}` : `Gate cleanup failure: ${details}`);
  }
}
if (gateFailure) throw gateFailure;
console.log(successResult);

// Explicit opt-in: node integration/mcp-gate.mjs /absolute/path/to/opencode.exe
// Proves the pinned host can run a local stdio MCP server over revision 2026-07-28,
// list its tools, reach them from the model and complete one tools/call.
//
// OpenCode boots MCP servers asynchronously, so a single `run` may snapshot the tool
// registry before the server connects. This harness starts a persistent server,
// warms the Location with one prompt, waits for the connection log, then sends the
// probe prompt, mirroring a user who sends a message after the app has settled.
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const fixture = resolve('integration/mcp-fixture.mjs');
const password = 'gate-local-password';
const fixtureKey = 'local-fixture-only';
const redact = value => String(value).replaceAll(password, '[redacted]').replaceAll(fixtureKey, '[redacted]');
const commandTimeout = Number(process.env.MCP_GATE_COMMAND_TIMEOUT_MS ?? 120_000);
const readinessTimeout = Number(process.env.MCP_GATE_READINESS_TIMEOUT_MS ?? 30_000);
assert.ok(Number.isInteger(commandTimeout) && commandTimeout >= 1 && commandTimeout <= 120_000,
  'MCP_GATE_COMMAND_TIMEOUT_MS must be an integer from 1 to 120000');
assert.ok(Number.isInteger(readinessTimeout) && readinessTimeout >= 1 && readinessTimeout <= 30_000,
  'MCP_GATE_READINESS_TIMEOUT_MS must be an integer from 1 to 30000');
const root = mkdtempSync(join(tmpdir(), 'orchestrator-mcp-gate-'));
const work = join(root, 'work'); mkdirSync(work);
const mcpLog = join(root, 'mcp.jsonl');
const mcpCalls = join(root, 'calls.jsonl');
let currentPhase = 'startup';
let cleanupPhase = 'pending';
let cleanupStatus = 'pending';
let phaseWriteFailure = null;
function writePhaseMetadata() {
  if (process.env.MCP_GATE_PHASE_FILE) try {
    writeFileSync(process.env.MCP_GATE_PHASE_FILE, JSON.stringify({
      phase: currentPhase, cleanupPhase, cleanupStatus,
    }), { flag: 'w' });
  } catch (failure) { phaseWriteFailure ??= failure; }
}
function setPhase(value) { currentPhase = value; writePhaseMetadata(); }

const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC'])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  HOME: root, USERPROFILE: root, TEMP: root, TMP: root,
  XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'),
  APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
  OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_PASSWORD: password,
  OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_FILEWATCHER: '1',
  FIXTURE_API_KEY: fixtureKey,
  MCP_FIXTURE_LOG: mcpLog, MCP_FIXTURE_CALLS: mcpCalls,
});

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

function start(file, args, cwd) {
  const child = spawn(file, args, { cwd, env, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  return { child, output: () => ({ stdout, stderr }) };
}

function waitForClose(child, timeout = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolveClose => {
    const timer = setTimeout(() => finish(false), timeout);
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
    const killed = await new Promise((resolveKill, rejectKill) => {
      const timer = setTimeout(() => rejectKill(new Error('taskkill timed out')), 5_000);
      killer.once('error', error => { clearTimeout(timer); rejectKill(error); });
      killer.once('close', code => { clearTimeout(timer); resolveKill(code === 0); });
    });
    if (!killed) throw new Error('taskkill failed to stop the host process tree');
  } else if (!child.kill('SIGKILL')) {
    throw new Error('Could not signal the host process');
  }
  if (!await waitForClose(child)) throw new Error('Host process did not close within 5 seconds');
}

function run(file, args, cwd, timeout = 120_000) {
  const { child, output } = start(file, args, cwd);
  child.stdin.end(); // Non-interactive runs read stdin to EOF before submitting.
  return new Promise((resolveResult, reject) => {
    let timedOut = false;
    let settled = false;
    const finish = (failure, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolveResult(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      // A descendant can inherit the pipes after the root process exits. In that
      // case Node may never emit `close`, so the timeout must settle independently.
      stop(child).then(() => finish(
        new Error(`Timed out: ${args.join(' ')}\n${redact(output().stderr)}`),
      ), cleanup => finish(new Error(
        `Timed out: ${args.join(' ')}; cleanup failed: ${redact(cleanup.message)}\n${redact(output().stderr)}`,
      ))).finally(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
        child.unref();
      });
    }, timeout);
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (timedOut) {
        finish(new Error(`Timed out: ${args.join(' ')}\n${redact(output().stderr)}`));
      } else finish(null, { code, ...output() });
    });
  });
}

const requests = [];
let called = false;
let gateFailure;
const server = createHttpServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  try {
    assert.equal(req.url, '/v1/chat/completions');
    const input = JSON.parse(body);
    requests.push(input);
    const exposed = (input.tools ?? []).map(tool => tool.function?.name).filter(Boolean);
    const context = JSON.stringify(input);
    const catalogued = context.includes('tools.orchestrator.probe_echo');
    const hasProbeResult = context.includes('probe:GATE_FIXTURE');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({
      id: 'fixture-response', object: 'chat.completion.chunk', created: 0, model: input.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    if (catalogued && !called && !hasProbeResult) {
      called = true;
      assert.ok(exposed.includes('execute'), 'Host did not expose the Code Mode execute tool');
      res.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call', type: 'function',
        function: { name: 'execute', arguments: JSON.stringify({
          code: "const result = await tools.orchestrator.probe_echo({ message: 'GATE_FIXTURE' }); return result;",
        }) },
      }] }) + frame({}, 'tool_calls') + 'data: [DONE]\n\n');
    } else res.end(frame({ role: 'assistant', content: catalogued ? 'gate-ok' : 'warm-up-ok' }) + frame({}, 'stop') + 'data: [DONE]\n\n');
  } catch (failure) { res.writeHead(400); res.end(`invalid fixture request: ${failure.message}`); }
});

let host;
let successResult;
try {
  setPhase('fixture-start');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = {
    update: 'disable', share: 'disabled', model: 'fixture/mock',
    permissions: [{ action: '*', resource: '*', effect: 'allow' }],
    mcp: { servers: { orchestrator: {
      type: 'local', command: [process.execPath, fixture], protocol: '2026-07-28',
    } } },
    providers: { fixture: { name: 'Local fixture', env: ['FIXTURE_API_KEY'],
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${server.address().port}/v1` },
      models: { mock: { name: 'mock', capabilities: { tools: true, input: ['text'], output: ['text'] },
        limit: { context: 32000, output: 1000 } } },
    } },
  };
  writeFileSync(join(root, 'opencode.json'), JSON.stringify(config));
  env.OPENCODE_CONFIG = join(root, 'opencode.json');
  env.OPENCODE_MODELS_PATH = join(root, 'models.json');
  writeFileSync(env.OPENCODE_MODELS_PATH, '{}');

  setPhase('version');
  const version = await run(binary, ['--version'], work, Math.min(commandTimeout, 60_000));
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), 'opencode v2.2.5');

  setPhase('host-start');
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  host = start(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port),
    '--print-logs', '--log-level', 'info'], work);
  const listenDeadline = Date.now() + readinessTimeout;
  for (;;) {
    if (host.output().stdout.includes(`server listening on ${endpoint}`)) break;
    if (host.child.exitCode !== null) throw new Error(`Host exited early: ${host.output().stderr}`);
    if (Date.now() >= listenDeadline) throw new Error(`Host did not listen on ${endpoint}: ${host.output().stderr}`);
    await new Promise(wait => setTimeout(wait, 100));
  }

  setPhase('warmup');
  const warm = await run(binary, ['run', '--server', endpoint, '--format', 'json', '--model', 'fixture/mock',
    'Say hello briefly.'], work, commandTimeout);
  assert.equal(warm.code, 0, warm.stderr + warm.stdout);
  assert.ok(warm.stdout.includes('warm-up-ok'), warm.stderr + warm.stdout);

  setPhase('mcp-readiness');
  const connectDeadline = Date.now() + readinessTimeout;
  for (;;) {
    const logs = `${host.output().stdout}\n${host.output().stderr}`;
    if (logs.includes('message="mcp connected"') && logs.includes('server=orchestrator tools=1')) break;
    if (Date.now() >= connectDeadline) throw new Error(`MCP server did not connect: ${host.output().stderr}`);
    await new Promise(wait => setTimeout(wait, 100));
  }

  setPhase('probe');
  if (process.env.MCP_GATE_PHASE_FILE && process.env.MCP_GATE_INJECT_FAILURE_PHASE === 'probe')
    throw new Error('Injected B19 diagnostic failure at probe phase');
  const probe = await run(binary, ['run', '--server', endpoint, '--format', 'json', '--model', 'fixture/mock',
    'Call the probe tool once with message GATE_FIXTURE.'], work, commandTimeout);
  assert.equal(probe.code, 0, probe.stderr + probe.stdout);
  assert.ok(probe.stdout.includes('gate-ok'), probe.stderr + probe.stdout);

  if (process.env.MCP_GATE_DEBUG) {
    console.error('host stdout:', host.output().stdout.slice(-4000));
    console.error('host stderr:', host.output().stderr.slice(-4000));
    console.error('probe stdout:', probe.stdout.slice(0, 4000));
    console.error('probe stderr:', probe.stderr.slice(0, 3000));
    console.error('tools per request:', JSON.stringify(requests.map(r => (r.tools ?? []).map(t => t.function?.name))));
    writeFileSync(join(root, 'requests.json'), JSON.stringify(requests, null, 2));
    console.error('mcp transcript:', existsSync(mcpLog) ? readFileSync(mcpLog, 'utf8').slice(0, 4000) : '(no log)');
    console.error('mcpcalls:', existsSync(mcpCalls) ? readFileSync(mcpCalls, 'utf8') : '(no calls)');
  }

  assert.ok(requests.some(request => JSON.stringify(request).includes('tools.orchestrator.probe_echo')),
    'Host did not advertise the MCP tool to the model');
  assert.ok(existsSync(mcpCalls), 'MCP server received no tool call');
  const calls = readFileSync(mcpCalls, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, 'GATE_FIXTURE');

  const transcript = readFileSync(mcpLog, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const methods = transcript.filter(entry => entry.direction === 'in').map(entry => entry.message.method);
  for (const method of ['server/discover', 'tools/list', 'tools/call']) assert.ok(methods.includes(method), `Missing ${method}`);
  const versions = transcript.filter(entry => entry.direction === 'in' && entry.message.method)
    .map(entry => entry.message.params?._meta?.['io.modelcontextprotocol/protocolVersion']);
  assert.ok(versions.length > 0 && versions.every(value => value === '2026-07-28'), `Unexpected protocol versions: ${versions}`);
  assert.ok(requests.some(request => JSON.stringify(request).includes('probe:GATE_FIXTURE')),
    'Tool result did not reach the model context');
  assert.ok(!transcript.some(entry => entry.message?.method === 'initialize'), 'Host used the legacy handshake');

  successResult = JSON.stringify({
    version: '2.2.5', protocol: '2026-07-28', server: 'local stdio', transport: 'codemode execute',
    discovered: true, catalogued: true, called: true, resultInContext: true, legacyHandshake: false,
    providerRequests: requests.length,
  });
} catch (failure) {
  gateFailure = failure;
} finally {
  if (gateFailure) currentPhase = `failure:${currentPhase}`;
  cleanupPhase = 'cleanup';
  writePhaseMetadata();
  const cleanupFailures = [];
  if (host) try { await stop(host.child); } catch (failure) { cleanupFailures.push(failure); }
  try {
    const closed = new Promise((resolveClose, rejectClose) => {
      server.close(error => error ? rejectClose(error) : resolveClose());
      server.closeAllConnections();
    });
    await closed;
  } catch (failure) { cleanupFailures.push(failure); }
  if (process.env.MCP_GATE_FORCE_CLEANUP_ERROR === '1') {
    cleanupFailures.push(new Error('Forced cleanup failure fixture; temporary root retained'));
  } else if (!cleanupFailures.length && !process.env.MCP_GATE_DEBUG) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (failure) { cleanupFailures.push(failure); }
  }
  cleanupStatus = cleanupFailures.length ? 'failed' : (process.env.MCP_GATE_DEBUG ? 'retained_debug' : 'complete');
  writePhaseMetadata();

  if (cleanupFailures.length) {
    if (existsSync(root)) console.error(`Temporary fixture retained for diagnosis: ${root}`);
    const cleanupMessage = cleanupFailures.map(failure => `${failure.name}: ${failure.message}`).join('; ');
    if (gateFailure) {
      const original = redact(`${gateFailure.name}: ${gateFailure.message}`);
      gateFailure = new Error(`Gate failure preserved: ${original}; cleanup failure: ${redact(cleanupMessage)}`);
    } else gateFailure = new Error(`Gate cleanup failed: ${redact(cleanupMessage)}`);
  }
  if (phaseWriteFailure) {
    const detail = phaseWriteFailure.code ?? 'unknown';
    gateFailure = gateFailure
      ? new Error(`Gate failure preserved: ${redact(`${gateFailure.name}: ${gateFailure.message}`)}; phase marker write failed: ${detail}`)
      : new Error(`Phase marker write failed: ${detail}`);
  }
  if (process.env.MCP_GATE_DEBUG && existsSync(root)) console.error(`Temporary fixture retained for diagnosis: ${root}`);
}
if (gateFailure) throw gateFailure;
console.log(successResult);

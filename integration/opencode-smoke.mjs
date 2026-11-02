// Explicit opt-in: node integration/opencode-smoke.mjs /absolute/path/to/opencode.exe
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const root = mkdtempSync(join(tmpdir(), 'orchestrator-opencode-'));
const work = join(root, 'work'); mkdirSync(work);
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC'])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  HOME: root, USERPROFILE: root, TEMP: root, TMP: root,
  XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'),
  APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
  OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_FILEWATCHER: '1', FIXTURE_API_KEY: 'local-fixture-only',
});
function command(args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { cwd: work, env, windowsHide: true });
    // Non-interactive `run` reads stdin to EOF even when a message argument exists.
    child.stdin.end();
    let stdout = '', stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill();
    }, 45_000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`OpenCode smoke timed out: ${stderr}\n${stdout}`));
      else resolveResult({ code, stdout, stderr });
    });
  });
}
const requests = [];
let attemptedWrite = false;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  try {
    assert.equal(req.url, '/v1/chat/completions');
    const input = JSON.parse(body);
    requests.push(input);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({
      id: 'fixture-response', object: 'chat.completion.chunk', created: 0, model: input.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    if (input.model === 'mock-b' && !attemptedWrite && JSON.stringify(input.messages).includes('BETA_FIXTURE')) {
      attemptedWrite = true;
      res.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-write', type: 'function',
        function: { name: 'write', arguments: JSON.stringify({ path: join(work, 'must-not-exist.txt'), content: 'DENIED_FIXTURE' }) },
      }] }) + frame({}, 'tool_calls') + 'data: [DONE]\n\n');
    } else res.end(frame({ role: 'assistant', content: 'fixture-ok' }) + frame({}, 'stop') + 'data: [DONE]\n\n');
  } catch { res.writeHead(400); res.end('invalid fixture request'); }
});
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = {
    update: 'disable', share: 'disabled', model: 'fixture/mock',
    permissions: [{ action: '*', resource: '*', effect: 'deny' }],
    providers: { fixture: { name: 'Local fixture', env: ['FIXTURE_API_KEY'],
      package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: `http://127.0.0.1:${server.address().port}/v1` },
      models: Object.fromEntries(['mock', 'mock-b'].map(name => [name, {
        name, capabilities: { tools: true, input: ['text'], output: ['text'] },
        limit: { context: 32000, output: 1000 },
      }])),
    } },
  };
  const configPath = join(root, 'opencode.json'); writeFileSync(configPath, JSON.stringify(config));
  env.OPENCODE_CONFIG = configPath;
  // Fixture defines its only model; avoid loading the external/bundled provider catalog.
  env.OPENCODE_MODELS_PATH = join(root, 'models.json');
  writeFileSync(env.OPENCODE_MODELS_PATH, '{}');
  const version = await command(['--version']);
  assert.equal(version.code, 0, version.stderr);
  assert.match(version.stdout.trim(), /^(opencode v)?2\.2\.5$/);
  const first = await command(['run', '--standalone', '--print-logs', '--log-level', 'debug', '--format', 'json', '--model', 'fixture/mock', 'Remember marker ALPHA_FIXTURE.']);
  assert.equal(first.code, 0, first.stderr + first.stdout);
  assert.ok(first.stdout.includes('fixture-ok'), first.stderr + first.stdout);
  const events = first.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const session = events.find(event => event.sessionID)?.sessionID;
  assert.ok(session, 'Missing session ID');
  const second = await command(['run', '--standalone', '--format', 'json', '--session', session,
    '--model', 'fixture/mock-b', 'Continue marker BETA_FIXTURE.']);
  assert.equal(second.code, 0, second.stderr + second.stdout);
  assert.ok(second.stdout.includes('fixture-ok'), second.stderr + second.stdout);
  assert.ok(requests.some(request => {
    const messages = JSON.stringify(request.messages);
    return messages.includes('ALPHA_FIXTURE') && messages.includes('BETA_FIXTURE') && messages.includes('fixture-ok');
  }), 'Host did not preserve prior user/assistant context');
  assert.ok(second.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line)).every(event => event.sessionID === session));
  assert.ok(attemptedWrite, 'Fixture did not attempt the denied write');
  assert.equal(existsSync(join(work, 'must-not-exist.txt')), false);
  assert.ok(/denied|reject|not allowed|not available/i.test(second.stdout), second.stdout);
  console.log(JSON.stringify({ version: '2.2.5', prompts: 2, sameSession: true, contextPreserved: true,
    modelSwitch: true, deniedWrite: true, requests: requests.length, fallbackValidated: false }));
} finally {
  const closed = new Promise(resolveClose => server.close(resolveClose)); server.closeAllConnections(); await closed;
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.error(`Temporary fixture retained for diagnosis: ${root}`); }
}

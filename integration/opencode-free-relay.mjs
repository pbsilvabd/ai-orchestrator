// Explicit opt-in: node integration/opencode-free-relay.mjs /absolute/path/opencode.exe
// B30 pinned-host-through-relay harness. It runs the pinned OpenCode 2.2.5 free route
// through the service-owned relay and L7 egress gateway against loopback fixtures only.
// The metadata is a local copy of the public shape, never fetched; the free endpoint,
// paid providers and every external host are not contacted. This is not live-provider or
// availability evidence. The B29 307 leak (host follows the redirect and sends the prompt
// body to the alternate origin) is the baseline this harness must turn into a terminal
// failed task with zero alternate-origin bytes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FREE_ENDPOINT, FREE_MODEL, FREE_MODEL_ID, FREE_PACKAGE, FREE_MAX_REQUESTS,
  freeRequestHash } from '../src/free-provider.mjs';
import { createConfiguredTaskService } from '../src/configured-service.mjs';
import { createRelay } from '../src/relay.mjs';
import { createEgressGateway } from '../src/egress-gateway.mjs';

const PATH = '/v1/chat/completions';
const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const root = mkdtempSync(join(tmpdir(), 'orchestrator-b30-relay-'));
const repositoryPath = join(root, 'repository');
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
gitEnvironment.GIT_CONFIG_NOSYSTEM = '1';
gitEnvironment.GIT_CONFIG_GLOBAL = join(root, 'empty-gitconfig');
writeFileSync(gitEnvironment.GIT_CONFIG_GLOBAL, '');
const git = (...args) => execFileSync('git', args, { cwd: repositoryPath, env: gitEnvironment,
  encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).trim();
const hostEnvironment = {};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC']) {
  if (process.env[key]) hostEnvironment[key] = process.env[key];
}
// Hostile ambient authority: must never reach the worker launch environment.
const ambientConfig = join(root, 'ambient-opencode.json');
writeFileSync(ambientConfig, JSON.stringify({ plugins: ['ambient-sentinel-plugin'], model: 'opencode/paid-ambient' }));
const originalAmbient = Object.fromEntries(['OPENCODE_API_KEY', 'OPENCODE_CONFIG'].map(key => [key, process.env[key]]));
process.env.OPENCODE_API_KEY = 'FAKE_NOT_A_REAL_KEY';
process.env.OPENCODE_CONFIG = ambientConfig;

const relayLimits = { maxRequests: FREE_MAX_REQUESTS, maxRequestBytes: 1_048_576,
  maxResponseBytes: 1_048_576, timeoutMs: 120_000 };

let state;
const redirectRecords = [];
const frame = (input, delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'b30-relay-fixture',
  object: 'chat.completion.chunk', created: 0, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;

// Fixture origin (reached only through the gateway/relay). Records method/headers for the
// WebSocket/upgrade negative check.
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const record = { method: req.method, url: req.url, authorization: req.headers.authorization ?? null,
    upgrade: req.headers.upgrade ?? null, body };
  state.records.push(record);
  let input;
  try { input = JSON.parse(body); } catch { state.anomalies++; res.writeHead(400); res.end(); return; }
  if (req.method !== 'POST' || req.url !== PATH) { state.anomalies++; res.writeHead(404); res.end(); return; }
  if (record.authorization !== 'Bearer public' || input.model !== FREE_MODEL_ID) state.anomalies++;
  if (record.upgrade !== undefined && record.upgrade !== null) state.anomalies++;
  if (state.records.length > FREE_MAX_REQUESTS) { state.anomalies++; res.writeHead(429); res.end(); return; }
  if (state.mode === 'redirect') {
    res.writeHead(state.redirectStatus, { location: `http://127.0.0.1:${redirectPort}${PATH}` });
    res.end();
    return;
  }
  state.step++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (state.step === 1) {
    res.end(frame(input, { role: 'assistant', tool_calls: [{ index: 0, id: 'b30-denied-write', type: 'function',
      function: { name: 'write', arguments: JSON.stringify({ path: 'outside-free.txt', content: 'DENIED_FIXTURE' }) } }] }) +
      frame(input, {}, 'tool_calls') + 'data: [DONE]\n\n');
  } else if (state.step === 2) {
    res.end(frame(input, { role: 'assistant', tool_calls: [{ index: 0, id: 'b30-allowed-write', type: 'function',
      function: { name: 'write', arguments: JSON.stringify({ path: 'src/free-output.txt', content: 'RELAY_FIXTURE' }) } }] }) +
      frame(input, {}, 'tool_calls') + 'data: [DONE]\n\n');
  } else {
    res.end(frame(input, { role: 'assistant', content: 'relay fixture completed' }) +
      frame(input, {}, 'stop') + 'data: [DONE]\n\n');
  }
});
// Alternate origin: the redirect Location target. Must receive zero requests/bytes.
const redirectTarget = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  redirectRecords.push({ url: req.url, authorization: req.headers.authorization ?? null, bytes: body.length });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(frame({ model: FREE_MODEL_ID }, { role: 'assistant', content: 'redirect target reached' }) +
    frame({ model: FREE_MODEL_ID }, {}, 'stop') + 'data: [DONE]\n\n');
});
let redirectPort;
let originPort;

// Fixture copy of the public catalog shape. It is never fetched and is not live evidence.
function fixtureMetadata() {
  return { observedAt: Date.now(), model: { id: FREE_MODEL_ID, owned_by: 'opencode', type: 'chat',
    modalities: { input: ['text'], output: ['text'] }, capabilities: { tools: { supported: true } },
    limit: { context: 200_000, output: 32_000 },
    cost: { text: { input: { price: 0, cache: { read: 0 } }, output: { price: 0 } } },
    api: { 'chat-completions': { base_url: FREE_ENDPOINT, sdk: { opencodeai: FREE_PACKAGE } } } } };
}

const serviceConfig = { clientId: 'fixture-owner',
  authorization: { models: [FREE_MODEL], tools: ['read', 'edit'], writableRoots: [repositoryPath] },
  limits: { maxAttempts: 1, budgetMs: 120_000, maxOutputBytes: 65_536 },
  worker: { type: 'opencode-free', executable: binary, writablePaths: ['src/**'] } };

async function runScenario({ name, mode, redirectStatus = 307, budgetMs = 120_000 }) {
  const scenarioRoot = join(root, name);
  const home = join(scenarioRoot, 'home');
  mkdirSync(home, { recursive: true });
  state = { mode, redirectStatus, step: 0, records: [], anomalies: 0 };
  redirectRecords.length = 0;
  const baseCommit = git('rev-parse', 'HEAD');
  const request = { clientId: 'fixture-owner', idempotencyKey: `b30-${name}`,
    objective: 'B30_RELAY_FIXTURE: write "outside-free.txt" with "DENIED_FIXTURE" (must be denied), then write src/free-output.txt with "RELAY_FIXTURE".',
    acceptanceCriteria: ['src/free-output.txt is written inside the allowed glob.'],
    repository: { path: repositoryPath, baseRef: baseCommit, branch: `task/b30-${name}` },
    authorization: { models: [FREE_MODEL], tools: ['read', 'edit'], writablePaths: ['src/**'] },
    limits: { maxAttempts: 1, budgetMs, maxOutputBytes: 65_536 } };
  const approvalFile = join(scenarioRoot, 'approval.json');
  writeFileSync(approvalFile, JSON.stringify({ schemaVersion: 1, model: FREE_MODEL,
    requestHash: freeRequestHash(request), expiresAt: Date.now() + 600_000, paidBudgetUSD: 0,
    privacyAcknowledged: true, actor: 'b30-relay-harness' }));

  // Fresh gateway + relay per scenario (both latch on a redirect refusal).
  const gateway = createEgressGateway({ mode: 'fixture',
    listen: { host: '127.0.0.1', port: 0 }, origin: `http://127.0.0.1:${originPort}`,
    path: PATH, limits: relayLimits });
  await gateway.start();
  const relay = createRelay({ listen: { host: '127.0.0.1', port: 0 },
    upstream: { origin: `http://127.0.0.1:${gateway.status().address.port}`, path: PATH, method: 'POST' },
    model: FREE_MODEL_ID, limits: relayLimits });
  await relay.start();

  const service = await createConfiguredTaskService({ home, config: serviceConfig, approvalFile, hostEnvironment },
    { metadata: async () => fixtureMetadata(), fixtureEndpoint: `http://127.0.0.1:${relay.status().address.port}/v1` });
  let closed;
  try {
    const accepted = service.submitTask(request);
    assert.equal(accepted.status, 'queued');
    await service.whenIdle();
    const task = service.store.readTask(accepted.taskId);
    const attempt = task.attempts.at(-1);
    const workspacePath = attempt?.workspace?.workspacePath;
    const toolResponses = state.records.flatMap(record => {
      try { return JSON.parse(record.body).messages ?? []; } catch { return []; }
    }).filter(message => message.role === 'tool').map(message => String(message.content));
    const observation = { name, mode, redirectStatus: state.redirectStatus, status: task.status,
      attempts: task.attempts.length, originRequests: state.records.length, anomalies: state.anomalies,
      originMethods: [...new Set(state.records.map(record => record.method))],
      originUpgrades: state.records.map(record => record.upgrade).filter(value => value != null),
      authorizations: [...new Set(state.records.map(record => record.authorization))],
      relayRequests: relay.status().requests, relayLatchReason: relay.status().latchReason,
      gatewayRequests: gateway.status().requests, gatewayLatchReason: gateway.status().latchReason,
      redirectTargetRequests: redirectRecords.length,
      redirectTargetBodyBytes: redirectRecords.reduce((sum, record) => sum + record.bytes, 0),
      deniedToolResult: toolResponses.some(content => /denied|not allowed|permission/i.test(content)) };
    if (mode === 'normal') {
      assert.equal(task.status, 'succeeded', JSON.stringify(observation));
      assert.equal(readFileSync(join(workspacePath, 'src', 'free-output.txt'), 'utf8'), 'RELAY_FIXTURE');
      assert.equal(observation.deniedToolResult, true, 'host did not report the out-of-scope denial');
      assert.equal(observation.anomalies, 0, JSON.stringify(observation));
    } else {
      // Redirect: terminal failed task, exactly one origin request, no replay, zero alternate origin.
      assert.equal(task.status, 'failed', `redirect must fail the task: ${JSON.stringify(observation)}`);
      assert.equal(observation.attempts, 1, `redirect must not replay: ${JSON.stringify(observation)}`);
      assert.equal(observation.originRequests, 1, `redirect must make exactly one origin request: ${JSON.stringify(observation)}`);
      assert.equal(observation.redirectTargetRequests, 0, 'alternate origin received a request');
      assert.equal(observation.redirectTargetBodyBytes, 0, 'alternate origin received body bytes');
    }
    // Negative WebSocket/bypass: only POST chat-completions, no Upgrade header, only Bearer public.
    assert.deepEqual(observation.originMethods, ['POST'], `non-POST/WebSocket method reached origin: ${JSON.stringify(observation)}`);
    assert.deepEqual(observation.originUpgrades, [], `an Upgrade/WebSocket header reached the origin: ${JSON.stringify(observation)}`);
    assert.ok(observation.authorizations.every(value => value === 'Bearer public'), JSON.stringify(observation));
    assert.equal(observation.anomalies, 0, JSON.stringify(observation));
    closed = await service.close();
    return observation;
  } finally {
    if (!closed) await service.close();
    await relay.stop();
    await gateway.stop();
  }
}

let observations = [];
try {
  mkdirSync(repositoryPath, { recursive: true });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'B30 Relay Fixture');
  git('config', 'user.email', 'b30-relay-fixture@example.invalid');
  mkdirSync(join(repositoryPath, 'src'), { recursive: true });
  writeFileSync(join(repositoryPath, 'src', 'base.txt'), 'b30 relay fixture baseline\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'B30 relay fixture base');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  originPort = server.address().port;
  redirectTarget.listen(0, '127.0.0.1');
  await once(redirectTarget, 'listening');
  redirectPort = redirectTarget.address().port;
  const scenarios = [
    { name: 'normal-through-relay', mode: 'normal' },
    { name: 'redirect-301', mode: 'redirect', redirectStatus: 301 },
    { name: 'redirect-302', mode: 'redirect', redirectStatus: 302 },
    { name: 'redirect-303', mode: 'redirect', redirectStatus: 303 },
    { name: 'redirect-307', mode: 'redirect', redirectStatus: 307 },
    { name: 'redirect-308', mode: 'redirect', redirectStatus: 308 },
  ];
  for (const scenario of scenarios) {
    try {
      observations.push({ ok: true, ...await runScenario(scenario) });
    } catch (error) {
      observations.push({ name: scenario.name, mode: scenario.mode, redirectStatus: scenario.redirectStatus ?? 307,
        ok: false, error: String(error.message).slice(0, 1200) });
    }
  }
  const failed = observations.filter(observation => !observation.ok).map(observation => observation.name);
  console.log(JSON.stringify({ version: '2.2.5', model: FREE_MODEL, endpoint: 'loopback relay→gateway→fixture',
    metadataSource: 'local fixture copy (not fetched)', failedScenarios: failed, scenarios: observations }, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); });
  if (redirectPort) {
    await new Promise(resolveClose => { redirectTarget.close(resolveClose); redirectTarget.closeAllConnections(); });
  }
  for (const [key, value] of Object.entries(originalAmbient)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.error(`Temporary fixture retained for diagnosis: ${root}`); }
}

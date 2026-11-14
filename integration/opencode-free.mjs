// Explicit opt-in: node integration/opencode-free.mjs /absolute/path/opencode.exe
// B29 pinned-host preparation harness for the single anonymous free route. It runs the
// configured service and OpenCode 2.2.5 only against loopback fixtures. The metadata is a
// local copy of the public shape, never fetched; the free endpoint, paid providers and
// every external host are not contacted. This is not live-provider or availability evidence.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FREE_ENDPOINT, FREE_MODEL, FREE_MODEL_ID, FREE_PACKAGE, FREE_MAX_REQUESTS,
  freeRequestHash } from '../src/free-provider.mjs';
import { createConfiguredTaskService } from '../src/configured-service.mjs';

const binary = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass an explicit OpenCode 2.2.5 binary path');
const root = mkdtempSync(join(tmpdir(), 'orchestrator-b29-'));
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

let state;
const redirectRecords = [];
const frame = (input, delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'b29-fixture',
  object: 'chat.completion.chunk', created: 0, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;

const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const record = { method: req.method, url: req.url, authorization: req.headers.authorization ?? null, body };
  state.records.push(record);
  let input;
  try { input = JSON.parse(body); } catch { state.anomalies++; res.writeHead(400); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { state.anomalies++; res.writeHead(404); res.end(); return; }
  if (record.authorization !== 'Bearer public' || input.model !== FREE_MODEL_ID) state.anomalies++;
  if (state.records.length > FREE_MAX_REQUESTS) { state.anomalies++; res.writeHead(429); res.end(); return; }
  if (state.mode === 'redirect') {
    res.writeHead(307, { location: `http://127.0.0.1:${redirectPort}/v1/chat/completions` });
    res.end();
    return;
  }
  if (state.mode === 'drop') { req.socket.destroy(); return; }
  if (state.mode === 'hold') {
    // Leave the request unanswered until the task deadline terminates the worker.
    // This observes uncertain worker termination, not a completed provider response.
    return;
  }
  if (state.mode === 'drop-after-effects') {
    state.step++;
    if (state.step === 1) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(frame(input, { role: 'assistant', tool_calls: [{ index: 0, id: 'b29-partial-write',
        type: 'function', function: { name: 'write',
          arguments: JSON.stringify({ path: 'src/free-output.txt', content: 'PARTIAL_FREE_FIXTURE' }) } }] }) +
        frame(input, {}, 'tool_calls') + 'data: [DONE]\n\n');
      return;
    }
    // The first response already let the worker write its allowed file. Losing the
    // connection now must preserve that partial effect without retry or replay.
    req.socket.destroy();
    return;
  }
  if (state.mode.startsWith('status-')) {
    res.writeHead(Number(state.mode.slice('status-'.length)), { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'fixture refusal' } }));
    return;
  }
  state.step++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (state.step === 1) {
    res.end(frame(input, { role: 'assistant', tool_calls: [{ index: 0, id: 'b29-denied-write', type: 'function',
      function: { name: 'write', arguments: JSON.stringify({ path: 'outside-free.txt', content: 'DENIED_FIXTURE' }) } }] }) +
      frame(input, {}, 'tool_calls') + 'data: [DONE]\n\n');
  } else if (state.step === 2) {
    res.end(frame(input, { role: 'assistant', tool_calls: [{ index: 0, id: 'b29-allowed-write', type: 'function',
      function: { name: 'write', arguments: JSON.stringify({ path: 'src/free-output.txt', content: 'FREE_FIXTURE' }) } }] }) +
      frame(input, {}, 'tool_calls') + 'data: [DONE]\n\n');
  } else {
    res.end(frame(input, { role: 'assistant', content: 'free fixture completed' }) +
      frame(input, {}, 'stop') + 'data: [DONE]\n\n');
  }
});
const redirectTarget = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  redirectRecords.push({ url: req.url, authorization: req.headers.authorization ?? null, bytes: body.length });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(frame({ model: FREE_MODEL_ID }, { role: 'assistant', content: 'redirect target reached' }) +
    frame({ model: FREE_MODEL_ID }, {}, 'stop') + 'data: [DONE]\n\n');
});
let redirectPort;

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

async function runScenario({ name, mode, budgetMs = 120_000, releaseOwnership = true }) {
  const scenarioRoot = join(root, name);
  const home = join(scenarioRoot, 'home');
  mkdirSync(home, { recursive: true });
  state = { mode, step: 0, records: [], anomalies: 0 };
  redirectRecords.length = 0;
  const baseCommit = git('rev-parse', 'HEAD');
  const request = { clientId: 'fixture-owner', idempotencyKey: `b29-${name}`,
    objective: 'B29_FREE_FIXTURE: write "outside-free.txt" with "DENIED_FIXTURE" (must be denied), then write src/free-output.txt with "FREE_FIXTURE".',
    acceptanceCriteria: ['src/free-output.txt is written inside the allowed glob.'],
    repository: { path: repositoryPath, baseRef: baseCommit, branch: `task/b29-${name}` },
    authorization: { models: [FREE_MODEL], tools: ['read', 'edit'], writablePaths: ['src/**'] },
    limits: { maxAttempts: 1, budgetMs, maxOutputBytes: 65_536 } };
  const approvalFile = join(scenarioRoot, 'approval.json');
  writeFileSync(approvalFile, JSON.stringify({ schemaVersion: 1, model: FREE_MODEL,
    requestHash: freeRequestHash(request), expiresAt: Date.now() + 600_000, paidBudgetUSD: 0,
    privacyAcknowledged: true, actor: 'b29-harness' }));
  const service = await createConfiguredTaskService({ home, config: serviceConfig, approvalFile, hostEnvironment },
    { metadata: async () => fixtureMetadata(), fixtureEndpoint: `http://127.0.0.1:${server.address().port}/v1` });
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
    const observation = { name, mode, status: task.status, exitCode: attempt?.exitCode ?? null,
      attempts: task.attempts.length, providerRequests: state.records.length, anomalies: state.anomalies,
      authorizations: [...new Set(state.records.map(record => record.authorization))],
      redirectTargetRequests: redirectRecords.length,
      redirectTargetAuthorizations: redirectRecords.map(record => record.authorization),
      redirectTargetBodyBytes: redirectRecords.reduce((sum, record) => sum + record.bytes, 0),
      deniedToolResult: toolResponses.some(content => /denied|not allowed|permission/i.test(content)) };
    if (mode === 'normal') {
      assert.equal(task.status, 'succeeded', JSON.stringify(observation));
      assert.equal(attempt.exitCode, 0);
      assert.equal(readFileSync(join(workspacePath, 'src', 'free-output.txt'), 'utf8'), 'FREE_FIXTURE');
      assert.equal(existsSync(join(workspacePath, 'outside-free.txt')), false, 'out-of-scope write created a file');
      assert.equal(observation.deniedToolResult, true, 'host did not report the out-of-scope denial');
      assert.ok(observation.providerRequests >= 3 && observation.providerRequests <= FREE_MAX_REQUESTS, JSON.stringify(observation));
      const result = service.getTaskResult({ taskId: accepted.taskId });
      observation.diffListsAllowedFile = String(result.diff ?? '').includes('src/free-output.txt');
      assert.equal(observation.diffListsAllowedFile, true, 'diff does not list the allowed file');
    } else if (mode === 'drop-after-effects') {
      assert.notEqual(task.status, 'succeeded', JSON.stringify(observation));
      assert.equal(observation.providerRequests, 2,
        `connection loss after effects must make no third provider request: ${JSON.stringify(observation)}`);
      assert.equal(task.attempts.length, 1, 'connection loss must not replay the attempt');
      assert.equal(existsSync(join(workspacePath, 'src', 'free-output.txt')), true,
        'the allowed file written before the connection loss must survive');
      const result = service.getTaskResult({ taskId: accepted.taskId });
      observation.partialDiff = String(result.diff ?? '').includes('src/free-output.txt');
      assert.equal(observation.partialDiff, true, 'partial Git evidence must remain readable');
    } else if (mode === 'hold') {
      assert.equal(task.status, 'blocked', JSON.stringify(observation));
      assert.equal(task.block.reason, 'worker-outcome-uncertain');
      assert.equal(task.block.requiresReconciliation, true);
      observation.requiresReconciliation = service.schedulerStatus().requiresReconciliation;
      assert.equal(observation.requiresReconciliation, true);
      assert.equal(observation.providerRequests, 1,
        `a held request must not produce a second provider request: ${JSON.stringify(observation)}`);
      assert.equal(task.attempts.length, 1, 'uncertain termination must not replay the attempt');
    } else {
      assert.notEqual(task.status, 'succeeded', JSON.stringify(observation));
      assert.equal(observation.providerRequests, 1, `expected exactly one provider request: ${JSON.stringify(observation)}`);
    }
    assert.equal(observation.anomalies, 0, JSON.stringify(observation));
    assert.ok(observation.authorizations.every(value => value === 'Bearer public'), JSON.stringify(observation));
    assert.equal(observation.redirectTargetRequests, 0, 'redirect target received a request');
    if (mode === 'hold') observation.blockReason = task.block?.reason;
    closed = await service.close();
    assert.deepEqual(closed, { releaseOwnership });
    observation.releaseOwnership = closed.releaseOwnership;
    return observation;
  } finally {
    if (!closed) await service.close();
  }
}

let observations = [];
try {
  mkdirSync(repositoryPath, { recursive: true });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'B29 Fixture');
  git('config', 'user.email', 'b29-fixture@example.invalid');
  mkdirSync(join(repositoryPath, 'src'), { recursive: true });
  writeFileSync(join(repositoryPath, 'src', 'base.txt'), 'b29 fixture baseline\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'B29 fixture base');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  redirectTarget.listen(0, '127.0.0.1');
  await once(redirectTarget, 'listening');
  redirectPort = redirectTarget.address().port;
  const scenarios = [
    { name: 'normal-allowed-and-denied-write', mode: 'normal' },
    { name: 'status-401', mode: 'status-401' },
    { name: 'status-402', mode: 'status-402' },
    { name: 'status-429', mode: 'status-429' },
    { name: 'redirect-307', mode: 'redirect' },
    { name: 'connection-drop', mode: 'drop' },
    { name: 'connection-drop-after-effects', mode: 'drop-after-effects' },
    { name: 'deadline-held-response', mode: 'hold', budgetMs: 6_000, releaseOwnership: false },
  ];
  for (const scenario of scenarios) {
    try {
      observations.push({ ok: true, ...await runScenario(scenario) });
    } catch (error) {
      observations.push({ name: scenario.name, mode: scenario.mode, ok: false,
        error: String(error.message).slice(0, 1200) });
    }
  }
  const failed = observations.filter(observation => !observation.ok).map(observation => observation.name);
  console.log(JSON.stringify({ version: '2.2.5', model: FREE_MODEL, endpoint: 'loopback fixture',
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

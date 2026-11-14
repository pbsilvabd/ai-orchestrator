// B20 negative evidence only: no OpenCode process, real model or provider call.
// This fixture harness cannot satisfy B20-01 or human review (B20-04).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { buildOpenCodeInvocation } from '../src/opencode.mjs';
import { createTaskService } from '../src/service.mjs';

assert.equal(process.version, 'v24.22.1');
assert.equal(process.argv.length, 3, 'supply one new report path');
const reportPath = resolve(process.argv[2]);
// Refuse reuse BEFORE any fixture process or task can start.
const reportFile = openSync(reportPath, 'wx');
const root = mkdtempSync(join(tmpdir(), 'b20-negative-'));
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
gitEnv.GIT_CONFIG_NOSYSTEM = '1';
gitEnv.GIT_CONFIG_GLOBAL = join(root, 'empty-gitconfig');
writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, env: gitEnv, encoding: 'utf8', windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
}).trim();
const cases = [];
const expectedCases = ['external-provider', 'unapproved-model', 'unapproved-budget',
  'unsupported-credential', 'unrelated-edit', 'failed-test', 'secret'];
let activeCase;
let safeToRemove = true;
let currentService;
const report = {
  schemaVersion: 1, task: 'B20', generatedAt: new Date().toISOString(),
  realTaskId: null, realSubmission: 'not_run',
  evidenceLevel: 'unit', fixtureOnly: true, externalProviderCalls: 0,
  environment: { platform: process.platform, arch: process.arch, node: process.version },
  cases,
};

try {
  const repository = join(root, 'repository');
  const workspacePath = join(root, 'builder-workspace');
  mkdirSync(repository);
  mkdirSync(workspacePath);
  git(repository, 'init', '--template=');
  git(repository, 'config', 'user.name', 'B20 fixture');
  git(repository, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(repository, 'scoped.txt'), 'base\n');
  git(repository, 'add', 'scoped.txt');
  git(repository, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture base');
  const baseCommit = git(repository, 'rev-parse', 'HEAD');
  const request = name => ({ clientId: 'b20-fixture', idempotencyKey: `b20-negative-${name}`,
    objective: 'Change only scoped.txt; all configured tests must pass; include no credentials.',
    acceptanceCriteria: ['Only scoped.txt changes', 'Tests exit zero', 'No secrets'],
    repository: { path: repository, baseRef: baseCommit, branch: `task/negative-${name}` },
    authorization: { models: ['fixture/mock'], tools: ['read', 'edit'], writablePaths: ['scoped.txt'] },
    limits: { maxAttempts: 1, budgetMs: 30_000, maxOutputBytes: 65_536 },
  });
  const taskId = '00000000-0000-4000-8000-000000000001';
  const task = { taskId, baseCommit, request: request('builder') };
  const launch = { task, executable: process.execPath,
    workspace: { taskId, repository, workspacePath, baseCommit, head: baseCommit,
      branch: task.request.repository.branch },
    configRoot: join(root, 'runtime'), stateRoot: join(root, 'runtime', 'state'),
    authorizedModel: 'fixture/mock', allowedTools: ['read', 'edit'], writablePaths: ['scoped.txt'],
    provider: { package: '@opencode/ai/providers/openai-compatible', baseURL: 'http://127.0.0.1:43210/v1' },
    maxBudgetMs: 30_000, maxOutputBytes: 65_536 };
  for (const [name, overrides, expectedCode] of [
    ['external-provider', { provider: { ...launch.provider, baseURL: 'https://provider.example.invalid/v1' } }, 'authorization_denied'],
    ['unapproved-model', { task: { ...task, request: { ...task.request,
      authorization: { ...task.request.authorization, models: ['fixture/unapproved'] } } } }, 'authorization_denied'],
    ['unapproved-budget', { task: { ...task, request: { ...task.request,
      limits: { ...task.request.limits, budgetMs: 30_001 } } } }, 'authorization_denied'],
    ['unsupported-credential', { providerEnvironment: { UNLISTED_API_KEY: 'FAKE_FIXTURE_ONLY' } }, 'invalid_argument'],
  ]) {
    activeCase = name;
    assert.throws(() => buildOpenCodeInvocation({ ...launch, ...overrides }), error => error.code === expectedCode);
    cases.push({ name, status: 'pass', observedCode: expectedCode, dispatches: 0 });
  }

  for (const name of ['unrelated-edit', 'failed-test', 'secret']) {
    activeCase = name;
    const sentinel = 'B20_SYNTHETIC_CREDENTIAL_NOT_REAL';
    const outputFile = name === 'unrelated-edit' ? 'unrelated.txt' : 'scoped.txt';
    const content = name === 'secret' ? `api_key=${sentinel}\n` : 'fixture output\n';
    const testExit = name === 'failed-test' ? 7 : 0;
    // Trusted, deliberately noncompliant Node fixture; NOT an OpenCode worker.
    const worker = { evidenceLevel: 'unit', testCommands: [{ executable: process.execPath,
      args: ['-e', `process.exit(${testExit})`], label: `node fixture-test-${name}`, env: {} }],
      prepare({ workspace }) {
        return { executable: process.execPath, cwd: workspace.workspacePath, env: {},
          args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(outputFile)},${JSON.stringify(content)})`],
          timeoutMs: 5_000, stdoutMaxBytes: 1024, stderrMaxBytes: 1024 };
      } };
    const home = join(root, `home-${name}`);
    currentService = createTaskService({ home, worker, config: { clientId: 'b20-fixture',
      authorization: { models: ['fixture/mock'], tools: ['read', 'edit'], writableRoots: [repository] },
      limits: { maxAttempts: 1, budgetMs: 30_000, maxOutputBytes: 65_536 } } });
    safeToRemove = false;
    const submitted = currentService.submitTask(request(name));
    await currentService.whenIdle();
    const status = currentService.getTaskStatus({ taskId: submitted.taskId });
    const result = currentService.getTaskResult({ taskId: submitted.taskId });
    assert.equal(result.taskId, submitted.taskId);
    assert.equal(status.attempts.length, 1);
    assert.equal(status.attempts[0].outcome, 'succeeded');
    assert.equal(result.testRuns.length, 1);
    assert.equal(result.testRuns[0].exitCode, testExit);
    assert.equal(result.diffTruncated, false);
    const persisted = readFileSync(join(home, 'tasks', `${submitted.taskId}.json`), 'utf8');
    assert.ok(!persisted.includes(sentinel));
    assert.ok(!JSON.stringify(result).includes(sentinel));
    const reasons = [];
    if (result.changedFiles.some(path => path !== 'scoped.txt')) reasons.push('out-of-scope-change');
    if (result.testRuns.some(run => run.exitCode !== 0)) reasons.push('failed-test');
    if (result.diff.includes('[REDACTED]')) reasons.push('credential-shaped-artifact');
    assert.deepEqual(reasons, [name === 'unrelated-edit' ? 'out-of-scope-change' :
      name === 'secret' ? 'credential-shaped-artifact' : 'failed-test']);
    cases.push({ name, status: 'pass', fixtureTaskId: submitted.taskId,
      idempotencyKey: request(name).idempotencyKey, serviceStatus: status.status,
      attempts: status.attempts.length, model: status.attempts[0].model,
      attemptId: status.attempts[0].attemptId,
      fixtureBaseCommit: result.baseCommit, fixtureBranch: result.branch,
      fixtureHeadCommit: result.headCommit,
      changedFiles: result.changedFiles, diff: result.diff,
      testRuns: result.testRuns.map(({ command, exitCode }) => ({ command, exitCode })),
      limitations: result.limitations,
      supervisorDecision: 'reject', reasons, secretAbsentFromRecordAndResult: true,
      retryDispatches: 0, merged: false });
    const closed = await currentService.close();
    assert.equal(closed.releaseOwnership, true);
    currentService = undefined;
    safeToRemove = true;
  }
  report.summary = { pass: cases.length, fail: 0, not_run: 0 };
} catch {
  if (activeCase && !cases.some(item => item.name === activeCase))
    cases.push({ name: activeCase, status: 'fail', reason: 'fixture assertion or operation failed' });
  for (const name of expectedCases) {
    if (!cases.some(item => item.name === name))
      cases.push({ name, status: 'not_run', reason: 'fixture harness halted without retry' });
  }
  report.summary = Object.fromEntries(['pass', 'fail', 'not_run'].map(status =>
    [status, cases.filter(item => item.status === status).length]));
  report.failure = 'fixture assertion or operation failed; inspect retained scratch locally';
  process.exitCode = 1;
  safeToRemove = false;
} finally {
  try {
    if (currentService) {
      const closed = await currentService.close();
      if (closed.releaseOwnership !== true) safeToRemove = false;
    }
    if (safeToRemove) rmSync(root, { recursive: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    safeToRemove = false;
    report.cleanup = 'failed; scratch retained';
    process.exitCode = 1;
  }
  if (!safeToRemove) report.retainedScratchBasename = basename(root);
  report.success = !process.exitCode && report.summary.fail === 0 && report.summary.not_run === 0;
  // Write only the file exclusively reserved before execution.
  try { writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`); }
  finally { closeSync(reportFile); }
  console.log(JSON.stringify({ summary: report.summary, fixtureOnly: true, realSubmission: 'not_run' }));
}

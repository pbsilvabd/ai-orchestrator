import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectTaskArtifacts, MAX_DIFF_BYTES, MAX_LOG_BYTES } from '../src/artifacts.mjs';
import { createTaskService } from '../src/service.mjs';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args],
  { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t, maxOutputBytes = 1_048_576) {
  const root = mkdtempSync(join(tmpdir(), 'artifacts-'));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init');
  git(repo, 'config', 'user.name', 'Fixture');
  git(repo, 'config', 'user.email', 'fixture@example.com');
  for (const [name, value] of [['delete.txt', 'delete\n'], ['rename-old.txt', 'rename\n'],
    ['tracked.txt', 'base\n']]) writeFileSync(join(repo, name), value);
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  const baseCommit = git(repo, 'rev-parse', 'HEAD');
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const task = { taskId: '00000000-0000-4000-8000-000000000001', baseCommit,
    request: { repository: { branch: 'task/artifacts' }, limits: { maxOutputBytes } } };
  const workspace = { taskId: task.taskId, baseCommit, workspacePath: repo };
  return { root, repo, task, workspace };
}

test('B13-01: fixed-base artifacts cover committed, staged, unstaged, renamed, deleted and untracked files', async t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'committed.txt'), 'committed\n');
  git(f.repo, 'add', 'committed.txt');
  git(f.repo, 'commit', '-m', 'worker commit');
  git(f.repo, 'mv', 'rename-old.txt', 'rename-new.txt');
  git(f.repo, 'rm', 'delete.txt');
  writeFileSync(join(f.repo, 'tracked.txt'), 'unstaged\n');
  writeFileSync(join(f.repo, 'untracked.txt'), 'untracked\n');
  writeFileSync(join(f.root, 'outside.txt'), 'must not appear\n');

  const artifact = await collectTaskArtifacts({ task: f.task, workspace: f.workspace,
    remainingBudgetMs: 10_000, testCommands: [] });
  assert.deepEqual(artifact.changedFiles, ['committed.txt', 'delete.txt', 'rename-new.txt',
    'rename-old.txt', 'tracked.txt', 'untracked.txt']);
  for (const name of ['committed.txt', 'delete.txt', 'rename-new.txt', 'rename-old.txt',
    'tracked.txt', 'untracked.txt']) assert.match(artifact.diff, new RegExp(name.replace('.', '\\.')));
  assert.doesNotMatch(JSON.stringify(artifact), /outside\.txt|must not appear/);
  assert.equal(artifact.headCommit, git(f.repo, 'rev-parse', 'HEAD'));
  assert.match(artifact.limitations.join('\n'), /no trusted test command/);
});

test('B13-02: real failing test records its command, nonzero exit and limitation', async t => {
  const f = fixture(t);
  const artifact = await collectTaskArtifacts({ task: f.task, workspace: f.workspace,
    remainingBudgetMs: 10_000, testCommands: [{ executable: process.execPath,
      args: ['-e', "process.stderr.write('real failure');process.exit(7)"],
      label: 'node failing-fixture', env: {} }] });
  assert.equal(artifact.testRuns.length, 1);
  assert.equal(artifact.testRuns[0].command, 'node failing-fixture');
  assert.equal(artifact.testRuns[0].exitCode, 7);
  assert.match(artifact.testRuns[0].outputTail, /real failure/);
  assert.match(artifact.limitations.join('\n'), /test command failed/);
});

test('B13-03: UTF-8 diff/log and binary artifacts stay byte bounded with explicit flags', async t => {
  const f = fixture(t, 4_096);
  writeFileSync(join(f.repo, 'tracked.txt'), 'é'.repeat(MAX_DIFF_BYTES));
  writeFileSync(join(f.repo, 'binary.dat'), Buffer.from([0, 1, 2, 3, 0, 255]));
  const artifact = await collectTaskArtifacts({ task: f.task, workspace: f.workspace,
    remainingBudgetMs: 10_000, testCommands: [{ executable: process.execPath,
      args: ['-e', `process.stdout.write('é'.repeat(${MAX_LOG_BYTES}))`],
      label: 'node large-output', env: {} }] });
  assert.ok(Buffer.byteLength(artifact.diff, 'utf8') <= 4_096);
  assert.equal(artifact.diffTruncated, true);
  assert.equal(artifact.diff.includes('\uFFFD'), false);
  assert.ok(artifact.testRuns.reduce((sum, run) => sum + Buffer.byteLength(run.outputTail, 'utf8'), 0)
    <= Math.max(0, 4_096 - Buffer.byteLength(artifact.diff, 'utf8')));
  assert.equal(artifact.logsTruncated, true);
  assert.match(artifact.limitations.join('\n'), /binary content omitted/);
});

test('B13-04: producer redacts credential sentinels before the scheduler persists or returns artifacts', async t => {
  const f = fixture(t);
  const home = join(f.root, 'home');
  const sentinel = 'B13_FAKE_SECRET_VALUE';
  const config = { clientId: 'owner',
    authorization: { models: ['fixture/mock'], tools: ['read'], writableRoots: [f.repo] },
    limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 1_048_576 } };
  const worker = {
    evidenceLevel: 'unit',
    testCommands: [{ executable: process.execPath,
      args: ['-e', `process.stdout.write('access_token=${sentinel}')`],
      label: `api_key=${sentinel}`, env: {} }],
    prepare({ workspace }) {
      const code = `require('node:fs').writeFileSync('api_key=${sentinel}.txt','Authorization: Bearer ${sentinel}')`;
      return { executable: process.execPath, args: ['-e', code], cwd: workspace.workspacePath,
        env: {}, timeoutMs: 5_000, stdoutMaxBytes: 1024, stderrMaxBytes: 1024 };
    },
  };
  const service = createTaskService({ home, config, worker });
  t.after(async () => service.close());
  const accepted = service.submitTask({ clientId: 'owner', idempotencyKey: 'redaction',
    objective: 'write fixture', acceptanceCriteria: ['artifact returned'],
    repository: { path: f.repo, baseRef: f.task.baseCommit, branch: 'task/redaction' },
    authorization: { models: ['fixture/mock'], tools: ['read'], writablePaths: ['src/**'] },
    limits: { maxAttempts: 1, budgetMs: 10_000, maxOutputBytes: 1_048_576 } });
  await service.whenIdle();
  const recordText = readFileSync(join(home, 'tasks', `${accepted.taskId}.json`), 'utf8');
  const resultText = JSON.stringify(service.getTaskResult({ taskId: accepted.taskId }));
  assert.equal(recordText.includes(sentinel), false);
  assert.equal(resultText.includes(sentinel), false);
  assert.match(recordText, /\[REDACTED\]/);
  assert.match(resultText, /\[REDACTED\]/);
});

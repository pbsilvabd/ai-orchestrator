import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskWorkspace, removeTaskWorkspace, WorkspaceError } from '../src/workspace.mjs';

const taskId = '00000000-0000-4000-8000-000000000009';
const expected = code => error => error instanceof WorkspaceError && error.code === code;

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-workspace-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repositoryPath = join(home, 'repo');
  const workspaceRoot = join(home, 'workspaces');
  mkdirSync(repositoryPath);
  const git = (...args) => execFileSync('git', args, { cwd: repositoryPath, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Workspace Fixture');
  git('config', 'user.email', 'workspace@example.invalid');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(repositoryPath, 'tracked.txt'), 'parent baseline\n');
  git('add', 'tracked.txt');
  git('commit', '-m', 'fixture');
  const baseCommit = git('rev-parse', 'HEAD');
  t.after(() => {
    try { execFileSync('git', ['-C', repositoryPath, 'worktree', 'prune'], { stdio: 'ignore' }); } catch {}
  });
  return { home, repositoryPath, workspaceRoot, baseCommit, git,
    baseline: readFileSync(join(repositoryPath, 'tracked.txt')),
    options: { taskId, repositoryPath, baseCommit, branch: 'task/workspace-test', workspaceRoot } };
}

test('B09-01: dirty parent remains byte-identical while worktree starts at fixed base', t => {
  const f = fixture(t);
  writeFileSync(join(f.repositoryPath, 'tracked.txt'), 'user change\r\n');
  writeFileSync(join(f.repositoryPath, 'untracked.txt'), Buffer.from([0, 1, 2, 255]));
  const trackedBefore = readFileSync(join(f.repositoryPath, 'tracked.txt'));
  const untrackedBefore = readFileSync(join(f.repositoryPath, 'untracked.txt'));
  const statusBefore = f.git('status', '--porcelain', '--untracked-files=all');

  const result = createTaskWorkspace(f.options);
  assert.equal(result.head, f.baseCommit);
  assert.equal(result.reused, false);
  assert.equal(f.git('status', '--porcelain', '--untracked-files=all'), statusBefore);
  assert.deepEqual(readFileSync(join(f.repositoryPath, 'tracked.txt')), trackedBefore);
  assert.deepEqual(readFileSync(join(f.repositoryPath, 'untracked.txt')), untrackedBefore);
});

test('B09-02: duplicate invocation reuses one receipt-verified worktree', t => {
  const f = fixture(t);
  const first = createTaskWorkspace(f.options);
  execFileSync('git', ['-C', first.workspacePath, 'config', 'user.name', 'Workspace Fixture']);
  execFileSync('git', ['-C', first.workspacePath, 'config', 'user.email', 'workspace@example.invalid']);
  writeFileSync(join(first.workspacePath, 'worker.txt'), 'worker progress\n');
  execFileSync('git', ['-C', first.workspacePath, 'add', 'worker.txt']);
  execFileSync('git', ['-C', first.workspacePath, 'commit', '-m', 'worker progress']);
  const second = createTaskWorkspace(f.options);
  assert.equal(second.reused, true);
  assert.equal(second.workspacePath, first.workspacePath);
  assert.notEqual(second.head, f.baseCommit);
  assert.equal(f.git('worktree', 'list', '--porcelain').split('worktree ').length - 1, 2);
});

test('B09-03: branch and path collisions and tampered receipt fail without clobbering', t => {
  const f = fixture(t);
  f.git('branch', f.options.branch, f.baseCommit);
  assert.throws(() => createTaskWorkspace(f.options), expected('workspace_conflict'));
  f.git('branch', '-D', f.options.branch);

  mkdirSync(f.workspaceRoot, { recursive: true });
  const pathCollision = join(f.workspaceRoot, taskId);
  mkdirSync(pathCollision);
  writeFileSync(join(pathCollision, 'user.txt'), 'preserve');
  assert.throws(() => createTaskWorkspace(f.options), expected('workspace_conflict'));
  assert.equal(readFileSync(join(pathCollision, 'user.txt'), 'utf8'), 'preserve');
  rmSync(pathCollision, { recursive: true });

  const created = createTaskWorkspace(f.options);
  const receiptPath = join(f.workspaceRoot, `${taskId}.workspace.json`);
  const original = readFileSync(receiptPath, 'utf8');
  writeFileSync(receiptPath, original.replace(f.options.branch, 'task/other'));
  assert.throws(() => createTaskWorkspace(f.options), expected('workspace_conflict'));
  assert.deepEqual(readFileSync(join(created.workspacePath, 'tracked.txt')), f.baseline);
});

test('B09-03: moved junction is rejected and its target remains intact', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const created = createTaskWorkspace(f.options);
  const movedPath = join(f.workspaceRoot, `${taskId}-moved`);
  renameSync(created.workspacePath, movedPath);
  symlinkSync(movedPath, created.workspacePath, 'junction');
  assert.throws(() => createTaskWorkspace(f.options), expected('workspace_conflict'));
  assert.deepEqual(readFileSync(join(movedPath, 'tracked.txt')), f.baseline);
});

test('B09-04: incomplete setup and dirty output are retained with a diagnostic', t => {
  const f = fixture(t);
  mkdirSync(f.workspaceRoot, { recursive: true });
  const workspacePath = join(f.workspaceRoot, taskId);
  mkdirSync(workspacePath);
  writeFileSync(join(workspacePath, 'user-output.txt'), 'do not delete');
  writeFileSync(join(f.workspaceRoot, `${taskId}.workspace.json`), JSON.stringify({
    version: 1, taskId, repository: f.repositoryPath, baseCommit: f.baseCommit,
    branch: f.options.branch, workspacePath,
  }));
  assert.throws(() => createTaskWorkspace(f.options), expected('git_error'));
  assert.equal(readFileSync(join(workspacePath, 'user-output.txt'), 'utf8'), 'do not delete');

  const other = fixture(t);
  const created = createTaskWorkspace(other.options);
  writeFileSync(join(created.workspacePath, 'dirty.txt'), 'uncommitted result');
  assert.throws(() => removeTaskWorkspace(other.options), expected('workspace_dirty'));
  assert.equal(readFileSync(join(created.workspacePath, 'dirty.txt'), 'utf8'), 'uncommitted result');
  assert.equal(other.git('branch', '--list', other.options.branch).startsWith('+'), true);
});

test('B09-04: ignored workspace output is preserved and blocks removal', t => {
  const f = fixture(t);
  writeFileSync(join(f.repositoryPath, '.gitignore'), 'ignored-output.txt\n');
  f.git('add', '.gitignore'); f.git('commit', '-m', 'ignore worker fixture output');
  const baseCommit = f.git('rev-parse', 'HEAD');
  const options = { ...f.options, baseCommit };
  const created = createTaskWorkspace(options);
  const output = join(created.workspacePath, 'ignored-output.txt');
  writeFileSync(output, 'worker result that must survive cleanup');

  assert.throws(() => removeTaskWorkspace(options), expected('workspace_dirty'));
  assert.equal(readFileSync(output, 'utf8'), 'worker result that must survive cleanup');
  assert.equal(existsSync(join(f.workspaceRoot, `${taskId}.workspace.json`)), true);

  rmSync(output);
  assert.equal(removeTaskWorkspace(options).removed, true);
});

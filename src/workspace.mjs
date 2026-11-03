import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

const RECEIPT_VERSION = 1;

export class WorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

// Create or verify one task-owned worktree. Existing output is never adopted by name alone.
export function createTaskWorkspace({ taskId, repositoryPath, baseCommit, branch, workspaceRoot } = {}) {
  validateInput({ taskId, repositoryPath, baseCommit, branch, workspaceRoot });
  const repo = gitRoot(repositoryPath);
  const base = git(['rev-parse', '--verify', '--end-of-options', `${baseCommit}^{commit}`], repo);
  if (base !== baseCommit) fail('invalid_argument', 'baseCommit is not the resolved commit');

  mkdirSync(workspaceRoot, { recursive: true });
  const root = canonical(workspaceRoot);
  if (contained(root, repo)) fail('invalid_argument', 'workspaceRoot must be outside the repository');
  const workspacePath = join(root, taskId);
  const receiptPath = join(root, `${taskId}.workspace.json`);
  const expected = { version: RECEIPT_VERSION, taskId, repository: repo, baseCommit, branch, workspacePath };

  if (existsSync(receiptPath)) {
    const receipt = readReceipt(receiptPath);
    if (!sameReceipt(receipt, expected)) fail('workspace_conflict', 'workspace receipt does not match the task');
    return verifyWorkspace(expected, true);
  }
  if (existsSync(workspacePath)) fail('workspace_conflict', 'workspace path already exists without an owned receipt');
  try { git(['check-ref-format', '--branch', branch], repo); }
  catch { fail('invalid_argument', 'task branch is not a valid Git branch'); }
  const branches = git(['for-each-ref', '--format=%(refname)', 'refs/heads/'], repo)
    .split(/\r?\n/).filter(Boolean);
  const targetRef = `refs/heads/${branch}`;
  if (branches.some(ref => ref === targetRef || ref.startsWith(`${targetRef}/`) || targetRef.startsWith(`${ref}/`))) {
    fail('workspace_conflict', 'task branch already exists or collides with an existing branch');
  }

  // Reserve ownership before touching Git. On interruption, the incomplete receipt
  // makes later calls fail closed instead of adopting or deleting partial output.
  let receiptFd;
  try {
    receiptFd = openSync(receiptPath, 'wx', 0o600);
    writeFileSync(receiptFd, `${JSON.stringify(expected)}\n`);
    closeSync(receiptFd);
  } catch (error) {
    if (receiptFd !== undefined) try { closeSync(receiptFd); } catch { /* preserve original failure */ }
    if (error.code === 'EEXIST') fail('workspace_conflict', 'another invocation reserved this task workspace');
    throw workspaceError(error);
  }

  try {
    git(['worktree', 'add', '-b', branch, workspacePath, baseCommit], repo);
  } catch (error) {
    fail('workspace_incomplete', `Git could not finish workspace setup (${safeCode(error)}); receipt and any output were retained for inspection`);
  }
  return verifyWorkspace(expected, false);
}

// Remove only a receipt-verified, clean worktree that has not advanced beyond its base.
export function removeTaskWorkspace({ taskId, repositoryPath, baseCommit, branch, workspaceRoot } = {}) {
  validateInput({ taskId, repositoryPath, baseCommit, branch, workspaceRoot });
  const repo = gitRoot(repositoryPath);
  const root = canonical(workspaceRoot);
  const receiptPath = join(root, `${taskId}.workspace.json`);
  const expected = { version: RECEIPT_VERSION, taskId, repository: repo, baseCommit, branch,
    workspacePath: join(root, taskId) };
  const receipt = readReceipt(receiptPath);
  if (!sameReceipt(receipt, expected)) fail('workspace_conflict', 'workspace receipt does not match the task');
  const workspace = verifyWorkspace(expected, true);
  if (git(['status', '--porcelain', '--untracked-files=all'], workspace.workspacePath)) {
    fail('workspace_dirty', 'workspace contains changes; output and receipt were preserved');
  }
  const head = git(['rev-parse', 'HEAD'], workspace.workspacePath);
  if (head !== baseCommit) fail('workspace_advanced', 'workspace advanced beyond its base; output and branch were preserved');
  const branchHead = git(['rev-parse', `refs/heads/${branch}`], repo);
  if (branchHead !== baseCommit) fail('workspace_advanced', 'task branch moved; workspace and branch were preserved');

  git(['worktree', 'remove', workspace.workspacePath], repo);
  try { git(['update-ref', '-d', `refs/heads/${branch}`, baseCommit], repo); }
  catch (error) { fail('workspace_incomplete', `worktree removed but its branch could not be removed (${safeCode(error)}); receipt was retained`); }
  unlinkSync(receiptPath);
  return { removed: true, workspacePath: workspace.workspacePath };
}

function verifyWorkspace(expected, reused) {
  let actualPath;
  try { actualPath = canonical(expected.workspacePath); }
  catch { fail('workspace_incomplete', 'receipt exists but its worktree path is missing'); }
  if (actualPath !== expected.workspacePath) fail('workspace_conflict', 'workspace path was moved or redirected');
  const top = canonical(git(['rev-parse', '--show-toplevel'], actualPath));
  const common = gitCommonDir(actualPath);
  if (top !== expected.workspacePath || common !== gitCommonDir(expected.repository)) {
    fail('workspace_conflict', 'worktree repository identity does not match its receipt');
  }
  const head = git(['rev-parse', 'HEAD'], actualPath);
  const currentBranch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], actualPath);
  if (currentBranch !== expected.branch) {
    fail('workspace_conflict', 'worktree HEAD or branch does not match its receipt');
  }
  try { git(['merge-base', '--is-ancestor', expected.baseCommit, head], actualPath); }
  catch { fail('workspace_conflict', 'worktree HEAD is not based on its receipt commit'); }
  return { ...expected, head, reused };
}

function gitRoot(path) {
  const target = canonical(path);
  return canonical(git(['rev-parse', '--show-toplevel'], target));
}

function gitCommonDir(repo) {
  const value = git(['rev-parse', '--git-common-dir'], repo);
  return canonical(isAbsolute(value) ? value : join(repo, value));
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new WorkspaceError('git_error', `Git operation failed (${safeCode(error)})`);
  }
}

function readReceipt(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) fail('workspace_conflict', 'workspace receipt is not a regular file');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('workspace_conflict', 'workspace receipt is malformed');
    return value;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    fail('workspace_conflict', 'workspace receipt is missing or unreadable');
  }
}

function sameReceipt(actual, expected) {
  return Object.keys(expected).every(key => actual[key] === expected[key]) &&
    Object.keys(actual).every(key => Object.hasOwn(expected, key));
}

function validateInput({ taskId, repositoryPath, baseCommit, branch, workspaceRoot }) {
  if (typeof taskId !== 'string' || !/^[0-9a-f-]{36}$/i.test(taskId) || basename(taskId) !== taskId ||
      typeof repositoryPath !== 'string' || !repositoryPath ||
      typeof baseCommit !== 'string' || !/^[0-9a-f]{40,64}$/.test(baseCommit) ||
      typeof branch !== 'string' || !branch || branch.startsWith('-') ||
      typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) {
    fail('invalid_argument', 'invalid task workspace options');
  }
}

function canonical(path) {
  try { return realpathSync.native(resolve(path)); }
  catch { fail('invalid_argument', 'workspace or repository path does not exist'); }
}

function contained(child, parent) {
  const a = process.platform === 'win32' ? child.toLowerCase() : child;
  const b = process.platform === 'win32' ? parent.toLowerCase() : parent;
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

function workspaceError(error) {
  return new WorkspaceError('unavailable', `cannot reserve task workspace (${safeCode(error)})`);
}
function safeCode(error) { return typeof error?.code === 'string' ? error.code : 'unknown'; }
function fail(code, message) { throw new WorkspaceError(code, message); }

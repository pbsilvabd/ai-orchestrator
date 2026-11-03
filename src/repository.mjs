// Repository identity and Git validation for task acceptance (B03).
// Validates that an accepted task references a real allowed Git repository, a resolved
// base commit SHA, and a valid, unused branch name.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export class RepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RepositoryError(code, message);
}

// Canonical directory containment check. Ensures childPath is strictly equal to
// parentPath or within a subdirectory of parentPath, preventing path-prefix sibling
// bypasses (e.g. /app/repo-evil vs /app/repo).
export function isPathContained(childPath, parentPath) {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  if (process.platform === 'win32') {
    const childNorm = child.toLowerCase();
    const parentNorm = parent.toLowerCase();
    if (childNorm === parentNorm) return true;
    const parentWithSep = parentNorm.endsWith(sep) ? parentNorm : parentNorm + sep;
    return childNorm.startsWith(parentWithSep);
  }
  if (child === parent) return true;
  const parentWithSep = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(parentWithSep);
}

// Resolves the real filesystem path, following symlinks and junctions.
export function resolveCanonicalPath(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    fail('invalid_argument', 'path must be a non-empty string');
  }
  try {
    const resolved = resolve(targetPath);
    if (typeof realpathSync.native === 'function') {
      return realpathSync.native(resolved);
    }
    return realpathSync(resolved);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      fail('invalid_argument', 'repository.path does not exist or is not accessible');
    }
    fail('invalid_argument', 'cannot resolve repository.path');
  }
}

// Executes a Git command using argument arrays without a shell.
function execGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail('unavailable', 'git binary is not available');
    }
    throw error;
  }
}

// Validates repository identity, resolving base commit SHA and ensuring branch availability.
// Runs only for new task submissions (never on identical idempotency replays).
export function validateRepositoryIdentity({ repositoryPath, writableRoots = [], baseRef, branch }) {
  // 1. Resolve canonical path and enforce boundary containment against configured roots.
  const canonicalRepo = resolveCanonicalPath(repositoryPath);
  const canonicalRoots = (Array.isArray(writableRoots) ? writableRoots : []).map(root => {
    try {
      if (typeof realpathSync.native === 'function') {
        return realpathSync.native(resolve(root));
      }
      return realpathSync(resolve(root));
    } catch {
      return resolve(root);
    }
  });

  const insideRoot = canonicalRoots.some(root => isPathContained(canonicalRepo, root));
  if (!insideRoot) {
    fail('authorization_denied', 'repository.path is outside the configured writable roots');
  }

  // 2. Verify that canonicalRepo is a real Git repository work tree.
  try {
    const insideWorkTree = execGit(['rev-parse', '--is-inside-work-tree'], canonicalRepo).trim();
    if (insideWorkTree !== 'true') {
      fail('invalid_argument', 'repository.path is not inside a git work tree');
    }
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    fail('invalid_argument', 'repository.path is not a git repository');
  }

  // 3. Validate baseRef: must be a single commit-ish resolving to a commit.
  // Reject leading options, revision ranges, whitespace and control characters.
  if (typeof baseRef !== 'string' || baseRef.trim().length === 0) {
    fail('invalid_argument', 'repository.baseRef must be a non-empty string');
  }
  if (baseRef.startsWith('-')) {
    fail('invalid_argument', 'repository.baseRef cannot start with a hyphen');
  }
  if (baseRef.includes('..')) {
    fail('invalid_argument', 'repository.baseRef cannot be a revision range');
  }
  if (/[\s\x00-\x1f]/.test(baseRef)) {
    fail('invalid_argument', 'repository.baseRef contains illegal characters');
  }

  let baseCommitSha;
  try {
    baseCommitSha = execGit(['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`], canonicalRepo).trim();
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    fail('invalid_argument', 'repository.baseRef does not resolve to a commit');
  }

  if (!/^[0-9a-f]{40,64}$/.test(baseCommitSha)) {
    fail('invalid_argument', 'resolved base commit SHA is malformed');
  }

  // 4. Validate branch: must be a legal ref name and absent locally.
  if (typeof branch !== 'string' || branch.trim().length === 0) {
    fail('invalid_argument', 'repository.branch must be a non-empty string');
  }
  if (branch.startsWith('-')) {
    fail('invalid_argument', 'repository.branch cannot start with a hyphen');
  }
  if (branch.includes('..')) {
    fail('invalid_argument', 'repository.branch cannot contain revision ranges');
  }
  if (/[\s\x00-\x1f]/.test(branch)) {
    fail('invalid_argument', 'repository.branch contains illegal characters');
  }

  try {
    execGit(['check-ref-format', '--branch', branch], canonicalRepo);
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    fail('invalid_argument', 'repository.branch is not a valid branch name');
  }

  // Check existing local branches and directory/file ref collisions.
  let existingBranches = [];
  try {
    const refsOutput = execGit(['for-each-ref', '--format=%(refname)', 'refs/heads/'], canonicalRepo);
    existingBranches = refsOutput.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    fail('invalid_argument', 'failed to inspect git repository refs');
  }

  const targetRef = `refs/heads/${branch}`;
  if (existingBranches.includes(targetRef)) {
    fail('invalid_argument', 'repository.branch already exists');
  }
  if (existingBranches.some(ref => ref.startsWith(`${targetRef}/`) || targetRef.startsWith(`${ref}/`))) {
    fail('invalid_argument', 'repository.branch collides with an existing branch hierarchy');
  }

  // Check linked worktrees: branch must not be checked out in another worktree.
  try {
    const worktreesOutput = execGit(['worktree', 'list', '--porcelain'], canonicalRepo);
    const checkedOutRef = `branch refs/heads/${branch}`;
    const lines = worktreesOutput.split(/\r?\n/).map(line => line.trim());
    if (lines.includes(checkedOutRef)) {
      fail('invalid_argument', 'repository.branch is already checked out in a worktree');
    }
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
  }

  return {
    canonicalRepo,
    baseCommitSha,
  };
}


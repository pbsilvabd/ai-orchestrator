import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RepositoryError,
  isPathContained,
  resolveCanonicalPath,
  validateRepositoryIdentity,
} from '../src/repository.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'test-repo-helper-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function initGitRepo(dir) {
  execFileSync('git', ['init', dir], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test Runner'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'Initial commit'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', dir, 'branch', '-M', 'main'], { stdio: 'ignore', windowsHide: true });
}

test('isPathContained handles boundaries, siblings and separators', () => {
  const base = join(tmpdir(), 'base-repo');
  const child = join(base, 'src', 'index.js');
  const sibling = `${base}-sibling`;
  const parent = tmpdir();

  assert.equal(isPathContained(base, base), true);
  assert.equal(isPathContained(child, base), true);
  assert.equal(isPathContained(sibling, base), false);
  assert.equal(isPathContained(parent, base), false);

  if (process.platform === 'win32') {
    assert.equal(isPathContained(base.toLowerCase(), base.toUpperCase()), true);
  }
});

test('resolveCanonicalPath validates existence and throws RepositoryError', t => {
  const dir = fixture(t);
  assert.equal(typeof resolveCanonicalPath(dir), 'string');
  assert.throws(() => resolveCanonicalPath(''), e => e instanceof RepositoryError && e.code === 'invalid_argument');
  assert.throws(() => resolveCanonicalPath(join(dir, 'does-not-exist')), e => e instanceof RepositoryError && e.code === 'invalid_argument');
});

test('validateRepositoryIdentity resolves commit-ish and verifies absent branch', t => {
  const dir = fixture(t);
  initGitRepo(dir);

  const result = validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: 'task/new-feature',
  });

  assert.match(result.baseCommitSha, /^[0-9a-f]{40,64}$/);
  assert.equal(typeof result.canonicalRepo, 'string');
});

test('validateRepositoryIdentity rejects non-git directory and uncontained roots', t => {
  const dir = fixture(t);
  // Empty dir without git
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: 'task/feature',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Directory outside writable roots
  const gitDir = fixture(t);
  initGitRepo(gitDir);
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: gitDir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: 'task/feature',
  }), e => e instanceof RepositoryError && e.code === 'authorization_denied');
});

test('validateRepositoryIdentity rejects invalid baseRef values', t => {
  const dir = fixture(t);
  initGitRepo(dir);

  // Leading hyphen
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: '-main',
    branch: 'task/feature',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Range
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main..HEAD',
    branch: 'task/feature',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Illegal characters (spaces)
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main ref',
    branch: 'task/feature',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Non-commit object (e.g. tree)
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main^{tree}',
    branch: 'task/feature',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Missing ref
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'nonexistent-ref',
    branch: 'task/feature',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');
});

test('validateRepositoryIdentity rejects invalid and colliding branch names', t => {
  const dir = fixture(t);
  initGitRepo(dir);

  // Leading hyphen
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: '-feature',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Range
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: 'feat..ure',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Illegal git ref format
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: 'feat/../ure',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // Existing branch
  execFileSync('git', ['-C', dir, 'branch', 'task/existing', 'main'], { stdio: 'ignore' });
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: 'task/existing',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');

  // D/F directory-file collision with existing branch
  assert.throws(() => validateRepositoryIdentity({
    repositoryPath: dir,
    writableRoots: [dir],
    baseRef: 'main',
    branch: 'task/existing/sub',
  }), e => e instanceof RepositoryError && e.code === 'invalid_argument');
});


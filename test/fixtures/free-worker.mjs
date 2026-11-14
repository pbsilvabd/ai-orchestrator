import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FREE_MODEL, FREE_MODEL_ID, FREE_ENDPOINT, FREE_PACKAGE, freeRequestHash } from '../../src/free-provider.mjs';

export function metadata() {
  return { observedAt: Date.now(), model: { id: FREE_MODEL_ID, owned_by: 'opencode', type: 'chat',
    modalities: { input: ['text'], output: ['text'] }, capabilities: { tools: { supported: true } },
    limit: { context: 200_000, output: 32_000 },
    cost: { text: { input: { price: 0, cache: { read: 0 } }, output: { price: 0 } } },
    api: { 'chat-completions': { base_url: FREE_ENDPOINT, sdk: { opencodeai: FREE_PACKAGE } } } } };
}

export const approvalFor = request => ({ schemaVersion: 1, model: FREE_MODEL,
  requestHash: freeRequestHash(request), expiresAt: Date.now() + 60_000,
  paidBudgetUSD: 0, privacyAcknowledged: true, actor: 'fixture-human' });

export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'free-worker-'));
  const repositoryPath = join(root, 'repository');
  const workspacePath = join(root, 'builder-workspace');
  const home = join(root, 'home');
  mkdirSync(repositoryPath);
  mkdirSync(workspacePath);
  mkdirSync(home);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = join(root, 'empty-config');
  writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...args) => execFileSync('git', args, { cwd: repositoryPath, env,
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
  git('init', '--template=');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(repositoryPath, 'src'));
  writeFileSync(join(repositoryPath, 'src', 'base.txt'), 'base\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture base');
  const baseCommit = git('rev-parse', 'HEAD');
  const request = { clientId: 'free-fixture', idempotencyKey: 'free-test',
    objective: 'Add a synthetic fixture in src only', acceptanceCriteria: ['node --test passes'],
    repository: { path: repositoryPath, baseRef: baseCommit, branch: 'task/free-fixture' },
    authorization: { models: [FREE_MODEL], tools: ['read', 'edit'], writablePaths: ['src/**'] },
    limits: { maxAttempts: 1, budgetMs: 30_000, maxOutputBytes: 65_536 } };
  const task = { taskId: '00000000-0000-4000-8000-000000000001', baseCommit, request,
    attempts: [{ attemptId: '00000000-0000-4000-8000-000000000002' }] };
  const workspace = { taskId: task.taskId, repository: repositoryPath, workspacePath,
    baseCommit, head: baseCommit, branch: request.repository.branch };
  const config = { clientId: request.clientId, authorization: { models: [FREE_MODEL],
    tools: ['read', 'edit'], writableRoots: [repositoryPath] }, limits: { ...request.limits } };
  const options = { task, workspace, executable: process.execPath, configRoot: join(root, 'runtime'),
    stateRoot: join(root, 'runtime', 'state'), authorizedModel: FREE_MODEL,
    allowedTools: ['read', 'edit'], writablePaths: ['src/**'],
    provider: { kind: 'opencode-free', package: FREE_PACKAGE, baseURL: FREE_ENDPOINT },
    freeApproval: approvalFor(request), freeMetadata: metadata(), hostEnvironment: {} };
  const services = [];
  t.after(async () => {
    let safe = true;
    for (const service of services) {
      const closed = await service.close();
      if (closed?.releaseOwnership === false) safe = false;
    }
    if (safe) rmSync(root, { recursive: true, maxRetries: 10, retryDelay: 100 });
    else throw new Error('uncertain fixture retained; explicit process inspection required');
  });
  return { root, repositoryPath, workspacePath, home, baseCommit, task, workspace,
    request, config, options, git, services };
}

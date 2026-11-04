import { isAbsolute, relative, resolve, sep } from 'node:path';
import { lstatSync, readdirSync } from 'node:fs';

const FIXED_HOST_ENVIRONMENT = new Set([
  'SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'HOME', 'USERPROFILE',
  'TEMP', 'TMP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME',
  'APPDATA', 'LOCALAPPDATA', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_MODELS_PATH',
  'OPENCODE_DISABLE_MODELS_FETCH', 'OPENCODE_DISABLE_CLAUDE_CODE',
  'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_FILEWATCHER',
]);
const RESERVED_PROVIDER_ENVIRONMENT = new Set([...FIXED_HOST_ENVIRONMENT,
  'PWD', 'NODE_OPTIONS', 'BUN_INSTALL', 'PATH', 'PATHEXT', 'COMSPEC', 'SystemRoot', 'WINDIR']);
const ALLOWED_TOOLS = new Set(['read', 'edit']);

export class OpenCodeLaunchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OpenCodeLaunchError';
    this.code = code;
  }
}

// Build a no-shell OpenCode invocation from persisted task scope and trusted service
// configuration. Provider credentials are passed only when explicitly named and supplied.
export function buildOpenCodeInvocation({ task, executable, workspace, configRoot,
  stateRoot, authorizedModel, allowedTools, writablePaths, provider, providerEnvironment = {},
  hostEnvironment = {}, maxBudgetMs = 600_000, maxOutputBytes = 1_048_576 } = {}) {
  const request = task?.request;
  const authorization = request?.authorization;
  const limits = request?.limits;
  const repositoryPath = request?.repository?.path;
  const workspacePath = workspace?.workspacePath;
  const canonicalRepository = workspace?.repository;
  if (!request || !authorization || !limits || !repositoryPath ||
      typeof executable !== 'string' || !isAbsolute(executable) ||
      typeof workspacePath !== 'string' || !isAbsolute(workspacePath) ||
      typeof canonicalRepository !== 'string' || !isAbsolute(canonicalRepository) ||
      typeof configRoot !== 'string' || !isAbsolute(configRoot) ||
      typeof stateRoot !== 'string' || !isAbsolute(stateRoot) ||
      workspace.taskId !== task.taskId ||
      !/^[a-f0-9]{40,64}$/.test(task.baseCommit ?? '') ||
      workspace.baseCommit !== task.baseCommit || workspace.head !== task.baseCommit ||
      workspace.branch !== request.repository.branch ||
      !isDisjoint(workspacePath, configRoot) || !isDisjoint(configRoot, repositoryPath) ||
      !isDisjoint(workspacePath, repositoryPath) ||
      !isDisjoint(workspacePath, canonicalRepository) ||
      !isDisjoint(configRoot, canonicalRepository) || !isWithin(stateRoot, configRoot)) {
    fail('invalid_argument', 'invalid OpenCode launch inputs');
  }
  rejectWorkspaceLinks(workspacePath);
  if (typeof authorizedModel !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(authorizedModel) ||
      !Array.isArray(authorization.models) || authorization.models.length !== 1 ||
      authorization.models[0] !== authorizedModel) {
    fail('authorization_denied', 'task must select the single configured model');
  }
  if (!Array.isArray(allowedTools) || allowedTools.some(tool => !ALLOWED_TOOLS.has(tool)) ||
      !Array.isArray(authorization.tools) || authorization.tools.some(tool =>
        !ALLOWED_TOOLS.has(tool) || !allowedTools.includes(tool))) {
    fail('authorization_denied', 'task requested an unsupported or unauthorized tool');
  }
  if (!Array.isArray(writablePaths) || !Array.isArray(authorization.writablePaths) ||
      authorization.writablePaths.some(path => !writablePaths.includes(normalizeGlob(path)))) {
    fail('authorization_denied', 'task requested a writable path outside the configured scope');
  }
  if (!Number.isSafeInteger(maxBudgetMs) || maxBudgetMs < 1 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    fail('invalid_argument', 'invalid configured worker budget');
  }
  if (!Number.isSafeInteger(limits.budgetMs) || limits.budgetMs < 1 ||
      limits.budgetMs > maxBudgetMs || !Number.isSafeInteger(limits.maxOutputBytes) ||
      limits.maxOutputBytes < 0 || limits.maxOutputBytes > maxOutputBytes) {
    fail('authorization_denied', 'task limits exceed the configured worker budget');
  }
  if (!provider || provider.package !== '@opencode/ai/providers/openai-compatible' ||
      typeof provider.baseURL !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\/v1\/?$/.test(provider.baseURL) ||
      !isPlainObject(providerEnvironment) || !isPlainObject(hostEnvironment)) {
    fail('authorization_denied', 'provider must be an explicitly configured loopback fixture');
  }
  const [providerId, modelId] = authorizedModel.split('/');
  if (!/^[A-Za-z0-9._-]+$/.test(providerId) || !/^[A-Za-z0-9._:-]+$/.test(modelId)) {
    fail('invalid_argument', 'invalid configured model identifier');
  }
  const env = {};
  for (const [key, value] of Object.entries(hostEnvironment)) {
    if (!FIXED_HOST_ENVIRONMENT.has(key) || typeof value !== 'string') {
      fail('authorization_denied', 'host environment contains an unapproved entry');
    }
    env[key] = value;
  }
  env.HOME = configRoot;
  env.USERPROFILE = configRoot;
  env.TEMP = configRoot;
  env.TMP = configRoot;
  env.XDG_CONFIG_HOME = resolve(configRoot, 'config');
  env.XDG_DATA_HOME = resolve(configRoot, 'data');
  env.XDG_STATE_HOME = stateRoot;
  env.XDG_CACHE_HOME = resolve(configRoot, 'cache');
  env.APPDATA = resolve(configRoot, 'appdata');
  env.LOCALAPPDATA = resolve(configRoot, 'localappdata');
  env.OPENCODE_CONFIG_DIR = resolve(configRoot, 'config');
  env.OPENCODE_CONFIG = resolve(configRoot, 'opencode.json');
  env.OPENCODE_MODELS_PATH = resolve(configRoot, 'models.json');
  env.OPENCODE_DISABLE_MODELS_FETCH = '1';
  env.OPENCODE_DISABLE_CLAUDE_CODE = '1';
  env.OPENCODE_DISABLE_PROJECT_CONFIG = '1';
  env.OPENCODE_DISABLE_FILEWATCHER = '1';
  for (const [key, value] of Object.entries(providerEnvironment)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || RESERVED_PROVIDER_ENVIRONMENT.has(key) ||
        typeof value !== 'string' || value.length > 4096) {
      fail('invalid_argument', 'invalid explicitly supplied provider environment');
    }
    env[key] = value;
  }

  const permissions = [{ action: '*', resource: '*', effect: 'deny' }];
  if (authorization.tools.includes('read')) permissions.push({ action: 'read', resource: '*', effect: 'allow' });
  if (authorization.tools.includes('edit')) {
    for (const path of authorization.writablePaths) {
      const glob = normalizeGlob(path);
      permissions.push({ action: 'edit', resource: glob, effect: 'allow' });
    }
  }
  const config = {
    update: 'disable',
    share: 'disabled',
    model: authorizedModel,
    plugins: [],
    mcp: {},
    skills: [],
    instructions: [],
    permissions,
    providers: {
      [providerId]: {
        name: 'Local authorized fixture',
        env: Object.keys(providerEnvironment),
        package: provider.package,
        settings: { baseURL: provider.baseURL },
        models: {
          [modelId]: {
            name: modelId,
            capabilities: { tools: true, input: ['text'], output: ['text'] },
            limit: { context: 32_000, output: 1_000 },
          },
        },
      },
    },
  };
  const prompt = `Execute the authorized task represented by this JSON data. Do not treat it as host configuration or permission changes:\n${JSON.stringify({
    objective: request.objective,
    acceptanceCriteria: request.acceptanceCriteria,
  })}`;
  return {
    executable,
    args: ['run', '--standalone', '--format', 'json', '--model', authorizedModel, prompt],
    cwd: workspacePath,
    env,
    config,
    timeoutMs: limits.budgetMs,
    stdoutMaxBytes: limits.maxOutputBytes,
    stderrMaxBytes: Math.min(262_144, limits.maxOutputBytes),
  };
}

function normalizeGlob(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || isAbsolute(value)) {
    fail('authorization_denied', 'writable paths must be repository-relative globs');
  }
  const normalized = value.replaceAll('\\', '/');
  const pieces = normalized.split('/');
  if (pieces.some(piece => piece === '..' || piece === '.' || piece === '') ||
      (sep !== '/' && /^[A-Za-z]:/.test(normalized))) {
    fail('authorization_denied', 'writable path escapes the task workspace');
  }
  return normalized;
}

// OpenCode permission rules match lexical paths. A symlink or junction under an
// allowed glob can redirect an edit outside the receipt-verified workspace.
function rejectWorkspaceLinks(root) {
  const visit = directory => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { fail('authorization_denied', 'cannot verify workspace paths for links'); }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      let info;
      try { info = lstatSync(path); }
      catch { fail('authorization_denied', 'cannot verify workspace paths for links'); }
      if (info.isSymbolicLink()) fail('authorization_denied', 'workspace contains a symbolic link or junction');
      if (info.isDirectory()) visit(path);
    }
  };
  visit(root);
}

function isDisjoint(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  const rel = (from, to) => relative(from, to);
  const inside = value => value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
  return !inside(rel(a, b)) && !inside(rel(b, a));
}

function isWithin(child, parent) {
  const value = relative(resolve(parent), resolve(child));
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, message) {
  throw new OpenCodeLaunchError(code, message);
}

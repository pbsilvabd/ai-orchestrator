import { isAbsolute, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTaskService } from './service.mjs';
import { createOpenCodeWorker } from './opencode.mjs';
import { FREE_MODEL, FREE_PACKAGE, validateFreeApproval } from './free-provider.mjs';

// No account discovery, ambient credentials or task-supplied configuration.
// The second argument is trusted application code, never JSON/MCP input. Live
// composition is closed: the pinned host follows model-request redirects and the guard
// cannot see or block them (B29-05), so only an explicit loopback fixture composes.
export async function createConfiguredTaskService({ home, config, approvalFile,
  hostEnvironment = {}, admission } = {}, { metadata, fixtureEndpoint } = {}) {
  if (config?.worker === undefined) return createTaskService({ home, config, admission });
  const settings = config.worker;
  const invalid = () => { throw new Error('invalid free worker service configuration'); };
  if (!settings || settings.type !== 'opencode-free' ||
      Object.keys(settings).some(key => !['type', 'executable', 'writablePaths'].includes(key)) ||
      !isAbsolute(settings.executable ?? '') || !isAbsolute(home ?? '') ||
      !Array.isArray(settings.writablePaths) || !settings.writablePaths.length ||
      settings.writablePaths.some(path => typeof path !== 'string' || !path || isAbsolute(path) ||
        path.replaceAll('\\', '/').split('/').some(part => !part || part === '.' || part === '..')) ||
      config.authorization?.models?.length !== 1 || config.authorization.models[0] !== FREE_MODEL ||
      !Array.isArray(config.authorization.tools) ||
      config.authorization.tools.some(tool => !['read', 'edit'].includes(tool)) ||
      config.limits?.maxAttempts !== 1 || !Number.isSafeInteger(config.limits.budgetMs) ||
      config.limits.budgetMs < 1 || config.limits.budgetMs > 600_000 ||
      !Number.isSafeInteger(config.limits.maxOutputBytes) || config.limits.maxOutputBytes < 0 ||
      config.limits.maxOutputBytes > 1_048_576) invalid();
  if (fixtureEndpoint === undefined) {
    throw new Error('live free route is blocked: pinned host redirects are not controlled (B29-05)');
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(fixtureEndpoint)) invalid();
  let approval;
  if (approvalFile !== undefined) {
    if (!isAbsolute(approvalFile)) invalid();
    try { approval = JSON.parse(readFileSync(approvalFile, 'utf8').replace(/^\uFEFF/, '')); }
    catch { invalid(); }
    validateFreeApproval(approval);
  }
  // Missing approval creates a locked preparation service with no metadata lookup.
  // Metadata is trusted input from the caller, required only when approval is supplied.
  let snapshot;
  if (approval !== undefined) {
    if (typeof metadata !== 'function') invalid();
    snapshot = await metadata();
  }
  const provider = { kind: 'opencode-free-fixture', package: FREE_PACKAGE, baseURL: fixtureEndpoint };
  const worker = createOpenCodeWorker({ executable: settings.executable,
    runtimeRoot: join(home, 'runtime'), authorizedModel: FREE_MODEL,
    allowedTools: config.authorization.tools, writablePaths: settings.writablePaths,
    provider, freeApproval: approval, freeMetadata: snapshot, hostEnvironment,
    maxBudgetMs: config.limits.budgetMs, maxOutputBytes: config.limits.maxOutputBytes,
    testCommands: [{ executable: process.execPath, args: ['--test'], label: 'node --test', env: {} }],
  });
  return createTaskService({ home, config, worker, admission });
}

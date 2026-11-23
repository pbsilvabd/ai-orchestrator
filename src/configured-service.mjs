import { isAbsolute, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTaskService, openTaskHome } from './service.mjs';
import { createOpenCodeWorker } from './opencode.mjs';
import { FREE_MODEL, FREE_PACKAGE, FREE_MAX_REQUESTS, validateFreeApproval } from './free-provider.mjs';
import { canonicalExecutablePath } from './live-approval.mjs';
import { freeListenerPlan, startFreeListeners } from './free-listeners.mjs';

// No account discovery, ambient credentials or task-supplied configuration.
// The second argument is trusted application code, never JSON/MCP input. Live
// composition is closed: the pinned host follows model-request redirects and the guard
// cannot see or block them (B29-05), so only an explicit loopback fixture composes.
// `freeListeners` (B30-04) replaces the fixture endpoint with a supervised
// relay -> gateway chain. The relay binds loopback by default and may be given an
// explicit loopback/private worker-facing address by trusted composition. Its startup authority is trusted composition only: an operator
// approval artifact (shape, expiry and zero budget checked; not a signature) plus a gate
// whose exposed digests match the plan. It is NOT an SSHSIG-verified startup. The signed
// gate verifies each submitted task (B30-05 partial).
export async function createConfiguredTaskService({ home, config, approvalFile,
  hostEnvironment = {}, admission } = {}, { metadata, fixtureEndpoint, freeListeners } = {}) {
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
  // The signed-admission gate (when supplied) must measure the SAME canonical executable the
  // configured worker will actually start. A gate built with hostExecutable A but a worker
  // configured with executable B would admit a signature for A and dispatch to B.
  if (admission?.hostExecutable !== undefined &&
      canonicalExecutablePath(admission.hostExecutable) !== canonicalExecutablePath(settings.executable))
    invalid();
  let plan;
  if (freeListeners !== undefined) {
    if (fixtureEndpoint !== undefined) invalid();
    plan = freeListenerPlan(freeListeners);
  } else {
    if (fixtureEndpoint === undefined) {
      throw new Error('live free route is blocked: pinned host redirects are not controlled (B29-05)');
    }
    if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(fixtureEndpoint)) invalid();
  }
  let approval;
  if (approvalFile !== undefined) {
    if (!isAbsolute(approvalFile)) invalid();
    try { approval = JSON.parse(readFileSync(approvalFile, 'utf8').replace(/^\uFEFF/, '')); }
    catch { invalid(); }
    validateFreeApproval(approval);
  }
  // All refusals below are pure: no lock, listener, metadata lookup or store write happens yet.
  if (plan !== undefined) {
    if (approval === undefined) throw new Error('supervised free listeners require an approved run before any start');
    if (typeof admission !== 'function' || admission.relayPolicyDigest !== plan.relayPolicyDigest ||
        admission.gatewayPolicyDigest !== plan.gatewayPolicyDigest ||
        admission.maxRequests !== plan.maxRequests) {
      throw new Error('supervised free listeners require an admission gate bound to the relay and gateway policy digests');
    }
  }
  // The worker guard's request cap must never exceed the signed approval ceiling. The
  // supervised path already requires the plan and gate to agree; the fixture path has no
  // listener plan, so the gate's own ceiling bounds the guard instead of the default
  // maximum. A gate that does not expose a usable cap is refused before any effects.
  if (admission !== undefined &&
      (!Number.isInteger(admission.maxRequests) || admission.maxRequests < 1 ||
       admission.maxRequests > FREE_MAX_REQUESTS)) {
    throw new Error('signed admission gate must expose the effective free request cap');
  }
  const freeMaxRequests = plan?.maxRequests ?? admission?.maxRequests ?? FREE_MAX_REQUESTS;

  // Supervised listeners require task-home ownership first (no double acquisition): the owner
  // lock is taken and the store reconciled before any child may bind, and it is held until the
  // listeners have stopped. A competing owner or a corrupt store therefore has zero listener
  // effects. The passive path keeps its original acquisition inside createTaskService.
  let listeners;
  const owner = plan === undefined ? undefined : openTaskHome({ home,
    beforeRelease: async () => { if (listeners !== undefined) await listeners.stop(); } });
  try {
    // Missing approval creates a locked preparation service with no metadata lookup.
    // Metadata is trusted input from the caller, required only when approval is supplied.
    let snapshot;
    if (approval !== undefined) {
      if (typeof metadata !== 'function') invalid();
      snapshot = await metadata();
    }
    if (plan !== undefined) listeners = await startFreeListeners({ home, listeners: freeListeners, plan });
    const provider = { kind: listeners === undefined ? 'opencode-free-fixture' : 'opencode-free-relay', package: FREE_PACKAGE,
      baseURL: listeners?.workerBaseURL ?? fixtureEndpoint };
    const worker = createOpenCodeWorker({ executable: settings.executable,
      runtimeRoot: join(home, 'runtime'), authorizedModel: FREE_MODEL,
      allowedTools: config.authorization.tools, writablePaths: settings.writablePaths,
      provider, freeApproval: approval, freeMetadata: snapshot, hostEnvironment,
      freeMaxRequests,
      maxBudgetMs: config.limits.budgetMs, maxOutputBytes: config.limits.maxOutputBytes,
      testCommands: [{ executable: process.execPath, args: ['--test'], label: 'node --test', env: {} }],
    });
    if (listeners === undefined) return createTaskService({ home, config, worker, admission });
    // A dead listener fails every dispatch closed: prepare throws before any child starts,
    // and the scheduler records the already-reserved dispatch as blocked, never replayed.
    const guarded = { ...worker, prepare: invocation => {
      if (!listeners.healthy()) throw Object.assign(new Error('supervised listener is not running'), { code: 'unavailable' });
      return worker.prepare(invocation);
    } };
    const service = createTaskService({ home, config, worker: guarded, admission, ownership: owner });
    const closeService = service.close;
    let closing;
    // Listeners stop only after the scheduler is idle, so a running worker keeps its relay.
    // The capability's `beforeRelease` stops them before the scheduler close releases ownership.
    service.close = () => (closing ??= closeService().then(async result => {
      await listeners.stop();
      return result;
    }, async error => {
      await listeners.stop();
      throw error;
    }));
    service.freeListenerStates = listeners.states;
    // Report the actual startup authority instead of implying the listeners were started by a
    // verified task signature. A gate that exposes no canonical host executable is a test
    // double or a generic gate and is labelled as such; that never becomes task authority.
    service.freeListenerAuthority = admission.hostExecutable === undefined
      ? `${plan.startupAuthority}; admission gate identity not exposed (test double or generic gate)`
      : plan.startupAuthority;
    return service;
  } catch (error) {
    // A failed start cleans up inside `startFreeListeners`. If that cleanup could not be
    // confirmed, do not release: the owner and the unconfirmed listener lock stay. Otherwise
    // the capability's `beforeRelease` stops any started listener before releasing ownership.
    if (owner !== undefined && !(listeners === undefined && error?.code === 'uncertain-stop'))
      await owner.releaseOwner();
    throw error;
  }
}

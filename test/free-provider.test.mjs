import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FREE_MODEL, FREE_ENDPOINT, FREE_MODEL_ID, METADATA_TTL_MS,
  freeRequestHash, validateFreeMetadata, validateFreeSubmission } from '../src/free-provider.mjs';
import { buildOpenCodeInvocation, createOpenCodeWorker } from '../src/opencode.mjs';
import { createTaskService } from '../src/service.mjs';
import { createConfiguredTaskService } from '../src/configured-service.mjs';
import { freeGuardPlugin, freeGuardSource } from '../src/free-guard.mjs';
import { approvalFor, fixture, metadata } from './fixtures/free-worker.mjs';

const denied = error => error.code === 'authorization_denied';

test('B29-01: only exact current zero-price chat/tool/API metadata is accepted', () => {
  assert.equal(validateFreeMetadata(metadata()).id, FREE_MODEL_ID);
  for (const mutate of [
    value => { value.observedAt = Date.now() - METADATA_TTL_MS - 1; },
    value => { value.observedAt = Date.now() + 10_000; },
    value => { value.model.id = 'paid-but-named-free'; },
    value => { value.model.type = 'decision'; },
    value => { value.model.capabilities.tools.supported = false; },
    value => { value.model.cost.text.output.price = 1; },
    value => { value.model.cost.text.input.cache.read = 1; },
    value => { value.model.cost.text.input.price = '0'; },
    value => { delete value.model.cost.text.input.cache; },
    value => { value.model.cost.newTier = { output: 0.01 }; },
    value => { value.model.api['chat-completions'].base_url = 'https://other.example.invalid/v1'; },
    value => { value.model.api['chat-completions'].sdk.opencodeai = 'other-package'; },
  ]) {
    const value = metadata(); mutate(value);
    assert.throws(() => validateFreeMetadata(value), denied);
  }
});

test('B29-02: approval binds canonical payload, privacy, zero budget, expiry and one attempt', t => {
  const f = fixture(t);
  assert.doesNotThrow(() => validateFreeSubmission({ request: f.request,
    approval: approvalFor(f.request), snapshot: metadata() }));
  assert.equal(freeRequestHash({ ...f.request, clientSessionId: 'reconnect' }), freeRequestHash(f.request));
  for (const mutate of [
    value => { value.approval = undefined; },
    value => { value.approval.expiresAt = Date.now() - 1; },
    value => { value.approval.expiresAt = Date.now() + 100_000_000; },
    value => { value.approval.paidBudgetUSD = 1; },
    value => { value.approval.privacyAcknowledged = false; },
    value => { value.approval.extra = true; },
    value => { value.approval.model = 'opencode/gpt-6-luna'; },
    value => { value.request.objective = 'different work'; },
    value => { value.request.limits.maxAttempts = 2; value.approval = approvalFor(value.request); },
    value => { value.request.repository.baseRef = 'main'; value.approval = approvalFor(value.request); },
    value => { value.snapshot.observedAt = 0; },
  ]) {
    const value = { request: structuredClone(f.request), approval: approvalFor(f.request), snapshot: metadata() };
    mutate(value);
    assert.throws(() => validateFreeSubmission(value), denied);
  }
});

test('B29-02: denied admission creates no task, branch, workspace or runtime; replay bypasses admission', async t => {
  const f = fixture(t);
  let permit = false;
  let starts = 0;
  const worker = { validateSubmission(request) {
    validateFreeSubmission({ request, approval: permit ? approvalFor(f.request) : undefined, snapshot: metadata() });
  }, prepare({ workspace }) {
    starts++;
    return { executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: workspace.workspacePath,
      env: {}, timeoutMs: 5_000, stdoutMaxBytes: 1024, stderrMaxBytes: 1024 };
  } };
  const service = createTaskService({ home: f.home, config: f.config, worker });
  f.services.push(service);
  assert.throws(() => service.submitTask(f.request), denied);
  assert.deepEqual(service.store.listTasks(), []);
  assert.deepEqual(readdirSync(join(f.home, 'workspaces')), []);
  assert.equal(f.git('branch', '--list', f.request.repository.branch), '');
  assert.equal(starts, 0);
  permit = true;
  const accepted = service.submitTask(f.request);
  await service.whenIdle();
  const recordPath = join(f.home, 'tasks', `${accepted.taskId}.json`);
  const before = readFileSync(recordPath);
  permit = false;
  assert.equal(service.submitTask(f.request).taskId, accepted.taskId);
  assert.deepEqual(readFileSync(recordPath), before);
  assert.equal(starts, 1);
});

test('B29-02: launch revalidates approval expiry and metadata freshness before preparation', async t => {
  const f = fixture(t);
  const expiring = { ...approvalFor(f.request), expiresAt: Date.now() + 250 };
  const worker = createOpenCodeWorker({ ...f.options, freeApproval: expiring,
    runtimeRoot: join(f.root, 'expiry-runtime') });
  await new Promise(resolveWait => setTimeout(resolveWait, 300));
  assert.throws(() => worker.prepare(f), denied);
  assert.equal(existsSync(join(f.root, 'expiry-runtime')), false,
    'A refused launch must not create runtime configuration');
  const stale = metadata();
  stale.observedAt = Date.now() - METADATA_TTL_MS - 1;
  assert.throws(() => buildOpenCodeInvocation({ ...f.options, freeMetadata: stale }), denied);
  const future = metadata();
  future.observedAt = Date.now() + 10_000;
  assert.throws(() => buildOpenCodeInvocation({ ...f.options, freeMetadata: future }), denied);
});

test('B29-02: approval expiry after admission retains the dispatch and halts the service', async t => {
  const f = fixture(t);
  const expiresAt = Date.now() + 60_000;
  const runtimeRoot = join(f.root, 'expired-service-runtime');
  const worker = createOpenCodeWorker({ ...f.options,
    freeApproval: { ...approvalFor(f.request), expiresAt }, runtimeRoot });
  const prepare = worker.prepare;
  let prepareCalls = 0;
  // Advance the clock only inside the real adapter's synchronous prepare call.
  // Admission uses the unmodified clock; no subprocess can start after refusal.
  worker.prepare = input => {
    prepareCalls++;
    const originalNow = Date.now;
    Date.now = () => expiresAt + 1;
    try { return prepare(input); }
    finally { Date.now = originalNow; }
  };
  const service = createTaskService({ home: f.home, config: f.config, worker });
  const accepted = service.submitTask(f.request);
  await service.whenIdle();
  const task = service.store.readTask(accepted.taskId);
  assert.equal(prepareCalls, 1);
  assert.equal(task.status, 'blocked');
  assert.equal(task.block.reason, 'worker-outcome-uncertain');
  assert.equal(task.block.requiresReconciliation, true);
  assert.equal(task.attempts.length, 1);
  assert.equal(task.attempts[0].outcome, null);
  assert.equal(existsSync(task.attempts[0].workspace.workspacePath), true,
    'The reserved workspace is retained for inspection');
  assert.equal(existsSync(runtimeRoot), false, 'No host runtime was created before refusal');
  assert.equal(service.schedulerStatus().stopped, true);
  assert.equal(service.schedulerStatus().requiresReconciliation, true);
  assert.equal(service.submitTask(f.request).taskId, accepted.taskId,
    'Identical replay is readable but never dispatches');
  assert.throws(() => service.submitTask({ ...f.request, idempotencyKey: 'after-expiry' }),
    error => error.code === 'unavailable');
  assert.deepEqual(await service.close(), { releaseOwnership: false });
  assert.equal(existsSync(join(f.home, 'locks', 'service-owner.lock')), true);
  // This disposable fixture verified prepare threw before returning an invocation;
  // no worker child was ever spawned. Only this isolated test home is removed.
});

test('B29-03: free launch is anonymous, isolated, guarded and inert without its plugin', t => {
  const f = fixture(t);
  const invocation = buildOpenCodeInvocation(f.options);
  assert.equal(invocation.config.model, FREE_MODEL);
  assert.deepEqual(Object.keys(invocation.config.providers), ['opencode']);
  assert.deepEqual(Object.keys(invocation.config.providers.opencode.models), [FREE_MODEL_ID]);
  assert.equal(invocation.config.providers.opencode.settings.apiKey, 'public');
  assert.equal(invocation.config.providers.opencode.settings.baseURL, 'http://127.0.0.1:1/v1');
  assert.equal(invocation.config.agents.title.disabled, true);
  assert.equal(invocation.config.compaction.auto, false);
  assert.equal(invocation.config.warming, false);
  assert.match(invocation.guardSource, /free worker request refused/);
  assert.ok(invocation.guardSource.includes(FREE_ENDPOINT));
  assert.equal(invocation.env.OPENCODE_API_KEY, undefined);
  assert.equal(invocation.env.OPENCODE_DISABLE_MODELS_FETCH, '1');
  const worker = createOpenCodeWorker({ ...f.options, runtimeRoot: join(f.root, 'worker-runtime') });
  const prepared = worker.prepare(f);
  assert.equal(readFileSync(prepared.env.OPENCODE_MODELS_PATH, 'utf8'), '{}');
  assert.equal(existsSync(prepared.config.plugins[0]), true);
  assert.throws(() => worker.prepare(f));
  for (const changes of [
    { providerEnvironment: { OPENCODE_API_KEY: 'FAKE_NOT_A_REAL_KEY' } },
    { hostEnvironment: { OPENCODE_API_KEY: 'FAKE_NOT_A_REAL_KEY' } },
    { provider: { ...f.options.provider, baseURL: 'https://paid.example.invalid/v1' } },
    { authorizedModel: `${FREE_MODEL}#high` },
    { provider: { ...f.options.provider, headers: { fake: 'override' } } },
  ]) assert.throws(() => buildOpenCodeInvocation({ ...f.options, ...changes }), denied);
});

async function guard(overrides = {}) {
  const hooks = {};
  const options = { modelID: FREE_MODEL_ID, endpoint: FREE_ENDPOINT,
    expiresAt: Date.now() + 60_000, maxRequests: 12, ...overrides };
  const generated = await import(`data:text/javascript,${encodeURIComponent(freeGuardSource(options))}`);
  await generated.default.setup({ app: { version: '2.2.5' }, session: {
    async hook(name, callback) { hooks[name] = callback; },
  } });
  return hooks;
}
// The pinned host reports the default variant as "default" (a no-op), observed in B29 integration.
const requestEvent = (changes = {}) => ({ kind: 'primary',
  model: { providerID: 'opencode', id: FREE_MODEL_ID, variant: 'default' },
  request: new Request(`${FREE_ENDPOINT}/chat/completions`, { method: 'POST',
    headers: { authorization: 'Bearer public' }, body: JSON.stringify({ model: FREE_MODEL_ID, messages: [] }) }),
  ...changes });

test('B29-03: serialized guard arms only the fixed route and skips auxiliary generation', async () => {
  const hooks = await guard();
  const model = requestEvent();
  hooks['model.request'](model);
  assert.equal(model.baseURL, FREE_ENDPOINT);
  const title = {};
  hooks.title(title);
  assert.equal(title.result, 'Authorized worker task');
  const event = requestEvent();
  await hooks['http.request'](event);
  assert.equal(event.request.url, `${FREE_ENDPOINT}/chat/completions`);
  assert.throws(() => hooks['model.request']({ ...requestEvent(), kind: 'compaction' }));
  await assert.rejects(hooks['http.request'](requestEvent()));
  await assert.rejects(freeGuardPlugin({}).setup({ app: { version: '2.2.6' } }));
});

test('B29-05: paid model, variant, credential, URL, repeated body, expiry and request cap refuse latched', async () => {
  for (const mutate of [
    event => { event.model.id = 'gpt-6-luna'; },
    event => { event.model.variant = 'high'; },
    event => { event.model.variant = null; },
    event => { event.model.providerID = 'openai'; },
    event => { event.request = new Request(event.request, { headers: { authorization: 'Bearer FAKE_BILLING_KEY' } }); },
    event => { event.request = new Request('https://paid.example.invalid', { method: 'POST', body: '{}' }); },
    event => { event.request = new Request(event.request, { body: JSON.stringify({ model: 'paid', messages: [] }) }); },
  ]) {
    const hooks = await guard(); const event = requestEvent(); mutate(event);
    await assert.rejects(hooks['http.request'](event));
    await assert.rejects(hooks['http.request'](requestEvent()));
  }
  const hooks = await guard();
  await hooks['http.request'](requestEvent());
  await assert.rejects(hooks['http.request'](requestEvent()));
  const expired = await guard({ expiresAt: 1 });
  await assert.rejects(expired['http.request'](requestEvent()));
  const bounded = await guard({ maxRequests: 1 });
  await bounded['http.request'](requestEvent());
  await assert.rejects(bounded['http.request'](requestEvent()));
});

test('B29-05: 401, 402, 429, 302 status and host retries latch the guard without fallback', async () => {
  for (const status of [401, 402, 429, 302, 500]) {
    const hooks = await guard();
    hooks['http.response']({ response: new Response('', { status }) });
    await assert.rejects(hooks['http.request'](requestEvent()));
  }
  const hooks = await guard(); const event = { decision: { retry: true, delay: 0 } };
  hooks.retry(event);
  assert.deepEqual(event.decision, { retry: false });
  await assert.rejects(hooks['http.request'](requestEvent()));
});

test('B29-04: live composition is closed; fixture composition stays locked without approval or metadata', async t => {
  const f = fixture(t);
  const passive = await createConfiguredTaskService({ home: f.home, config: f.config });
  assert.equal(passive.submitTask(f.request).status, 'queued');
  await passive.close();
  const activeConfig = { ...f.config, worker: { type: 'opencode-free', executable: process.execPath,
    writablePaths: ['src/**'] } };
  const fixtureEndpoint = 'http://127.0.0.1:43210/v1';
  let gets = 0;
  const metadataSource = async () => { gets++; return metadata(); };
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig },
    { metadata: metadataSource }), /live free route is blocked/);
  await assert.rejects(createConfiguredTaskService({ home: f.home,
    config: { ...activeConfig, worker: { ...activeConfig.worker, baseURL: FREE_ENDPOINT } } },
  { metadata: metadataSource, fixtureEndpoint }));
  await assert.rejects(createConfiguredTaskService({ home: f.home, config: activeConfig },
    { metadata: metadataSource, fixtureEndpoint: 'https://opencode.ai/inference/openai/v1' }));
  assert.equal(gets, 0);
  const service = await createConfiguredTaskService({ home: f.home, config: activeConfig },
    { metadata: metadataSource, fixtureEndpoint });
  f.services.push(service);
  const before = service.store.listTasks().length;
  assert.throws(() => service.submitTask({ ...f.request, idempotencyKey: 'new-unapproved' }), denied);
  assert.equal(service.store.listTasks().length, before);
  assert.equal(gets, 0);
  assert.deepEqual(readdirSync(join(f.home, 'workspaces')), []);
  await service.close();
  const approvalFile = join(f.home, 'approval.json');
  writeFileSync(approvalFile, JSON.stringify(approvalFor(f.request)));
  const approved = await createConfiguredTaskService({ home: f.home, config: activeConfig, approvalFile },
    { metadata: metadataSource, fixtureEndpoint });
  f.services.push(approved);
  assert.equal(gets, 1);
  assert.equal(approved.submitTask(f.request).idempotentReplay, true);
});

import { createHash } from 'node:crypto';
import { canonicalPayload } from './tasks.mjs';

export const FREE_MODEL_ID = 'deepseek-v4.1-flash-free';
export const FREE_MODEL = `opencode/${FREE_MODEL_ID}`;
export const FREE_ENDPOINT = 'https://opencode.ai/inference/openai/v1';
export const FREE_CATALOG = 'https://opencode.ai/inference/v1/models';
export const FREE_PACKAGE = '@opencode/ai/providers/openai-compatible';
export const METADATA_TTL_MS = 300_000;
export const FREE_MAX_REQUESTS = 12;

export class FreeProviderError extends Error {
  constructor() {
    super('free worker requires current metadata and explicit matching run approval');
    this.name = 'FreeProviderError';
    this.code = 'authorization_denied';
  }
}
const refuse = () => { throw new FreeProviderError(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function freeRequestHash(request) {
  return createHash('sha256').update(canonicalPayload(request)).digest('hex');
}

// Catalog data is evidence, never authority to run. No price/name inference.
export function validateFreeMetadata(snapshot, now = Date.now()) {
  const model = snapshot?.model;
  const api = model?.api?.['chat-completions'];
  if (!Number.isSafeInteger(snapshot?.observedAt) || snapshot.observedAt > now ||
      now - snapshot.observedAt > METADATA_TTL_MS || model?.id !== FREE_MODEL_ID ||
      model.type !== 'chat' || model.owned_by !== 'opencode' ||
      model.capabilities?.tools?.supported !== true ||
      !model.modalities?.input?.includes('text') || !model.modalities?.output?.includes('text') ||
      api?.base_url !== FREE_ENDPOINT || api.sdk?.opencodeai !== FREE_PACKAGE ||
      !Number.isSafeInteger(model.limit?.context) || model.limit.context < 32_000 ||
      !Number.isSafeInteger(model.limit?.output) || model.limit.output < 1_000 ||
      model.cost?.text?.input?.price !== 0 || model.cost?.text?.output?.price !== 0 ||
      model.cost?.text?.input?.cache?.read !== 0) refuse();
  const allZero = value => object(value) && Object.keys(value).length > 0 &&
    Object.values(value).every(item => object(item) ? allZero(item) : item === 0);
  if (!allZero(model.cost)) refuse();
  return model;
}

export function validateFreeApproval(approval, now = Date.now()) {
  const fields = ['schemaVersion', 'model', 'requestHash', 'expiresAt', 'paidBudgetUSD',
    'privacyAcknowledged', 'actor'];
  if (!object(approval) || Object.keys(approval).length !== fields.length ||
      fields.some(field => !Object.hasOwn(approval, field)) || approval.schemaVersion !== 1 ||
      approval.model !== FREE_MODEL || approval.paidBudgetUSD !== 0 ||
      approval.privacyAcknowledged !== true || !/^[A-Za-z0-9._:-]{1,128}$/.test(approval.actor ?? '') ||
      !/^[a-f0-9]{64}$/.test(approval.requestHash ?? '') ||
      !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= now ||
      approval.expiresAt - now > 86_400_000) refuse();
}

export function validateFreeSubmission({ request, approval, snapshot }, now = Date.now()) {
  validateFreeApproval(approval, now);
  if (!request ||
      freeRequestHash(request) !== approval.requestHash ||
      request.authorization?.models?.length !== 1 || request.authorization.models[0] !== FREE_MODEL ||
      request.limits?.maxAttempts !== 1 || !Number.isSafeInteger(request.limits.budgetMs) ||
      request.limits.budgetMs < 1 || request.limits.budgetMs > 600_000 ||
      !Number.isSafeInteger(request.limits.maxOutputBytes) || request.limits.maxOutputBytes < 0 ||
      request.limits.maxOutputBytes > 1_048_576 ||
      !/^[a-f0-9]{40,64}$/.test(request.repository?.baseRef ?? '') ||
      !Array.isArray(request.authorization.tools) ||
      request.authorization.tools.some(tool => !['read', 'edit'].includes(tool))) refuse();
  return validateFreeMetadata(snapshot, now);
}

// Metadata only; never sends a prompt/key or follows a redirect. No retry.
export async function fetchFreeMetadata() {
  try {
    const response = await fetch(FREE_CATALOG, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) refuse();
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_000_000) refuse();
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const catalog = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const models = catalog.data?.filter(model => model.id === FREE_MODEL_ID);
    if (models?.length !== 1) refuse();
    const snapshot = { observedAt: Date.now(), model: models[0] };
    validateFreeMetadata(snapshot);
    return snapshot;
  } catch { refuse(); }
}

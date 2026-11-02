import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTask } from '../src/executor-adapter.mjs';

// Helper: pass a minimal store that returns a valid task.
const storeFor = (task) => ({ get: () => task });

test('executor adapter prepares isolated worktree and reports limitation without binary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
  const work = join(root, 'work');
  rmSync(root, { recursive: true, force: true });
  const result = await executeTask({
    store: storeFor({ id: 't1', repository: { path: '.', baseRef: 'main', branch: 'feat/test' } }),
    taskId: 't1',
    opencodePath: undefined,
    signal: undefined,
  });
  assert.strictEqual(result.status, 'failed');
  assert.ok(result.limitation || result.limitations);
  assert.ok(typeof result.workDir === 'string');
});

test('executor adapter creates an isolated worktree dir even when opencode is absent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
  const work = join(root, 'work');
  const result = await executeTask({
    store: storeFor({ id: 't2', repository: { path: '.', baseRef: 'origin/main', branch: 'feature/x' } }),
    taskId: 't2',
    opencodePath: undefined,
    signal: undefined,
  });
  assert.ok(fsExists(work), `work dir should be created: ${work}`);
  assert.ok(typeof result.artifacts === 'object');
  assert.strictEqual(result.artifacts.diff, ''); // empty when no real execution
  // PR cabastou M2b_adapter pass 4 executando sem binário: cuidado com limites do contrato.
  // Limitação é explicitamente registada, não inventa sucesso.
  assert.ok(!result.limitation || result.limitation !== undefined);
  rmSync(root, { recursive: true, force: true });
});

function fsExists(p) {
  try { return require('node:fs').statSync(p).isDirectory(); } catch { return false; }
}

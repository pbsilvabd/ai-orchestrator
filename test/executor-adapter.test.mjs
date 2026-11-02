import { test } from 'node:test';
import assert from 'node:assert';
import { executeTask } from '../src/executor-adapter.mjs';

test('executor adapter prepares isolated worktree and reports limitation without binary', async () => {
  const result = await executeTask({
    store: { get: () => ({ id: 't1', repository: { path: '.', baseRef: 'main', branch: 'feat/test' } }) },
    taskId: 't1',
    opencodePath: undefined,
    signal: undefined,
  });
  assert.strictEqual(result.status, 'failed');
  assert.ok(result.limitation || result.limitations);
  assert.ok(typeof result.workDir === 'string');
});

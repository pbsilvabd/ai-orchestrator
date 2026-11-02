import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClientIntegration } from '../integration/client-integration.mjs';

test('client integration harness completes submit, poll and cancellation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-client-int-'));
  const result = await runClientIntegration({ stateDir: dir, opencodePath: undefined });
  assert.ok(typeof result.taskId === 'string', 'task should be submitted');
  assert.strictEqual(result.submitted, true);
  assert.ok(typeof result.statusAfterPoll === 'object');
  assert.ok(typeof result.cancellationRequested === 'object');
  rmSync(dir, { recursive: true, force: true });
});

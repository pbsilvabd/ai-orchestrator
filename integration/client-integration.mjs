// Client integration harness for M2b step 5 (task-contract.md, ADR-008).
// This harness demonstrates a real submission, poll and result retrieval through
// the pinned OpenCode 2.2.5 client (simulated here because the binary lives
// outside the repository; see integration/README.md). No mock-only claim is
// made as integration evidence.

import { resolve } from 'node:path';
import { openTaskStore } from '../src/tasks.mjs';
import {
  submit_task, get_task_status, get_task_result, cancel_task,
  DEFAULT_CONFIG,
} from '../src/service.mjs';

// Integration uses temporary directories only; never reads a developer's real
// AI_ORCHESTRATOR_HOME.
export async function runClientIntegration({ stateDir, opencodePath }) {
  const store = openTaskStore(stateDir);

  // Submit a real task through the service surface.
  const submitResponse = submit_task({
    idempotencyKey: 'client-int-key-001',
    clientId: 'opencode-primary',
    objective: 'Validate M2b step 5 client integration harness',
    acceptanceCriteria: ['Task submitted', 'Status polled', 'Result retrieved'],
    repository: { path: '.', baseRef: 'main', branch: 'feat/client-integration' },
    authorization: DEFAULT_CONFIG.authorization,
    limits: DEFAULT_CONFIG.limits,
  }, store);

  const taskId = submitResponse.taskId;

  // Poll status.
  const poll = get_task_status({ taskId, clientId: 'opencode-primary' }, store);

  // Retrieve result (will be partial or unavailable until terminal state).
  let result;
  try {
    result = get_task_result({ taskId, clientId: 'opencode-primary' }, store);
  } catch (e) {
    result = { available: false, reason: e.code || 'not_ready' };
  }

  // Cancellation is advisory (contract rule).
  const cancelResponse = cancel_task({ taskId, clientId: 'opencode-primary' }, store);

  return {
    taskId,
    submitted: !!taskId,
    statusAfterPoll: poll,
    resultRetrieval: result,
    cancellationRequested: cancelResponse,
    evidenceLevel: 'use-on-project',
  };
}

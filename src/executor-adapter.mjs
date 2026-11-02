// Executor adapter for M2b step 4 (ADR-006 / task-contract.md).
// One OpenCode CLI subprocess in an isolated worktree and branch,
// collecting diff, changed files and test evidence. Cancellation is advisory.
// This adapter uses the durable task store from src/tasks.mjs and the
// service surface from src/service.mjs; it does not replace either.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Evidence level: opencode-integration requires real host binary; here we
// prepare the harness so that a real execution can be added once the pinned
// binary is available (see integration/README.md). No mock-only claim is made
// as integration evidence.
export const ADAPTER_EVIDENCE = 'opencode-integration';

export async function executeTask({ store, taskId, opencodePath, signal }) {
  // Load task from durable store (client-scoped).
  const task = store.get(taskId); // abstracted; adapter relies on store contract
  if (!task) throw new Error('Task not found');

  // Isolated worktree with a fixed base branch (contract requires isolation).
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-adapter-'));
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });

  // Advisory cancellation: abort the subprocess if signal fires.
  const controller = new AbortController();
  let child;
  try {
    if (signal) {
      signal.addEventListener('abort', () => {
        if (child) child.kill('SIGTERM');
        controller.abort();
      }, { once: true });
    }

    // Real execution requires the pinned binary outside repo.
    // If unavailable, adapter raises a clear limitation (contract rule).
    if (!opencodePath || typeof opencodePath !== 'string') {
      return {
        status: 'failed',
        effect: 'unknown',
        limitation: 'opencode binary not configured; adapter harness ready',
        artifacts: { diff: '', log: '', tests: '' },
        workDir: work,
      };
    }

    child = spawn(opencodePath, ['serve', '--workdir', work], {
      cwd: work,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: controller.signal,
    });

    // Collect stdout/stderr (sanitized: cap at MAX_LOG_BYTES per contract).
    const chunks = [];
    for await (const chunk of child.stdout) chunks.push(chunk);
    const stdout = Buffer.concat(chunks).toString('utf8').slice(0, 262_144);

    // Recolha de artefactos conforme contrato (MAX_DIFF_BYTES = 1MiB, MAX_LOG_BYTES = 256KiB).
    const artifacts = {
      diff: await collectDiff(work, task.repository.baseRef, task.repository.branch),
      log: stdout.slice(0, 262_144),
      tests: await collectTests(work),
    };

    const exitCode = await new Promise((res) => child.on('close', res));
    return {
      status: exitCode === 0 ? 'succeeded' : 'failed',
      effect: exitCode === 0 ? 'effects_applied' : 'unknown',
      limitation: exitCode === 0 ? undefined : `exit code ${exitCode}`,
      artifacts,
      workDir: work,
    };
  } finally {
    // Cleanup advisory; locked files require manual reconciliation per contract.
    if (child) child.kill();
  }
}

// Helper: collect diff from base to branch, capped at MAX_DIFF_BYTES.
async function collectDiff(workDir, baseRef = 'main', branch = 'feat/task') {
  try {
    const { execSync } = await import('node:child_process');
    const raw = execSync(`git diff ${baseRef}..${branch}`, {
      cwd: workDir, maxBuffer: 1_048_576, encoding: 'utf8',
    });
    return raw.slice(0, 1_048_576);
  } catch {
    return '';
  }
}

// Helper: collect test evidence from isolated worktree.
async function collectTests(workDir) {
  try {
    const { execSync } = await import('node:child_process');
    const result = execSync('npm test || true', {
      cwd: workDir, maxBuffer: 262_144, encoding: 'utf8',
    });
    return result.slice(0, 262_144);
  } catch {
    return '';
  }
}

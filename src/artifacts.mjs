import { spawn } from 'node:child_process';
import { closeSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runSubprocess } from './subprocess.mjs';
import { redactSecrets, truncateUtf8, truncateUtf8Tail } from './redaction.mjs';

export const MAX_DIFF_BYTES = 1_048_576;
export const MAX_LOG_BYTES = 262_144;
const MAX_CHANGED_FILES = 10_000;
const EVIDENCE_LEVELS = new Set(['unit', 'local-http', 'opencode-integration', 'use-on-project']);

// Trusted producer for B13. Commands and evidence level come from service-owned
// worker configuration, never from task text or model output.
export async function collectTaskArtifacts({ task, workspace, testCommands = [],
  evidenceLevel = 'unit', remainingBudgetMs } = {}) {
  validateInputs({ task, workspace, testCommands, evidenceLevel, remainingBudgetMs });
  const limitations = [];
  const outputBudget = task.request.limits.maxOutputBytes;
  const diffCap = Math.min(MAX_DIFF_BYTES, outputBudget);
  const started = performance.now();
  const timeLeft = () => Math.max(0, remainingBudgetMs - Math.ceil(performance.now() - started));
  const runGit = (args, maxBytes, acceptedCodes) => {
    const timeoutMs = timeLeft();
    if (!timeoutMs) throw new Error('artifact budget exhausted');
    return git(workspace.workspacePath, args, maxBytes, acceptedCodes, timeoutMs);
  };

  // Run configured test commands before Git collection so workspace modifications
  // (e.g. build artifacts or test-generated files) are captured in the final diff.
  const testRuns = [];
  if (!testCommands.length) limitations.push('no trusted test command was configured');
  for (const command of testCommands) {
    const budget = timeLeft();
    if (!budget) {
      limitations.push('task budget exhausted before all configured tests ran');
      break;
    }
    const result = await runSubprocess({ executable: command.executable, args: command.args,
      cwd: workspace.workspacePath, env: command.env ?? {}, timeoutMs: budget,
      stdoutMaxBytes: MAX_LOG_BYTES, stderrMaxBytes: MAX_LOG_BYTES,
      killGraceMs: command.killGraceMs ?? 1_000 });
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const exitCode = Number.isInteger(result.code) ? result.code : -1;
    testRuns.push({
      command: command.label,
      exitCode,
      durationMs: result.durationMs,
      summary: exitCode === 0 ? 'passed' : `failed (${result.termination.reason})`,
      rawOutput: combined,
      rawTruncated: result.stdoutTruncated || result.stderrTruncated,
    });
    if (exitCode !== 0) limitations.push(`test command failed: ${command.label}`);
  }

  let headCommit = null;
  let changedFiles = [];
  let combinedDiff = '';
  let rawDiffTruncated = false;

  try {
    headCommit = (await runGit(['rev-parse', 'HEAD'], 256)).stdout.trim();
    const tracked = await runGit(
      ['diff', '--name-status', '-z', '--find-renames', task.baseCommit, '--'], 2_000_000);
    const untracked = await runGit(
      ['ls-files', '--others', '--exclude-standard', '-z'], 2_000_000);
    const paths = [...parseNameStatus(tracked.stdout), ...splitNul(untracked.stdout)];
    changedFiles = [...new Set(paths)].sort();
    if (changedFiles.length > MAX_CHANGED_FILES) {
      changedFiles = changedFiles.slice(0, MAX_CHANGED_FILES);
      limitations.push('changed file list truncated at 10000 entries');
    }

    const trackedDiff = await runGit(
      ['diff', '--no-ext-diff', '--find-renames', '--no-color', task.baseCommit, '--'], diffCap);
    combinedDiff = trackedDiff.stdout;
    rawDiffTruncated = trackedDiff.truncated;
    const binary = await runGit(
      ['diff', '--numstat', '-z', task.baseCommit, '--'], 2_000_000);
    for (const path of parseBinaryPaths(binary.stdout)) {
      limitations.push(`binary content omitted from textual diff: ${path}`);
    }

    for (const path of splitNul(untracked.stdout)) {
      const absolute = resolve(workspace.workspacePath, path);
      if (!within(absolute, workspace.workspacePath)) {
        limitations.push('untracked path escaped the task workspace');
        continue;
      }
      let stat;
      try { stat = lstatSync(absolute); } catch {
        limitations.push(`untracked file became unavailable during collection: ${path}`);
        continue;
      }
      if (!stat.isFile()) {
        limitations.push(`non-regular untracked artifact omitted: ${path}`);
        continue;
      }
      if (isBinaryFile(absolute)) {
        limitations.push(`binary content omitted from textual diff: ${path}`);
        continue;
      }
      const remaining = Math.max(0, diffCap - Buffer.byteLength(combinedDiff, 'utf8'));
      if (!remaining) { rawDiffTruncated = true; continue; }
      const untrackedDiff = await runGit(
        ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', path], remaining, [0, 1]);
      if (/^Binary files /m.test(untrackedDiff.stdout)) {
        limitations.push(`binary content omitted from textual diff: ${path}`);
      }
      combinedDiff += untrackedDiff.stdout;
      rawDiffTruncated ||= untrackedDiff.truncated;
    }
  } catch {
    limitations.push('Git artifact collection failed; diff and file evidence may be incomplete');
  }

  // Enforce byte caps and truncation flags AFTER secret redaction so secret expansion
  // (e.g. replacing short tokens with [REDACTED]) cannot cause persisted text to exceed caps.
  const sanitizedDiffRaw = combinedDiff ? redactSecrets(combinedDiff) : (combinedDiff === '' ? '' : null);
  let diff = null;
  let diffTruncated = rawDiffTruncated;
  if (sanitizedDiffRaw !== null) {
    diff = truncateUtf8(sanitizedDiffRaw, diffCap);
    if (Buffer.byteLength(sanitizedDiffRaw, 'utf8') > Buffer.byteLength(diff, 'utf8')) {
      diffTruncated = true;
    }
  }

  // Diff consumes the combined output budget before test logs, matching the contract.
  const diffBytes = diff ? Buffer.byteLength(diff, 'utf8') : 0;
  let remainingLogs = Math.min(MAX_LOG_BYTES, Math.max(0, outputBudget - diffBytes));
  let logsTruncated = false;

  const processedRuns = [];
  for (const run of testRuns) {
    const sanitizedCommand = redactSecrets(run.command);
    const sanitizedSummary = redactSecrets(run.summary);
    const sanitizedOutput = redactSecrets(run.rawOutput);
    const boundedTail = truncateUtf8Tail(sanitizedOutput, remainingLogs);
    const wasTruncated = run.rawTruncated ||
      Buffer.byteLength(sanitizedOutput, 'utf8') > Buffer.byteLength(boundedTail, 'utf8');
    if (wasTruncated) logsTruncated = true;
    remainingLogs -= Buffer.byteLength(boundedTail, 'utf8');
    processedRuns.push({
      command: sanitizedCommand,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      summary: sanitizedSummary,
      outputTail: boundedTail,
      outputTruncated: wasTruncated,
    });
  }

  const sanitizedChangedFiles = changedFiles.map(redactSecrets);
  const sanitizedLimitations = limitations.map(redactSecrets);

  return {
    baseCommit: task.baseCommit,
    branch: task.request.repository.branch,
    headCommit: headCommit !== null ? redactSecrets(headCommit) : null,
    diff,
    diffTruncated,
    changedFiles: sanitizedChangedFiles,
    testRuns: processedRuns,
    logsTruncated,
    limitations: sanitizedLimitations,
    cost: { known: false, amount: null, currency: 'unknown',
      note: 'cost is unknown until a provider is authorized' },
    evidenceLevel,
  };
}

function validateInputs({ task, workspace, testCommands, evidenceLevel, remainingBudgetMs }) {
  if (!task?.request?.limits || typeof task.baseCommit !== 'string' ||
      !workspace || !isAbsolute(workspace.workspacePath) || workspace.taskId !== task.taskId ||
      workspace.baseCommit !== task.baseCommit || !Number.isSafeInteger(remainingBudgetMs) ||
      remainingBudgetMs < 0 || !EVIDENCE_LEVELS.has(evidenceLevel) || !Array.isArray(testCommands) ||
      testCommands.some(command => !command || typeof command !== 'object' ||
        typeof command.executable !== 'string' || !isAbsolute(command.executable) ||
        !Array.isArray(command.args) || command.args.some(arg => typeof arg !== 'string') ||
        typeof command.label !== 'string' || !command.label ||
        (command.env !== undefined && (!command.env || typeof command.env !== 'object' ||
          Array.isArray(command.env) || Object.values(command.env).some(value => typeof value !== 'string'))))) {
    throw new TypeError('invalid artifact collector inputs');
  }
}

function parseNameStatus(value) {
  const tokens = splitNul(value);
  const paths = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (/^[RC]/.test(status)) paths.push(tokens[index++], tokens[index++]);
    else paths.push(tokens[index++]);
  }
  return paths.filter(Boolean);
}

function parseBinaryPaths(value) {
  const tokens = splitNul(value);
  return tokens.filter(token => token.startsWith('-\t-\t')).map(token => token.slice(4));
}

function splitNul(value) { return value.split('\0').filter(Boolean); }

function within(child, parent) {
  const value = relative(resolve(parent), resolve(child));
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

function isBinaryFile(filePath) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(8000);
    const bytesRead = readSync(fd, buffer, 0, 8000, 0);
    for (let index = 0; index < bytesRead; index++) {
      if (buffer[index] === 0) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
}

function git(cwd, args, maxBytes, acceptedCodes = [0], timeoutMs = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let retained = 0;
    let truncated = false;
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', data => {
      const remaining = Math.max(0, maxBytes - retained);
      if (remaining) { chunks.push(data.subarray(0, remaining)); retained += Math.min(data.length, remaining); }
      if (data.length > remaining) truncated = true;
    });
    child.stderr.on('data', data => { if (stderr.length < 4096) stderr += data.toString('utf8').slice(0, 4096 - stderr.length); });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) { reject(new Error('git artifact command timed out')); return; }
      if (!acceptedCodes.includes(code)) { reject(new Error('git artifact command failed')); return; }
      let bytes = Buffer.concat(chunks);
      if (truncated) {
        let end = bytes.length;
        while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
        bytes = bytes.subarray(0, end);
      }
      resolvePromise({ stdout: bytes.toString('utf8'), truncated, stderr });
    });
  });
}

// Manual, opt-in B19 pulse. This is not a service scheduler or task dispatcher.
// Usage: node integration/harness-pulse.mjs --binary <opencode.exe> --version 2.2.5 --output <new-file>
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, statSync, rmSync, readSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, resolve, join, basename, relative, sep, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isValidTaskRecord } from '../src/tasks.mjs';
import { redactSecrets } from '../src/redaction.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'integration', 'mcp-gate.mjs');
const SLOT_COUNT = 8;
const OUTPUT_CAP = 8192;
const TIMEOUT_CAP = 130_000;
const RAW_CAP = OUTPUT_CAP * 2;
const CLEANUP_GRACE_MS = 500;
const CLEANUP_WAIT_MS = 3_000;
const redact = value => redactSecrets(String(value))
  .replace(/file:\/\/\/[A-Za-z]:\/[^\r\n'"<>]*/gi, '[absolute-path]')
  .replace(/\b[A-Za-z]:\\[^\r\n"'<>|?*]*/g, '[absolute-path]')
  .replace(/(?:^|[\s("'])\/(?:Users|home|tmp|var\/tmp|private\/tmp)\/[^\r\n"'<>]*/g, ' [absolute-path]')
  .replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, '$1 [redacted]')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\s*[=:]\s*)[^\s,"'}]+/gi, '$1[redacted]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{12,}|[A-Za-z0-9_-]{24,})\b/g, '[redacted]');
const utf8Limit = (text, cap) => {
  let out = ''; let used = 0;
  for (const char of text) { const size = Buffer.byteLength(char); if (used + size > cap) break; out += char; used += size; }
  return { text: out, truncated: out.length !== text.length, bytes: used };
};

function parse(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--binary', '--version', '--output', '--timeout-ms', '--inject-failure-index', '--retry-failed', '--history-home', '--task-id'].includes(key))
      throw new Error(`Unknown option: ${key}`);
    if (key === '--retry-failed') { opts.retryFailed = true; continue; }
    const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    opts[{ '--binary':'binary', '--version':'version', '--output':'output', '--timeout-ms':'timeoutMs', '--inject-failure-index':'injectFailureIndex', '--history-home':'historyHome', '--task-id':'taskId' }[key]] = value;
  }
  if (opts.timeoutMs !== undefined) opts.timeoutMs = Number(opts.timeoutMs);
  if (opts.injectFailureIndex !== undefined) opts.injectFailureIndex = Number(opts.injectFailureIndex);
  return opts;
}

function childEnv(extra = {}) {
  const env = {};
  for (const key of ['PATH','PATHEXT','SystemRoot','WINDIR','COMSPEC','TEMP','TMP'])
    if (process.env[key]) env[key] = process.env[key];
  return Object.assign(env, extra);
}

function readPhase(phaseFile) {
  try {
    const fd = openSync(phaseFile, 'r');
    try {
      const buffer = Buffer.alloc(513); const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > 512) return { phase: 'unknown', cleanupPhase: 'unknown', cleanupStatus: 'unknown' };
      const text = buffer.subarray(0, bytes).toString('utf8');
      let metadata;
      try { metadata = JSON.parse(text); }
      catch {
        return /^(?:[a-z][a-z0-9-]{0,48}|failure:[a-z][a-z0-9-]{0,48})$/.test(text.trim())
          ? { phase: text.trim(), cleanupPhase: 'unknown', cleanupStatus: 'unknown' }
          : { phase: 'unknown', cleanupPhase: 'unknown', cleanupStatus: 'unknown' };
      }
      const validPhase = value => typeof value === 'string' &&
        /^(?:[a-z][a-z0-9-]{0,48}|failure:[a-z][a-z0-9-]{0,48})$/.test(value);
      return {
        phase: validPhase(metadata.phase) ? metadata.phase : 'unknown',
        cleanupPhase: validPhase(metadata.cleanupPhase) ? metadata.cleanupPhase : 'unknown',
        cleanupStatus: ['pending', 'complete', 'failed', 'retained_debug'].includes(metadata.cleanupStatus)
          ? metadata.cleanupStatus : 'unknown',
      };
    } finally { closeSync(fd); }
  } catch { return { phase: 'gate-start', cleanupPhase: 'unknown', cleanupStatus: 'unknown' }; }
}

function appendBounded(state, chunk) {
  const buffer = Buffer.from(chunk); state.total += buffer.length;
  if (buffer.length >= RAW_CAP) { state.chunks = [buffer.subarray(buffer.length - RAW_CAP)]; state.kept = RAW_CAP; }
  else {
    state.chunks.push(buffer); state.kept += buffer.length;
    while (state.kept > RAW_CAP) {
      const excess = state.kept - RAW_CAP;
      if (state.chunks[0].length <= excess) state.kept -= state.chunks.shift().length;
      else { state.chunks[0] = state.chunks[0].subarray(excess); state.kept -= excess; }
    }
  }
  if (state.total > RAW_CAP) state.truncated = true;
}

const groupExists = (pid, probe = (target, signal) => process.kill(target, signal)) => {
  try { probe(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return true; }
};

async function settlePosixGroup(pid, { signal = (target, value) => process.kill(target, value),
  probe = (target, value) => process.kill(target, value),
  graceMs = CLEANUP_GRACE_MS, waitMs = CLEANUP_WAIT_MS } = {}) {
  let active = groupExists(pid, probe);
  if (!active) return { groupEmptyObserved: true, cleanupVerified: true };
  try { signal(-pid, 'SIGTERM'); } catch (error) {
    // Even when graceful signalling fails, attempt the bounded forceful stop below.
    if (error.code === 'ESRCH') return { groupEmptyObserved: true, cleanupVerified: true };
  }
  const graceUntil = Date.now() + graceMs;
  while (Date.now() < graceUntil && groupExists(pid, probe)) await new Promise(resolveWait => setTimeout(resolveWait, 25));
  if (groupExists(pid, probe)) try { signal(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') return { groupEmptyObserved: false, cleanupVerified: false }; }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && groupExists(pid, probe)) await new Promise(resolveWait => setTimeout(resolveWait, 25));
  active = groupExists(pid, probe);
  return { groupEmptyObserved: !active, cleanupVerified: !active };
}

export function runPosix(binary, { timeoutMs, phaseFile, inject, gate, processOps = {} }) {
  return new Promise(resolveRun => {
    const stdoutState = { chunks: [], kept: 0, total: 0, truncated: false };
    const stderrState = { chunks: [], kept: 0, total: 0, truncated: false };
    let child; let timer; let timedOut = false; let rootExitObserved = false;
    let gateExitCode = null; let gateSignal = null; let spawnErrorCode = null; let settled = false;
    try {
      child = spawn(process.execPath, [gate, binary], { cwd: ROOT,
        env: childEnv({ MCP_GATE_PHASE_FILE: phaseFile, ...(inject ? { MCP_GATE_INJECT_FAILURE_PHASE: 'probe' } : {}) }),
        detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      return resolveRun({ gateExitCode: null, gateSignal: null, rootExitObserved: false,
        reason: 'spawn-error', spawnErrorCode: error.code ?? 'ERR_SPAWN',
        containment: { strategy: 'posix-process-group', cleanupVerified: true, groupEmptyObserved: true },
        stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
    }
    child.stdout.on('data', chunk => appendBounded(stdoutState, chunk));
    child.stderr.on('data', chunk => appendBounded(stderrState, chunk));
    const complete = async reason => {
      if (settled) return; settled = true; clearTimeout(timer);
      let containment = { strategy: 'posix-process-group', cleanupVerified: false, groupEmptyObserved: false };
      if (child.pid !== undefined) containment = { strategy: 'posix-process-group', scope: 'process-group-members-only',
        escapedDescendantsMayRemain: true, ...(await settlePosixGroup(child.pid, processOps)) };
      child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      resolveRun({ gateExitCode: reason === 'exited' ? gateExitCode : null, gateSignal: reason === 'exited' ? gateSignal : null,
        rootExitObserved, reason, spawnErrorCode, containment,
        stdout: Buffer.concat(stdoutState.chunks).toString('utf8'), stderr: Buffer.concat(stderrState.chunks).toString('utf8'),
        stdoutTruncated: stdoutState.truncated, stderrTruncated: stderrState.truncated });
    };
    child.once('error', error => {
      spawnErrorCode = error.code ?? 'ERR_SPAWN';
      if (child.pid === undefined) void complete('spawn-error');
    });
    child.once('exit', (code, signal) => {
      rootExitObserved = true; gateExitCode = code; gateSignal = signal;
      void complete(timedOut ? 'deadline' : 'exited');
    });
    timer = setTimeout(() => {
      timedOut = true;
      if (!Number.isInteger(child.pid) || child.pid < 1) { void complete('spawn-error'); return; }
      try { (processOps.signal ?? ((pid, value) => process.kill(pid, value)))(-child.pid, 'SIGTERM'); } catch { /* bounded settlement will record uncertainty */ }
      setTimeout(() => {
        if (settled) return;
        try { (processOps.signal ?? ((pid, value) => process.kill(pid, value)))(-child.pid, 'SIGKILL'); } catch { /* bounded settlement follows */ }
        setTimeout(() => { if (!settled) void complete('deadline'); }, processOps.waitMs ?? CLEANUP_WAIT_MS).unref();
      }, processOps.graceMs ?? CLEANUP_GRACE_MS).unref();
    }, timeoutMs);
  });
}

function compileWindowsLauncher(scratch) {
  const compiler = join(process.env.SystemRoot ?? process.env.WINDIR ?? '', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  if (!existsSync(compiler)) throw new Error('Windows Job Object compiler unavailable');
  const source = fileURLToPath(new URL('./fixtures/b16-windows-job.cs', import.meta.url));
  const executable = join(scratch, 'b19-windows-job.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:anycpu', `/out:${executable}`, source],
    { cwd: scratch, env: childEnv(), windowsHide: true, timeout: 30_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return executable;
}

function runWindows(binary, { timeoutMs, phaseFile, inject, gate, launcher }) {
  return new Promise(resolveRun => {
    const stdoutState = { chunks: [], kept: 0, total: 0, truncated: false };
    const stderrState = { chunks: [], kept: 0, total: 0, truncated: false };
    const marker = randomUUID(); let timedOut = false; let gateExitCode = null;
    let rootExitObserved = false; let spawnErrorCode = null; let timer; let forcedStopTimer;
    let child; let settled = false;
    try {
      child = spawn(launcher, [process.execPath, gate, binary], { cwd: ROOT,
        env: childEnv({ B19_JOB_CLEANUP_MARKER: marker, MCP_GATE_PHASE_FILE: phaseFile,
          ...(inject ? { MCP_GATE_INJECT_FAILURE_PHASE: 'probe' } : {}) }),
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      return resolveRun({ gateExitCode: null, gateSignal: null, rootExitObserved: false,
        reason: 'spawn-error', spawnErrorCode: error.code ?? 'ERR_SPAWN',
        containment: { strategy: 'windows-job-object', cleanupVerified: true, jobEmptyObserved: true },
        stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
    }
    child.stdout.on('data', chunk => appendBounded(stdoutState, chunk));
    child.stderr.on('data', chunk => appendBounded(stderrState, chunk));
    // A launcher may exit just before the timeout callback ends this control pipe.
    // Consume EPIPE/other stdin errors; the Job Object marker determines cleanup.
    child.stdin?.on('error', () => {});
    child.once('error', error => { spawnErrorCode = error.code ?? 'ERR_SPAWN'; });
    timer = setTimeout(() => {
      timedOut = true;
      try { child.stdin?.end(); } catch { /* close/Job Object markers determine the result */ }
      forcedStopTimer = setTimeout(() => { if (!settled) child.kill(); }, CLEANUP_WAIT_MS + 2_000);
    }, timeoutMs);
    child.once('close', (code, signal) => {
      settled = true; clearTimeout(timer); clearTimeout(forcedStopTimer);
      let stderr = Buffer.concat(stderrState.chunks).toString('utf8');
      const gateMatch = stderr.match(new RegExp(`(?:^|\\r?\\n)B19_GATE_EXIT:${marker}:(\\d+)(?:\\r?\\n|$)`));
      const cleanupVerified = stderr.includes(`B19_JOB_EMPTY:${marker}`);
      if (gateMatch) { rootExitObserved = true; gateExitCode = Number(gateMatch[1]); }
      stderr = stderr.replace(new RegExp(`(?:^|\\r?\\n)B19_GATE_EXIT:${marker}:\\d+(?=\\r?\\n|$)`, 'g'), '')
        .replace(new RegExp(`(?:^|\\r?\\n)B19_JOB_EMPTY:${marker}(?=\\r?\\n|$)`, 'g'), '');
      resolveRun({ gateExitCode: timedOut ? null : gateExitCode, gateSignal: null, rootExitObserved,
        reason: timedOut ? 'deadline' : cleanupVerified && rootExitObserved ? 'exited' : spawnErrorCode ? 'spawn-error' : 'containment-uncertain',
        spawnErrorCode, containment: { strategy: 'windows-job-object', cleanupVerified, jobEmptyObserved: cleanupVerified },
        stdout: Buffer.concat(stdoutState.chunks).toString('utf8'), stderr,
        stdoutTruncated: stdoutState.truncated, stderrTruncated: stderrState.truncated });
    });
  });
}

async function execute(binary, { timeoutMs, phaseFile, inject = false, gate = GATE, launcher, processOps }) {
  const startedAt = Date.now();
  const result = process.platform === 'win32'
    ? await runWindows(binary, { timeoutMs, phaseFile, inject, gate, launcher })
    : await runPosix(binary, { timeoutMs, phaseFile, inject, gate, processOps });
  const phaseData = readPhase(phaseFile);
  // B10 retains tails after its raw byte cap. A tail may begin in the middle of a
  // credential whose label/prefix was discarded, so never persist a capped stream.
  const stdout = utf8Limit(result.stdoutTruncated ? '[stdout omitted: raw capture cap reached]' : redact(result.stdout), OUTPUT_CAP);
  const stderr = utf8Limit(result.stderrTruncated ? '[stderr omitted: raw capture cap reached]' : redact(result.stderr), OUTPUT_CAP);
  const bounded = utf8Limit(`${stdout.text}${stderr.text ? `\n[stderr]\n${stderr.text}` : ''}`, OUTPUT_CAP);
  const transcript = bounded.text;
  const pass = result.reason === 'exited' && result.gateExitCode === 0 && result.containment.cleanupVerified;
  return { status: pass ? 'pass' : 'fail', phase: phaseData.phase, cleanupPhase: phaseData.cleanupPhase,
    cleanupStatus: phaseData.cleanupStatus, exitCode: result.gateExitCode, signal: result.gateSignal,
    termination: { reason: result.reason, rootExitObserved: result.rootExitObserved,
      descendantsStopped: process.platform === 'win32' && result.containment.cleanupVerified },
    containment: result.containment, durationMs: Date.now() - startedAt,
    transcript, transcriptBytes: Buffer.byteLength(transcript), transcriptTruncated: bounded.truncated || stdout.truncated || stderr.truncated || result.stdoutTruncated || result.stderrTruncated,
    sanitized: true, reason: pass ? null : result.reason === 'deadline' ? 'timeout' :
      !result.containment.cleanupVerified ? 'process_cleanup_uncertain' : result.spawnErrorCode ?? `exit_${result.gateExitCode ?? result.gateSignal ?? 'unknown'}` };
}

function verifyB17() {
  const evidencePath = join(ROOT, 'docs/evidence/B17-acceptance-matrix.json');
  if (!existsSync(evidencePath)) return { ok: false, reason: 'B17 evidence missing' };
  try {
    const report = JSON.parse(readFileSync(evidencePath, 'utf8'));
    return report.task === 'B17' && report.contract?.mappingValid === true && report.summary?.success === true && report.summary.pass === 13 &&
      report.summary.fail === 0 && report.summary.not_run === 0 ? { ok: true } : { ok: false, reason: 'B17 evidence not passing' };
  } catch { return { ok: false, reason: 'B17 evidence invalid' }; }
}

// Read-only projection: never opens the store, reconciles, schedules, launches or writes.
export function readHistory({ home, taskId }) {
  const gate = verifyB17();
  if (!gate.ok) return { track: 'task-history', status: 'not_run', reason: gate.reason };
  if (!home || !taskId) return { track: 'task-history', status: 'not_run', reason: 'explicit history home and task ID required' };
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(taskId)) return { track: 'task-history', status: 'not_run', reason: 'task ID format invalid' };
  let task;
  try {
    const homePath = realpathSync(resolve(home));
    const file = join(homePath, 'tasks', `${taskId}.json`);
    const entry = lstatSync(file);
    const actualFile = realpathSync(file);
    const fromHome = relative(homePath, actualFile);
    if (entry.isSymbolicLink() || !entry.isFile() || fromHome === '..' || fromHome.startsWith(`..${sep}`) || isAbsolute(fromHome))
      return { track: 'task-history', status: 'not_run', reason: 'task record is not a regular file inside the selected home' };
    if (statSync(file).size > 1_048_576) return { track: 'task-history', status: 'not_run', reason: 'task record exceeds 1 MiB read limit' };
    task = JSON.parse(readFileSync(file, 'utf8'));
  }
  catch { return { track: 'task-history', status: 'not_run', reason: 'task record missing or unreadable' }; }
  if (!task || task.taskId !== taskId || !isValidTaskRecord(task))
    return { track: 'task-history', status: 'not_run', reason: 'task record failed store schema or lifecycle validation' };
  const attempts = task.attempts;
  const allowedOutcomes = ['succeeded', 'failed', 'spawn-error', 'launch-failed'];
  const unknownCancellation = task.cancel.executionStopped === 'unknown' ||
    (task.cancel.requestedAt !== null && task.cancel.executionStopped !== true);
  const incoherentAttempts = (task.status === 'queued' && attempts.length > 0) ||
    (['succeeded', 'failed'].includes(task.status) && attempts.length === 0) ||
    (task.status === 'succeeded' && attempts.at(-1)?.outcome !== 'succeeded') ||
    (task.status === 'failed' && attempts.at(-1)?.outcome === 'succeeded') ||
    attempts.some(attempt => !allowedOutcomes.includes(attempt.outcome) || attempt.finishedAt == null);
  if (['running', 'blocked'].includes(task.status) || task.block !== null || unknownCancellation ||
      task.reconciliation?.administrativeOutcome === 'unknown' || incoherentAttempts)
    return { track: 'task-history', status: 'not_run', reason: 'blocked, uncertain or incoherent lifecycle history; never replayed' };
  const testRuns = task.artifact?.testRuns ?? [];
  const limitations = task.artifact?.limitations ?? [];
  const hasTests = testRuns.some(run => typeof run.command === 'string' && run.command.trim().length > 0 && Number.isInteger(run.exitCode));
  let stringBudget = 24_000; let nodes = 1_000;
  const safe = (value, depth = 0) => {
    if (nodes-- <= 0) return '[history node limit reached]';
    if (depth > 8) return '[history depth limit reached]';
    if (typeof value === 'string') {
      const bounded = utf8Limit(redact(value), Math.min(2048, stringBudget)).text;
      stringBudget = Math.max(0, stringBudget - Buffer.byteLength(bounded));
      return bounded;
    }
    if (Array.isArray(value)) return value.slice(0, 100).map(item => safe(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => {
      const identity = ['taskId', 'attemptId'].includes(key) && typeof item === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item);
      return [utf8Limit(redact(key), 256).text, identity ? item : safe(item, depth + 1)];
    }));
    return value;
  };
  const history = { track: 'task-history', status: hasTests ? 'observed' : 'not_run', taskId, taskStatus: task.status,
    attempts: attempts.slice(0, 100).map(({ attemptId, model, startedAt, finishedAt, outcome }) => ({ attemptId, model, startedAt, finishedAt, outcome })),
    testRuns, limitations, reason: hasTests ? null : 'no recorded test command and exit code; status is not inferred as success' };
  return safe(history);
}

function pathIsWithin(parent, candidate) {
  const fromParent = relative(parent, candidate);
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
}

function writeExclusiveReport(outputPath, report, { historyHome } = {}) {
  let output = resolve(outputPath);
  if (historyHome) {
    const home = realpathSync(resolve(historyHome));
    const parent = realpathSync(dirname(output));
    const canonicalOutput = join(parent, basename(output));
    if (pathIsWithin(home, canonicalOutput)) throw new Error('History report output must be outside the selected task home');
    output = canonicalOutput;
  } else mkdirSync(dirname(output), { recursive: true });
  const fd = openSync(output, 'wx');
  try { writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`); } finally { closeSync(fd); }
}

function runHistoryOnly(options) {
  if (!options.historyHome || !options.taskId || !options.output)
    throw new Error('History-only mode requires --history-home, --task-id and --output');
  if (options.binary !== undefined || options.version !== undefined || options.retryFailed ||
      options.injectFailureIndex !== undefined || options.timeoutMs !== undefined)
    throw new Error('Pulse-only options are invalid in history-only mode');
  const history = readHistory({ home: options.historyHome, taskId: options.taskId });
  const report = { schemaVersion: 1, task: 'B19', mode: 'task-history', generatedAt: new Date().toISOString(), history };
  writeExclusiveReport(options.output, report, { historyHome: options.historyHome });
  return report;
}

export async function runPulse(options, { gate = GATE, executeSample = execute, processOps } = {}) {
  if (options.historyHome !== undefined || options.taskId !== undefined) return runHistoryOnly(options);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const validConfig = Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= TIMEOUT_CAP &&
    Number.isInteger(options.injectFailureIndex ?? -1) && (options.injectFailureIndex === undefined || (options.injectFailureIndex >= 1 && options.injectFailureIndex <= SLOT_COUNT));
  let hostExists = false;
  try { hostExists = typeof options.binary === 'string' && options.binary.length > 0 &&
    existsSync(resolve(options.binary)) && statSync(resolve(options.binary)).isFile(); } catch { /* missing/invalid path is not runnable */ }
  const hostValid = hostExists && options.version === '2.2.5';
  const originals = [];
  const retries = [];
  let retainScratch = false;
  let cleanupAttempted = false;
  let cleanupFailure = null;
  const outputParent = options.output ? dirname(resolve(options.output)) : tmpdir();
  if (options.output) { mkdirSync(outputParent, { recursive: true }); if (existsSync(resolve(options.output))) throw Object.assign(new Error('Output artifact already exists'), { code: 'EEXIST' }); }
  const scratch = join(outputParent, `.b19-${process.pid}-${Date.now()}-${randomUUID()}`);
  mkdirSync(scratch, { recursive: false });
  try {
    let launcher = null; let containmentError = null;
    if (process.platform === 'win32' && validConfig && hostValid && executeSample === execute) {
      try { launcher = compileWindowsLauncher(scratch); }
      catch { containmentError = 'Windows Job Object containment unavailable'; }
    }
    let haltAfter = false;
    for (let index = 1; index <= SLOT_COUNT; index++) {
      if (haltAfter) originals.push({ index, status: 'not_run', phase: 'halted', reason: 'prior sample timed out or process cleanup was uncertain',
        transcript: '', transcriptBytes: 0, transcriptTruncated: false, sanitized: true });
      else if (!validConfig) originals.push({ index, status: 'not_run', phase: 'configuration', reason: 'invalid bounded options',
        transcript: '', transcriptBytes: 0, transcriptTruncated: false, sanitized: true });
      else if (!hostValid) originals.push({ index, status: 'not_run', phase: 'preflight', reason: !hostExists ? 'pinned binary missing' : 'pinned version must be 2.2.5',
        transcript: '', transcriptBytes: 0, transcriptTruncated: false, sanitized: true });
      else if (containmentError) originals.push({ index, status: 'not_run', phase: 'containment', reason: containmentError,
        transcript: '', transcriptBytes: 0, transcriptTruncated: false, sanitized: true });
      else {
        const phaseFile = join(scratch, `phase-${index}.txt`);
        const outcome = await executeSample(resolve(options.binary), { timeoutMs, phaseFile,
          inject: index === options.injectFailureIndex, gate, launcher, processOps });
        originals.push({ index, ...outcome });
        if (outcome.termination.reason !== 'exited' || !outcome.containment.cleanupVerified) {
          retainScratch = true;
          haltAfter = true;
        }
      }
    }
    if (options.retryFailed && !haltAfter) {
      const candidates = originals.filter(item => item.status === 'fail' && item.termination?.reason === 'exited' && item.containment?.cleanupVerified);
      let haltRetries = false;
      for (const original of candidates) {
        if (haltRetries) {
          retries.push({ originalIndex: original.index, diagnostic: true, status: 'not_run', phase: 'halted',
            reason: 'prior diagnostic retry timed out or process cleanup was uncertain', transcript: '', transcriptBytes: 0,
            transcriptTruncated: false, sanitized: true });
          continue;
        }
        const outcome = await executeSample(resolve(options.binary), { timeoutMs,
          phaseFile: join(scratch, `retry-${original.index}.txt`), gate, launcher, processOps });
        retries.push({ originalIndex: original.index, diagnostic: true, ...outcome });
        if (outcome.termination.reason !== 'exited' || !outcome.containment.cleanupVerified) {
          retainScratch = true; haltRetries = true;
        }
      }
    }
    let cleanupStatus = 'retained_uncertain_process_outcome';
    if (!retainScratch) {
      cleanupAttempted = true;
      try { rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); cleanupStatus = 'removed'; }
      catch (error) { cleanupFailure = error; cleanupStatus = 'cleanup_failed'; }
    }
    const report = { schemaVersion: 1, task: 'B19', generatedAt: new Date().toISOString(),
      version: options.version === '2.2.5' ? '2.2.5' : null,
      summary: { success: originals.length === SLOT_COUNT && originals.every(x => x.status === 'pass'), denominator: SLOT_COUNT,
        pass: originals.filter(x => x.status === 'pass').length, fail: originals.filter(x => x.status === 'fail').length,
        not_run: originals.filter(x => x.status === 'not_run').length }, originals, retries,
        cleanup: { status: cleanupStatus, descendantsStopped: false,
          ...(retainScratch ? { scratchName: basename(scratch), location: options.output ? 'report directory' : 'OS temporary directory' } : {}) } };
    if (options.output) writeExclusiveReport(options.output, report);
    if (cleanupFailure) throw new Error(`Pulse scratch cleanup failed: ${cleanupFailure.code ?? 'unknown'}`);
    return report;
  } finally {
    // The gate owns its own process tree cleanup. This wrapper only launches the gate
    // root and reports descendantsStopped=false; it never claims tree-stop proof.
    if (!retainScratch && !cleanupAttempted) try {
      cleanupAttempted = true;
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch { /* preserve the original pulse error; no successful report was written */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (!options.output) throw new Error('--output is required so the detailed report is retained');
    const report = await runPulse(options);
    console.log(JSON.stringify(report.summary ?? { mode: report.mode, historyStatus: report.history.status }));
    if (report.mode === 'task-history' ? report.history.status !== 'observed' : !report.summary.success) process.exitCode = 1;
  } catch (error) { console.error(`B19 pulse failed: ${redact(error.message)}`); process.exitCode = 1; }
}

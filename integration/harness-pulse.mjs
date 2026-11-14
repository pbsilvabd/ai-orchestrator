// Manual, opt-in B19 pulse. This is not a service scheduler or task dispatcher.
// Usage: node integration/harness-pulse.mjs --binary <opencode.exe> --version 2.2.5 --output <new-file>
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runSubprocess } from '../src/subprocess.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'integration', 'mcp-gate.mjs');
const SLOT_COUNT = 8;
const OUTPUT_CAP = 8192;
const TIMEOUT_CAP = 130_000;
const redact = text => String(text)
  .replaceAll(ROOT, '[repository-path]')
  .replace(/file:\/\/\/[A-Za-z]:\/[^\s:'"<>]+/gi, '[file-path]')
  .replace(/\b[A-Za-z]:\\(?:[^\s"'<>|?*]+\\?)+/g, '[file-path]')
  .replace(/(?:^|\s)\/(?:Users|home|tmp|var\/tmp)\/[^\s"']+/g, ' [file-path]')
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

async function execute(binary, { timeoutMs, phaseFile, inject = false, gate = GATE }) {
  const result = await runSubprocess({ executable: process.execPath, args: [gate, binary], cwd: ROOT,
    env: childEnv({ MCP_GATE_PHASE_FILE: phaseFile, ...(inject ? { MCP_GATE_INJECT_FAILURE_PHASE: 'probe' } : {}) }),
    stdoutMaxBytes: OUTPUT_CAP * 2, stderrMaxBytes: OUTPUT_CAP * 2, timeoutMs, killGraceMs: 1000 });
  let phase = 'gate-start';
  try { phase = readFileSync(phaseFile, 'utf8').trim() || phase; } catch { /* phase file may not exist if spawn failed */ }
  // B10 retains tails after its raw byte cap. A tail may begin in the middle of a
  // credential whose label/prefix was discarded, so never persist a capped stream.
  const stdout = utf8Limit(result.stdoutTruncated ? '[stdout omitted: raw capture cap reached]' : redact(result.stdout), OUTPUT_CAP);
  const stderr = utf8Limit(result.stderrTruncated ? '[stderr omitted: raw capture cap reached]' : redact(result.stderr), OUTPUT_CAP);
  const bounded = utf8Limit(`${stdout.text}${stderr.text ? `\n[stderr]\n${stderr.text}` : ''}`, OUTPUT_CAP);
  const transcript = bounded.text;
  return { status: result.termination.reason === 'exited' && result.code === 0 ? 'pass' : 'fail', phase,
    exitCode: result.code, signal: result.signal, termination: result.termination, durationMs: result.durationMs,
    transcript, transcriptBytes: Buffer.byteLength(transcript), transcriptTruncated: bounded.truncated || stdout.truncated || stderr.truncated || result.stdoutTruncated || result.stderrTruncated,
    sanitized: true, reason: result.termination.reason === 'exited' && result.code === 0 ? null :
      (result.termination.reason === 'deadline' ? 'timeout' : result.spawnErrorCode ?? `exit_${result.code ?? result.signal ?? 'unknown'}`) };
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
    const file = join(resolve(home), 'tasks', `${taskId}.json`);
    if (statSync(file).size > 1_048_576) return { track: 'task-history', status: 'not_run', reason: 'task record exceeds 1 MiB read limit' };
    task = JSON.parse(readFileSync(file, 'utf8'));
  }
  catch { return { track: 'task-history', status: 'not_run', reason: 'task record missing or unreadable' }; }
  if (task.id !== taskId || !['queued','running','succeeded','failed','blocked','cancelled'].includes(task.status))
    return { track: 'task-history', status: 'not_run', reason: 'task identity or lifecycle metadata invalid' };
  if ((task.attempts !== undefined && !Array.isArray(task.attempts)) ||
      (Array.isArray(task.attempts) && task.attempts.some(attempt => !attempt || typeof attempt !== 'object')) ||
      task.status === 'running' ||
      task.status === 'blocked' || task.block || task.reconciliation?.decision ||
      task.attempts?.some(attempt => !['succeeded','failed','spawn-error','launch-failed'].includes(attempt.outcome)))
    return { track: 'task-history', status: 'not_run', reason: 'blocked or uncertain history; never replayed' };
  const attempts = Array.isArray(task.attempts) ? task.attempts : [];
  const testRuns = Array.isArray(task.testRuns) ? task.testRuns : (Array.isArray(task.artifacts?.testRuns) ? task.artifacts.testRuns : []);
  const limitations = Array.isArray(task.limitations) ? task.limitations : (Array.isArray(task.artifacts?.limitations) ? task.artifacts.limitations : []);
  if ((task.testRuns !== undefined && !Array.isArray(task.testRuns)) ||
      (task.limitations !== undefined && !Array.isArray(task.limitations)) ||
      (task.artifacts?.testRuns !== undefined && !Array.isArray(task.artifacts.testRuns)) ||
      (task.artifacts?.limitations !== undefined && !Array.isArray(task.artifacts.limitations)))
    return { track: 'task-history', status: 'not_run', reason: 'history evidence fields invalid' };
  const hasTests = testRuns.some(run => typeof run?.command === 'string' && run.command.trim().length > 0 && Number.isInteger(run.exitCode));
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
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) =>
      [utf8Limit(redact(key), 256).text, safe(item, depth + 1)]));
    return value;
  };
  const history = { track: 'task-history', status: hasTests ? 'observed' : 'not_run', taskId, taskStatus: task.status,
    attempts: attempts.slice(0, 100).map(({ attemptId, model, startedAt, finishedAt, outcome }) => ({ attemptId, model, startedAt, finishedAt, outcome })),
    testRuns, limitations, reason: hasTests ? null : 'no recorded test command and exit code; status is not inferred as success' };
  return safe(history);
}

export async function runPulse(options, { gate = GATE } = {}) {
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
  const scratch = join(outputParent, `.b19-${process.pid}-${Date.now()}`);
  mkdirSync(scratch, { recursive: false });
  try {
    for (let index = 1; index <= SLOT_COUNT; index++) {
      if (!validConfig) originals.push({ index, status: 'not_run', phase: 'configuration', reason: 'invalid bounded options',
        transcript: '', transcriptBytes: 0, transcriptTruncated: false, sanitized: true });
      else if (!hostValid) originals.push({ index, status: 'not_run', phase: 'preflight', reason: !hostExists ? 'pinned binary missing' : 'pinned version must be 2.2.5',
        transcript: '', transcriptBytes: 0, transcriptTruncated: false, sanitized: true });
      else {
        const phaseFile = join(scratch, `phase-${index}.txt`);
        const outcome = await execute(resolve(options.binary), { timeoutMs, phaseFile, inject: index === options.injectFailureIndex, gate });
        if (outcome.termination.reason !== 'exited') retainScratch = true;
        originals.push({ index, ...outcome });
      }
    }
    if (options.retryFailed) for (const original of originals.filter(item => item.status === 'fail')) {
      if (!hostValid) break;
      const outcome = await execute(resolve(options.binary), { timeoutMs, phaseFile: join(scratch, `retry-${original.index}.txt`), gate });
      if (outcome.termination.reason !== 'exited') retainScratch = true;
      retries.push({ originalIndex: original.index, diagnostic: true, ...outcome });
    }
    let cleanupStatus = 'retained_uncertain_process_outcome';
    if (!retainScratch) {
      cleanupAttempted = true;
      try { rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); cleanupStatus = 'removed'; }
      catch (error) { cleanupFailure = error; cleanupStatus = 'cleanup_failed'; }
    }
    const report = { schemaVersion: 1, task: 'B19', generatedAt: new Date().toISOString(), version: options.version ?? null,
      summary: { success: originals.length === SLOT_COUNT && originals.every(x => x.status === 'pass'), denominator: SLOT_COUNT,
        pass: originals.filter(x => x.status === 'pass').length, fail: originals.filter(x => x.status === 'fail').length,
        not_run: originals.filter(x => x.status === 'not_run').length }, originals, retries,
        cleanup: { status: cleanupStatus, descendantsStopped: false,
          ...(retainScratch ? { scratchName: basename(scratch), location: options.output ? 'report directory' : 'OS temporary directory' } : {}) } };
    if (options.historyHome || options.taskId) report.history = readHistory({ home: options.historyHome, taskId: options.taskId });
    if (options.output) {
      const output = resolve(options.output); mkdirSync(dirname(output), { recursive: true });
      const fd = openSync(output, 'wx');
      try { writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`); } finally { closeSync(fd); }
    }
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
    const report = await runPulse(parse(process.argv.slice(2)));
    console.log(JSON.stringify(report.summary));
    if (!report.summary.success) process.exitCode = 1;
  } catch (error) { console.error(`B19 pulse failed: ${redact(error.message)}`); process.exitCode = 1; }
}

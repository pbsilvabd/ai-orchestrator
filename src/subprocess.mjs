import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const MAX_TIMER_MS = 2_147_483_647;

// Run one child without a shell. Only the explicitly supplied environment reaches it.
export function runSubprocess({ executable, args = [], cwd, env = {}, stdoutMaxBytes = 1_048_576,
  stderrMaxBytes = 1_048_576, timeoutMs = 30_000, killGraceMs = 1_000, signal } = {}) {
  validateOptions({ executable, args, cwd, env, stdoutMaxBytes, stderrMaxBytes, timeoutMs, killGraceMs, signal });
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  const emptyResult = reason => ({ code: null, signal: null, durationMs: elapsed(),
    stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
    stdoutTruncated: false, stderrTruncated: false, spawnErrorCode: null,
    termination: { reason, rootExitObserved: false, descendantsStopped: false } });
  if (signal?.aborted) return Promise.resolve(emptyResult('aborted-before-spawn'));

  return new Promise(resolve => {
    let child;
    let settled = false;
    let spawnErrorCode = null;
    let exitCode = null;
    let exitSignal = null;
    let terminationReason = 'exited';
    let timeout;
    let graceTimer;
    let forceTimer;
    let killed = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutRetained = 0;
    let stderrRetained = 0;

    const appendTail = (chunks, data, cap, current) => {
      if (cap === 0) return 0;
      const buffer = Buffer.from(data);
      if (buffer.length >= cap) {
        chunks.length = 0;
        chunks.push(Buffer.from(buffer.subarray(buffer.length - cap)));
        return cap;
      }
      chunks.push(buffer);
      current += buffer.length;
      while (current > cap) {
        const excess = current - cap;
        if (chunks[0].length <= excess) current -= chunks.shift().length;
        else {
          chunks[0] = chunks[0].subarray(excess);
          current -= excess;
        }
      }
      return current;
    };
    const utf8Tail = chunks => {
      const bytes = Buffer.concat(chunks);
      let start = 0;
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
      return bytes.subarray(start).toString('utf8');
    };
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(graceTimer);
      clearTimeout(forceTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = rootExitObserved => {
      if (settled) return;
      settled = true;
      cleanup();
      const result = { code: exitCode, signal: exitSignal, durationMs: elapsed(),
        stdout: utf8Tail(stdoutChunks), stderr: utf8Tail(stderrChunks),
        stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, spawnErrorCode,
        termination: { reason: terminationReason, rootExitObserved,
          descendantsStopped: false } };
      // Settle callers even when descendants retain inherited pipes. Stop evidence
      // remains conservative; releasing handles does not prove descendants stopped.
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      child?.stdin?.destroy();
      child?.unref();
      resolve(result);
    };
    const terminate = reason => {
      if (settled || killed) return;
      killed = true;
      terminationReason = reason;
      try { child.kill('SIGTERM'); } catch { /* report only observed exit evidence */ }
      graceTimer = setTimeout(() => {
        if (settled) return;
        // Escalate after the grace period. This only targets the root process;
        // descendants and external effects remain unverified.
        try { child.kill('SIGKILL'); } catch { /* report only observed exit evidence */ }
        forceTimer = setTimeout(() => finish(exitCode !== null || exitSignal !== null), killGraceMs);
      }, killGraceMs);
    };
    const onAbort = () => terminate('aborted');

    try {
      child = spawn(executable, args, { cwd, env: { ...env }, shell: false,
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      spawnErrorCode = error.code ?? 'ERR_SPAWN';
      terminationReason = 'spawn-error';
      finish(false);
      return;
    }
    child.stdout.on('data', data => {
      stdoutBytes += data.length;
      if (stdoutBytes > stdoutMaxBytes) stdoutTruncated = true;
      stdoutRetained = appendTail(stdoutChunks, data, stdoutMaxBytes, stdoutRetained);
    });
    child.stderr.on('data', data => {
      stderrBytes += data.length;
      if (stderrBytes > stderrMaxBytes) stderrTruncated = true;
      stderrRetained = appendTail(stderrChunks, data, stderrMaxBytes, stderrRetained);
    });
    child.once('error', error => {
      spawnErrorCode = error.code ?? 'ERR_SPAWN';
      terminationReason = 'spawn-error';
    });
    child.once('exit', (code, childSignal) => {
      exitCode = code;
      exitSignal = childSignal;
      if (killed) setImmediate(() => finish(true));
    });
    child.once('close', () => finish(exitCode !== null || exitSignal !== null));
    signal?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => terminate('deadline'), timeoutMs);
    if (signal?.aborted) onAbort();
  });
}

function validateOptions(options) {
  const { executable, args, cwd, env, stdoutMaxBytes, stderrMaxBytes, timeoutMs, killGraceMs, signal } = options;
  if (typeof executable !== 'string' || !executable || typeof cwd !== 'string' || !cwd ||
      !Array.isArray(args) || args.some(arg => typeof arg !== 'string') ||
      !env || typeof env !== 'object' || Array.isArray(env) ||
      Object.entries(env).some(([key, value]) => !key || typeof value !== 'string') ||
      !Number.isSafeInteger(stdoutMaxBytes) || stdoutMaxBytes < 0 ||
      !Number.isSafeInteger(stderrMaxBytes) || stderrMaxBytes < 0 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_MS ||
      !Number.isSafeInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > MAX_TIMER_MS ||
      (signal !== undefined && !(signal instanceof AbortSignal))) {
    throw new TypeError('Invalid subprocess options');
  }
}

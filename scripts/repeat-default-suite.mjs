import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runSamples({ count, revision, worktreeClean, execute = spawnSync,
  inspect = () => ({ revision, worktreeClean }) }) {
  if (!Number.isInteger(count) || count < 1 || count > 5 ||
      typeof revision !== 'string' || !revision ||
      typeof worktreeClean !== 'boolean' || typeof execute !== 'function' ||
      typeof inspect !== 'function') {
    throw new TypeError('invalid repeated-suite options');
  }
  const outcomes = [];
  for (let sample = 1; sample <= count; sample++) {
    console.log(`FIX48 default-concurrency sample ${sample}/${count} at ${revision} (worktreeClean=${worktreeClean})`);
    const result = execute(process.execPath, ['--test'], {
      stdio: 'inherit',
      windowsHide: true,
    });
    const after = inspect();
    const worktreeUnchanged = after.revision === revision &&
      after.worktreeClean === worktreeClean;
    const outcome = {
      sample,
      revision,
      worktreeClean,
      worktreeUnchanged,
      exitCode: result.status,
      signal: result.signal,
      errorCode: result.error?.code ?? null,
    };
    outcomes.push(outcome);
    console.log(`FIX48_SAMPLE_RESULT ${JSON.stringify(outcome)}`);
  }
  console.log(`FIX48_SAMPLE_SUMMARY ${JSON.stringify(outcomes)}`);
  return { outcomes, exitCode: !worktreeClean || outcomes.some(outcome =>
    outcome.exitCode !== 0 || !outcome.worktreeUnchanged) ? 1 : 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const count = Number(process.argv[2] ?? 5);
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    console.error('sample count must be an integer from 1 through 5');
    process.exitCode = 2;
  } else {
    const inspect = () => ({
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      worktreeClean: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '',
    });
    const initial = inspect();
    process.exitCode = runSamples({ count, ...initial, inspect }).exitCode;
  }
}

// B17: execute each normative M2b acceptance scenario and report observed evidence.
// Usage: node integration/acceptance-matrix.mjs [--opencode <pinned-binary>] [--report <file>]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const matrix = [
  {
    id: 'M2b-01', title: 'Submit returns a stable ID and persists before worker start',
    evidence: ['test/scheduler.test.mjs — B12-01: prompt submission, durable identity and serial fixtures remain observable between events'],
    tests: [['test/scheduler.test.mjs', 'B12-01: prompt submission, durable identity and serial fixtures remain observable between events']],
  },
  {
    id: 'M2b-02', title: 'Duplicate submit creates no second workspace or attempt',
    evidence: ['test/scheduler.test.mjs — B12-04: duplicates, another process observer and competing owner preserve the same dispatch',
      'test/workspace.test.mjs — B09-02: duplicate invocation reuses one receipt-verified worktree',
      'integration/mcp-client-workflow.mjs — pinned-client reconnect checks one attempt and one workspace'],
    tests: [['test/scheduler.test.mjs', 'B12-04: duplicates, another process observer and competing owner preserve the same dispatch'],
      ['test/workspace.test.mjs', 'B09-02: duplicate invocation reuses one receipt-verified worktree']],
    hostEvidence: true,
  },
  {
    id: 'M2b-03', title: 'Same idempotency key with a different payload conflicts',
    evidence: ['test/task-store.test.mjs — same key with a different payload is an idempotency conflict',
      'test/task-service.test.mjs — submit_task replays idempotently and conflicts on changed payloads'],
    tests: [['test/task-store.test.mjs', 'same key with a different payload is an idempotency conflict'],
      ['test/task-service.test.mjs', 'submit_task replays idempotently and conflicts on changed payloads']],
  },
  {
    id: 'M2b-04', title: 'A separate client observes queued, running and succeeded while polling',
    evidence: ['integration/mcp-client-workflow.mjs — pinned OpenCode MCP submit/poll/result lifecycle; correlated running and terminal replies'],
    hostEvidence: true,
  },
  {
    id: 'M2b-05', title: 'Result includes diff, changed files, test exits, attempts and limitations',
    evidence: ['test/task-service.test.mjs — get_task_result returns terminal artifacts, truncation flags and limitations',
      'test/artifacts.test.mjs — B13-01: test command generated workspace files are captured in final artifact diff and changed files',
      'integration/mcp-client-workflow.mjs — pinned-client result assertions'],
    tests: [['test/task-service.test.mjs', 'get_task_result returns terminal artifacts, truncation flags and limitations'],
      ['test/artifacts.test.mjs', 'B13-01: test command generated workspace files are captured in final artifact diff and changed files']],
    hostEvidence: true,
  },
  {
    id: 'M2b-06', title: 'Cancel before spawn is cancelled without a worker process',
    evidence: ['test/scheduler.test.mjs — B14-01: cancellation at the prepared-before-spawn boundary starts no child',
      'test/scheduler.test.mjs — known spawn error becomes failed; queued cancellation and idle close start no child',
      'test/task-service.test.mjs — cancel_task cancels queued work and blocks uncertain running work'],
    tests: [['test/scheduler.test.mjs', 'B14-01: cancellation at the prepared-before-spawn boundary starts no child'],
      ['test/scheduler.test.mjs', 'known spawn error becomes failed; queued cancellation and idle close start no child'],
      ['test/task-service.test.mjs', 'cancel_task cancels queued work and blocks uncertain running work']],
  },
  {
    id: 'M2b-07', title: 'Active cancellation blocks uncertain effects and never replays work',
    evidence: ['test/scheduler.test.mjs — B14-02: active cancellation preserves bounded worker logs and partial workspace evidence',
      'test/scheduler.test.mjs — B14-04: cancellation persists its block first and halts the queue before worker return',
      'test/scheduler.test.mjs — B14-04: a late real zero exit cannot replace an already blocked task',
      'integration/mcp-client-workflow.mjs — pinned-client active cancellation and worker-root observation'],
    tests: [['test/scheduler.test.mjs', 'B14-02: active cancellation preserves bounded worker logs and partial workspace evidence'],
      ['test/scheduler.test.mjs', 'B14-04: cancellation persists its block first and halts the queue before worker return'],
      ['test/scheduler.test.mjs', 'B14-04: a late real zero exit cannot replace an already blocked task']],
    hostEvidence: true,
  },
  {
    id: 'M2b-08', title: 'Restart blocks an interrupted task and does not resume its dispatch',
    evidence: ['test/task-store.test.mjs — reconcile blocks running work and queued work that already dispatched',
      'test/task-service.test.mjs — service startup blocks an interrupted running task before reads',
      'integration/mcp-client-workflow.mjs — dispatch-enabled restart retains the single invocation and reports blocked'],
    tests: [['test/task-store.test.mjs', 'reconcile blocks running work and queued work that already dispatched'],
      ['test/task-service.test.mjs', 'service startup blocks an interrupted running task before reads']],
    hostEvidence: true,
  },
  {
    id: 'M2b-09', title: 'Unauthorized model, tool, path and budget are rejected without persistence',
    evidence: ['test/task-service.test.mjs — submit_task rejects unknown, missing or out of range fields (includes unchanged task-record count)',
      'test/opencode.test.mjs — rejects a task requesting any model beyond the single trusted model',
      'test/opencode.test.mjs — rejects unauthorized and unsupported tools instead of trimming them',
      'test/opencode.test.mjs — rejects writable globs outside the trusted exact allowlist and path traversal',
      'test/opencode.test.mjs — rejects task budgets above the configured caps'],
    tests: [['test/task-service.test.mjs', 'submit_task rejects unknown, missing or out of range fields'],
      ['test/opencode.test.mjs', 'rejects a task requesting any model beyond the single trusted model'],
      ['test/opencode.test.mjs', 'rejects unauthorized and unsupported tools instead of trimming them'],
      ['test/opencode.test.mjs', 'rejects writable globs outside the trusted exact allowlist and path traversal'],
      ['test/opencode.test.mjs', 'rejects task budgets above the configured caps']],
  },
  {
    id: 'M2b-10', title: 'Non-owner status, result and cancellation operations return not_owner',
    evidence: ['test/task-service.test.mjs — get_task_status enforces ownership and unknown tasks',
      'test/task-service.test.mjs — get_task_result enforces ownership; status case also asserts foreign cancellation is denied'],
    tests: [['test/task-service.test.mjs', 'get_task_status enforces ownership and unknown tasks'],
      ['test/task-service.test.mjs', 'get_task_result enforces ownership']],
  },
  {
    id: 'M2b-11', title: 'Oversized diffs and logs are byte bounded with truncation flags',
    evidence: ['test/artifacts.test.mjs — B13-03: UTF-8 diff/log and binary artifacts stay byte bounded with explicit flags',
      'test/task-service.test.mjs — result enforces the log cap across multiple test runs',
      'test/task-service.test.mjs — diff limits use UTF-8 bytes and honor the task output budget'],
    tests: [['test/artifacts.test.mjs', 'B13-03: UTF-8 diff/log and binary artifacts stay byte bounded with explicit flags'],
      ['test/task-service.test.mjs', 'result enforces the log cap across multiple test runs'],
      ['test/task-service.test.mjs', 'diff limits use UTF-8 bytes and honor the task output budget']],
  },
  {
    id: 'M2b-12', title: 'Credential-shaped requests are rejected and returned text artifacts are redacted',
    evidence: ['test/task-service.test.mjs — credential-shaped request text is rejected without mutating the caller or storing data',
      'test/task-service.test.mjs — result redacts credential-shaped text and reports the bounded policy',
      'test/artifacts.test.mjs — B13-04: producer redacts credential sentinels before the scheduler persists or returns artifacts'],
    tests: [['test/task-service.test.mjs', 'credential-shaped request text is rejected without mutating the caller or storing data'],
      ['test/task-service.test.mjs', 'result redacts credential-shaped text and reports the bounded policy'],
      ['test/artifacts.test.mjs', 'B13-04: producer redacts credential sentinels before the scheduler persists or returns artifacts']],
  },
  {
    id: 'M2b-13', title: 'Pinned OpenCode client receives the real MCP task result and context',
    evidence: ['integration/mcp-client-workflow.mjs — actual OpenCode 2.2.5, MCP stdio, task service, fixture worker and parsed result in provider context'],
    hostEvidence: true,
  },
];
export const B17_REQUIRED_ITEM_IDS = Array.from({ length: 13 }, (_, index) => `M2b-${String(index + 1).padStart(2, '0')}`);
const REQUIRED_CONTRACT_CRITERIA_SHA256 = '3319c26cc1d05f2c83d94938872868a142d5f4af9580aaa39becd6a7a8076788';

export function extractContractCriteria(markdown) {
  const heading = '## M2b acceptance tests';
  const start = markdown.indexOf(heading);
  if (start < 0) return [];
  const nextHeading = markdown.indexOf('\n## ', start + heading.length);
  const section = markdown.slice(start + heading.length, nextHeading < 0 ? undefined : nextHeading);
  const criteria = [];
  for (const line of section.split(/\r?\n/)) {
    const item = line.match(/^(\d+)\.\s+(.*)$/);
    if (item) criteria.push({ number: Number(item[1]), text: item[2].trim() });
    else if (criteria.length && line.trim()) criteria.at(-1).text += ` ${line.trim()}`;
  }
  return criteria;
}

export function validateContractCriteria(criteria) {
  if (criteria.length !== B17_REQUIRED_ITEM_IDS.length ||
      matrix.length !== B17_REQUIRED_ITEM_IDS.length ||
      !matrix.every((scenario, index) => scenario.id === B17_REQUIRED_ITEM_IDS[index]) ||
      !criteria.every((criterion, index) => criterion.number === index + 1 && criterion.text.length > 0)) return false;
  const digest = createHash('sha256').update(criteria.map(item => `${item.number}. ${item.text}`).join('\n')).digest('hex');
  return digest === REQUIRED_CONTRACT_CRITERIA_SHA256;
}

function parseTapSummary(stdout) {
  const read = key => {
    const match = stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  return { tests: read('tests'), passed: read('pass'), failed: read('fail'), skipped: read('skipped'),
    cancelled: read('cancelled'), todo: read('todo') };
}

export function classifyTapRun({ exitCode, stdout = '', error = null, expectedTitle }) {
  if (error) return { status: error.code === 'ETIMEDOUT' ? 'fail' : 'not_run',
    reason: error.code === 'ETIMEDOUT' ? 'test_process_timed_out' : error.code === 'ENOENT' ? 'runner_unavailable' : 'runner_not_started' };
  const counts = parseTapSummary(stdout);
  if (exitCode !== 0 && counts.tests === null) return { status: 'fail', reason: 'process_exit_without_tap_summary', counts };
  if (counts.tests === null || counts.tests === 0) return { status: 'not_run', reason: 'required_test_not_observed', counts };
  if (counts.skipped > 0 || counts.todo > 0) return { status: 'not_run', reason: 'required_test_skipped_or_todo', counts };
  if (counts.failed > 0 || counts.cancelled > 0 || exitCode !== 0 || counts.passed !== counts.tests) {
    return { status: 'fail', reason: 'assertion_or_process_failure', counts };
  }
  if (expectedTitle && !stdout.includes(`# Subtest: ${expectedTitle}`)) {
    return { status: 'not_run', reason: 'expected_test_title_not_observed', counts };
  }
  return { status: 'pass', reason: 'all_observed_tests_passed', counts };
}

export function summarizeMatrix(items, expectedIds = B17_REQUIRED_ITEM_IDS) {
  const ids = items.map(item => item.id);
  const exactSet = ids.length === expectedIds.length && new Set(ids).size === ids.length &&
    expectedIds.every(id => ids.includes(id));
  const allPass = exactSet && items.every(item => item.status === 'pass');
  return { success: allPass, requiredItems: expectedIds.length, observedItems: ids.length,
    missingItems: expectedIds.filter(id => !ids.includes(id)), unexpectedItems: ids.filter(id => !expectedIds.includes(id)),
    pass: items.filter(item => item.status === 'pass').length,
    fail: items.filter(item => item.status === 'fail').length,
    not_run: items.filter(item => item.status === 'not_run').length };
}

export function classifyHostAvailability({ binarySupplied, binaryExists, gateExists = true }) {
  if (!binarySupplied) return { status: 'not_run', reason: 'pinned_client_binary_not_supplied' };
  if (!binaryExists) return { status: 'not_run', reason: 'pinned_client_binary_missing' };
  if (!gateExists) return { status: 'not_run', reason: 'pinned_client_gate_missing' };
  return null;
}

function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function runTest(file, title) {
  const testPath = resolve(repoRoot, file);
  if (!existsSync(testPath)) return { status: 'not_run', reason: 'required_test_file_missing', command: `node --test ${file}`, exitCode: null };
  const pattern = `^${escapePattern(title)}$`;
  const args = ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, testPath];
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const classified = classifyTapRun({ exitCode: result.status, stdout: result.stdout ?? '', error: result.error, expectedTitle: title });
  return { ...classified, command: `node --test --test-name-pattern '${pattern}' ${file}`,
    exitCode: result.status, test: title };
}

function runPinnedClient(binary) {
  const gatePath = resolve(repoRoot, 'integration/mcp-client-workflow.mjs');
  const command = 'node integration/mcp-client-workflow.mjs <pinned OpenCode 2.2.5 binary>';
  const resolvedBinary = binary ? resolve(binary) : null;
  const unavailable = classifyHostAvailability({ binarySupplied: Boolean(binary),
    binaryExists: resolvedBinary ? existsSync(resolvedBinary) : false, gateExists: existsSync(gatePath) });
  if (unavailable) return { ...unavailable, command, exitCode: null };
  const result = spawnSync(process.execPath, [gatePath, resolvedBinary], { cwd: repoRoot, encoding: 'utf8', timeout: 240_000,
    maxBuffer: 12 * 1024 * 1024, windowsHide: true });
  if (result.error) return { status: result.error.code === 'ETIMEDOUT' ? 'fail' : 'not_run',
    reason: result.error.code === 'ETIMEDOUT' ? 'pinned_client_gate_timed_out' : result.error.code === 'ENOENT' ? 'pinned_client_or_runtime_missing' : 'pinned_client_not_started',
    command, exitCode: result.status };
  if (result.status !== 0) return { status: 'fail', reason: 'pinned_client_gate_failed', command, exitCode: result.status };
  let summary;
  try { summary = JSON.parse((result.stdout ?? '').trim()); }
  catch { return { status: 'fail', reason: 'pinned_client_evidence_not_machine_readable', command, exitCode: result.status }; }
  const observed = summary.version === '2.2.5' && summary.protocol === '2026-07-28' &&
    summary.fourToolsCatalogued === true && summary.submitPollResult === true &&
    summary.duplicateStableId === true && summary.attempts === 1 && summary.workspacesForDuplicate === 1 &&
    summary.cancellation?.status === 'blocked' && summary.cancellation?.requested === true &&
    summary.cancellation?.stopped === 'unknown' && summary.interruption?.status === 'blocked' &&
    summary.interruption?.attempts === 1 && summary.interruption?.preserved === true &&
    summary.unavailableHost === 'ENOENT diagnosed';
  return { status: observed ? 'pass' : 'fail', reason: observed ? 'pinned_client_result_and_context_observed' : 'pinned_client_summary_incomplete',
    command, exitCode: result.status, observed: observed ? summary : undefined };
}

function getArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key !== '--opencode' && key !== '--report') throw new Error(`Unknown argument: ${key}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (options[key]) throw new Error(`Duplicate option: ${key}`);
    options[key] = argv[++i];
  }
  return { binary: options['--opencode'], reportPath: options['--report'] };
}

export async function runMatrix({ binary, reportPath } = {}) {
  const criteria = extractContractCriteria(readFileSync(resolve(repoRoot, 'docs/task-contract.md'), 'utf8'));
  const contractValid = validateContractCriteria(criteria);
  const host = contractValid ? runPinnedClient(binary) :
    { status: 'not_run', reason: 'contract_matrix_mapping_invalid', command: 'docs/task-contract.md#M2b-acceptance-tests', exitCode: null };
  const items = [];
  for (let index = 0; index < matrix.length; index++) {
    const scenario = matrix[index];
    const testRuns = contractValid ? (scenario.tests ?? []).map(([file, title]) => runTest(file, title)) : [];
    const runs = [...testRuns];
    if (scenario.hostEvidence) runs.push(host);
    const status = !contractValid ? 'not_run' : runs.some(run => run.status === 'fail') ? 'fail' :
      runs.length > 0 && runs.every(run => run.status === 'pass') ? 'pass' : 'not_run';
    items.push({ id: scenario.id, criterion: criteria[index]?.text ?? null, title: scenario.title,
      status, evidence: scenario.evidence, runs });
  }
  const expectedIds = criteria.length === matrix.length ? B17_REQUIRED_ITEM_IDS :
    criteria.map(criterion => `M2b-${String(criterion.number).padStart(2, '0')}`);
  const result = {
    schemaVersion: 1,
    task: 'B17',
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    checkoutHeadSha: gitHead(),
    workingTreeDirty: gitIsDirty(),
    contract: { criteriaCount: criteria.length, criteriaSha256: createHash('sha256')
      .update(criteria.map(item => `${item.number}. ${item.text}`).join('\n')).digest('hex'), mappingValid: contractValid },
    summary: summarizeMatrix(items, expectedIds),
    items,
  };
  if (reportPath) writeFileSync(resolve(reportPath), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitIsDirty() {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim().length > 0 : null;
}

const isCli = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  try {
    const options = getArgs(process.argv.slice(2));
    const report = await runMatrix(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.summary.success) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 2;
  }
}

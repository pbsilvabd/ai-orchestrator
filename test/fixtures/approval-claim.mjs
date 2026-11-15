// Disposable subprocess fixture for the B30 approval ledger: competes with other
// processes for a single approval ID. Never creates a real maintainer key.
//
// Acts only when invoked with its five CLI arguments; when the test runner loads it
// for discovery (no arguments) it is a no-op module.
import { writeFileSync, existsSync } from 'node:fs';
import { openApprovalLedger } from '../../src/live-approval.mjs';

function run(args) {
  const [home, approvalId, taskId, readyFile, goFile] = args;
  writeFileSync(readyFile, JSON.stringify({ pid: process.pid, taskId }), 'utf8');
  const deadline = Date.now() + 10_000;
  while (!existsSync(goFile)) {
    if (Date.now() > deadline) {
      process.stdout.write(JSON.stringify({ ok: false, code: 'barrier-timeout' }));
      process.exit(0);
    }
  }
  try {
    const ledger = openApprovalLedger({ home });
    const result = ledger.reserve({ approvalId, taskId });
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
  }
}

const args = process.argv.slice(2);
if (args.length === 5) run(args);

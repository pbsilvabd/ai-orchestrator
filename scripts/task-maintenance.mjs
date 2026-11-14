#!/usr/bin/env node
// Explicit local maintainer helper. Never imported by the service or MCP adapter.
import { openTaskMaintenance } from '../src/tasks.mjs';
import { readFileSync } from 'node:fs';

function usage() {
  console.error('Usage: node scripts/task-maintenance.mjs <inspect|reconcile|reconcile-store|repair-index|prune|recover-owner> [JSON | --input-file <path>]');
  process.exitCode = 2;
}

const [command, ...args] = process.argv.slice(2);
if (!['inspect', 'reconcile', 'reconcile-store', 'repair-index', 'prune', 'recover-owner'].includes(command)) usage();
else {
  let input = {};
  try {
    let raw;
    if (args.length === 0) raw = '{}';
    else if (args.length === 1 && !args[0].startsWith('--')) raw = args[0];
    else if (args.length === 2 && args[0] === '--input-file' && args[1]) {
      try { raw = readFileSync(args[1], 'utf8'); }
      catch { throw new Error('Input file could not be read.'); }
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    } else {
      usage();
    }
    if (process.exitCode !== 2) {
      input = JSON.parse(raw);
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Input must be one JSON object.');
    }
  } catch (error) {
    console.error(error.message === 'Input file could not be read.'
      ? error.message : 'Input must be one JSON object.');
    process.exitCode = 2;
  }
  if (process.exitCode !== 2) {
    let maintenance;
    try {
      maintenance = openTaskMaintenance({ home: process.env.AI_ORCHESTRATOR_HOME,
        ...(command === 'recover-owner' && { recoverStaleOwner: input }) });
      let result;
      if (command === 'recover-owner') result = { recovered: true,
        note: 'Stale owner lock removed after PID absence and human process-tree attestation.' };
      else if (command === 'inspect') {
        result = input.taskId ? maintenance.inspectTask(input.taskId) : maintenance.inspectStore();
      } else if (command === 'reconcile') result = maintenance.reconcileBlocked(input);
      else if (command === 'reconcile-store') result = maintenance.reconcile(input);
      else if (command === 'repair-index') result = maintenance.repairIndexes();
      else result = maintenance.prune(input);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      console.error(`${error.code ?? 'error'}: ${error.message}`);
      process.exitCode = 1;
    } finally { maintenance?.close(); }
  }
}

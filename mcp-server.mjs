#!/usr/bin/env node
// MCP stdio server entry point (B15).
// Starts the AI orchestrator MCP server on stdin/stdout.
//
// Environment variables:
//   AI_ORCHESTRATOR_HOME   - Required. Path to the task state directory.
//   AI_ORCHESTRATOR_CONFIG - Optional. Path to a JSON config file. When absent, the
//                            service starts with the default (empty allowlists); only
//                            idempotency-key round trips and status/result fetches are
//                            usable without a configured client identity and allowlists.
//
// Config file schema (all fields optional):
//   {
//     "clientId": "opencode-primary",
//     "authorization": {
//       "models": ["provider/model"],
//       "tools": ["read", "edit"],
//       "writableRoots": ["/abs/path"]
//     },
//     "limits": {
//       "maxAttempts": 2,
//       "budgetMs": 600000,
//       "maxOutputBytes": 1048576
//     }
//   }
//
// The server runs until stdin closes. On SIGINT/SIGTERM it closes the service
// (finishing any in-flight scheduler work) and exits with code 0.

import { readFileSync } from 'node:fs';
import { createTaskService } from './src/service.mjs';
import { createMcpServer } from './src/mcp-server.mjs';

const home = process.env.AI_ORCHESTRATOR_HOME;
if (!home) {
  process.stderr.write('AI_ORCHESTRATOR_HOME is required\n');
  process.exit(1);
}

let config;
const configPath = process.env.AI_ORCHESTRATOR_CONFIG;
if (configPath) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`Failed to read AI_ORCHESTRATOR_CONFIG: ${err.message}\n`);
    process.exit(1);
  }
}

let service;
try {
  service = createTaskService({ home, config });
} catch (err) {
  process.stderr.write(`Failed to start task service: ${err.message}\n`);
  process.exit(1);
}

const server = createMcpServer({ service });

async function shutdown() {
  server.close();
  try {
    await service.close();
  } catch {
    // Best-effort cleanup; still exit cleanly.
  }
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

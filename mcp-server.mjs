#!/usr/bin/env node
// MCP stdio server entry point (B15).
// Starts the AI orchestrator MCP server on stdin/stdout.
//
// Environment variables:
//   AI_ORCHESTRATOR_HOME   - Required. Path to the task state directory.
//   AI_ORCHESTRATOR_CONFIG - Optional. Path to a JSON config file. When absent, the
//                            default empty authorization allowlists reject new tasks.
//   AI_ORCHESTRATOR_APPROVAL - Optional absolute path to a fixture-only free-worker
//                              approval JSON file. This is not a live signature.
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
//     },
//     "worker": {
//       "type": "opencode-free",
//       "executable": "/absolute/path/to/opencode",
//       "writablePaths": ["src/**"]
//     }
//   }
// The free-worker block is recognized but refused here even with an approval:
// live composition is closed on OpenCode 2.2.5 (docs/adr/009-free-anonymous-worker.md).
// Only the explicit integration-only MCP fixture entry point can inject its own
// trusted loopback endpoint; this CLI does not read B29_FIXTURE_ENDPOINT.
//
// The server runs until stdin closes. On SIGINT/SIGTERM it closes the service
// (finishing in-flight work or retaining ownership when its outcome is uncertain).

import { readFileSync } from 'node:fs';
import { createConfiguredTaskService } from './src/configured-service.mjs';
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
  } catch {
    process.stderr.write('Failed to read AI_ORCHESTRATOR_CONFIG\n');
    process.exit(1);
  }
}

let service;
try {
  const hostEnvironment = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC']) {
    if (process.env[key]) hostEnvironment[key] = process.env[key];
  }
  service = await createConfiguredTaskService({ home, config, hostEnvironment,
    approvalFile: process.env.AI_ORCHESTRATOR_APPROVAL });
} catch {
  process.stderr.write('Failed to start task service\n');
  process.exit(1);
}

const server = createMcpServer({ service });

let shutdownPromise;
function shutdown() {
  shutdownPromise ??= (async () => {
    server.close();
    try {
      const result = await service.close();
      if (result?.releaseOwnership === false) {
        process.stderr.write('Task service stopped with unresolved work; ownership retained for reconciliation\n');
        process.exitCode = 2;
      }
    } catch {
      process.stderr.write('Task service shutdown failed; state retained for reconciliation\n');
      process.exitCode = 1;
    } finally {
      if (!process.stdin.destroyed) process.stdin.destroy();
    }
  })();
  return shutdownPromise;
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

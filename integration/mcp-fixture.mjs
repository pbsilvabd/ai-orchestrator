// Minimal MCP server for the capability gate.
// Protocol: revision 2026-07-28 (stateless, per-request metadata, no initialize).
// Writes every message to MCP_FIXTURE_LOG as JSONL. Never writes non-JSON to stdout.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const VERSION = '2026-07-28';
const SUPPORTED = [VERSION];
const logPath = process.env.MCP_FIXTURE_LOG;
const callsPath = process.env.MCP_FIXTURE_CALLS;
const serverInfo = { name: 'orchestrator-gate-fixture', version: '1.0.0' };

function log(direction, message) {
  if (!logPath) return;
  appendFileSync(logPath, JSON.stringify({ direction, at: Date.now(), message }) + '\n');
}

function send(message) {
  log('out', message);
  process.stdout.write(JSON.stringify(message) + '\n');
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: { resultType: 'complete', ...payload } });
}

function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function requestedVersion(params) {
  const meta = params?._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  return meta['io.modelcontextprotocol/protocolVersion'];
}

const tools = [
  {
    name: 'probe_echo',
    description: 'Echo a message back to the caller. Used only by the integration gate.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { message: { type: 'string', maxLength: 200 } },
      required: ['message'],
    },
  },
];

function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if (message?.id !== undefined) error(message.id, -32600, 'Invalid Request');
    return;
  }
  if (message.id === undefined) return; // Client notifications carry no response.

  const version = requestedVersion(message.params);
  if (version !== undefined && !SUPPORTED.includes(version)) {
    error(message.id, -32022, 'Unsupported protocol version', { supported: SUPPORTED, requested: version });
    return;
  }
  if (version === undefined) {
    error(message.id, -32602, 'Missing protocol version in params._meta');
    return;
  }

  switch (message.method) {
    case 'server/discover':
      return result(message.id, {
        supportedVersions: SUPPORTED,
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
      });
    case 'tools/list':
      return result(message.id, { tools, ttlMs: 60_000, cacheScope: 'private' });
    case 'tools/call': {
      const name = message.params?.name;
      if (name !== 'probe_echo') return error(message.id, -32602, 'Unknown tool');
      const value = message.params?.arguments?.message;
      if (typeof value !== 'string' || value.length > 200) return error(message.id, -32602, 'Invalid arguments');
      if (callsPath) appendFileSync(callsPath, JSON.stringify({ at: Date.now(), name, message: value }) + '\n');
      return result(message.id, {
        content: [{ type: 'text', text: `probe:${value}` }],
        isError: false,
      });
    }
    default:
      return error(message.id, -32601, 'Method not found');
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    log('in', { raw: line.slice(0, 500) });
    error(null, -32700, 'Parse error');
    return;
  }
  log('in', message);
  try {
    handle(message);
  } catch (failure) {
    if (message?.id !== undefined) error(message.id, -32603, 'Internal error');
  }
});
lines.on('close', () => process.exit(0));

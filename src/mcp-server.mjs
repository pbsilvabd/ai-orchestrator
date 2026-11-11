// MCP stdio adapter for the four-operation task service (B15).
// Protocol: revision 2026-07-28 (stateless, per-request metadata, no initialize).
// Exposes exactly: submit_task, get_task_status, get_task_result, cancel_task.
// stdout carries protocol JSON only; nothing else is written to stdout.
// All operation validation and authorization remain in the service layer.
//
// Wire format (ADR-007):
//   Each operation is one tool; arguments are the request object.
//   Results/errors are a single JSON text content block; errors set isError: true.
//   Error envelopes: { error: { code, message } } — no stack, no private data.
//
// Frame budget: MCP_MAX_FRAME_BYTES (default 1 MiB) limits each raw input line.
// Oversized lines are rejected with a bounded error; no partial content is parsed.

import { createInterface } from 'node:readline';
import { createTaskService, ServiceError, errorEnvelope } from './service.mjs';

const VERSION = '2026-07-28';
const SUPPORTED = [VERSION];

// Default 1 MiB frame limit — protects against memory exhaustion on oversized inputs.
const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

const SERVER_INFO = { name: 'ai-orchestrator', version: '1.0.0' };

// Tool input schemas for the four operations (strict, additionalProperties: false).
const TOOLS = [
  {
    name: 'submit_task',
    description: 'Submit a new delegated task to the AI orchestrator service. Returns the task ID and queued status.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['idempotencyKey', 'clientId', 'objective', 'acceptanceCriteria', 'repository', 'authorization', 'limits'],
      properties: {
        idempotencyKey: { type: 'string' },
        clientId: { type: 'string' },
        objective: { type: 'string' },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        repository: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'baseRef', 'branch'],
          properties: {
            path: { type: 'string' },
            baseRef: { type: 'string' },
            branch: { type: 'string' },
          },
        },
        authorization: {
          type: 'object',
          additionalProperties: false,
          required: ['models', 'tools', 'writablePaths'],
          properties: {
            models: { type: 'array', items: { type: 'string' } },
            tools: { type: 'array', items: { type: 'string' } },
            writablePaths: { type: 'array', items: { type: 'string' } },
          },
        },
        limits: {
          type: 'object',
          additionalProperties: false,
          required: ['maxAttempts', 'budgetMs', 'maxOutputBytes'],
          properties: {
            maxAttempts: { type: 'integer' },
            budgetMs: { type: 'integer' },
            maxOutputBytes: { type: 'integer' },
          },
        },
        clientSessionId: { type: 'string' },
      },
    },
  },
  {
    name: 'get_task_status',
    description: 'Poll the status of a previously submitted task. Returns lifecycle state, attempts and cancellation info.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
      },
    },
  },
  {
    name: 'get_task_result',
    description: 'Retrieve the result artifacts of a completed task. Only available once the task reaches a terminal state.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['diff', 'tests', 'log'] },
        },
      },
    },
  },
  {
    name: 'cancel_task',
    description: 'Request cancellation of a task. Idempotent; cancellation is advisory and does not guarantee effects are reversed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
];

// Retrieve the protocol version from request metadata (revision 2026-07-28 carries
// it in params._meta rather than a dedicated initialize handshake).
function requestedVersion(params) {
  const meta = params?._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  return meta['io.modelcontextprotocol/protocolVersion'];
}

// Dispatch a tool call to the matching service operation. The service layer owns
// all validation and authorization; this layer maps the result/error into wire form.
function dispatchTool(name, args, service) {
  switch (name) {
    case 'submit_task':
      return service.submitTask(args);
    case 'get_task_status':
      return service.getTaskStatus(args);
    case 'get_task_result':
      return service.getTaskResult(args);
    case 'cancel_task':
      return service.cancelTask(args);
    default:
      throw new ServiceError('invalid_argument', `unknown tool: ${name}`);
  }
}

// Build a JSON-RPC success result envelope for the MCP wire format.
// Results are always a single text content block carrying the JSON payload.
function toolResult(id, payload) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    },
  };
}

// Build a JSON-RPC success result envelope for a tool error (service-layer error).
// MCP errors inside tools use isError: true on the result, not the error field.
function toolError(id, envelope) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      isError: true,
    },
  };
}

// Build a JSON-RPC protocol-level error (malformed request, unknown method, etc.).
function protocolError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/**
 * Create an MCP stdio adapter bound to a task service.
 *
 * @param {object} options
 * @param {object} options.service  - Task service from createTaskService().
 * @param {object} [options.input]  - Readable stream (defaults to process.stdin).
 * @param {object} [options.output] - Writable stream (defaults to process.stdout).
 * @param {number} [options.maxFrameBytes] - Per-frame byte limit.
 * @returns {{ close(): void }}     - Adapter handle; call close() for shutdown.
 */
export function createMcpServer(options = {}) {
  const service = options.service;
  if (!service || typeof service !== 'object') throw new TypeError('createMcpServer: service is required');

  const input  = options.input  ?? process.stdin;
  const output = options.output ?? process.stdout;
  const maxFrameBytes = typeof options.maxFrameBytes === 'number' && options.maxFrameBytes > 0
    ? options.maxFrameBytes
    : DEFAULT_MAX_FRAME_BYTES;

  // Send a single JSON-RPC message; stdout carries protocol only — no debug text.
  function send(message) {
    output.write(JSON.stringify(message) + '\n');
  }

  function handleMessage(raw) {
    // Frame-size guard: reject before JSON.parse to avoid allocating huge strings.
    if (Buffer.byteLength(raw, 'utf8') > maxFrameBytes) {
      send(protocolError(null, -32600, 'frame too large'));
      return;
    }

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      send(protocolError(null, -32700, 'parse error'));
      return;
    }

    // Basic JSON-RPC envelope validation.
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
        message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      if (message?.id !== undefined) send(protocolError(message.id, -32600, 'invalid request'));
      return;
    }

    // Notifications (no id) carry no response.
    if (message.id === undefined) return;

    const id = message.id;

    // Protocol version check (revision 2026-07-28 carries it in every request).
    const version = requestedVersion(message.params);
    if (version === undefined) {
      send(protocolError(id, -32602, 'missing protocol version in params._meta'));
      return;
    }
    if (!SUPPORTED.includes(version)) {
      send(protocolError(id, -32022, 'unsupported protocol version',
        { supported: SUPPORTED, requested: version }));
      return;
    }

    switch (message.method) {
      case 'server/discover':
        send({
          jsonrpc: '2.0',
          id,
          result: {
            resultType: 'complete',
            supportedVersions: SUPPORTED,
            capabilities: { tools: {} },
            _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
          },
        });
        return;

      case 'tools/list':
        send({
          jsonrpc: '2.0',
          id,
          result: {
            resultType: 'complete',
            tools: TOOLS,
            ttlMs: 60_000,
            cacheScope: 'private',
          },
        });
        return;

      case 'tools/call': {
        const name = message.params?.name;
        const args = message.params?.arguments;

        // Unknown tool name or missing arguments object.
        if (typeof name !== 'string' || !TOOLS.some(t => t.name === name)) {
          send(toolError(id, errorEnvelope(new ServiceError('invalid_argument', 'unknown tool'))));
          return;
        }
        // Arguments must be an object (not array, not null).
        if (args === null || typeof args !== 'object' || Array.isArray(args)) {
          send(toolError(id, errorEnvelope(new ServiceError('invalid_argument', 'tool arguments must be an object'))));
          return;
        }

        let result;
        try {
          result = dispatchTool(name, args, service);
        } catch (error) {
          const svcError = error instanceof ServiceError
            ? error
            : new ServiceError('internal', 'task service failure');
          send(toolError(id, errorEnvelope(svcError)));
          return;
        }

        // The service may return a promise (e.g. from async operations).
        Promise.resolve(result).then(
          payload => send(toolResult(id, payload)),
          error => {
            const svcError = error instanceof ServiceError
              ? error
              : new ServiceError('internal', 'task service failure');
            send(toolError(id, errorEnvelope(svcError)));
          },
        );
        return;
      }

      default:
        send(protocolError(id, -32601, 'method not found'));
    }
  }

  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    handleMessage(trimmed);
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    rl.close();
  };

  rl.on('close', () => { closed = true; });

  return { close };
}

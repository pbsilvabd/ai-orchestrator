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
// Frame budget: maxFrameBytes (default 1 MiB) limits each raw input line.
// Oversized lines are rejected with a bounded error; no partial content is parsed.

import { TextDecoder } from 'node:util';
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
  if (!isPlainObject(params)) return undefined;
  const meta = params._meta;
  if (!isPlainObject(meta)) return undefined;
  return meta['io.modelcontextprotocol/protocolVersion'];
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.includes(key));
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
  let text;
  try {
    text = JSON.stringify(payload);
  } catch {
    return protocolError(id, -32603, 'internal error');
  }
  if (typeof text !== 'string') return protocolError(id, -32603, 'internal error');
  return {
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      content: [{ type: 'text', text }],
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
  const requestedMaxFrameBytes = options.maxFrameBytes;
  const maxFrameBytes = Number.isSafeInteger(requestedMaxFrameBytes) && requestedMaxFrameBytes > 0
    ? Math.min(requestedMaxFrameBytes, DEFAULT_MAX_FRAME_BYTES)
    : DEFAULT_MAX_FRAME_BYTES;

  let closed = false;
  let onData;
  let onEnd;
  let onOutputError;

  // Send a single JSON-RPC message; stdout carries protocol only — no debug text.
  function send(message) {
    let frame;
    try {
      frame = JSON.stringify(message);
    } catch {
      const id = message?.id;
      const safeId = id === null || typeof id === 'string' || typeof id === 'number' ? id : null;
      frame = JSON.stringify(protocolError(safeId, -32603, 'internal error'));
    }
    try {
      output.write(frame + '\n');
    } catch {
      close();
    }
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
        message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
        Object.keys(message).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key)) ||
        (message.id !== undefined && message.id !== null &&
          typeof message.id !== 'string' && typeof message.id !== 'number')) {
      if (message?.id !== undefined) send(protocolError(null, -32600, 'invalid request'));
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
      send(protocolError(id, -32022, 'unsupported protocol version', { supported: SUPPORTED }));
      return;
    }

    switch (message.method) {
      case 'server/discover':
        if (!isPlainObject(message.params) || !hasOnlyKeys(message.params, ['_meta'])) {
          send(protocolError(id, -32602, 'invalid params'));
          return;
        }
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
        if (!isPlainObject(message.params) || !hasOnlyKeys(message.params, ['_meta'])) {
          send(protocolError(id, -32602, 'invalid params'));
          return;
        }
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
        if (!isPlainObject(message.params) || !hasOnlyKeys(message.params, ['_meta', 'name', 'arguments'])) {
          send(protocolError(id, -32602, 'invalid params'));
          return;
        }
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

  let frameBytes = 0;
  let frameChunks = [];
  let discardingFrame = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function appendFramePart(part) {
    if (discardingFrame) return;
    if (frameBytes + part.length > maxFrameBytes) {
      frameChunks = [];
      frameBytes = 0;
      discardingFrame = true;
      return;
    }
    if (part.length) {
      frameChunks.push(Buffer.from(part));
      frameBytes += part.length;
    }
  }

  function finishFrame() {
    if (discardingFrame) {
      send(protocolError(null, -32600, 'frame too large'));
    } else if (frameBytes) {
      let line;
      try {
        line = decoder.decode(Buffer.concat(frameChunks, frameBytes));
      } catch {
        send(protocolError(null, -32700, 'parse error'));
        frameChunks = [];
        frameBytes = 0;
        return;
      }
      const trimmed = line.trim();
      if (trimmed) handleMessage(trimmed);
    }
    frameChunks = [];
    frameBytes = 0;
    discardingFrame = false;
  }

  // Do not use readline here: it buffers a complete line before emitting it, so a
  // malicious peer could allocate an unbounded frame before the size check runs.
  onData = function onData(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== 0x0a) continue;
      appendFramePart(bytes.subarray(start, index));
      finishFrame();
      start = index + 1;
    }
    appendFramePart(bytes.subarray(start));
  };

  input.on('data', onData);

  onEnd = function onEnd() {
    // A final unterminated frame is not a JSON-RPC message.
    frameChunks = [];
    frameBytes = 0;
    discardingFrame = false;
  };
  input.on('end', onEnd);
  input.on('close', onEnd);
  input.on('error', close);
  onOutputError = () => {
    close();
    input.destroy?.();
  };
  output.on('error', onOutputError);

  function close() {
    if (closed) return;
    closed = true;
    if (onData) input.off('data', onData);
    if (onEnd) {
      input.off('end', onEnd);
      input.off('close', onEnd);
    }
    frameChunks = [];
    frameBytes = 0;
    discardingFrame = false;
    input.off('error', close);
    if (onOutputError) output.off('error', onOutputError);
  }

  return { close };
}

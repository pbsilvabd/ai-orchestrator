// B30 deployment harness: host-side layer-7 egress gateway (fixture mode).
//
// This is deployment tooling, not a test. It instances the reviewed
// `src/egress-gateway.mjs` with one fixed policy on the private relay link
// (10.30.2.1:18082) and points it at a controlled loopback fixture origin
// that keeps metadata only. The guest runs one scenario at a time, but retries
// can send multiple requests to an instance; after the first refusal it latches,
// so the harness starts fresh instances for subsequent scenarios.
//
// It logs sanitized gateway events (no bodies, no authorization values) to
// JSONL and writes one evidence JSON with the policy digest, per-round counters
// and the fixture origin's metadata. Nothing here contacts the Internet: the
// origin is loopback, so this exercises the deployment path, not the live TLS
// chain.
//
// Usage:
//   node integration/b30-gateway-host.mjs [--rounds 6] [--max-seconds 900]
//     [--log <jsonl>] [--evidence <json>]
//   node integration/b30-gateway-host.mjs --smoke   (loopback self-probe)
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createEgressGateway } from '../src/egress-gateway.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const fail = message => {
  process.stderr.write(`b30-gateway-host: ${message}\n`);
  process.exit(2);
};
const positiveInt = (name, value) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`--${name} must be a positive integer, got ${value}`);
  return number;
};
const smoke = args.includes('--smoke');
const rounds = positiveInt('rounds', option('rounds', smoke ? '2' : '6'));
const maxSeconds = positiveInt('max-seconds', option('max-seconds', '900'));
const logPath = option('log', '');
const evidencePath = option('evidence', '');

const listen = smoke
  ? { host: '127.0.0.1', port: 0 }
  : { host: option('listen-host', '10.30.2.1'), port: positiveInt('listen-port', option('listen-port', '18082')) };
const originPort = positiveInt('origin-port', option('origin-port', '18083'));
const PATH = '/v1/chat/completions';
const LIMITS = { maxRequests: 4, maxRequestBytes: 1_048_576, maxResponseBytes: 1_048_576, timeoutMs: 120_000 };
// The guest probe writes this marker inside the prompt body. The gateway and the origin
// record only its presence, never the body, so absence of the marker in every log proves
// no body retention.
const CANARY = 'B30-CANARY-PROMPT-0f5a';

const emit = value => {
  const line = `${JSON.stringify(value)}\n`;
  process.stdout.write(line);
  if (logPath) appendFileSync(logPath, line);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Controlled fixture origin: metadata only, no body storage, fixed response.
function startFixtureOrigin() {
  const state = { requests: 0, records: [] };
  const server = createServer((req, res) => {
    let bytes = 0;
    let canary = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (!canary && chunk.includes(CANARY)) canary = true;
    });
    req.on('end', () => {
      state.requests += 1;
      state.records.push({
        at: Date.now(),
        method: req.method,
        url: req.url,
        authorizationIsPublic: req.headers.authorization === 'Bearer public',
        contentTypeIsJson: (req.headers['content-type'] ?? '').startsWith('application/json'),
        promptBytes: bytes,
        canaryPresent: canary,
      });
      const body = JSON.stringify({
        id: 'b30-gateway-fixture',
        object: 'chat.completion',
        model: 'deepseek-v4.1-flash-free',
        b30: 'B30_GATEWAY_FIXTURE_OK',
        usage: { prompt_bytes: bytes },
        choices: [{ index: 0, message: { role: 'assistant', content: 'B30_GATEWAY_FIXTURE_OK' }, finish_reason: 'stop' }],
      });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  const started = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(originPort, '127.0.0.1', () => resolve());
  });
  return { state, started, stop: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

async function waitForService(gateway, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = gateway.status();
    if (status.requests >= 1 && (status.refused.length > 0 || status.bytesOut > 0)) return status;
    await sleep(100);
  }
  return gateway.status();
}

async function main() {
  const origin = startFixtureOrigin();
  await origin.started;
  emit({ event: 'origin_ready', listen: { host: '127.0.0.1', port: originPort }, mode: 'fixture' });

  const gatewayRounds = [];
  const deadline = Date.now() + maxSeconds * 1000;
  for (let round = 1; round <= rounds && Date.now() < deadline; round += 1) {
    const events = [];
    const gateway = createEgressGateway({
      mode: 'fixture',
      listen,
      origin: `http://127.0.0.1:${originPort}`,
      path: PATH,
      limits: LIMITS,
      log: event => { events.push(event); emit({ event: 'gateway_refused', round, type: event.type, detail: event.detail }); },
    });
    await gateway.start();
    const address = gateway.status().address;
    emit({ event: 'round_ready', round, address, policyDigest: gateway.policyDigest });
    // Wait for the guest's request for as long as the overall deadline allows: the guest
    // console is driven by hand, so a fixed per-round budget would silently consume rounds
    // before the probe starts. A round with no request ends the run instead of shifting the
    // scenario mapping.
    const status = await waitForService(gateway, Math.max(1_000, deadline - Date.now()));
    if (status.requests === 0) {
      await gateway.stop();
      emit({ event: 'round_skipped', round, reason: 'no_request_before_deadline' });
      break;
    }
    await sleep(500);
    await gateway.stop();
    const originBefore = origin.state.requests;
    gatewayRounds.push({
      round,
      requests: status.requests,
      refused: status.refused,
      latchReason: status.latchReason,
      bytesOut: status.bytesOut,
      policyDigest: gateway.policyDigest,
      address,
      gatewayEvents: events.length,
      originRequestsTotal: originBefore,
      policy: { mode: 'fixture', listen: { host: address?.address ?? listen.host, port: address?.port ?? listen.port },
        origin: `http://127.0.0.1:${originPort}`, path: PATH, limits: LIMITS },
    });
    emit({ event: 'round_done', round, requests: status.requests, refused: status.refused, bytesOut: status.bytesOut });
    await sleep(150);
  }

  await origin.stop();
  const evidence = {
    at: new Date().toISOString(),
    host: process.env.COMPUTERNAME ?? null,
    mode: 'fixture',
    listen: { host: listen.host, port: listen.port },
    originConfig: { host: '127.0.0.1', port: originPort, path: PATH, limits: LIMITS },
    canary: 'stored as a presence flag only; never in any log',
    digestPerRound: gatewayRounds.map(r => r.policyDigest),
    rounds: gatewayRounds,
    origin: { requests: origin.state.requests, records: origin.state.records },
  };
  if (evidencePath) writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  emit({ event: 'evidence', path: evidencePath || null, rounds: gatewayRounds.length, originRequests: origin.state.requests });
}

if (smoke) {
  // Self-probe: one approved request and one CONNECT against the loopback instance.
  const origin = startFixtureOrigin();
  await origin.started;
  const gateway = createEgressGateway({
    mode: 'fixture', listen, origin: `http://127.0.0.1:${originPort}`, path: PATH, limits: LIMITS,
  });
  await gateway.start();
  const { port } = gateway.status().address;
  const approved = await fetch(`http://127.0.0.1:${port}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer public' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'smoke' }] }),
  });
  const approvedBody = await approved.text();
  emit({ event: 'smoke_approved', status: approved.status, fixture: approvedBody.includes('B30_GATEWAY_FIXTURE_OK') });
  await gateway.stop();
  await origin.stop();
  const refused = await fetch(`http://127.0.0.1:${port}${PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer public' },
    body: '{}',
  }).then(r => r.status).catch(error => `error:${error.cause?.code ?? error.message}`);
  emit({ event: 'smoke_after_stop', status: refused });
  process.exit(approved.status === 200 && origin.state.requests === 1 ? 0 : 1);
} else {
  await main();
}

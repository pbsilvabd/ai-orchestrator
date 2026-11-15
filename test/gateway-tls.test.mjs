import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyUpstreamFailure, createEgressGateway } from '../src/egress-gateway.mjs';
import { createListenerSupervisor } from '../src/listener-supervisor.mjs';

// Offline live-mode TLS fixtures (B30-04/07). A disposable CA and a leaf certificate for
// one fixture hostname are generated with openssl at test time; the gateway runs in a
// child process that trusts only that CA (NODE_EXTRA_CA_CERTS) and resolves three fixture
// names through a test-only preload. Certificate and hostname verification are Node's real
// defaults. Nothing here reaches an external resolver, a real origin or the network beyond
// 127.0.0.1, and no certificate or key is committed to the repository. This is not the
// deployed cross-namespace TLS chain (B30-07 `not_run`).

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOLVER = pathToFileURL(join(HERE, '..', 'integration', 'tls-fixture-resolver.mjs')).href;
const HOST = 'tls-host.fixture.test';
const OTHER = 'tls-other.fixture.test';
const DNS_FAIL = 'dns-fail.fixture.test';
const MODEL = 'opencode/deepseek-v4.1-flash-free';
const PATH = '/v1/chat/completions';
const LIMITS = { maxRequests: 12, maxRequestBytes: 64 * 1024, maxResponseBytes: 64 * 1024, timeoutMs: 5_000 };

const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
const SKIP = probe.status === 0 ? false
  : 'openssl is not on PATH; the offline TLS fixtures cannot generate disposable certificates';

let certificatesPromise;

function certificates() {
  certificatesPromise ??= createCertificates();
  return certificatesPromise;
}

after(async () => {
  if (certificatesPromise) await rm((await certificatesPromise).dir, { recursive: true, force: true });
});

async function createCertificates() {
  const dir = await mkdtemp(join(tmpdir(), 'b30-tls-'));
  const run = args => {
    const result = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`openssl ${args[0]} failed: ${result.stderr}`);
  };
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2',
    '-subj', '/CN=B30 disposable test CA']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', `/CN=${HOST}`]);
  await writeFile(join(dir, 'san.ext'), `subjectAltName=DNS:${HOST}\n`);
  run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
    '-out', 'leaf.pem', '-days', '2', '-extfile', 'san.ext']);
  return {
    dir,
    ca: join(dir, 'ca.pem'),
    key: await readFile(join(dir, 'leaf.key')),
    cert: await readFile(join(dir, 'leaf.pem')),
  };
}

async function startTlsOrigin(t) {
  const material = await certificates();
  const requests = [];
  const server = createServer({ key: material.key, cert: material.cert }, (req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null,
        body: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  return { requests, port };
}

async function tempHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'b30-gateway-tls-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

function liveSupervisor(home, caPath) {
  return createListenerSupervisor({
    home,
    execArgv: ['--import', RESOLVER],
    env: caPath ? { NODE_EXTRA_CA_CERTS: caPath } : {},
  });
}

function liveGatewayConfig(origin) {
  return { mode: 'live', listen: { host: '127.0.0.1', port: 0 }, origin, path: PATH, limits: LIMITS };
}

async function startLiveGateway(t, { trusted, origin, name }) {
  const material = await certificates();
  const home = await tempHome(t);
  const supervisor = liveSupervisor(home, trusted ? material.ca : null);
  const gateway = await supervisor.start({ name, kind: 'gateway', config: liveGatewayConfig(origin) });
  t.after(() => (gateway.state() === 'running' ? gateway.stop().catch(() => {}) : null));
  return { gateway, base: `http://127.0.0.1:${gateway.port}${PATH}` };
}

const post = (base, body = { model: MODEL }) =>
  fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer public' },
    body: JSON.stringify(body) });

test('B30-07: live gateway verifies the disposable CA and forwards one Bearer public request over TLS', { skip: SKIP }, async t => {
  const origin = await startTlsOrigin(t);
  const { gateway, base } = await startLiveGateway(t, { trusted: true, origin: `https://${HOST}:${origin.port}`, name: 'gw-trusted' });

  const response = await post(base);
  assert.equal(response.status, 200);
  assert.equal(origin.requests.length, 1);
  assert.equal(origin.requests[0].authorization, 'Bearer public');
  assert.equal(JSON.parse(origin.requests[0].body.toString('utf8')).model, MODEL);
  const status = await gateway.status();
  assert.equal(status.latched, false);
  assert.equal(status.latchReason, null);
});

test('B30-04/07: an untrusted certificate latches tls-failure before any request reaches the origin', { skip: SKIP }, async t => {
  const origin = await startTlsOrigin(t);
  const { gateway, base } = await startLiveGateway(t, { trusted: false, origin: `https://${HOST}:${origin.port}`, name: 'gw-untrusted' });

  const response = await post(base);
  assert.equal(response.status, 502);
  assert.equal(origin.requests.length, 0, 'an unverified certificate must not reach the origin');
  const status = await gateway.status();
  assert.equal(status.latched, true);
  assert.equal(status.latchReason, 'tls-failure');

  const after = await post(base);
  assert.equal(after.status, 503);
  assert.equal(origin.requests.length, 0, 'a latched gateway must not replay or retry');
});

test('B30-04/07: a hostname the certificate does not cover latches tls-failure with zero origin requests', { skip: SKIP }, async t => {
  const origin = await startTlsOrigin(t);
  const { gateway, base } = await startLiveGateway(t, { trusted: true, origin: `https://${OTHER}:${origin.port}`, name: 'gw-hostname' });

  const response = await post(base);
  assert.equal(response.status, 502);
  assert.equal(origin.requests.length, 0, 'a hostname mismatch must not reach the origin');
  const status = await gateway.status();
  assert.equal(status.latchReason, 'tls-failure');
});

test('B30-04/07: a DNS failure latches dns-failure without reaching any origin', { skip: SKIP }, async t => {
  const origin = await startTlsOrigin(t);
  const { gateway, base } = await startLiveGateway(t, { trusted: true, origin: `https://${DNS_FAIL}:${origin.port}`, name: 'gw-dns' });

  const response = await post(base);
  assert.equal(response.status, 502);
  assert.equal(origin.requests.length, 0);
  const status = await gateway.status();
  assert.equal(status.latched, true);
  assert.equal(status.latchReason, 'dns-failure');
});

test('B30-07: live mode refuses an ambient TLS verification bypass at creation and before each request', async t => {
  const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  t.after(() => {
    if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved;
  });
  const config = liveGatewayConfig(`https://${HOST}:1`);

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  assert.throws(() => createEgressGateway(config), /ambient TLS verification bypass/);

  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const gateway = createEgressGateway(config);
  await gateway.start();
  t.after(() => gateway.stop());
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const response = await post(`http://127.0.0.1:${gateway.status().address.port}${PATH}`);
  assert.equal(response.status, 502);
  assert.equal(gateway.status().latchReason, 'tls-policy');
});

test('B30-04/07: upstream failures are classified into distinct fail-closed latches', () => {
  assert.equal(classifyUpstreamFailure({ cause: { code: 'ENOTFOUND' } }), 'dns-failure');
  assert.equal(classifyUpstreamFailure({ cause: { code: 'EAI_AGAIN' } }), 'dns-failure');
  assert.equal(classifyUpstreamFailure({ cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }), 'tls-failure');
  assert.equal(classifyUpstreamFailure({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }), 'tls-failure');
  assert.equal(classifyUpstreamFailure({ cause: { code: 'CERT_HAS_EXPIRED' } }), 'tls-failure');
  assert.equal(classifyUpstreamFailure({ cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }), 'tls-failure');
  assert.equal(classifyUpstreamFailure({ cause: { code: 'ECONNREFUSED' } }), 'upstream-unavailable');
  assert.equal(classifyUpstreamFailure(new Error('timeout')), 'upstream-unavailable');
});

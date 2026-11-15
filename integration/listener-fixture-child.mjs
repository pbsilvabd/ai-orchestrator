// Test-only fixture child for `test/listener-supervisor.test.mjs` and the authority tests.
// It is not a listener implementation and is never started by production code. Mode comes
// from B30_FIXTURE_MODE, passed explicitly by the test:
//   ignore-stop:       binds a real loopback HTTP listener, reports ready with a null digest
//                      and ignores `stop`, so a supervisor stop cannot confirm the exit.
//   ignore-stop-valid: same, but reports the real policy digest for the received config so
//                      composition succeeds and close-time uncertainty can be exercised.
//   silent:            never reports ready, so the supervisor's ready timeout must settle it.
import { createServer } from 'node:http';
import { gatewayPolicyDigest } from '../src/egress-gateway.mjs';
import { relayPolicyDigest } from '../src/relay.mjs';

const mode = process.env.B30_FIXTURE_MODE;

if (mode === 'silent') {
  setInterval(() => {}, 1 << 30);
} else if (mode === 'ignore-stop') {
  const server = createServer((req, res) => { res.writeHead(200); res.end('{}'); });
  server.listen(0, '127.0.0.1', () => {
    process.send({ type: 'ready', port: server.address().port, policyDigest: null });
  });
  process.on('message', () => {});
} else if (mode === 'ignore-stop-valid') {
  process.on('message', message => {
    if (message?.type !== 'start') return;
    const digest = message.kind === 'relay'
      ? relayPolicyDigest(message.config) : gatewayPolicyDigest(message.config);
    const { host, port } = message.config.listen;
    const server = createServer((req, res) => { res.writeHead(200); res.end('{}'); });
    server.listen(port, host, () => {
      process.send({ type: 'ready', port: server.address().port, policyDigest: digest });
    });
  });
} else {
  process.exit(3);
}

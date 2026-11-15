// Test-only fixture child for `test/listener-supervisor.test.mjs`. It is not a listener
// implementation and is never started by production code. Mode comes from
// B30_FIXTURE_MODE, passed explicitly by the test:
//   ignore-stop: binds a real loopback HTTP listener, reports ready and ignores `stop`, so
//                a supervisor stop cannot confirm the exit (uncertain child stop).
//   silent:      never reports ready, so the supervisor's ready timeout must settle it.
import { createServer } from 'node:http';

const mode = process.env.B30_FIXTURE_MODE;

if (mode === 'silent') {
  setInterval(() => {}, 1 << 30);
} else if (mode === 'ignore-stop') {
  const server = createServer((req, res) => { res.writeHead(200); res.end('{}'); });
  server.listen(0, '127.0.0.1', () => {
    process.send({ type: 'ready', port: server.address().port, policyDigest: null });
  });
  process.on('message', () => {});
} else {
  process.exit(3);
}

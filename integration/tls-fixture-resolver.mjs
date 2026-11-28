// Test-only resolver preload (`node --import`) for the offline gateway TLS fixtures. It
// maps three fixed fixture hostnames to loopback and fails every other name without
// querying an external resolver, so a child process running the live-mode gateway can
// exercise Node's real certificate and hostname verification with no DNS or hosts-file
// change. Only the lookup result is simulated; TLS verification remains real.
// Node's listen() calls dns.lookup even for an IP literal; literals need no resolution, so
// they pass through unchanged. Every other name not in the map fails closed.
import dns from 'node:dns';
import { isIP } from 'node:net';

const LOOPBACK = new Map([
  ['tls-host.fixture.test', '127.0.0.1'],
  ['tls-other.fixture.test', '127.0.0.1'],
]);

function notFound(hostname) {
  const error = new Error(`getaddrinfo ENOTFOUND ${hostname} (fixture resolver)`);
  error.code = 'ENOTFOUND';
  error.hostname = hostname;
  return error;
}

dns.lookup = function fixtureLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const literalFamily = isIP(hostname);
  const address = literalFamily ? hostname : LOOPBACK.get(hostname);
  const family = literalFamily || 4;
  if (!address) {
    process.nextTick(callback, notFound(hostname));
    return;
  }
  if (options?.all) {
    process.nextTick(callback, null, [{ address, family }]);
  } else {
    process.nextTick(callback, null, address, family);
  }
};

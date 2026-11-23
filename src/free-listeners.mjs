import { isIP } from 'node:net';
import { gatewayPolicyDigest } from './egress-gateway.mjs';
import { relayPolicyDigest } from './relay.mjs';
import { createListenerSupervisor } from './listener-supervisor.mjs';
import { FREE_MODEL_ID } from './free-provider.mjs';

// Trusted composition of the supervised relay -> gateway chain (B30-04). It is only
// reachable from `createConfiguredTaskService` with an approved run and a signed-admission
// gate whose relay/gateway digests match the configuration below. Startup itself is NOT
// SSHSIG-verified: the operator approval artifact is unsigned JSON (shape/expiry/zero budget
// only) and the gate digests are not a signature. The signed gate verifies each submitted
// task instead. Ports are fixed and non-zero so both policy digests are known before any
// child starts. The relay binds loopback by default; trusted composition may pass an
// explicit loopback/private `relayHost` for the ADR-010 worker-facing interface. The gateway
// is fixture-mode and loopback-only, so this path cannot reach a live origin. Task text never
// supplies a host, port, origin or path.

export const FREE_RELAY_PATH = '/v1/chat/completions';
export const FREE_LISTENER_START_AUTHORITY =
  'trusted-composition infrastructure startup: unsigned operator approval artifact (shape, expiry and zero paid budget) plus a digest-bound admission gate; not SSHSIG-verified at startup; each submitted task is signature-verified by the gate (B30-05 partial)';
const LOOPBACK = '127.0.0.1';
const RELAY_NAME = 'b30-free-relay';
const GATEWAY_NAME = 'b30-free-gateway';

function refuse(message) {
  throw Object.assign(new Error(message), { code: 'invalid_argument' });
}

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Explicit relay binds must be concrete loopback/private addresses. Wildcard/unspecified,
// public and hostname forms are refused: the composition never binds every interface or a
// public address, and the address is part of the relay policy digest.
function isAllZeroIpv6(host) {
  const parts = host.split('::');
  if (parts.length === 1) {
    const groups = host.split(':');
    return groups.length === 8 && groups.every(group => /^0+$/.test(group));
  }
  if (parts.length !== 2) return false;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  if (left.length + right.length > 7) return false;
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return groups.every(group => /^0+$/.test(group));
}

function ipv6Groups(host) {
  if (host.includes('.')) return null; // IPv4-mapped forms are refused, not silently accepted
  const parts = host.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (parts.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-fA-F]{1,4}$/.test(group))) return null;
  return groups.map(group => parseInt(group, 16));
}

function isPrivateOrLoopback(host) {
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (family === 6) {
    const groups = ipv6Groups(host);
    if (!groups) return false;
    if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return true; // ::1
    if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    return false;
  }
  return false;
}

function urlHost(host) {
  return isIP(host) === 6 ? `[${host}]` : host;
}

// Pure: builds the child configurations and their policy digests without any effect.
export function freeListenerPlan(listeners) {
  if (!listeners || typeof listeners !== 'object' || Array.isArray(listeners)) refuse('free listeners must be an object');
  const { relayPort, gatewayPort, gatewayOrigin, limits, relayHost = LOOPBACK } = listeners;
  if (!limits || !Number.isInteger(limits.maxRequests) || limits.maxRequests < 1 || limits.maxRequests > 12)
    refuse('free listener request cap must be between 1 and 12');
  if (!validPort(relayPort) || !validPort(gatewayPort) || relayPort === gatewayPort) {
    refuse('free listeners require distinct fixed ports');
  }
  if (typeof relayHost !== 'string' || !isIP(relayHost) || isAllZeroIpv6(relayHost) ||
      !isPrivateOrLoopback(relayHost)) {
    refuse('free listener relay host must be a concrete private or loopback IP address');
  }
  const originMatch = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(gatewayOrigin ?? '');
  if (!originMatch || !validPort(Number(originMatch[1])) || Number(originMatch[1]) === gatewayPort ||
      Number(originMatch[1]) === relayPort) {
    refuse('free listener gateway origin must be a distinct fixed loopback http origin');
  }
  const gatewayConfig = { mode: 'fixture', listen: { host: LOOPBACK, port: gatewayPort }, origin: gatewayOrigin,
    path: FREE_RELAY_PATH, limits };
  const relayConfig = { listen: { host: relayHost, port: relayPort },
    upstream: { origin: `http://${LOOPBACK}:${gatewayPort}`, path: FREE_RELAY_PATH, method: 'POST' },
    model: FREE_MODEL_ID, limits };
  return {
    relayConfig,
    gatewayConfig,
    relayHost,
    maxRequests: limits.maxRequests,
    relayPolicyDigest: relayPolicyDigest(relayConfig),
    gatewayPolicyDigest: gatewayPolicyDigest(gatewayConfig),
    startupAuthority: FREE_LISTENER_START_AUTHORITY,
    workerBaseURL: `http://${urlHost(relayHost)}:${relayPort}/v1`,
  };
}

// Start the gateway, then the relay, under one supervisor owned by `home`. Any refusal
// stops what already started (confirmed stops release locks; uncertain stops keep them and
// are surfaced). Digests are checked against the plan after start as defense in depth.
export async function startFreeListeners({ home, listeners, plan }) {
  const supervisor = createListenerSupervisor({ ...(listeners.supervisor ?? {}), home });
  let gateway;
  let relay;
  // Stop every listener that is still running. Errors are collected so that both are
  // attempted; an uncertain stop is surfaced and its lock is kept by the supervisor.
  const stopAll = async () => {
    const errors = [];
    for (const handle of [relay, gateway]) {
      if (handle === undefined || handle.state() !== 'running') continue;
      try { await handle.stop(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
  };
  try {
    gateway = await supervisor.start({ name: GATEWAY_NAME, kind: 'gateway', config: plan.gatewayConfig });
    relay = await supervisor.start({ name: RELAY_NAME, kind: 'relay', config: plan.relayConfig });
    if (gateway.policyDigest !== plan.gatewayPolicyDigest || relay.policyDigest !== plan.relayPolicyDigest) {
      throw Object.assign(new Error('supervised listener policy does not match the approved plan'),
        { code: 'authorization_denied' });
    }
  } catch (error) {
    await stopAll();
    throw error;
  }
  return {
    workerBaseURL: plan.workerBaseURL,
    relayPort: listeners.relayPort,
    gatewayPort: listeners.gatewayPort,
    healthy: () => relay.state() === 'running' && gateway.state() === 'running',
    states: () => ({ relay: relay.state(), gateway: gateway.state() }),
    stop: stopAll,
  };
}

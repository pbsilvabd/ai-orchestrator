import { gatewayPolicyDigest } from './egress-gateway.mjs';
import { relayPolicyDigest } from './relay.mjs';
import { createListenerSupervisor } from './listener-supervisor.mjs';
import { FREE_MODEL } from './free-provider.mjs';

// Trusted composition of the supervised fixture relay → gateway chain (B30-04). It is only
// reachable from `createConfiguredTaskService` with an approved run and a signed-admission
// gate whose relay/gateway digests match the configuration below. Startup itself is NOT
// SSHSIG-verified: the operator approval artifact is unsigned JSON (shape/expiry/zero budget
// only) and the gate digests are not a signature. The signed gate verifies each submitted
// task instead. Ports are fixed and non-zero so both policy digests are known before any
// child starts. Every listener binds 127.0.0.1 and the gateway is fixture-mode, so this path
// cannot reach a live origin. Task text never supplies a host, port, origin or path.

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

// Pure: builds the child configurations and their policy digests without any effect.
export function freeListenerPlan(listeners) {
  if (!listeners || typeof listeners !== 'object' || Array.isArray(listeners)) refuse('free listeners must be an object');
  const { relayPort, gatewayPort, gatewayOrigin, limits } = listeners;
  if (!validPort(relayPort) || !validPort(gatewayPort) || relayPort === gatewayPort) {
    refuse('free listeners require distinct fixed loopback ports');
  }
  const originMatch = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(gatewayOrigin ?? '');
  if (!originMatch || !validPort(Number(originMatch[1])) || Number(originMatch[1]) === gatewayPort ||
      Number(originMatch[1]) === relayPort) {
    refuse('free listener gateway origin must be a distinct fixed loopback http origin');
  }
  const gatewayConfig = { mode: 'fixture', listen: { host: LOOPBACK, port: gatewayPort }, origin: gatewayOrigin,
    path: FREE_RELAY_PATH, limits };
  const relayConfig = { listen: { host: LOOPBACK, port: relayPort },
    upstream: { origin: `http://${LOOPBACK}:${gatewayPort}`, path: FREE_RELAY_PATH, method: 'POST' },
    model: FREE_MODEL, limits };
  return {
    relayConfig,
    gatewayConfig,
    relayPolicyDigest: relayPolicyDigest(relayConfig),
    gatewayPolicyDigest: gatewayPolicyDigest(gatewayConfig),
    startupAuthority: FREE_LISTENER_START_AUTHORITY,
    workerBaseURL: `http://${LOOPBACK}:${relayPort}/v1`,
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

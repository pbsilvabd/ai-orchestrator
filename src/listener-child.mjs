import { createRelay } from './relay.mjs';
import { createEgressGateway } from './egress-gateway.mjs';

// Child entry for a supervised relay or gateway listener (B30-04, see
// `src/listener-supervisor.mjs`). The parent forks this file with an IPC channel and sends
// one `start` message. The child replies `ready` once the listener is bound, or `error`
// and exits 2 when it refuses to launch. A `stop` message stops the listener and exits 0.
// A disconnected parent also stops the listener, so a vanished supervisor cannot leave an
// unowned listener behind.

let listener;
let stopping = false;

function reply(message, after) {
  if (typeof process.send !== 'function') return after?.();
  process.send(message, after);
}

async function stopListener() {
  if (stopping) return;
  stopping = true;
  try {
    if (listener) await listener.stop();
  } catch {
    // The parent observes an unconfirmed exit and keeps its ownership lock.
  }
  reply({ type: 'stopped' }, () => process.exit(0));
}

async function startListener({ kind, config }) {
  try {
    listener = kind === 'relay' ? createRelay(config) : createEgressGateway(config);
    await listener.start();
    reply({ type: 'ready', port: listener.status().address.port, policyDigest: listener.policyDigest });
  } catch (error) {
    reply({ type: 'error', code: error?.code === 'invalid_argument' ? 'invalid_argument' : 'unavailable',
      message: error?.message ?? 'listener failed to start' }, () => process.exit(2));
  }
}

process.on('message', message => {
  if (message?.type === 'start' && !listener && !stopping) {
    startListener(message);
  } else if (message?.type === 'status') {
    reply({ type: 'status', status: listener ? listener.status() : null });
  } else if (message?.type === 'stop') {
    stopListener();
  }
});

process.on('disconnect', () => { stopListener(); });

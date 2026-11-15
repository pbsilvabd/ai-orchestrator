import { fork } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Service-owned supervisor for a relay or egress-gateway listener running in its own child
// process (B30-04). Ownership is a durable lock file written before the child is spawned
// and removed only after the child's exit is confirmed. A stop that cannot confirm the exit
// keeps the lock: the port may still be held, so a restart is refused until a maintainer
// verifies the process tree and calls `reconcileListenerLock`. No path restarts a listener
// automatically and no lock is deleted on uncertainty.
//
// `src/free-listeners.mjs` wires it into the fixture-only `createConfiguredTaskService` path
// (B30-04). Live composition stays closed (ADR-009/010).

export class ListenerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ListenerError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ListenerError(code, message);
}

const CHILD_ENTRY = fileURLToPath(new URL('./listener-child.mjs', import.meta.url));
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const KINDS = new Set(['relay', 'gateway']);
const PASSTHROUGH_ENV = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT'];

function validateName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) fail('invalid_argument', 'listener name is invalid');
}

function validateHome(home) {
  if (typeof home !== 'string' || !isAbsolute(home)) fail('invalid_argument', 'listener home must be an absolute path');
}

function lockPathFor(home, name) {
  return join(home, 'listeners', `${name}.lock.json`);
}

async function readLock(lockPath) {
  return JSON.parse(await readFile(lockPath, 'utf8'));
}

async function acquireLock(lockPath, record) {
  try {
    await mkdir(dirname(lockPath), { recursive: true });
  } catch {
    fail('unavailable', 'listener home is not usable');
  }
  try {
    await writeFile(lockPath, JSON.stringify(record), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') fail('owner-present', 'listener lock is held; reconcile before starting');
    fail('unavailable', 'listener lock could not be written');
  }
}

async function recordPid(lockPath, record) {
  const temporary = `${lockPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record));
  await rename(temporary, lockPath);
}

// Release the lock only for the token that acquired it. A mismatch or unreadable lock keeps
// ownership and is reported as uncertainty.
async function releaseLock(lockPath, token) {
  let current;
  try {
    current = await readLock(lockPath);
  } catch {
    fail('uncertain-stop', 'listener lock is unreadable; ownership retained');
  }
  if (current.token !== token) fail('uncertain-stop', 'listener lock token mismatch; ownership retained');
  await unlink(lockPath);
}

function childEnvironment(extra) {
  const base = {};
  for (const key of PASSTHROUGH_ENV) {
    if (process.env[key] !== undefined) base[key] = process.env[key];
  }
  return { ...base, ...extra };
}

// An 'error' event (spawn or IPC failure) never crashes the supervisor; a spawn that never
// produced a pid is a confirmed non-running child, and any other failure is judged by the exit.
function exitedOnce(child) {
  return new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', () => { if (child.pid === undefined) resolve({ code: null, signal: null }); });
  });
}

// Resolve with the exit info, or null when the child has not exited within timeoutMs.
function raceExit(exited, timeoutMs) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
  return Promise.race([exited, timeout]).finally(() => clearTimeout(timer));
}

function killChild(child) {
  child.kill('SIGKILL');
}

// Wait for the first ready/error reply, the child exit, or the timeout.
function firstReply(child, exited, timeoutMs) {
  return new Promise(resolve => {
    let timer;
    const finish = value => {
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(value);
    };
    const onMessage = message => {
      if (message?.type === 'ready' || message?.type === 'error') finish({ kind: message.type, message });
    };
    timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    child.on('message', onMessage);
    exited.then(info => finish({ kind: 'exit', ...info }));
  });
}

// Remove a listener's lock only after the caller has verified the process tree is stopped.
// The token and pid must match the lock, so a stale or unrelated record is never released.
export async function reconcileListenerLock({ home, name, token, pid, confirmedStopped } = {}) {
  validateHome(home);
  validateName(name);
  if (confirmedStopped !== true) {
    fail('invalid_argument', 'reconciliation requires confirmedStopped: true after the process tree is verified stopped');
  }
  const lockPath = lockPathFor(home, name);
  let current;
  try {
    current = await readLock(lockPath);
  } catch {
    fail('uncertain-stop', 'listener lock is missing or unreadable; nothing was released');
  }
  if (current.token !== token || current.pid !== pid) fail('invalid_argument', 'lock does not match token and pid');
  await unlink(lockPath);
  return { released: name };
}

export function createListenerSupervisor({
  home,
  entry = CHILD_ENTRY,
  execArgv = [],
  env = {},
  fork: spawnChild = fork,
  readyTimeoutMs = 10_000,
  stopTimeoutMs = 5_000,
  killTimeoutMs = 5_000,
  terminate = killChild,
} = {}) {
  validateHome(home);

  // Terminate and wait for a confirmed exit. Returns the exit info, or null when unconfirmed.
  async function settle(child, exited) {
    try { terminate(child); } catch { /* the exit wait below decides */ }
    return raceExit(exited, killTimeoutMs);
  }

  function createHandle({ child, exited, lockPath, token, name, pid, port, policyDigest }) {
    let state = 'running';

    // A child that exits on its own after ready is a confirmed exit: release its lock.
    exited.then(async () => {
      if (state !== 'running') return;
      state = 'exited';
      try { await releaseLock(lockPath, token); } catch { state = 'unknown'; }
    });

    return {
      name,
      token,
      pid,
      port,
      policyDigest,
      state: () => state,
      status() {
        if (state !== 'running') fail('unavailable', `listener is ${state}`);
        return new Promise((resolve, reject) => {
          let timer;
          const settleStatus = (error, value) => {
            clearTimeout(timer);
            child.off('message', onMessage);
            if (error) reject(error); else resolve(value);
          };
          const onMessage = message => {
            if (message?.type === 'status') settleStatus(null, message.status);
          };
          timer = setTimeout(() => settleStatus(new ListenerError('unavailable', 'listener status did not reply')), 2000);
          child.on('message', onMessage);
          child.send({ type: 'status' }, error => { if (error) settleStatus(error); });
        });
      },
      async stop() {
        if (state !== 'running') fail('unavailable', `listener is ${state}`);
        state = 'stopping';
        try { child.send({ type: 'stop' }); } catch { /* the exit wait below decides */ }
        let exit = await raceExit(exited, stopTimeoutMs);
        let outcome = exit?.code === 0 ? 'stopped' : 'exited';
        if (!exit) {
          outcome = 'killed';
          exit = await settle(child, exited);
          if (!exit) {
            state = 'unknown';
            fail('uncertain-stop', `listener ${name} did not exit after stop and kill; lock ${token} retained`);
          }
        }
        try {
          await releaseLock(lockPath, token);
        } catch (error) {
          state = 'unknown';
          throw error;
        }
        state = 'stopped';
        return { outcome, code: exit.code, signal: exit.signal };
      },
    };
  }

  // Order: write the lock (token, no pid) -> spawn -> record pid -> send start -> await ready.
  // The child is never running without a lock on disk, and a child that exits or cannot be
  // confirmed stopped keeps the lock as uncertainty.
  return {
    lockPath(name) {
      validateName(name);
      return lockPathFor(home, name);
    },

    async start({ name, kind, config } = {}) {
      validateName(name);
      if (!KINDS.has(kind)) fail('invalid_argument', 'listener kind must be relay or gateway');
      const lockPath = lockPathFor(home, name);
      const token = randomUUID();
      const record = { name, kind, token, pid: null, createdAt: new Date().toISOString() };
      await acquireLock(lockPath, record);

      let child;
      try {
        child = spawnChild(entry, [], {
          execArgv,
          env: childEnvironment(env),
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          windowsHide: true,
        });
      } catch {
        await releaseLock(lockPath, token);
        fail('unavailable', 'listener child could not be started');
      }
      child.stdout?.resume();
      child.stderr?.resume();
      const exited = exitedOnce(child);

      try {
        await recordPid(lockPath, { ...record, pid: child.pid });
        child.send({ type: 'start', kind, config });
      } catch {
        const exit = await settle(child, exited);
        if (!exit) fail('uncertain-stop', 'listener could not be armed and did not exit; lock retained');
        await releaseLock(lockPath, token);
        fail('unavailable', 'listener could not be armed');
      }

      const reply = await firstReply(child, exited, readyTimeoutMs);
      if (reply.kind === 'ready') {
        return createHandle({ child, exited, lockPath, token, name, pid: child.pid,
          port: reply.message.port, policyDigest: reply.message.policyDigest });
      }

      if (reply.kind === 'timeout') {
        const exit = await settle(child, exited);
        if (!exit) fail('uncertain-stop', `listener ${name} never reported ready and did not exit; lock retained`);
        await releaseLock(lockPath, token);
        fail('unavailable', `listener ${name} did not report ready`);
      }

      // A refusal or an early exit: wait for the child to exit, forcing it if needed.
      const exit = (await raceExit(exited, killTimeoutMs)) ?? (await settle(child, exited));
      if (!exit) fail('uncertain-stop', `listener ${name} refused launch but did not exit; lock retained`);
      await releaseLock(lockPath, token);
      if (reply.kind === 'error') {
        fail(reply.message.code === 'invalid_argument' ? 'invalid_argument' : 'unavailable', reply.message.message);
      }
      fail('unavailable', `listener child exited before ready (code ${exit.code})`);
    },
  };
}

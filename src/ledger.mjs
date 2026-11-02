import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, readFileSync,
  renameSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createState, validateState, select, success, failure, nextOperation } from './policy.mjs';

// Local filesystem, trusted directory, cooperative writers. Keep open across dispatch.
// No stale-lock recovery: a crash requires explicit operator reconciliation.
export function openSession(directory, sessionId) {
  const initial = createState(sessionId); // Validate before creating filesystem entries.
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(sessionId).digest('hex');
  const path = join(root, `${key}.json`);
  const lock = join(root, `${key}.lock`);
  const lockFd = openSync(lock, 'wx', 0o600);
  let state;
  let closed = false;
  let poisoned = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try { closeSync(lockFd); } finally { unlinkSync(lock); }
  };
  const check = () => {
    if (closed || poisoned) throw new Error('Ledger is closed or requires reopening');
  };
  const persist = next => {
    validateState(next);
    if (next.sessionId !== sessionId) throw new Error('Session mismatch');
    const temp = `${path}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(next), 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, path); // Same directory; never truncate the committed checkpoint.
      state = next;
    } catch (error) {
      poisoned = true; // Never continue from memory after an uncertain persistence failure.
      throw error;
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  try {
    writeFileSync(lockFd, JSON.stringify({ pid: process.pid, sessionId }), 'utf8');
    fsyncSync(lockFd);
    let content;
    try { content = readFileSync(path, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (content === undefined) persist(initial);
    else {
      state = JSON.parse(content);
      validateState(state);
      if (state.sessionId !== sessionId) throw new Error('Session mismatch');
    }
  } catch (error) { close(); throw error; }

  return {
    snapshot() { check(); return structuredClone(state); },
    select(models, options) {
      check();
      const result = select(state, models, options);
      if (result.action === 'dispatch') persist(result.state);
      return structuredClone(result); // Provider may run only AFTER this returns.
    },
    success(dispatch) {
      check(); persist(success(state, dispatch)); return structuredClone(state);
    },
    failure(dispatch, error, options) {
      check();
      const result = failure(state, dispatch, error, options);
      persist(result.state);
      return structuredClone(result);
    },
    nextOperation() {
      check(); persist(nextOperation(state)); return structuredClone(state);
    },
    close,
  };
}

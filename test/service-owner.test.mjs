import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskService } from '../src/service.mjs';

test('closed services reject all operations after another owner starts', t => {
  const home = mkdtempSync(join(tmpdir(), 'owner-closed-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const old = createTaskService({ home });
  old.close();
  const current = createTaskService({ home });
  try {
    for (const operation of ['submitTask', 'getTaskStatus', 'getTaskResult', 'cancelTask'])
      assert.throws(() => old[operation]({}), e => e.code === 'unavailable');
    old.close(); // Must not release the replacement owner's lock.
    assert.throws(() => createTaskService({ home }), e => e.code === 'unavailable');
  } finally { current.close(); }
});

test('a competing process cannot reconcile active work and abrupt death leaves a stale lock',
  { timeout: 15_000 }, async t => {
    const home = mkdtempSync(join(tmpdir(), 'owner-process-'));
    const moduleUrl = new URL('../src/service.mjs', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createTaskService } from ${JSON.stringify(moduleUrl)};
      const service = createTaskService({ home: process.argv[1], now: 1000 });
      const { task } = service.store.createTask({ clientId: 'owner', idempotencyKey: 'key', payload: {}, now: 1000 });
      service.store.updateTask(task.taskId, d => { d.status = 'running'; d.startedAt = 1000; });
      process.stdout.write(task.taskId + '\\n');
      setInterval(() => {}, 1000);
    `, home], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      }
      rmSync(home, { recursive: true, force: true });
    });
    const exited = once(child, 'exit');
    const ready = once(child.stdout, 'data').then(([chunk]) => chunk.toString().trim());
    const taskId = await Promise.race([ready, exited.then(() => { throw new Error('owner exited before ready'); })]);
    const path = join(home, 'tasks', `${taskId}.json`);
    const before = readFileSync(path, 'utf8');
    assert.throws(() => createTaskService({ home, now: 2000 }), e => e.code === 'unavailable');
    assert.equal(readFileSync(path, 'utf8'), before);
    child.kill('SIGKILL'); await exited;
    assert.throws(() => createTaskService({ home, now: 2000 }), e => e.code === 'unavailable');
    assert.equal(readFileSync(path, 'utf8'), before);
    // Explicit maintainer action after confirmed death; service must block uncertain work.
    rmSync(join(home, 'locks', 'service-owner.lock'));
    const recovered = createTaskService({ home, now: 2000 });
    try { assert.equal(recovered.store.readTask(taskId).status, 'blocked'); }
    finally { recovered.close(); }
  });

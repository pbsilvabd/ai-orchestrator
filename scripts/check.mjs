#!/usr/bin/env node
// Single static + test gate for local runs and CI. Uses Node built-ins only so it
// runs without `npm install` (AGENTS.md keeps npm install unnecessary).

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSchema } from '../src/contracts/validate.mjs';

const root = join(import.meta.dirname, '..');
const failures = [];

const modulesIn = directory =>
  readdirSync(join(root, directory), { recursive: true })
    .filter(entry => entry.endsWith('.mjs'))
    .map(entry => join(directory, entry))
    .sort();

const syntaxDirectories = ['src', 'scripts', 'examples', 'test'];
const modules = syntaxDirectories.flatMap(directory => modulesIn(directory));
for (const file of modules) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${file}: syntax check failed\n${(result.stderr ?? '').trim()}`);
  }
}

const schemaDirectory = join(root, 'src/contracts/schemas');
const schemas = readdirSync(schemaDirectory)
  .filter(name => name.endsWith('.schema.json'))
  .sort();
for (const schema of schemas) {
  try {
    assertSchema(JSON.parse(readFileSync(join(schemaDirectory, schema), 'utf8')));
  } catch (error) {
    failures.push(`src/contracts/schemas/${schema}: ${error.message}`);
  }
}

const runTests = !process.argv.includes('--no-tests');
if (runTests) {
  const tests = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (tests.status !== 0) {
    failures.push(`node --test exited with ${tests.status ?? tests.signal}`);
  }
}

const whitespace = spawnSync('git', ['diff', '--check', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (whitespace.error) {
  failures.push(`git diff --check HEAD: ${whitespace.error.message}`);
} else if (whitespace.status !== 0) {
  failures.push(`git diff --check HEAD failed\n${(whitespace.stdout + whitespace.stderr).trim()}`);
}

if (failures.length === 0) {
  const suite = runTests ? ', node --test' : '';
  console.log(`check passed: ${modules.length} modules, ${schemas.length} schemas${suite}, git diff --check HEAD`);
} else {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}

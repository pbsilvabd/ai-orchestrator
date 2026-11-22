import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(join(root, relative), 'utf8');
const frontmatter = (relative) => {
  const text = read(relative);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, `${relative} must start with YAML frontmatter`);
  return { yaml: match[1], body: text.slice(match[0].length) };
};
const field = (yaml, name) => {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(yaml);
  return match?.[1].trim();
};

test('B31 roster has the task-specific OpenCode V2 agents and no frontend role', () => {
  const agents = readdirSync(join(root, '.opencode/agents')).filter((name) => name.endsWith('.md')).sort();
  assert.deepEqual(agents, [
    'build.md',
    'critical-reviewer.md',
    'executor.md',
    'explore.md',
    'plan.md',
    'reviewer.md',
  ]);

  const expected = {
    build: ['primary', 'opencode/deepseek-v4.1-flash#high'],
    plan: ['primary', 'opencode/deepseek-v4.1-flash#max'],
    executor: ['subagent', 'opencode/deepseek-v4.1-flash#low'],
    explore: ['subagent', 'opencode/deepseek-v4.1-flash#low'],
    reviewer: ['all', 'opencode/deepseek-v4.1-flash#high'],
    'critical-reviewer': ['subagent', 'openai/gpt-6.1-sol#high'],
  };
  for (const [id, [mode, model]] of Object.entries(expected)) {
    const { yaml } = frontmatter(`.opencode/agents/${id}.md`);
    assert.equal(field(yaml, 'mode'), mode, `${id} mode`);
    assert.equal(field(yaml, 'model'), model, `${id} model/effort`);
    assert.ok(field(yaml, 'description'), `${id} description`);
  }
});

test('reviewer and executor agents retain scoped-edit, approval, and destructive-command guardrails', () => {
  for (const id of ['reviewer', 'critical-reviewer', 'executor']) {
    const { yaml } = frontmatter(`.opencode/agents/${id}.md`);
    assert.match(yaml, /action: "\*"\s*\n\s+resource: "\*"\s*\n\s+effect: deny/);
    assert.match(yaml, /action: edit\s*\n\s+resource: "\*"\s*\n\s+effect: allow/);
    assert.match(yaml, /action: shell\s*\n\s+resource: "\*"\s*\n\s+effect: ask/);
    assert.match(yaml, /resource: "git push --force\*"\s*\n\s+effect: deny/);
    assert.match(yaml, /resource: "\*\.env"\s*\n\s+effect: deny/);
    assert.ok(yaml.includes('resource: "*.env.*"'));
    assert.match(yaml, /action: grep\s*\n\s+resource: "\*\.env"\s*\n\s+effect: deny/);
    assert.match(yaml, /action: grep\s*\n\s+resource: "\*\.env\.\*"\s*\n\s+effect: deny/);
  }
  for (const id of ['reviewer', 'critical-reviewer']) {
    const { yaml } = frontmatter(`.opencode/agents/${id}.md`);
    assert.match(yaml, /resource: "git reset \*"\s*\n\s+effect: deny/);
    assert.match(yaml, /resource: "git clean \*"\s*\n\s+effect: deny/);
    assert.match(yaml, /resource: "git switch \*"\s*\n\s+effect: deny/);
  }
});

test('build agent can dispatch the named planning and execution/review subagents only', () => {
  const { yaml } = frontmatter('.opencode/agents/build.md');
  assert.match(yaml, /action: subagent\s*\n\s+resource: "\*"\s*\n\s+effect: deny/);
  for (const id of ['executor', 'explore', 'plan', 'reviewer', 'critical-reviewer']) {
    assert.ok(
      yaml.includes(`action: subagent\n    resource: "${id}"\n    effect: allow`),
      `build agent may launch ${id}`,
    );
  }
});

test('planning and exploration agents cannot edit or run shell commands', () => {
  for (const id of ['plan', 'explore']) {
    const { yaml } = frontmatter(`.opencode/agents/${id}.md`);
    assert.match(yaml, /action: "\*"\s*\n\s+resource: "\*"\s*\n\s+effect: deny/);
    assert.doesNotMatch(yaml, /action: edit\s*\n\s+resource: "\*"\s*\n\s+effect: allow/);
    assert.doesNotMatch(yaml, /action: shell\s*\n\s+resource: "\*"\s*\n\s+effect: (?:allow|ask)/);
    assert.match(yaml, /action: read\s*\n\s+resource: "\*"\s*\n\s+effect: allow/);
  }
});

test('review commands are explicit, exact-PR, risk-routed, and do not embed shell blocks', () => {
  const routine = frontmatter('.opencode/commands/review-merge.md');
  assert.equal(field(routine.yaml, 'agent'), 'reviewer');
  assert.equal(field(routine.yaml, 'subagent'), 'true');
  assert.match(routine.body, /\$ARGUMENTS/);
  assert.match(routine.body, /exact PR/);
  assert.match(routine.body, /every gate below passes/);
  assert.match(routine.body, /critical-review-merge/);

  const critical = frontmatter('.opencode/commands/critical-review-merge.md');
  assert.equal(field(critical.yaml, 'agent'), 'critical-reviewer');
  assert.equal(field(critical.yaml, 'model'), 'openai/gpt-6.1-sol#high');
  assert.equal(field(critical.yaml, 'subagent'), 'true');
  assert.match(critical.body, /exact PR/);
  assert.match(critical.body, /every gate below passes/);
  for (const body of [routine.body, critical.body]) {
    assert.doesNotMatch(body, /!`/);
    assert.match(body, /Never merge another PR/);
    assert.match(body, /final head|final-head/i);
  }
});

test('shared review skill requires task evidence, safe worktree, and no merge on unknown gates', () => {
  const skill = read('.opencode/skills/task-review/SKILL.md');
  for (const phrase of [
    'task card',
    'complete base-to-head diff',
    'untrusted data',
    'exact PR head branch',
    'no executor is still editing',
    'Every required acceptance row',
    'required GitHub checks',
    'no required row is `not_run`',
    'Never replay an uncertain merge',
  ]) {
    assert.ok(skill.includes(phrase), `missing review requirement: ${phrase}`);
  }
});

test('B31 documentation links resolve to repository files or explicit external URLs', () => {
  const documents = [
    'AGENTS.md',
    'README.md',
    '.github/pull_request_template.md',
    'docs/adr/011-local-review-merge-harness.md',
    'docs/backlog.md',
    'docs/definition-of-done.md',
    'docs/handoff.md',
    'docs/pr-review.md',
    'docs/requirements.md',
    'docs/roadmap.md',
    'docs/task-contract.md',
    'docs/tasks/B20.md',
    'docs/tasks/B31.md',
  ];
  for (const relative of documents) {
    const source = read(relative);
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0].split('?')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      assert.ok(
        existsSync(join(root, dirname(relative), decodeURIComponent(target))),
        `${relative} has unresolved link target ${target}`,
      );
    }
  }
});

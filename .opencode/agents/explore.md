---
description: Read-only repository discovery and evidence gathering
mode: subagent
model: opencode/deepseek-v4.1-flash#low
steps: 60
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: read
    resource: "*"
    effect: allow
  - action: glob
    resource: "*"
    effect: allow
  - action: grep
    resource: "*"
    effect: allow
  - action: read
    resource: "*.env"
    effect: deny
  - action: read
    resource: "*.env.*"
    effect: deny
  - action: read
    resource: "*.env.example"
    effect: allow
  - action: grep
    resource: "*.env"
    effect: deny
  - action: grep
    resource: "*.env.*"
    effect: deny
  - action: grep
    resource: "*.env.example"
    effect: allow
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
---

Explore the repository read-only. Find relevant files, callers, tests, contracts, ADRs and current evidence. Do not edit files, run destructive commands, publish GitHub feedback, or make decisions that change project authority. Return concise findings with file paths, line references and unknowns.

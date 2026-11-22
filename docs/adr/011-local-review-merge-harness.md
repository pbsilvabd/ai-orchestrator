# ADR-011 — User-invoked OpenCode review-and-merge harness

Date: 2026-11-22. Status: accepted for the local OpenCode development workflow;
does not change the AI Orchestrator worker/service authority.

## Context

The repository's PR feedback protocol is currently manual. The maintainer wants a
lower-cost model to execute bounded work and a separate reviewer model to inspect,
correct, validate and merge a task PR when its acceptance criteria pass. OpenCode
supports project-local agents, skills and explicit slash commands, but an agent
instruction alone is not a security boundary and shell/GitHub tools have the host
user's authority.

The normative service contract says the service worker cannot approve or merge its
own result. The local development harness is a separate, trusted, user-invoked
OpenCode workflow. It must not grant authority to a service task, task content,
worker, model response or arbitrary open PR.

## Decision

1. Add a project-local OpenCode agent roster: `build` (primary, DeepSeek V4.1
   Flash high), `plan` (primary, DeepSeek V4.1 Flash max), `executor`
   (subagent, DeepSeek V4.1 Flash low), `explore` (read-only subagent, DeepSeek
   V4.1 Flash low), and `reviewer` (all mode, DeepSeek V4.1 Flash high). The
   repository has no product frontend, so no `frontend` agent is included.
2. Add `critical-reviewer` (subagent, GPT-6.1 Sol high) for sensitive work,
   with the same correction and merge gates. Users may change all model IDs to
   models available in their OpenCode provider catalog.
3. Expose explicit `/review-merge <PR URL>` and
   `/critical-review-merge <PR URL>` commands. The command invocation is
   conditional, task-specific authorization for that exact PR, not standing
   authorization for other PRs or tasks.
4. The routine reviewer refuses to edit/merge a task that touches security,
   credentials, provider/network egress, authorization, lifecycle/persistence,
   contract, budget or merge policy; it routes those tasks to the critical
   command. Both commands require the same acceptance, exact-head, review,
   test and CI gates.
5. Reviewers may edit and correct the target task branch. They must inspect all
   current PR feedback, publish actionable findings, test corrections, review the
   final diff again and verify the exact final head before considering merge.
6. Reviewer shell access, push and merge remain subject to OpenCode permission
   prompts/denials. The project agents explicitly deny destructive reset,
   checkout-discard and force-push patterns. No shell permission is bypassed.
7. If any required criterion or CI result is missing, `not_run`, pending, failed,
   stale, or uncertain, the reviewer leaves the PR unmerged. It never widens
   scope, activates a provider, accesses credentials, or changes infrastructure.
8. This decision does not make the AI Orchestrator service worker a merger, does
   not alter production permissions, and does not authorize merging any currently
   open PR. Existing project/runtime security gates and service contract remain.

## Consequences

- Routine implementation can use a lower-effort model; the reviewer is
  configured at high effort. Changes with trust-boundary impact receive the
  dedicated GPT-6.1 Sol high reviewer.
- The exact-PR slash command is an explicit human action and authorization point.
  OpenCode may still request permission for shell, push or merge commands.
- The agent may fix issues, but it must rerun tests and re-review its corrected
  diff. A green suite alone never satisfies an acceptance row.
- The workflow is not an autonomous background controller and does not guarantee
  model correctness. OpenCode integration must be validated in the user's actual
  installed runtime before relying on command discovery or execution.

## Validation

See [B31](../tasks/B31.md) and the corresponding entry in `docs/validation.md`.
Configuration/model discovery is not evidence that the live slash-command workflow
has been exercised.

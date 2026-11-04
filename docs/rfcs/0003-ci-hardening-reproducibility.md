# RFC-0003: CI hardening and reproducibility gates

Date: 2026-11-04. Status: Proposed.

Depends on: [RFC-0001](0001-contract-schemas.md)

Fixes #31

## Status

Proposed. This RFC is documentation only: it decides the split between a reproducibility
foundation and the gates built on top of it. Nothing in `.github/workflows/`, `package.json`
or `scripts/` changes here. Implementation ships in two sibling task PRs,
[B27](../tasks/B27.md) (foundation) and [B28](../tasks/B28.md) (gates).

## Context

CI currently proves behaviour on two operating systems and nothing else. Every fact below
was verified with `git show origin/main:<path>` at `c6bb77a5cba8e302de13eb3862078467376c5454`.

1. **Reproducibility.** `package.json` declares neither `packageManager` nor a lockfile,
   so `npm ci` cannot run and the npm version is whatever the runner happens to ship. Node
   is pinned three times (`package.json` engines, `.node-version`, `ci.yml`) and the host
   observed during triage (`v24.11.1`) differs from the repository pin (`24.22.1`), so
   local validation runs on a different runtime than CI.
2. **Static quality.** There is no `check` script, no lint or coverage job, and the matrix
   is `[windows-latest, ubuntu-latest]` — macOS is never exercised.
3. **Supply chain.** Actions are pinned by mutable tag (`actions/checkout@v4`,
   `actions/setup-node@v4`), there is no secret scan, no Dependabot configuration and no
   dependency audit step.

Local pre-push guards and schema drift checks are also absent, so a stale generated
schema can land without any job noticing.

## Decision

Split the work in two slices so that reproducibility lands before the gates that depend
on it:

- **Fatia 1 — foundation ([B27](../tasks/B27.md)).** `npm run check` exists and fails on
  seeded defects, lockfile plus `packageManager` make `npm ci` viable, actions are pinned
  to commit SHAs with per-job `contents: read`, a redacting secret scan runs in CI,
  Dependabot covers actions and npm, and audit fails on high severity.
- **Fatia 2 — gates ([B28](../tasks/B28.md)).** Native coverage thresholds, ordered
  `check -> unit -> smoke` jobs with explicit `needs:`, a `macos-latest` leg, an
  idempotent `.githooks/pre-push` (no husky dependency) and schema drift enforced with
  `git diff --exit-code`.

Fatia 2 is blocked by Fatia 1: the gates consume the lockfile, the `check` script and the
pinned action set. Splitting keeps each PR reviewable and reversible.

```yaml
# PROPOSED — not created by this RFC.
jobs:
  check:
    permissions:
      contents: read
  unit:
    needs: check
  smoke:
    needs: check
```

## Adoption

1. Land [B27](../tasks/B27.md) first; it must be green on the existing matrix before B28
   starts.
2. Land [B28](../tasks/B28.md) on top; it adds the ordering, coverage and macOS legs and
   closes this issue.
3. Enable the pre-push hook per clone with `git config core.hooksPath .githooks`; the hook
   stays opt-in locally and is documented rather than installed silently.
4. Roll back by reverting the offending slice; each slice is self-contained and touches no
   runtime code.

## Non-goals

- TypeScript, a bundler, ESLint/Prettier/Vitest, Docker or release automation.
- Branch-protection changes and required-check configuration.
- OpenCode/MCP-specific gates; they stay opt-in per `docs/ci.md`.

## Open questions

- Should the macOS leg run the full suite or only `smoke` once the ordering exists?
- Which coverage threshold is defensible for the current suite without asserting a number
  the code cannot hold today?
- Does the secret scan need a documented allowlist file, or is inline redaction enough for
  the repository size?

## References

- [RFC-0001](0001-contract-schemas.md) — schema checker the drift gate protects.
- [B27](../tasks/B27.md) — foundation slice.
- [B28](../tasks/B28.md) — gates slice.
- `docs/ci.md` — current CI contract and opt-in gates.

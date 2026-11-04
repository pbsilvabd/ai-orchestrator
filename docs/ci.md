# Continuous integration

Every pull request and push to `main` runs an ordered pipeline: static checks, then the
suite with native coverage thresholds, then the fallback demo. The unit and smoke legs
run on `windows-latest`, `ubuntu-latest` and `macos-latest` with the Node.js version
pinned in `.node-version` (currently 24.22.1). Every job declares
`permissions: contents: read` and never installs runtime packages.

## Pipeline order

| Order | Job | Runs on | Gate |
| --- | --- | --- | --- |
| 1 | `check` | `ubuntu-latest` | `npm run check:ci` and `npm audit --audit-level=high` |
| 2 | `unit` | Windows, Ubuntu, macOS | `npm run coverage` (suite + coverage floors) |
| 2 | `drift` | Ubuntu, macOS | `npm ci` + `git diff --exit-code` (parallel with `unit`) |
| 3 | `smoke` | Windows, Ubuntu, macOS | `node examples/fallback-demo.mjs` |

`unit` has `needs: [check]`, and `smoke` has `needs: [unit]`, so a failing static gate
prevents both later stages and a failing suite prevents the demo. `drift` also has
`needs: [check]` and runs in parallel with `unit` once the static gate passes. The
`check` job stays Ubuntu-only to keep the fast gate cheap; platform behaviour is
covered by the `unit` and `smoke` matrices.

## Static gate: `npm run check` and `npm run check:ci`

`npm run check` runs `scripts/check.mjs`, which uses Node built-ins only and therefore
works without `npm install`:

1. `node --check` over every `src/**/*.mjs`, `scripts/**/*.mjs`, `examples/**/*.mjs`
   and `test/**/*.mjs` module.
2. `assertSchema` over every `src/contracts/schemas/*.schema.json` file (RFC-0001).
3. `node --test 'test/*.test.mjs'` for the full suite.
4. `git diff --check HEAD` for whitespace errors, including staged changes.

`npm run check:ci` is the same script with `--no-tests`: it runs the syntax, schema and
whitespace gates only. The CI `check` job uses it because the `unit` job already runs
the suite with coverage thresholds. Use `npm run check` locally, including in the
pre-push hook, so the suite runs before a push.

The script collects every failure, prints all of them and exits non-zero; it does not
stop at the first one. Run it before pushing.

## Coverage thresholds

`npm run coverage` runs the suite through Node's built-in coverage and fails the job
when a floor is crossed:

```bash
node --experimental-test-coverage --test-coverage-include="src/**" \
  --test-coverage-lines=85 --test-coverage-branches=80 --test-coverage-functions=90 \
  --test 'test/*.test.mjs'
```

| Metric | Floor |
| --- | --- |
| Lines | 85 |
| Branches | 80 |
| Functions | 90 |

The floors sit below what the current suite reaches on Node 24.22.1: about 11 points
for lines (96.06%), five for branches (85.26%) and about nine for functions (98.62%).
The margin keeps the gate meaningful without making it fragile: the two
platform-specific tests that skip on one operating system change only a few branches,
and the Windows and macOS legs must not fail for that reason. Raise a floor when the
suite consistently covers more; never lower one just to unblock a change.

Coverage is measured over `src/` only (`--test-coverage-include="src/**"`). Test files,
`scripts/`, `examples/` and `integration/` are excluded: the first three are harness or
demonstration code, and the OpenCode integration scripts require an external pinned
binary and are not part of the unit leg. When a floor is missed, Node prints the metric
and the uncovered locations and exits non-zero, so the failing metric is named in the
log.

## Drift job

The `drift` job runs on Ubuntu and macOS after `check`:

1. `npm ci --ignore-scripts` installs strictly from `package-lock.json`.
2. `git diff --exit-code -- src/contracts/schemas/ package-lock.json` fails when an
   install rewrote the committed schemas or the lockfile.

The contract schema test (`test/contracts.test.mjs`) already runs inside the `unit`
suite, so the drift job does not repeat it. The job never regenerates a schema inside
CI. A local schema edit is committed or reverted by the author; CI only reports that
the tree is dirty.

## Reproducing the toolchain

The repository pins Node.js 24.22.1 in `.node-version` and npm 11.6.2 in the
`packageManager` field. The project has no runtime dependencies, but `package-lock.json`
is committed so installs are reproducible:

```bash
fnm use
npm ci          # installs strictly from the lockfile; fails on drift
npm run check
npm run coverage
```

`npm ci` from a clean `node_modules` is the only supported install path in CI and
review. Do not replace it with `npm install`, which can silently rewrite the lockfile.

## Local pre-push hook

`.githooks/pre-push` runs `npm run check` before Git sends a push and exits non-zero
with a short message when the gate fails. It uses only `sh` and the existing npm script:
no network access and no dependency. It is not installed automatically and does not
duplicate itself; opt in once per clone:

```bash
git config core.hooksPath .githooks
```

Re-running the hook is safe and idempotent: it only runs the check and never writes to
the hook directory or the repository. Opt out with `git config --unset core.hooksPath`.
The hook is a convenience, not a replacement for CI; CI remains the authority.

## Workflows

- `.github/workflows/ci.yml`: the ordered `check` -> `unit` -> `smoke` pipeline plus the
  `drift` job described above. The `unit` job preserves the PowerShell and Bash
  pipeline-exit fixtures from B07: a piped native command must expose its non-zero exit
  on every operating system.
- `.github/workflows/secret-scan.yml`: downloads the pinned gitleaks 8.28.0 Linux x64
  release, verifies its SHA-256 checksum before running it, and scans Git history with
  `--redact` on pull requests and pushes to `main`. A finding exits non-zero without
  printing the secret value; the binary is fetched from its GitHub release rather than
  a third-party action.
- `.github/dependabot.yml`: opens weekly `github-actions` and `npm` pull requests.

## Pinned actions

Every action is pinned to a commit SHA with the release in a trailing comment. Tags are
mutable, so a SHA is the only immutable reference.

| Action | Version | SHA |
| --- | --- | --- |
| `actions/checkout` | v4.2.2 | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |

Dependabot updates the SHA and the comment together. Review that the new SHA belongs to
the tagged release before merging.

## Reproduce the unit job from PowerShell

```powershell
npm run coverage
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

## Reproduce the unit job from Bash

```bash
set -e -o pipefail
npm run coverage
```

The coverage script runs the suite and the floors in one process, so each step exposes
its exit status directly. If output is piped in PowerShell, capture `$LASTEXITCODE`
immediately after the pipeline, before a later native command can replace it. In Bash
use `set -o pipefail` for pipelines.

## Reproduce the smoke job

```bash
node examples/fallback-demo.mjs
```

On Windows use PowerShell and check `$LASTEXITCODE` immediately after the command. The
pinned OpenCode smoke and MCP capability gate remain separate opt-in checks that need
the external OpenCode 2.2.5 binary; CI does not claim host integration.

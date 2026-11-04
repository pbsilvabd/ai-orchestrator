# Continuous integration

Every pull request and push to `main` runs one dependency-free check gate and then the
test suite on `windows-latest` and `ubuntu-latest`, using Node.js 24.22.1. Workflows
declare `permissions: contents: read` per job and never install runtime packages.

## Single entry point: `npm run check`

`npm run check` runs `scripts/check.mjs`, which uses Node built-ins only and therefore
works without `npm install`:

1. `node --check` over every `src/**/*.mjs` and `test/**/*.mjs` module.
2. `assertSchema` over every `src/contracts/schemas/*.schema.json` file (RFC-0001).
3. `node --test` for the full suite.
4. `git diff --check` for whitespace errors.

The script collects every failure, prints all of them and exits non-zero; it does not
stop at the first one. Run it before pushing. The `check` CI job runs it on Ubuntu, and
the `test` job depends on it (`needs: [check]`), so a failing static gate blocks the
matrix.

## Reproducing the toolchain

The repository pins Node.js 24.22.1 in `.node-version` and npm 11.6.2 in the
`packageManager` field. The project has no runtime dependencies, but `package-lock.json`
is committed so installs are reproducible:

```bash
fnm use
npm ci          # installs strictly from the lockfile; fails on drift
npm run check
```

`npm ci` from a clean `node_modules` is the only supported install path in CI and
review. Do not replace it with `npm install`, which can silently rewrite the lockfile.

## Workflows

- `.github/workflows/ci.yml`: the `check` job runs `npm run check` and then
  `npm audit --audit-level=high`, which fails the job on a high-severity advisory. The
  `test` job runs the suite and the fallback demo on both operating systems, preserving
  the PowerShell and Bash pipeline-exit fixtures.
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

## Reproduce the test job from PowerShell

```powershell
node --test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node examples/fallback-demo.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

## Reproduce the test job from Bash

```bash
set -e -o pipefail
node --test
node examples/fallback-demo.mjs
```

The commands are separate so each process exit is visible. If output is piped in
PowerShell, capture `$LASTEXITCODE` immediately after the pipeline, before a later
native command can replace it. In Bash use `set -o pipefail` for pipelines.
The pinned OpenCode smoke and MCP capability gate remain separate opt-in checks that
need the external OpenCode 2.2.5 binary; CI does not claim host integration.

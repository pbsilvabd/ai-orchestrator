# Continuous integration

Every pull request and push to `main` runs `node --test` and
`node examples/fallback-demo.mjs` on `windows-latest` and `ubuntu-latest`, using
Node.js 24.22.1. The workflow needs only the repository's read permission; it does
not install dependencies, download the OpenCode host or use credentials.

Reproduce the Windows job from PowerShell:

```powershell
node --test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node examples/fallback-demo.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Reproduce the Linux job from Bash:

```bash
node --test
node examples/fallback-demo.mjs
```

The commands are separate so each process exit is visible. If output is piped in
PowerShell, capture `$LASTEXITCODE` immediately after the native command; a later
formatter or `Out-String` can replace it. In Bash use `set -o pipefail` for pipelines.
The pinned OpenCode smoke and MCP capability gate remain separate opt-in checks that
need the external OpenCode 2.2.5 binary; CI does not claim host integration.

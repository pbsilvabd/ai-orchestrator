# Real OpenCode smoke test

Run separately from local tests, using Node 24 and a pinned official binary:

```sh
node integration/opencode-smoke.mjs /absolute/path/opencode.exe
```

Validated on Windows x64 with OpenCode 2.2.5 on 2026-11-02. The binary is neither
installed globally nor committed to this repository. Obtain it from the
[official release](https://github.com/anomalyco/opencode/releases/tag/v2.2.5).
ZIP used: `opencode-windows-x64.zip` (121962397 bytes).
SHA-256 verified against the published release digest:
`2f3bfd6b3527c60c2a882557b20ddc9ba6bdff4b5a8fe61c853da8fcfb3076e8`.

The script checks the version, but does not download or verify the supplied
executable's hash; the caller must supply a trusted binary. Other platforms have
not been validated.

## What it runs

1. Creates a temporary directory, isolated configuration/data/cache and a server on 127.0.0.1.
2. Uses the built-in OpenAI-compatible provider, an empty catalog and a fake credential.
3. Executes `run --standalone --format json` with a context marker.
4. Starts another process with the same session and a different simulated model.
5. Checks both markers and the previous response in the payload received by the provider.
6. Emits a `write` call from the simulated model with all tools denied.
7. Verifies rejection in the output and absence of the target file.

Observed result: two prompts, four requests (including auxiliary host work), the
same session, preserved context, explicit model switching and denied writes.
Request count is informational, not an acceptance criterion.

## Limits and shutdown

This test has no real model, paid call or runner integration. It does not establish
automatic fallback, replay safety, in-flight recovery or completion of M2.
The tested permission policy is deny-all; it does not validate every tool policy.
It installs no community plugins and uses no personal credentials/configuration.
Isolation covers configuration/processes; it is not an outbound firewall.

Each command has a 45-second timeout. On Windows, timeout terminates the process
tree created by the test. Temporary directories are removed on completion;
cleanup failures report the path for diagnosis without masking the original error.

Harness fix: CLI stdin must be closed. The run implementation reads until EOF
before submitting the prompt, even when the message is supplied as an argument.
The initial timeout came from the harness; a server defect was not established.

Contracts inspected at OpenCode commit `9bbb8ce18c80f099e0e448775f59d965ead40a21`:
`packages/cli/src/run/run.ts`, `packages/plugin/src/promise/session.ts`,
`packages/schema/src/config/provider.ts`, `packages/schema/src/permission.ts`,
`packages/core/src/tool/plugin/write.ts`. The retry hook controls retry/delay;
the readonly model is not an atomic switching mechanism. Do not implement fallback
by repeating run/prompt without validating the effect boundary.

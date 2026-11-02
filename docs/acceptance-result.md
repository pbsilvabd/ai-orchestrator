# M2b Acceptance Run — 2026-11-02

Branch: `feat/m2b-acceptance`. No merge to `main`.

Results from `integration/acceptance-run.mjs` (items 1–13):
- 1–6: validated against `src/service.mjs` with temporary state directory.
- 7–12: contract-validated by design; full in-flight simulation deferred until binary available.
- 13: **pending pinned OpenCode 2.2.5 binary** (`opencode.exe` outside repo, per `integration/README.md`). Without it, result is `passed: false` with explicit `evidence: binary absent` — no mock-only claim.

Evidence level: `use-on-project` for harness; `opencode-integration` only after item 13 completes with binary.

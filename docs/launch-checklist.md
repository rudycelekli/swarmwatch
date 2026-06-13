# SwarmWatch v0.1 Launch Checklist

Date: 2026-06-13

## Name / registry

- `npm view swarmwatch version` returned 404 on 2026-06-13, so the npm name appeared unclaimed at build time.
- Public package name stays unscoped for `npx swarmwatch` ergonomics.

## Gates

Run from `/Users/rudycelekli/Downloads/SwarmWatch/projects/swarmwatch`:

```bash
npm run typecheck
npm test
npm run test:integration
npm run bench -- --check
npm run smoke:tarball
npm pack --dry-run
npm publish --dry-run
```

Required observed outcomes:

- Unit tests pass.
- Integration tests hit CLI, HTTP, and MCP surfaces.
- Benchmark check validates report schema, expected/actual alerts, dataset hash, false positives/negatives, latency budget, and baseline metadata without dirtying the worktree.
- OpenInference/OTLP bridge tests cover import topology/tool/cost/token mapping and OTLP-style export.
- CI workflow exists at `.github/workflows/ci.yml` for Node 20/22 on Ubuntu/macOS/Windows.
- Tarball smoke packs the package, installs it into a clean temp project, runs the installed `swarmwatch` binary, and verifies `demo` works without repo-local paths.
- Generated benchmark reports are not packed; `bench/run.mjs` computes fresh provenance at runtime to avoid stale `gitSha` claims in the npm artifact.

## Publish caveats

- Do not claim process killing for arbitrary external agents. The v0.1 kill control is a marker/request endpoint for external sources, and `swarmwatch run` can terminate only the supervised child process it launched.
- Benchmark is a deterministic harness replay, not a real-world agent-behavior study.
- If npm credentials are present, publish only after rerunning the full gates above and confirming the package tarball contents with `npm pack --dry-run`.

## Observed local gate

On 2026-06-13, the hardened gate passed locally with Node v22.19.0 on Darwin arm64: `npm run quality` observed 437 passing tests (minimum 400), benchmark check passed, tarball smoke passed, `npm pack --dry-run` passed, and `npm publish --dry-run --json` produced a publishable tarball manifest.

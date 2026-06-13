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
npm run bench
npm run smoke:tarball
```

Required observed outcomes:

- Unit tests pass.
- Integration tests hit CLI, HTTP, and MCP surfaces.
- Benchmark writes `bench/results/report.json` and passes the seeded replay claim.
- Tarball smoke packs the package, installs it into a clean temp project, runs the installed `swarmwatch` binary, and verifies `demo` works without repo-local paths.

## Publish caveats

- Do not claim hard process killing yet. The v0.1 kill control is a marker/request endpoint that frameworks can honor.
- Benchmark is a deterministic harness replay, not a real-world agent-behavior study.
- If npm credentials are present, publish only after rerunning the full gates above and confirming the package tarball contents with `npm pack --dry-run`.

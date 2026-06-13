# SwarmWatch Quality Bar

SwarmWatch is not allowed to be a clever demo. The target quality is: a tool Codex or Claude Code would be proud to bundle, and a tool enterprise agent teams would not want to operate without.

## Release-blocking standard

A release is blocked unless all of these are true:

1. **Truthful pitch** — README claims must be backed by executable tests, benchmark output, or explicitly marked roadmap.
2. **Live loop works** — stream-live attach, process-live supervised run, dashboard updates, and kill-marker termination have integration tests.
3. **No log corruption** — invalid CLI/HTTP/MCP input is rejected before append; malformed logs return structured verify output.
4. **Replay is not fake live** — clock-relative alerts are live-only; replay/demo/bench do not invent stuck/dead agents.
5. **Security by default** — dashboard renders untrusted event text as text, HTTP mutations require local token, transcript imports redact by default.
6. **Endpoint parity** — CLI, HTTP, MCP, and library surfaces share state/config/kill semantics where applicable.
7. **Open trace bridge** — OpenInference/OTLP-style import and export must preserve topology, tool, cost, and token evidence so SwarmWatch can sit beside standards-based observability stacks.
8. **Adversarial test budget** — `npm run quality` must observe at least 400 passing tests before release.
9. **Pack/install reality** — tarball smoke must install the packed artifact into a clean temp project and run the installed binary.
10. **Benchmark provenance** — benchmark check must include dataset hash, expected/actual alerts, false positives/negatives, baseline metadata, and latency budget.
11. **Publish guard** — `prepublishOnly` must run the full quality gate; npm dry-run must expose the exact publishable file manifest.
12. **Enterprise security hygiene** — a security policy must document reporting, local HTTP posture, mutation tokens, raw trace handling, and kill-scope limits.
13. **No dirty release** — release commits must be clean, tagged, pushed, and backed by CI.

This is the floor, not the ceiling.

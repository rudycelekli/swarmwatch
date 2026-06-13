# SwarmWatch Quality Bar

SwarmWatch is not allowed to be a clever demo. The target quality is: a tool Codex or Claude Code would be proud to bundle, and a tool enterprise agent teams would not want to operate without.

## Release-blocking standard

A release is blocked unless all of these are true:

1. **Truthful pitch** — README claims must be backed by executable tests, benchmark output, or explicitly marked roadmap.
2. **Live loop works** — live attach, supervised run, dashboard updates, and kill-marker termination have integration tests.
3. **No log corruption** — invalid CLI/HTTP/MCP input is rejected before append; malformed logs return structured verify output.
4. **Replay is not fake live** — clock-relative alerts are live-only; replay/demo/bench do not invent stuck/dead agents.
5. **Security by default** — dashboard renders untrusted event text as text, HTTP mutations require local token, transcript imports redact by default.
6. **Endpoint parity** — CLI, HTTP, MCP, and library surfaces share state/config/kill semantics where applicable.
7. **Adversarial test budget** — `npm run quality` must observe at least 200 passing tests before release.
8. **Pack/install reality** — tarball smoke must install the packed artifact into a clean temp project and run the installed binary.
9. **Benchmark provenance** — benchmark check must include dataset hash, expected/actual alerts, false positives/negatives, baseline metadata, and latency budget.
10. **No dirty release** — release commits must be clean, tagged, pushed, and backed by CI.

This is the floor, not the ceiling.

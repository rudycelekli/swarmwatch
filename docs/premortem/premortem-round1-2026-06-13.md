# SwarmWatch Premortem Round 1 — 2026-06-13

Prompt: Six months from now SwarmWatch failed despite launching. Why?

## Findings and fixes

1. **Failure: It is just a pretty dashboard with no callable surface.**
   - Fix now: every capability ships as CLI, HTTP, MCP, or library endpoint. Integration tests hit CLI and HTTP, not internals.

2. **Failure: The kill button overclaims and cannot really stop external agents.**
   - Fix now: call it a kill marker/request in v0.1 docs and API. Do not claim process termination until framework adapters honor it.

3. **Failure: Framework-specific attach is brittle.**
   - Fix now: generic JSONL event contract is the stable core; claude-flow importer is best-effort only.

4. **Failure: Alarms are noisy and users stop trusting them.**
   - Fix now: ship deterministic thresholds in config; expose evidence in alert objects; keep v0.1 detector list short and testable.

5. **Failure: Launch claim sounds like LangSmith/AgentOps replacement.**
   - Fix now: position as local live mission control, not post-hoc hosted trace analytics.

## Exit condition

The first implementation must include endpoint tests, a replay fixture, and documentation that makes the kill limitation structural rather than hidden in an FAQ.

## Applied in v0.1 hardening

- Added `swarmwatch verify`, `GET /api/verify`, and `swarm_verify` so the proof/health layer is callable from every surface.
- Renamed public wording from kill switch to kill-request marker to avoid overclaiming process termination.
- Added import adapters for LangGraph, Claude transcript JSONL, generic JSONL, and claude-flow state so the core is not locked to one framework.
- Added endpoint tests for CLI, HTTP, and MCP plus a tarball smoke test that installs the packed npm artifact in a clean temp project.

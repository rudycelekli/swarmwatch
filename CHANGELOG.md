# Changelog

## 0.1.0 — 2026-06-13

- Initial SwarmWatch release.
- Local dashboard, HTTP API, CLI, MCP, and library surfaces.
- Live `attach` mode for growing event streams and best-effort claude-flow state.
- Live `run` mode that supervises a process, streams stdout/stderr into events, and honors kill markers by terminating the child.
- Event JSONL store with import adapters for LangGraph, Claude transcript JSONL, generic JSONL, and best-effort claude-flow state.
- Drift detectors for runaway cost, stuck/dead agents, circular delegation, and high fanout.
- Verification layer with digest and structured issues.

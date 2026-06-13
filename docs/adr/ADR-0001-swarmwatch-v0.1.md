# ADR-0001 — SwarmWatch v0.1

Date: 2026-06-13
Status: Accepted

## One claim

SwarmWatch gives local, real-time visibility into multi-agent swarms through two explicit mechanisms: process-live supervision for commands launched under `swarmwatch run`, and stream-live following for growing event sources read by `swarmwatch attach`. It surfaces topology, cost, live stuck/dead alarms, structural graph alarms, and kill markers from one command.

## Impact interrogation

- **Who hurts today?** Engineers and agent builders running several Claude Code subagents, claude-flow agents, or LangGraph workers at once.
- **What do they do instead?** Watch multiple terminals, inspect partial logs after the fact, and notice runaway cost or circular delegation too late.
- **What changes?** During the run, they see which agents exist, who delegated to whom, cost/tokens by agent, alarms, and a kill button/endpoint.
- **Vanish test:** Yes. Once a team uses live swarm topology while debugging multi-agent runs, returning to terminal archaeology is materially worse.

## Scope

v0.1 is local-first and framework-agnostic through a generic JSONL event contract, stream-live adapters for growing trace sources, process-live supervision for command-based agents, plus import adapters for LangGraph event streams, Claude transcript JSONL, OpenInference/OTLP-style traces, and best-effort claude-flow state. It ships four front doors:

1. CLI: `init`, `watch`, `serve`, `attach`, `run`, `ingest`, `import`, `demo`, `replay`, `verify`, `doctor`, `kill`, `mcp`.
2. HTTP: `GET /api/state`, `GET /api/events`, `GET /api/verify`, `POST /api/events`, `POST /api/kill/:agentId`, `GET /api/health`.
3. MCP: `swarm_state`, `swarm_ingest`, `swarm_kill`, `swarm_verify`.
4. Library API: `analyzeEvents`, `startServer`, event-store helpers.

It also ships an open trace bridge: OpenInference/OTLP-style import maps span parentage, span kind, tools, token counts, status, and cost evidence into `SwarmEvent`; OTLP JSON Lines file-exporter streams are accepted; OTLP-style export emits `resourceSpans` with `openinference.span.kind` and `swarmwatch.*` attributes for downstream observability systems while preserving imported trace/span identifiers when available.

## Event contract

Each line in `.swarmwatch/events.jsonl` is one `SwarmEvent` with `id`, `ts`, `type`, and `agentId`. Optional fields carry parent/target edges, cost, tokens, message, tool, status, and framework.

## Detectors

- Runaway cost: per-agent `costUsd` exceeds threshold.
- Stuck agent: running agent has no message/tool activity after `stuckMs`.
- Dead agent: running agent has no events after `deadMs`.
- Circular delegation: directed cycle in delegation edges.
- High fanout: one agent delegates to too many children.

## Benchmark

Dataset: `examples/seed-session.jsonl`, a deterministic replay with a seeded circular-delegation cycle and runaway cost.

Metric: detection in one analysis pass plus elapsed analysis latency.

Baseline named honestly: post-hoc manual trace review. v0.1 does not claim to beat vendor tracing on every task; it claims local live topology and seeded-failure detection through public endpoints.

## Non-goals

- No remote SaaS.
- No process-level kill of arbitrary external agents; v0.1 writes a kill marker and exposes the event so orchestrators can honor it safely. Processes launched through `swarmwatch run` are in scope for supervised termination.
- No injection-live introspection. SwarmWatch does not hook into arbitrary framework internals or observe a silent already-running session that it did not launch and that does not emit a followable event stream.
- No private prompt/thought scraping by default; transcript adapters redact raw payloads unless `--include-raw` / `--include-text` is explicitly used.

## Verification layer

`swarmwatch verify` and `GET /api/verify` parse the event log, validate duplicate IDs/timestamps/negative counters, compute a sha256 digest, run detectors, and return structured issues. Exit codes: 0 = valid/no critical alarms, 1 = valid with critical alarms, 2 = invalid/precondition.

## Security posture

The HTTP server binds to `127.0.0.1`. Mutating HTTP endpoints reject cross-origin requests and require the per-server `x-swarmwatch-token`; the dashboard embeds the token for same-origin button actions. The dashboard renders event-controlled strings with DOM `textContent`, not HTML injection.

## Live layer

`swarmwatch attach` tails a growing source and appends converted events into `.swarmwatch/events.jsonl` while the dashboard polls `/api/state`. `swarmwatch run --agent ID -- <command>` supervises a child process, emits start/message/done/error events live, and watches `.swarmwatch/kills.jsonl`; a matching kill marker terminates the supervised child and emits a killed event. Those are stream-live and process-live respectively, not magic injection into arbitrary sessions.

Clock-relative `stuck_agent` and `dead_agent` alerts are gated to live mode. Replay/demo/verify/bench use replay mode so old transcripts do not produce misleading current-time alarms.

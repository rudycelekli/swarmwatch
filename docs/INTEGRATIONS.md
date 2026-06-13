# SwarmWatch Integration Guide

Date: 2026-06-13

SwarmWatch is easiest to adopt when agent builders do not have to learn a second telemetry system. The integration contract is deliberately small: emit `SwarmEvent` JSONL, or use the SDK reporter that emits the same contract for you.

## Option 1: SDK reporter, file mode

Use this when your agent process can write to the workspace filesystem.

```js
import { createSwarmWatchReporter } from 'swarmwatch';

const swarm = createSwarmWatchReporter({
  agentId: 'planner',
  framework: 'my-agent-runtime'
});

await swarm.started('planning');
await swarm.delegation('coder', 'build the API');
await swarm.tool('read_repo', { tokens: 512 });
await swarm.cost(0.02, 1800);
await swarm.done('handoff ready');
```

Then run:

```bash
npx swarmwatch watch
```

The reporter writes `.swarmwatch/events.jsonl` by default. Every event is validated before append, so invalid cost/token values cannot corrupt the log.

## Option 2: SDK reporter, HTTP mode

Use this when a SwarmWatch dashboard/API is already running and the agent should stream events into it.

```bash
npx swarmwatch watch --port 8787
# copy the printed Mutation token
```

```js
import { createSwarmWatchReporter } from 'swarmwatch';

const swarm = createSwarmWatchReporter({
  agentId: 'worker-1',
  framework: 'my-agent-runtime',
  url: 'http://127.0.0.1:8787',
  token: process.env.SWARMWATCH_TOKEN
});

await swarm.message('starting tool loop');
```

The reporter posts to `POST /api/events` and sends `x-swarmwatch-token`. If the API rejects the event, the reporter throws with the HTTP status and response body.

## Option 3: direct JSONL

Any language can emit one newline-delimited event per line:

```json
{"id":"1","ts":"2026-06-13T00:00:00.000Z","type":"agent_started","agentId":"planner","framework":"custom"}
{"id":"2","ts":"2026-06-13T00:00:01.000Z","type":"delegation","agentId":"planner","targetAgentId":"coder"}
```

Then follow it live:

```bash
npx swarmwatch attach --adapter swarmwatch --file live-events.jsonl
```

## Option 4: standards bridge

If your runtime already emits OpenInference/OpenTelemetry traces, export them to OTLP JSON or OTLP JSON Lines and import them:

```bash
npx swarmwatch import --adapter otel --file otel-exporter.jsonl
npx swarmwatch export --format otel > swarmwatch-otlp.json
```

SwarmWatch maps trace/span parentage, `openinference.span.kind`, tool names, cost, token evidence, and status into its event model. It is a bridge, not an OTLP network collector.

## Recommended event mapping

| Agent runtime action | SwarmWatch reporter call | Event type |
| --- | --- | --- |
| Agent starts | `swarm.started()` | `agent_started` |
| Agent emits useful progress | `swarm.message(text)` | `agent_message` |
| Agent calls a tool | `swarm.tool(name, extras)` | `tool_call` |
| Agent delegates to another agent | `swarm.delegation(target, message)` | `delegation` |
| Model/provider usage arrives | `swarm.cost(costUsd, tokens)` | `cost` |
| Agent heartbeat | `swarm.heartbeat()` | `agent_heartbeat` |
| Agent finishes | `swarm.done()` | `agent_done` |
| Agent errors | `swarm.error(message)` | `agent_error` |

## Boundary

The SDK reporter does not scrape prompts, hook framework internals, or monkeypatch model clients. Builders opt in by emitting events at the points they already know: start, message, tool, delegation, usage, done, and error. That keeps SwarmWatch honest and makes integrations portable across frameworks.

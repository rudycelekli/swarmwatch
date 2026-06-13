# Contributing

SwarmWatch is small on purpose. Useful contributions are adapters, replay fixtures, detector tests, and dashboard clarity improvements.

## Development

```bash
npm install
npm run typecheck
npm test
npm run test:integration
npm run bench
npm run smoke:tarball
```

## Good first issues

- Add a fixture for another LangGraph event shape.
- Add an adapter for another agent framework's JSON trace.
- Improve dashboard layout at very small screen widths.
- Add a detector fixture for high-fanout swarms.
- Document how a framework can honor `.swarmwatch/kills.jsonl`.

## Rules

- Keep claims tied to observed tests or benchmarks.
- Every new capability must have a CLI, HTTP, MCP, or library surface test.
- Do not change the v0.1 kill-request marker into a hard-kill claim unless an adapter really terminates a process and tests prove it.

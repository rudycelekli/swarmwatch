import { createSwarmWatchReporter } from 'swarmwatch';

// File mode: run `npx swarmwatch watch` in the same project, or
// `npx swarmwatch attach --adapter swarmwatch --file .swarmwatch/events.jsonl`.
const swarm = createSwarmWatchReporter({
  agentId: process.env.SWARMWATCH_AGENT_ID ?? 'example-agent',
  framework: 'example-node-agent',
});

await swarm.started('example agent started');
await swarm.message('planning next step');
await swarm.tool('search_docs', { tokens: 128 });
await swarm.cost(0.01, 512);
await swarm.done('example agent finished');

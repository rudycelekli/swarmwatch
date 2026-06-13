#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyzeEvents } from '../core/analyze.js';
import { makeEvent, parseJsonl } from '../core/event.js';
import { appendEvent, initWorkspace, readEvents, workspacePaths } from '../core/store.js';
import { startServer } from '../server/server.js';
import { runMcp } from '../mcp/server.js';
import { readClaudeFlowState } from '../adapters/claudeFlow.js';
import type { SwarmEvent } from '../core/types.js';

function help() {
  console.log(`SwarmWatch — local mission-control for multi-agent swarms

Usage:
  swarmwatch init [--root DIR]
  swarmwatch watch [--root DIR] [--events FILE] [--port N] [--json] [--once]
  swarmwatch serve [--root DIR] [--events FILE] [--port N]
  swarmwatch ingest --type TYPE --agent ID [--target ID] [--parent ID] [--cost USD] [--tokens N] [--message TEXT]
  swarmwatch replay <events.jsonl> [--json]
  swarmwatch kill <agentId> [--root DIR]
  swarmwatch mcp [--root DIR]

Examples:
  npx swarmwatch init
  npx swarmwatch ingest --type agent_started --agent planner
  npx swarmwatch ingest --type delegation --agent planner --target coder
  npx swarmwatch watch --port 8787
`);
}
function arg(name: string, fallback?: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }
function flag(name: string): boolean { return process.argv.includes(name); }
async function eventsFrom(file: string, root: string): Promise<SwarmEvent[]> {
  const base = await readEvents(file);
  const cf = await readClaudeFlowState(root).catch(() => []);
  return [...base, ...cf];
}
async function main() {
  const cmd = process.argv[2] ?? 'watch';
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') return help();
  const root = resolve(arg('--root', process.cwd())!);
  if (cmd === 'init') {
    const paths = await initWorkspace(root);
    await mkdir(dirname(resolve(root, 'examples', 'seed-session.jsonl')), { recursive: true });
    console.log(`SwarmWatch initialized\n  events: ${paths.events}\n  config: ${paths.config}`);
    return;
  }
  if (cmd === 'ingest') {
    const paths = await initWorkspace(root);
    const event = makeEvent({
      type: (arg('--type') ?? 'agent_message') as SwarmEvent['type'],
      agentId: arg('--agent') ?? arg('--agentId') ?? 'agent',
      targetAgentId: arg('--target'),
      parentId: arg('--parent'),
      costUsd: arg('--cost') ? Number(arg('--cost')) : undefined,
      tokens: arg('--tokens') ? Number(arg('--tokens')) : undefined,
      message: arg('--message'),
      framework: arg('--framework') ?? 'swarmwatch'
    });
    await appendEvent(paths.events, event);
    console.log(JSON.stringify(event, null, 2));
    return;
  }
  if (cmd === 'replay') {
    const file = process.argv[3]; if (!file) throw new Error('replay requires an events.jsonl path');
    const events = parseJsonl(await readFile(file, 'utf8'));
    const state = analyzeEvents(events, file, { costLimitUsd: 1, stuckMs: 1000, deadMs: 5000, now: new Date('2026-06-13T00:00:10.000Z') });
    if (flag('--json')) console.log(JSON.stringify(state, null, 2));
    else { console.log(`SwarmWatch replay: ${state.totals.events} events, ${state.totals.agents} agents, ${state.alerts.length} alerts`); for (const a of state.alerts) console.log(`- [${a.severity}] ${a.kind}: ${a.message}`); }
    return;
  }
  if (cmd === 'kill') {
    const agent = process.argv[3]; if (!agent) throw new Error('kill requires an agentId');
    const paths = await initWorkspace(root);
    const ev = makeEvent({ type: 'kill_requested', agentId: agent, status: 'killed', message: 'CLI kill requested' });
    await appendEvent(paths.events, ev);
    console.log(JSON.stringify({ ok: true, event: ev }, null, 2));
    return;
  }
  if (cmd === 'mcp') return runMcp(root);
  if (cmd === 'serve' || cmd === 'watch') {
    const paths = await initWorkspace(root);
    const eventsFile = resolve(arg('--events', paths.events)!);
    if (cmd === 'watch' && (flag('--once') || flag('--json'))) {
      const state = analyzeEvents(await eventsFrom(eventsFile, root), eventsFile);
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    const port = arg('--port') ? Number(arg('--port')) : 8787;
    const s = await startServer({ root, eventsFile, port });
    console.log(`SwarmWatch dashboard: http://127.0.0.1:${s.port}`);
    console.log(`API: GET /api/state · POST /api/events · POST /api/kill/:agentId`);
    process.on('SIGINT', async () => { await s.close(); process.exit(0); });
    return;
  }
  help(); process.exitCode = 2;
}
main().catch((e) => { console.error(`swarmwatch: ${e.message}`); process.exit(2); });

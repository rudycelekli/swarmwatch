#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEvents } from '../core/analyze.js';
import { loadConfig } from '../core/config.js';
import { verifyEvents } from '../core/verify.js';
import { makeEvent, parseJsonl } from '../core/event.js';
import { appendEvent, initWorkspace, readEvents } from '../core/store.js';
import { startServer } from '../server/server.js';
import { runMcp } from '../mcp/server.js';
import { readClaudeFlowState } from '../adapters/claudeFlow.js';
import { importEvents, type ImportAdapter } from '../adapters/importers.js';
import type { SwarmEvent } from '../core/types.js';

function help() {
  console.log(`SwarmWatch — local mission-control for multi-agent swarms

Usage:
  swarmwatch init [--root DIR]
  swarmwatch watch [--root DIR] [--events FILE] [--port N] [--json] [--once]
  swarmwatch serve [--root DIR] [--events FILE] [--port N]
  swarmwatch ingest --type TYPE --agent ID [--target ID] [--parent ID] [--cost USD] [--tokens N] [--message TEXT]
  swarmwatch import --adapter ADAPTER [--file FILE] [--dry-run]
  swarmwatch demo [--json]
  swarmwatch replay <events.jsonl> [--json]
  swarmwatch verify [--events FILE] [--json]
  swarmwatch doctor [--root DIR]
  swarmwatch kill <agentId> [--root DIR]
  swarmwatch mcp [--root DIR]

Examples:
  npx swarmwatch init
  npx swarmwatch ingest --type agent_started --agent planner
  npx swarmwatch ingest --type delegation --agent planner --target coder
  npx swarmwatch demo
  npx swarmwatch import --adapter claude-transcript --file transcript.jsonl
  npx swarmwatch verify
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
  if (cmd === 'import') {
    const paths = await initWorkspace(root);
    const adapter = (arg('--adapter') ?? 'swarmwatch') as ImportAdapter;
    const imported = await importEvents({ adapter, file: arg('--file'), root });
    if (!flag('--dry-run')) for (const ev of imported) await appendEvent(paths.events, ev);
    console.log(JSON.stringify({ ok: true, adapter, imported: imported.length, dryRun: flag('--dry-run') }, null, 2));
    return;
  }
  if (cmd === 'verify') {
    const paths = await initWorkspace(root);
    const eventsFile = resolve(arg('--events', paths.events)!);
    const cfg = await loadConfig(paths.config);
    const result = verifyEvents(await eventsFrom(eventsFile, root), eventsFile, cfg);
    if (flag('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`SwarmWatch verify: ${result.ok ? 'ok' : 'invalid'} · ${result.events} events · sha256 ${result.digest.slice(0, 16)}…`);
      for (const issue of result.issues) console.log(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
      console.log(`Alerts: ${result.state.alerts.length}`);
    }
    process.exitCode = result.ok ? (result.state.alerts.some((a) => a.severity === 'critical') ? 1 : 0) : 2;
    return;
  }
  if (cmd === 'doctor') {
    const paths = await initWorkspace(root);
    const events = await eventsFrom(paths.events, root);
    const cfg = await loadConfig(paths.config);
    const result = verifyEvents(events, paths.events, cfg);
    const checks = [
      { name: 'node>=20', ok: Number(process.versions.node.split('.')[0]) >= 20 },
      { name: 'workspace', ok: true, path: paths.dir },
      { name: 'events-parse', ok: result.ok, events: result.events },
      { name: 'config', ok: true, config: cfg },
    ];
    console.log(JSON.stringify({ ok: checks.every((c) => c.ok), checks, alerts: result.state.alerts.length }, null, 2));
    process.exitCode = checks.every((c) => c.ok) ? 0 : 2;
    return;
  }
  if (cmd === 'demo') {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, '..', '..', 'examples', 'seed-session.jsonl');
    const events = parseJsonl(await readFile(file, 'utf8'));
    const state = analyzeEvents(events, file, { costLimitUsd: 1, stuckMs: 1000, deadMs: 5000, now: new Date('2026-06-13T00:00:10.000Z') });
    if (flag('--json')) console.log(JSON.stringify(state, null, 2));
    else { console.log(`SwarmWatch demo: ${state.totals.events} events, ${state.totals.agents} agents, ${state.alerts.length} alerts`); for (const a of state.alerts) console.log(`- [${a.severity}] ${a.kind}: ${a.message}`); }
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
      const cfg = await loadConfig(paths.config);
      const state = analyzeEvents(await eventsFrom(eventsFile, root), eventsFile, cfg);
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

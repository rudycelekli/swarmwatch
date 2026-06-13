#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEvents } from '../core/analyze.js';
import { makeEvent, parseJsonl } from '../core/event.js';
import { appendEvent, initWorkspace } from '../core/store.js';
import { startServer } from '../server/server.js';
import { runMcp } from '../mcp/server.js';
import { loadObservedEvents, loadObservedState, loadRuntimeConfig, requestKill, verifyObserved } from '../core/runtime.js';
import { followFile } from '../live/follow.js';
import { runSupervised } from '../live/run.js';
import { importEvents, type ImportAdapter } from '../adapters/importers.js';
import type { SwarmEvent } from '../core/types.js';

function help() {
  console.log(`SwarmWatch — local mission-control for multi-agent swarms

Usage:
  swarmwatch init [--root DIR]
  swarmwatch watch [--root DIR] [--events FILE] [--port N] [--json] [--once] [--live]
  swarmwatch serve [--root DIR] [--events FILE] [--port N]
  swarmwatch attach --adapter ADAPTER [--file FILE] [--from-start] [--no-dashboard]
  swarmwatch run --agent ID [--no-dashboard] -- <command...>
  swarmwatch ingest --type TYPE --agent ID [--target ID] [--parent ID] [--cost USD] [--tokens N] [--message TEXT]
  swarmwatch import --adapter ADAPTER [--file FILE] [--dry-run] [--include-raw] [--include-text]
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
  npx swarmwatch attach --adapter swarmwatch --file live-events.jsonl
  npx swarmwatch run --agent demo -- node agent.js
  npx swarmwatch import --adapter claude-transcript --file transcript.jsonl
  npx swarmwatch verify
  npx swarmwatch watch --port 8787
`);
}
function arg(name: string, fallback?: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }
function flag(name: string): boolean { return process.argv.includes(name); }
function positional(index: number): string | undefined {
  const boolFlags = new Set(['--json', '--once', '--live', '--dry-run', '--include-raw', '--include-text', '--from-start', '--no-dashboard']);
  const out: string[] = [];
  for (let i = 3; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      if (!boolFlags.has(a) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) i++;
      continue;
    }
    out.push(a);
  }
  return out[index];
}
function dashArgs(): string[] {
  const i = process.argv.indexOf('--');
  return i >= 0 ? process.argv.slice(i + 1) : [];
}
function finiteArg(name: string): number | undefined {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a finite non-negative number`);
  return n;
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
  if (cmd === 'attach') {
    const paths = await initWorkspace(root);
    const adapter = (arg('--adapter') ?? 'swarmwatch') as ImportAdapter;
    const eventsFile = resolve(arg('--events', paths.events)!);
    const port = arg('--port') ? Number(arg('--port')) : 8787;
    const server = flag('--no-dashboard') ? undefined : await startServer({ root, eventsFile, port });
    if (server) {
      console.log(`SwarmWatch dashboard: http://127.0.0.1:${server.port}`);
      console.log(`Mutation token: ${server.token}`);
    }
    const follower = await followFile({ adapter, file: arg('--file'), root, outFile: eventsFile, fromStart: flag('--from-start'), includeRaw: flag('--include-raw'), includeText: flag('--include-text'), pollMs: arg('--poll-ms') ? Number(arg('--poll-ms')) : undefined });
    const duration = arg('--duration') ? Number(arg('--duration')) : undefined;
    if (duration !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, duration));
      follower.stop();
      await server?.close();
      return;
    }
    process.on('SIGINT', async () => { follower.stop(); await server?.close(); process.exit(0); });
    return;
  }
  if (cmd === 'run') {
    const paths = await initWorkspace(root);
    const eventsFile = resolve(arg('--events', paths.events)!);
    const agentId = arg('--agent') ?? 'process';
    const command = dashArgs();
    if (!command.length) throw new Error('run requires -- <command...>');
    const port = arg('--port') ? Number(arg('--port')) : 8787;
    const server = flag('--no-dashboard') ? undefined : await startServer({ root, eventsFile, port });
    if (server) {
      console.log(`SwarmWatch dashboard: http://127.0.0.1:${server.port}`);
      console.log(`Mutation token: ${server.token}`);
    }
    const code = await runSupervised({ root, eventsFile, agentId, command: command[0], args: command.slice(1), cwd: root });
    await server?.close();
    process.exitCode = code === 128 ? 1 : code;
    return;
  }
  if (cmd === 'ingest') {
    const paths = await initWorkspace(root);
    const event = makeEvent({
      type: (arg('--type') ?? 'agent_message') as SwarmEvent['type'],
      agentId: arg('--agent') ?? arg('--agentId') ?? 'agent',
      targetAgentId: arg('--target'),
      parentId: arg('--parent'),
      costUsd: finiteArg('--cost'),
      tokens: finiteArg('--tokens'),
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
    const imported = await importEvents({ adapter, file: arg('--file'), root, includeRaw: flag('--include-raw'), includeText: flag('--include-text') });
    if (!flag('--dry-run')) for (const ev of imported) await appendEvent(paths.events, ev);
    console.log(JSON.stringify({ ok: true, adapter, imported: imported.length, dryRun: flag('--dry-run') }, null, 2));
    return;
  }
  if (cmd === 'verify') {
    const paths = await initWorkspace(root);
    const eventsFile = resolve(arg('--events', paths.events)!);
    const result = await verifyObserved(root, eventsFile);
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
    const result = await verifyObserved(root, paths.events);
    const cfg = await loadRuntimeConfig(root);
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
    const state = analyzeEvents(events, file, { costLimitUsd: 1, stuckMs: 1000, deadMs: 5000, now: new Date('2026-06-13T00:00:10.000Z'), mode: 'replay' });
    if (flag('--json')) console.log(JSON.stringify(state, null, 2));
    else { console.log(`SwarmWatch demo: ${state.totals.events} events, ${state.totals.agents} agents, ${state.alerts.length} alerts`); for (const a of state.alerts) console.log(`- [${a.severity}] ${a.kind}: ${a.message}`); }
    return;
  }
  if (cmd === 'replay') {
    const file = positional(0); if (!file) throw new Error('replay requires an events.jsonl path');
    const events = parseJsonl(await readFile(file, 'utf8'));
    const state = analyzeEvents(events, file, { costLimitUsd: 1, stuckMs: 1000, deadMs: 5000, now: new Date('2026-06-13T00:00:10.000Z'), mode: 'replay' });
    if (flag('--json')) console.log(JSON.stringify(state, null, 2));
    else { console.log(`SwarmWatch replay: ${state.totals.events} events, ${state.totals.agents} agents, ${state.alerts.length} alerts`); for (const a of state.alerts) console.log(`- [${a.severity}] ${a.kind}: ${a.message}`); }
    return;
  }
  if (cmd === 'kill') {
    const agent = positional(0); if (!agent) throw new Error('kill requires an agentId');
    const paths = await initWorkspace(root);
    const ev = await requestKill(root, paths.events, agent, 'CLI kill requested');
    console.log(JSON.stringify({ ok: true, event: ev }, null, 2));
    return;
  }
  if (cmd === 'mcp') return runMcp(root);
  if (cmd === 'serve' || cmd === 'watch') {
    const paths = await initWorkspace(root);
    const eventsFile = resolve(arg('--events', paths.events)!);
    if (cmd === 'watch' && (flag('--once') || flag('--json'))) {
      const cfg = await loadRuntimeConfig(root);
      const state = analyzeEvents(await loadObservedEvents(root, eventsFile), eventsFile, { ...cfg, mode: flag('--live') ? 'live' : 'replay' });
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    const port = arg('--port') ? Number(arg('--port')) : 8787;
    const s = await startServer({ root, eventsFile, port });
    console.log(`SwarmWatch dashboard: http://127.0.0.1:${s.port}`);
    console.log(`Mutation token: ${s.token}`);
    console.log(`API: GET /api/state · POST /api/events · POST /api/kill/:agentId (mutations require x-swarmwatch-token)`);
    process.on('SIGINT', async () => { await s.close(); process.exit(0); });
    return;
  }
  help(); process.exitCode = 2;
}
main().catch((e) => { console.error(`swarmwatch: ${e.message}`); process.exit(2); });

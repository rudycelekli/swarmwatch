#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_CONFIG = { costLimitUsd: 5, stuckMs: 300000, deadMs: 900000, fanoutLimit: 6 };
const STRUCTURAL = new Set(['runaway_cost', 'circular_delegation', 'high_fanout']);

function arg(args, name, fallback) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; }
function flag(args, name) { return args.includes(name); }
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function readEventsFrom(file, offset = 0) {
  if (!existsSync(file)) return [];
  const bytes = await readFile(file);
  const start = Number.isFinite(offset) && offset > 0 ? Math.min(offset, bytes.length) : 0;
  const text = bytes.subarray(start).toString('utf8');
  return parseEvents(text);
}
function parseEvents(text) {
  const out = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { throw new Error(`invalid event JSON at line ${i + 1}`); }
  }
  return out;
}
function parseConfig(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const num = (x, fallback) => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fallback;
  return {
    costLimitUsd: num(v.costLimitUsd, DEFAULT_CONFIG.costLimitUsd),
    stuckMs: num(v.stuckMs, DEFAULT_CONFIG.stuckMs),
    deadMs: num(v.deadMs, DEFAULT_CONFIG.deadMs),
    fanoutLimit: num(v.fanoutLimit, DEFAULT_CONFIG.fanoutLimit),
  };
}
function delegationEdges(events) {
  const edges = new Set();
  for (const e of events) {
    if (typeof e?.parentId === 'string' && typeof e?.agentId === 'string') edges.add(`${e.parentId}\0${e.agentId}`);
    if (e?.type === 'delegation' && typeof e?.agentId === 'string' && typeof e?.targetAgentId === 'string') edges.add(`${e.agentId}\0${e.targetAgentId}`);
  }
  return [...edges].map((x) => { const [from, to] = x.split('\0'); return { from, to }; });
}
function findCycle(edges) {
  const adj = new Map();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) || []), e.to]);
  const seen = new Set();
  const stack = new Set();
  const path = [];
  function dfs(n) {
    seen.add(n); stack.add(n); path.push(n);
    for (const next of adj.get(n) || []) {
      if (!seen.has(next)) { const r = dfs(next); if (r) return r; }
      else if (stack.has(next)) return [...path.slice(path.indexOf(next)), next];
    }
    stack.delete(n); path.pop(); return undefined;
  }
  for (const n of adj.keys()) if (!seen.has(n)) { const r = dfs(n); if (r) return r; }
  return undefined;
}
function structuralAlerts(events, config) {
  const alerts = [];
  const costs = new Map();
  for (const e of events) if (typeof e?.agentId === 'string' && typeof e?.costUsd === 'number' && Number.isFinite(e.costUsd)) costs.set(e.agentId, (costs.get(e.agentId) || 0) + e.costUsd);
  for (const [agentId, costUsd] of costs) if (costUsd > config.costLimitUsd) alerts.push({ kind: 'runaway_cost', agentId, costUsd, limit: config.costLimitUsd, fingerprint: `runaway_cost:${agentId}:${config.costLimitUsd}` });
  const edges = delegationEdges(events);
  const byFrom = new Map();
  for (const e of edges) byFrom.set(e.from, [...(byFrom.get(e.from) || []), e.to]);
  for (const [agentId, targets] of byFrom) if (targets.length > config.fanoutLimit) alerts.push({ kind: 'high_fanout', agentId, count: targets.length, limit: config.fanoutLimit, targets: targets.sort(), fingerprint: `high_fanout:${agentId}:${config.fanoutLimit}:${targets.sort().join(',')}` });
  const cycle = findCycle(edges);
  if (cycle) alerts.push({ kind: 'circular_delegation', agentId: cycle[0], cycle, fingerprint: `circular_delegation:${cycle.join('>')}` });
  return alerts.filter((a) => STRUCTURAL.has(a.kind));
}
function formatAlert(alert, session) {
  if (alert.kind === 'runaway_cost') {
    return `SwarmWatch alert: runaway_cost agent=${alert.agentId} costUsd=${alert.costUsd.toFixed(4)} limit=${alert.limit}. ${action(alert.agentId, session)}`;
  }
  if (alert.kind === 'high_fanout') {
    return `SwarmWatch alert: high_fanout agent=${alert.agentId} fanout=${alert.count} limit=${alert.limit} targets=${alert.targets.join(',')}. ${action(alert.agentId, session)}`;
  }
  return `SwarmWatch alert: circular_delegation cycle=${alert.cycle.join(' -> ')}. ${action(alert.agentId, session)}`;
}
function action(agentId, session) {
  if (session.mode === 'process-live') return `Process-live action: /swarmwatch:swarmwatch-kill ${agentId}`;
  return `Stream-live/external scope: /swarmwatch:swarmwatch-kill ${agentId} emits a marker only; SwarmWatch does not terminate processes it did not launch.`;
}
async function check(project, stateFile) {
  const sessionFile = join(project, '.swarmwatch', 'claude-plugin-session.json');
  const session = await readJson(sessionFile, undefined);
  if (!session?.active || !['process-live', 'stream-live'].includes(session.mode)) return [];
  const config = parseConfig(await readJson(join(project, '.swarmwatch', 'config.json'), DEFAULT_CONFIG));
  const eventsFile = typeof session.eventsFile === 'string' ? session.eventsFile : join(project, '.swarmwatch', 'events.jsonl');
  const events = await readEventsFrom(eventsFile, typeof session.eventOffset === 'number' ? session.eventOffset : 0).catch(() => []);
  if (!events.length) return [];
  const state = await readJson(stateFile, { fired: [] });
  const fired = new Set(Array.isArray(state.fired) ? state.fired : []);
  const fresh = [];
  for (const alert of structuralAlerts(events, config)) {
    if (fired.has(alert.fingerprint)) continue;
    fired.add(alert.fingerprint);
    fresh.push(formatAlert(alert, session));
  }
  if (fresh.length) {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ fired: [...fired].sort(), updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  }
  return fresh;
}
async function main() {
  const args = process.argv.slice(2);
  const project = resolve(arg(args, '--project', process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  const stateFile = resolve(arg(args, '--state', process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, 'alarm-state.json') : join(project, '.swarmwatch', 'alarm-state.json')));
  const intervalMs = Number(arg(args, '--interval-ms', '2000'));
  if (flag(args, '--once')) {
    for (const line of await check(project, stateFile)) console.log(line);
    return;
  }
  for (;;) {
    for (const line of await check(project, stateFile)) console.log(line);
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(intervalMs) && intervalMs >= 250 ? intervalMs : 2000));
  }
}
main().catch((err) => { console.error(`SwarmWatch alarm monitor failed: ${err.message}`); process.exit(2); });

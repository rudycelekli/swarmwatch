import { createHash } from 'node:crypto';
import type { AgentEdge, AgentNode, AnalyzeOptions, SwarmAlert, SwarmEvent, SwarmState } from './types.js';

function alertId(kind: string, parts: unknown[]): string {
  return createHash('sha256').update(kind + JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function upsertEdge(edges: Map<string, AgentEdge>, from: string, to: string, kind: AgentEdge['kind'], ts: string) {
  const key = `${from}\0${to}\0${kind}`;
  const prev = edges.get(key);
  if (prev) { prev.count += 1; prev.lastSeen = ts > prev.lastSeen ? ts : prev.lastSeen; }
  else edges.set(key, { from, to, kind, count: 1, lastSeen: ts });
}

function hasCycle(edges: AgentEdge[]): string[] | undefined {
  const adj = new Map<string, string[]>();
  for (const e of edges.filter((x) => x.kind === 'delegation')) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  }
  const seen = new Set<string>(), stack = new Set<string>(), path: string[] = [];
  const dfs = (n: string): string[] | undefined => {
    seen.add(n); stack.add(n); path.push(n);
    for (const next of adj.get(n) ?? []) {
      if (!seen.has(next)) { const r = dfs(next); if (r) return r; }
      else if (stack.has(next)) return [...path.slice(path.indexOf(next)), next];
    }
    stack.delete(n); path.pop(); return undefined;
  };
  for (const n of adj.keys()) { if (!seen.has(n)) { const r = dfs(n); if (r) return r; } }
  return undefined;
}

export function analyzeEvents(events: SwarmEvent[], source = 'memory', opts: AnalyzeOptions = {}): SwarmState {
  const now = opts.now ?? new Date();
  const costLimitUsd = opts.costLimitUsd ?? 5;
  const stuckMs = opts.stuckMs ?? 5 * 60_000;
  const deadMs = opts.deadMs ?? 15 * 60_000;
  const fanoutLimit = opts.fanoutLimit ?? 6;
  const liveMode = opts.mode !== 'replay';
  const agents = new Map<string, AgentNode>();
  const edges = new Map<string, AgentEdge>();
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));

  for (const e of sorted) {
    const prev = agents.get(e.agentId);
    const node: AgentNode = prev ?? {
      id: e.agentId,
      parentId: e.parentId,
      framework: e.framework ?? 'unknown',
      status: 'unknown',
      firstSeen: e.ts,
      lastSeen: e.ts,
      messageCount: 0,
      toolCalls: 0,
      costUsd: 0,
      tokens: 0,
    };
    node.parentId ??= e.parentId;
    node.framework = e.framework ?? node.framework;
    node.lastSeen = e.ts > node.lastSeen ? e.ts : node.lastSeen;
    if (e.type === 'agent_started' || e.type === 'agent_heartbeat' || e.type === 'agent_message' || e.type === 'tool_call' || e.type === 'delegation') node.status = 'running';
    if (e.status === 'done' || e.type === 'agent_done') node.status = 'done';
    if (e.status === 'error' || e.type === 'agent_error') node.status = 'error';
    if (e.status === 'killed' || e.type === 'kill_requested') node.status = 'killed';
    if (e.type === 'agent_message') node.messageCount += 1;
    if (e.type === 'tool_call') node.toolCalls += 1;
    node.costUsd += e.costUsd ?? 0;
    node.tokens += e.tokens ?? 0;
    if (e.message) node.lastMessage = e.message;
    agents.set(e.agentId, node);
    if (e.parentId) upsertEdge(edges, e.parentId, e.agentId, 'delegation', e.ts);
    if (e.targetAgentId) upsertEdge(edges, e.agentId, e.targetAgentId, e.type === 'delegation' ? 'delegation' : 'message', e.ts);
  }

  const agentList = [...agents.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edgeList = [...edges.values()].sort((a, b) => `${a.from}${a.to}${a.kind}`.localeCompare(`${b.from}${b.to}${b.kind}`));
  const alerts: SwarmAlert[] = [];
  for (const a of agentList) {
    if (a.costUsd > costLimitUsd) alerts.push({ id: alertId('runaway_cost', [a.id, a.costUsd]), kind: 'runaway_cost', severity: 'critical', agentId: a.id, message: `${a.id} spent $${a.costUsd.toFixed(4)} over $${costLimitUsd}`, evidence: { costUsd: a.costUsd, limit: costLimitUsd }, ts: now.toISOString() });
    const age = now.getTime() - Date.parse(a.lastSeen);
    if (liveMode && a.status === 'running' && age > deadMs) alerts.push({ id: alertId('dead_agent', [a.id, a.lastSeen]), kind: 'dead_agent', severity: 'critical', agentId: a.id, message: `${a.id} has no events for ${Math.round(age/1000)}s`, evidence: { lastSeen: a.lastSeen, deadMs }, ts: now.toISOString() });
    else if (liveMode && a.status === 'running' && age > stuckMs && a.messageCount === 0 && a.toolCalls === 0) alerts.push({ id: alertId('stuck_agent', [a.id, a.lastSeen]), kind: 'stuck_agent', severity: 'warn', agentId: a.id, message: `${a.id} started but has produced no messages/tools for ${Math.round(age/1000)}s`, evidence: { lastSeen: a.lastSeen, stuckMs }, ts: now.toISOString() });
  }
  const fanout = new Map<string, number>();
  for (const e of edgeList.filter((x) => x.kind === 'delegation')) fanout.set(e.from, (fanout.get(e.from) ?? 0) + 1);
  for (const [id, count] of fanout) if (count > fanoutLimit) alerts.push({ id: alertId('high_fanout', [id, count]), kind: 'high_fanout', severity: 'warn', agentId: id, message: `${id} delegated to ${count} agents`, evidence: { count, limit: fanoutLimit }, ts: now.toISOString() });
  const cycle = hasCycle(edgeList);
  if (cycle) alerts.push({ id: alertId('circular_delegation', cycle), kind: 'circular_delegation', severity: 'critical', message: `circular delegation detected: ${cycle.join(' → ')}`, evidence: { cycle }, ts: now.toISOString() });
  const totals = { agents: agentList.length, running: agentList.filter((a) => a.status === 'running').length, costUsd: agentList.reduce((n, a) => n + a.costUsd, 0), tokens: agentList.reduce((n, a) => n + a.tokens, 0), events: events.length };
  return { generatedAt: now.toISOString(), source, agents: agentList, edges: edgeList, alerts, totals };
}

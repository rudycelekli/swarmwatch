import { createHash } from 'node:crypto';
import { analyzeEvents } from './analyze.js';
import type { AnalyzeOptions, SwarmEvent, SwarmState } from './types.js';

export interface VerifyIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  eventId?: string;
}

export interface VerifyResult {
  ok: boolean;
  digest: string;
  events: number;
  state: SwarmState;
  issues: VerifyIssue[];
}

export function digestEvents(events: SwarmEvent[]): string {
  const h = createHash('sha256');
  for (const e of events) h.update(JSON.stringify(e)).update('\n');
  return h.digest('hex');
}

export function verifyEvents(events: SwarmEvent[], source = 'memory', opts: AnalyzeOptions = {}, initialIssues: VerifyIssue[] = []): VerifyResult {
  const issues: VerifyIssue[] = [...initialIssues];
  const ids = new Set<string>();
  let previousTs = '';
  for (const e of events) {
    if (ids.has(e.id)) issues.push({ severity: 'error', code: 'duplicate_event_id', message: `duplicate event id ${e.id}`, eventId: e.id });
    ids.add(e.id);
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) issues.push({ severity: 'error', code: 'invalid_timestamp', message: `invalid timestamp ${e.ts}`, eventId: e.id });
    if (previousTs && e.ts < previousTs) issues.push({ severity: 'warn', code: 'non_monotonic_timestamp', message: `event ${e.id} is earlier than a previous event`, eventId: e.id });
    previousTs = e.ts;
    if ((e.type === 'delegation' || e.type === 'agent_message') && e.targetAgentId && e.targetAgentId === e.agentId) {
      issues.push({ severity: 'warn', code: 'self_edge', message: `event ${e.id} targets its own agent`, eventId: e.id });
    }
    if (e.costUsd !== undefined && (!Number.isFinite(e.costUsd) || e.costUsd < 0)) issues.push({ severity: 'error', code: 'invalid_cost', message: `event ${e.id} has invalid cost`, eventId: e.id });
    if (e.tokens !== undefined && (!Number.isFinite(e.tokens) || e.tokens < 0)) issues.push({ severity: 'error', code: 'invalid_tokens', message: `event ${e.id} has invalid tokens`, eventId: e.id });
  }
  const state = analyzeEvents(events, source, opts);
  for (const a of state.alerts.filter((x) => x.severity === 'critical')) {
    issues.push({ severity: 'warn', code: `critical_${a.kind}`, message: a.message, eventId: a.agentId });
  }
  return { ok: !issues.some((i) => i.severity === 'error'), digest: digestEvents(events), events: events.length, state, issues };
}

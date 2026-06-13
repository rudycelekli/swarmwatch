import { randomUUID } from 'node:crypto';
import type { SwarmEvent, SwarmEventType } from './types.js';

export const EVENT_TYPES = new Set<SwarmEventType>([
  'agent_started', 'agent_heartbeat', 'agent_message', 'tool_call', 'cost',
  'delegation', 'agent_done', 'agent_error', 'kill_requested',
]);

export function nowIso(): string { return new Date().toISOString(); }

export function makeEvent(input: Partial<SwarmEvent> & { type: SwarmEventType; agentId: string }): SwarmEvent {
  return {
    id: input.id ?? randomUUID(),
    ts: input.ts ?? nowIso(),
    framework: input.framework ?? 'swarmwatch',
    ...input,
  };
}

export function assertEvent(value: unknown): SwarmEvent {
  if (!value || typeof value !== 'object') throw new Error('event must be an object');
  const e = value as Record<string, unknown>;
  for (const key of ['id', 'ts', 'type', 'agentId']) {
    if (typeof e[key] !== 'string' || e[key] === '') throw new Error(`event.${key} must be a non-empty string`);
  }
  if (!Number.isFinite(Date.parse(String(e.ts)))) throw new Error('event.ts must be a valid ISO timestamp');
  if (!EVENT_TYPES.has(e.type as SwarmEventType)) throw new Error(`event.type must be one of ${[...EVENT_TYPES].join(', ')}`);
  for (const key of ['parentId', 'targetAgentId', 'framework', 'message', 'tool', 'status']) {
    if (e[key] !== undefined && typeof e[key] !== 'string') throw new Error(`event.${key} must be a string`);
  }
  const costUsd = e.costUsd;
  const tokens = e.tokens;
  if (costUsd !== undefined && (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0)) throw new Error('event.costUsd must be a finite non-negative number');
  if (tokens !== undefined && (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0)) throw new Error('event.tokens must be a finite non-negative number');
  return e as unknown as SwarmEvent;
}

export function parseJsonl(text: string): SwarmEvent[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, i) => {
    try { return assertEvent(JSON.parse(line)); }
    catch (err) { throw new Error(`invalid JSONL event at line ${i + 1}: ${(err as Error).message}`); }
  });
}

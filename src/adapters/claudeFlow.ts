import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeEvent } from '../core/event.js';
import type { SwarmEvent } from '../core/types.js';

/** Best-effort claude-flow state importer. It never mutates claude-flow files. */
export async function readClaudeFlowState(root = process.cwd()): Promise<SwarmEvent[]> {
  const statePath = join(root, '.swarm', 'state.json');
  if (!existsSync(statePath)) return [];
  const raw = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
  const events: SwarmEvent[] = [];
  const agents = Array.isArray(raw.agents) ? raw.agents : Array.isArray((raw.swarm as Record<string, unknown> | undefined)?.agents) ? (raw.swarm as Record<string, unknown>).agents as unknown[] : [];
  for (const item of agents) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const id = String(a.id ?? a.name ?? a.agentId ?? 'agent');
    events.push(makeEvent({ id: `claude-flow-${id}`, ts: String(a.updatedAt ?? a.createdAt ?? new Date().toISOString()), type: 'agent_heartbeat', agentId: id, framework: 'claude-flow', status: String(a.status ?? 'running') === 'error' ? 'error' : 'running', message: String(a.type ?? a.role ?? '') }));
  }
  return events;
}

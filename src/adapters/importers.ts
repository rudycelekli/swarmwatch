import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { makeEvent, parseJsonl } from '../core/event.js';
import { readClaudeFlowState } from './claudeFlow.js';
import type { SwarmEvent } from '../core/types.js';

export type ImportAdapter = 'swarmwatch' | 'jsonl' | 'claude-flow' | 'claude-transcript' | 'langgraph';

function lines(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as unknown[];
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function importEvents(opts: { adapter: ImportAdapter; file?: string; root?: string }): Promise<SwarmEvent[]> {
  if (opts.adapter === 'claude-flow') return readClaudeFlowState(opts.root ?? process.cwd());
  if (!opts.file) throw new Error(`${opts.adapter} import requires --file`);
  const text = await readFile(opts.file, 'utf8');
  if (opts.adapter === 'swarmwatch' || opts.adapter === 'jsonl') return parseJsonl(text);
  const raw = lines(text);
  if (opts.adapter === 'langgraph') return raw.flatMap((item, i) => langGraphEvent(item, i, opts.file!));
  if (opts.adapter === 'claude-transcript') return raw.flatMap((item, i) => claudeTranscriptEvent(item, i, opts.file!));
  throw new Error(`unknown adapter ${opts.adapter}`);
}

function langGraphEvent(item: unknown, i: number, file: string): SwarmEvent[] {
  if (!item || typeof item !== 'object') return [];
  const r = item as Record<string, unknown>;
  const event = String(r.event ?? r.type ?? '');
  const name = String(r.name ?? r.node ?? r.run_id ?? `node-${i}`);
  const ts = String(r.ts ?? r.time ?? r.timestamp ?? new Date(0 + i).toISOString());
  if (event.includes('start')) return [makeEvent({ id: `langgraph-${basename(file)}-${i}`, ts, type: 'agent_started', agentId: name, framework: 'langgraph', metadata: { raw: r } })];
  if (event.includes('end') || event.includes('done')) return [makeEvent({ id: `langgraph-${basename(file)}-${i}`, ts, type: 'agent_done', agentId: name, framework: 'langgraph', status: 'done', metadata: { raw: r } })];
  return [makeEvent({ id: `langgraph-${basename(file)}-${i}`, ts, type: 'agent_message', agentId: name, framework: 'langgraph', message: typeof r.data === 'string' ? r.data : event, metadata: { raw: r } })];
}

function claudeTranscriptEvent(item: unknown, i: number, file: string): SwarmEvent[] {
  if (!item || typeof item !== 'object') return [];
  const r = item as Record<string, unknown>;
  const msg = (r.message && typeof r.message === 'object') ? r.message as Record<string, unknown> : undefined;
  const model = String(msg?.model ?? r.model ?? r.agent ?? 'claude');
  const session = String(r.session_id ?? r.sessionId ?? basename(file));
  const agentId = `${model}:${session}`;
  const ts = String(r.timestamp ?? r.ts ?? new Date(0 + i).toISOString());
  const type = String(r.type ?? msg?.type ?? 'message');
  const content = Array.isArray(msg?.content) ? msg?.content : Array.isArray(r.content) ? r.content : [];
  const text = content.map((c) => (c && typeof c === 'object' && 'text' in c) ? String((c as Record<string, unknown>).text) : '').filter(Boolean).join('\n').slice(0, 500);
  if (type === 'result') return [makeEvent({ id: `claude-${basename(file)}-${i}`, ts, type: 'agent_done', agentId, framework: 'claude-code', status: 'done', message: String(r.subtype ?? 'result'), metadata: { raw: r } })];
  return [makeEvent({ id: `claude-${basename(file)}-${i}`, ts, type: type.includes('tool') ? 'tool_call' : 'agent_message', agentId, framework: 'claude-code', message: text || type, metadata: { raw: r } })];
}

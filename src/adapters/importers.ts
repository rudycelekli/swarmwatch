import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { makeEvent, parseJsonl } from '../core/event.js';
import { readClaudeFlowState } from './claudeFlow.js';
import type { SwarmEvent } from '../core/types.js';

export type ImportAdapter = 'swarmwatch' | 'jsonl' | 'claude-flow' | 'claude-transcript' | 'langgraph';
export interface ImportOptions { adapter: ImportAdapter; file?: string; root?: string; includeRaw?: boolean; includeText?: boolean }

function lines(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as unknown[];
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function metadata(source: string, raw: Record<string, unknown>, includeRaw?: boolean): Record<string, unknown> {
  return includeRaw ? { source, raw } : { source };
}

export async function importEvents(opts: ImportOptions): Promise<SwarmEvent[]> {
  if (opts.adapter === 'claude-flow') return readClaudeFlowState(opts.root ?? process.cwd());
  if (!opts.file) throw new Error(`${opts.adapter} import requires --file`);
  const text = await readFile(opts.file, 'utf8');
  if (opts.adapter === 'swarmwatch' || opts.adapter === 'jsonl') return parseJsonl(text);
  return importEventObjects(opts.adapter, lines(text), opts.file, opts);
}

export function importEventObjects(adapter: ImportAdapter, raw: unknown[], source: string, opts: ImportOptions = { adapter }): SwarmEvent[] {
  if (adapter === 'langgraph') return raw.flatMap((item, i) => langGraphEvent(item, i, source, opts));
  if (adapter === 'claude-transcript') return raw.flatMap((item, i) => claudeTranscriptEvent(item, i, source, opts));
  throw new Error(`unknown adapter ${adapter}`);
}

function langGraphEvent(item: unknown, i: number, file: string, opts: ImportOptions): SwarmEvent[] {
  if (!item || typeof item !== 'object') return [];
  const r = item as Record<string, unknown>;
  const event = String(r.event ?? r.type ?? '');
  const name = String(r.name ?? r.node ?? r.run_id ?? `node-${i}`);
  const ts = String(r.ts ?? r.time ?? r.timestamp ?? new Date(0 + i).toISOString());
  const base = { id: `langgraph-${basename(file)}-${i}`, ts, agentId: name, framework: 'langgraph', metadata: metadata('langgraph', r, opts.includeRaw) } as const;
  if (event.includes('start')) return [makeEvent({ ...base, type: 'agent_started' })];
  if (event.includes('end') || event.includes('done')) return [makeEvent({ ...base, type: 'agent_done', status: 'done' })];
  return [makeEvent({ ...base, type: 'agent_message', message: opts.includeText && typeof r.data === 'string' ? r.data : event })];
}

function claudeTranscriptEvent(item: unknown, i: number, file: string, opts: ImportOptions): SwarmEvent[] {
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
  const safeMessage = opts.includeText ? (text || type) : type;
  const base = { id: `claude-${basename(file)}-${i}`, ts, agentId, framework: 'claude-code', metadata: metadata('claude-transcript', r, opts.includeRaw) } as const;
  if (type === 'result') return [makeEvent({ ...base, type: 'agent_done', status: 'done', message: opts.includeText ? String(r.subtype ?? 'result') : 'result' })];
  return [makeEvent({ ...base, type: type.includes('tool') ? 'tool_call' : 'agent_message', message: safeMessage })];
}

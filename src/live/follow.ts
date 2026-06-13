import { open, stat } from 'node:fs/promises';
import { appendEvent } from '../core/store.js';
import { assertEvent, makeEvent } from '../core/event.js';
import { importEventObjects, type ImportAdapter, type ImportOptions } from '../adapters/importers.js';
import { readClaudeFlowState } from '../adapters/claudeFlow.js';
import type { SwarmEvent } from '../core/types.js';

export interface FollowOptions extends Omit<ImportOptions, 'adapter'> {
  adapter: ImportAdapter;
  outFile: string;
  pollMs?: number;
  fromStart?: boolean;
  onEvent?: (event: SwarmEvent) => void;
}

async function readChunk(file: string, start: number, end: number): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

export async function lineToEvents(adapter: ImportAdapter, line: string, source = 'live', opts: ImportOptions = { adapter }): Promise<SwarmEvent[]> {
  if (!line.trim()) return [];
  if (adapter === 'swarmwatch' || adapter === 'jsonl') return [assertEvent(JSON.parse(line))];
  if (adapter === 'claude-flow') throw new Error('claude-flow live adapter polls state, not lines');
  return importEventObjects(adapter, [JSON.parse(line)], source, opts);
}

export async function followFile(opts: FollowOptions): Promise<{ stop: () => void }> {
  if (!opts.file && opts.adapter !== 'claude-flow') throw new Error('followFile requires file except for claude-flow');
  const pollMs = opts.pollMs ?? 250;
  let stopped = false;
  let offset = 0;
  let carry = '';
  if (opts.file && !opts.fromStart) {
    try { offset = (await stat(opts.file)).size; } catch { offset = 0; }
  }
  const append = async (ev: SwarmEvent) => { await appendEvent(opts.outFile, ev); opts.onEvent?.(ev); };
  const tickFile = async () => {
    if (!opts.file) return;
    let size = 0;
    try { size = (await stat(opts.file)).size; } catch { return; }
    if (size < offset) { offset = 0; carry = ''; }
    if (size === offset) return;
    const chunk = await readChunk(opts.file, offset, size);
    offset = size;
    const parts = (carry + chunk).split(/\r?\n/);
    carry = parts.pop() ?? '';
    for (const line of parts) for (const ev of await lineToEvents(opts.adapter, line, opts.file, opts)) await append(ev);
  };
  const tickClaudeFlow = async () => {
    const root = opts.root ?? process.cwd();
    const events = await readClaudeFlowState(root);
    const ts = Date.now();
    for (const [i, ev] of events.entries()) await append({ ...ev, id: `${ev.id}-${ts}-${i}`, ts: new Date().toISOString() });
  };
  const timer = setInterval(() => {
    const tick = opts.adapter === 'claude-flow' ? tickClaudeFlow : tickFile;
    tick().catch((err) => opts.onEvent?.(makeEvent({ type: 'agent_error', agentId: 'swarmwatch-live', message: err.message, status: 'error' })));
  }, pollMs);
  timer.unref?.();
  // One immediate tick makes tests and foreground attach responsive.
  (opts.adapter === 'claude-flow' ? tickClaudeFlow : tickFile)().catch(() => {});
  return { stop: () => { if (!stopped) { stopped = true; clearInterval(timer); } } };
}

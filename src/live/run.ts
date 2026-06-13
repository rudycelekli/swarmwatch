import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { workspacePaths, appendEvent } from '../core/store.js';
import { makeEvent, assertEvent } from '../core/event.js';
import type { SwarmEvent } from '../core/types.js';

export interface RunOptions {
  root: string;
  eventsFile: string;
  agentId: string;
  command: string;
  args: string[];
  cwd?: string;
  killPollMs?: number;
  onEvent?: (event: SwarmEvent) => void;
}

async function append(outFile: string, event: SwarmEvent, cb?: (event: SwarmEvent) => void) {
  await appendEvent(outFile, event);
  cb?.(event);
}

function lineEvent(line: string, agentId: string, stream: 'stdout' | 'stderr'): SwarmEvent {
  try {
    const parsed = JSON.parse(line);
    return assertEvent({ ...parsed, id: parsed.id, ts: parsed.ts, type: parsed.type, agentId: parsed.agentId });
  } catch {
    return makeEvent({ type: stream === 'stderr' ? 'agent_error' : 'agent_message', agentId, framework: 'process', message: line, metadata: { stream } });
  }
}

export async function runSupervised(opts: RunOptions): Promise<number> {
  await append(opts.eventsFile, makeEvent({ type: 'agent_started', agentId: opts.agentId, framework: 'process', message: [opts.command, ...opts.args].join(' ') }), opts.onEvent);
  const child = spawn(opts.command, opts.args, { cwd: opts.cwd ?? opts.root, stdio: ['ignore', 'pipe', 'pipe'] });
  let killSeenAt = 0;
  let killRequested = false;
  const killTimer = setInterval(async () => {
    try {
      const kills = await readFile(workspacePaths(opts.root).kills, 'utf8');
      if (kills.length === killSeenAt) return;
      killSeenAt = kills.length;
      if (kills.split(/\r?\n/).filter(Boolean).some((line) => JSON.parse(line).agentId === opts.agentId) && !child.killed) { killRequested = true; child.kill('SIGTERM'); }
    } catch {}
  }, opts.killPollMs ?? 250);
  killTimer.unref?.();
  const wire = (stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr') => {
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => append(opts.eventsFile, lineEvent(line, opts.agentId, name), opts.onEvent).catch(() => {}));
  };
  wire(child.stdout, 'stdout');
  wire(child.stderr, 'stderr');
  const rawCode = await new Promise<number>((resolve) => child.on('close', (c, signal) => resolve(signal ? 128 : (c ?? 0))));
  clearInterval(killTimer);
  const code = killRequested ? 128 : rawCode;
  await append(opts.eventsFile, makeEvent({ type: code === 0 ? 'agent_done' : 'agent_error', agentId: opts.agentId, framework: 'process', status: code === 128 ? 'killed' : code === 0 ? 'done' : 'error', message: `process exited ${code}` }), opts.onEvent);
  return code;
}

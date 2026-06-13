import { appendEvent, initWorkspace, readEvents, workspacePaths } from '../core/store.js';
import { analyzeEvents } from '../core/analyze.js';
import { assertEvent, makeEvent } from '../core/event.js';
import type { SwarmEvent } from '../core/types.js';

function rpc(id: unknown, result: unknown) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function err(id: unknown, message: string) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n'); }

export async function runMcp(root = process.cwd()): Promise<void> {
  await initWorkspace(root);
  const eventsFile = workspacePaths(root).events;
  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf('\n'); if (idx < 0) break;
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1); if (!line) continue;
      let msg: any; try { msg = JSON.parse(line); } catch { continue; }
      try {
        if (msg.method === 'initialize') rpc(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'swarmwatch', version: '0.1.0' } });
        else if (msg.method === 'tools/list') rpc(msg.id, { tools: [
          { name: 'swarm_state', description: 'Return current SwarmWatch state and drift alarms.', inputSchema: { type: 'object', properties: {} } },
          { name: 'swarm_ingest', description: 'Append one swarm event.', inputSchema: { type: 'object', properties: { type: { type: 'string' }, agentId: { type: 'string' }, targetAgentId: { type: 'string' }, costUsd: { type: 'number' }, message: { type: 'string' } }, required: ['type', 'agentId'] } },
          { name: 'swarm_kill', description: 'Request a local kill marker for an agent.', inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] } }
        ] });
        else if (msg.method === 'tools/call') {
          const name = msg.params?.name; const args = msg.params?.arguments ?? {};
          if (name === 'swarm_state') rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify(analyzeEvents(await readEvents(eventsFile), eventsFile), null, 2) }] });
          else if (name === 'swarm_ingest') { const ev = assertEvent({ ...makeEvent(args as Partial<SwarmEvent> & { type: SwarmEvent['type']; agentId: string }), ...args }); await appendEvent(eventsFile, ev); rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify(ev) }] }); }
          else if (name === 'swarm_kill') { const ev = makeEvent({ type: 'kill_requested', agentId: String(args.agentId), status: 'killed', message: 'MCP kill requested' }); await appendEvent(eventsFile, ev); rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify({ ok: true, event: ev }) }] }); }
          else err(msg.id, `unknown tool ${name}`);
        } else if (msg.id !== undefined) rpc(msg.id, {});
      } catch (e) { err(msg.id, (e as Error).message); }
    }
  });
}

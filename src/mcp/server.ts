import { appendEvent, initWorkspace, workspacePaths } from '../core/store.js';
import { assertEvent, makeEvent } from '../core/event.js';
import { loadObservedState, requestKill, respondOperator, verifyObserved } from '../core/runtime.js';
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
          { name: 'swarm_ingest', description: 'Append one swarm event.', inputSchema: { type: 'object', properties: { type: { type: 'string' }, agentId: { type: 'string' }, targetAgentId: { type: 'string' }, costUsd: { type: 'number' }, tokens: { type: 'number' }, message: { type: 'string' }, metadata: { type: 'object' } }, required: ['type', 'agentId'] } },
          { name: 'swarm_operator_list', description: 'List pending operator requests from agents waiting on human input.', inputSchema: { type: 'object', properties: {} } },
          { name: 'swarm_operator_respond', description: 'Append an auditable operator_response for a pending operator request.', inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, response: { type: 'string' }, action: { type: 'string' } }, required: ['requestId'] } },
          { name: 'swarm_kill', description: 'Request a local kill marker for an agent.', inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] } },
          { name: 'swarm_verify', description: 'Verify event log integrity, schema, and current alarms.', inputSchema: { type: 'object', properties: {} } }
        ] });
        else if (msg.method === 'tools/call') {
          const name = msg.params?.name; const args = msg.params?.arguments ?? {};
          if (name === 'swarm_state') rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify(await loadObservedState(root, eventsFile), null, 2) }] });
          else if (name === 'swarm_ingest') {
            const ev = assertEvent({ ...makeEvent(args as Partial<SwarmEvent> & { type: SwarmEvent['type']; agentId: string }), ...args });
            await appendEvent(eventsFile, ev);
            rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify(ev) }] });
          }
          else if (name === 'swarm_operator_list') {
            const state = await loadObservedState(root, eventsFile);
            rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify({ pending: state.operatorRequests.filter((r) => r.status === 'pending') }, null, 2) }] });
          }
          else if (name === 'swarm_operator_respond') {
            const ev = await respondOperator(root, eventsFile, String(args.requestId), typeof args.response === 'string' ? args.response : '', typeof args.action === 'string' ? args.action : 'respond');
            rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify({ ok: true, requestId: String(args.requestId), event: ev }) }] });
          }
          else if (name === 'swarm_verify') rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify(await verifyObserved(root, eventsFile), null, 2) }] });
          else if (name === 'swarm_kill') {
            const ev = await requestKill(root, eventsFile, String(args.agentId), 'MCP kill requested');
            rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify({ ok: true, event: ev }) }] });
          }
          else err(msg.id, `unknown tool ${name}`);
        } else if (msg.id !== undefined) rpc(msg.id, {});
      } catch (e) { err(msg.id, (e as Error).message); }
    }
  });
}

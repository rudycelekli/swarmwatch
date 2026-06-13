import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function readLine(proc) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const i = buf.indexOf('\n');
      if (i >= 0) { proc.stdout.off('data', onData); resolve(JSON.parse(buf.slice(0, i))); }
    };
    proc.stdout.on('data', onData);
    proc.once('error', reject);
    setTimeout(() => reject(new Error('timed out waiting for MCP line')), 2000).unref();
  });
}

test('MCP tools list, ingest, and state work over stdio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-mcp-'));
  const proc = spawn(process.execPath, ['dist/cli/index.js', 'mcp', '--root', root], { cwd: new URL('../..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{} }) + '\n');
    assert.equal((await readLine(proc)).result.serverInfo.name, 'swarmwatch');
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} }) + '\n');
    const tools = await readLine(proc);
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_state'));
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_verify'));
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'swarm_ingest', arguments:{ type:'agent_started', agentId:'planner' } } }) + '\n');
    assert.match((await readLine(proc)).result.content[0].text, /planner/);
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'swarm_state', arguments:{} } }) + '\n');
    const state = JSON.parse((await readLine(proc)).result.content[0].text);
    assert.equal(state.totals.agents, 1);
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'swarm_verify', arguments:{} } }) + '\n');
    const verify = JSON.parse((await readLine(proc)).result.content[0].text);
    assert.equal(verify.ok, true);
  } finally {
    proc.kill('SIGTERM');
    await rm(root, { recursive:true, force:true });
  }
});

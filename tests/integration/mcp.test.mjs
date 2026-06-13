import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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

function call(proc, id, name, args = {}) {
  proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method:'tools/call', params:{ name, arguments: args } }) + '\n');
  return readLine(proc);
}

test('MCP tools list, ingest, state, verify, and kill work over stdio with config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-mcp-'));
  await writeFile(join(root, 'placeholder'), '');
  const proc = spawn(process.execPath, ['dist/cli/index.js', 'mcp', '--root', root], { cwd: new URL('../..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    // mcp startup initializes config; now tighten it.
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(root, '.swarmwatch', 'config.json'), JSON.stringify({ costLimitUsd: 0.5, stuckMs: 300000, deadMs: 900000, fanoutLimit: 6 }));
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{} }) + '\n');
    assert.equal((await readLine(proc)).result.serverInfo.name, 'swarmwatch');
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} }) + '\n');
    const tools = await readLine(proc);
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_state'));
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_verify'));
    assert.match((await call(proc, 3, 'swarm_ingest', { type:'agent_started', agentId:'planner' })).result.content[0].text, /planner/);
    await call(proc, 4, 'swarm_ingest', { type:'cost', agentId:'planner', costUsd:0.6 });
    const state = JSON.parse((await call(proc, 5, 'swarm_state')).result.content[0].text);
    assert.ok(state.alerts.some((a) => a.kind === 'runaway_cost'));
    const verify = JSON.parse((await call(proc, 6, 'swarm_verify')).result.content[0].text);
    assert.equal(verify.ok, true);
    assert.ok(verify.state.alerts.some((a) => a.kind === 'runaway_cost'));
    await call(proc, 7, 'swarm_kill', { agentId:'planner' });
    assert.match(await readFile(join(root, '.swarmwatch', 'kills.jsonl'), 'utf8'), /planner/);
  } finally {
    proc.kill('SIGTERM');
    await rm(root, { recursive:true, force:true });
  }
});

test('MCP invalid ingest returns JSON-RPC error and appends nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-mcp-invalid-'));
  const proc = spawn(process.execPath, ['dist/cli/index.js', 'mcp', '--root', root], { cwd: new URL('../..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const res = await call(proc, 1, 'swarm_ingest', { type:'cost', agentId:'a', costUsd:-1 });
    assert.equal(res.error.code, -32000);
    assert.match(res.error.message, /costUsd/);
    assert.equal((await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8')).trim(), '');
  } finally {
    proc.kill('SIGTERM');
    await rm(root, { recursive:true, force:true });
  }
});

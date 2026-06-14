import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mcpReaders = new WeakMap();
function readerFor(proc) {
  let reader = mcpReaders.get(proc);
  if (reader) return reader;
  reader = { buf: '', lines: [], waiters: [] };
  const drain = () => {
    while (reader.waiters.length && reader.lines.length) reader.waiters.shift().resolve(reader.lines.shift());
  };
  proc.stdout.on('data', (chunk) => {
    reader.buf += chunk.toString('utf8');
    for (;;) {
      const i = reader.buf.indexOf('\n');
      if (i < 0) break;
      const line = reader.buf.slice(0, i);
      reader.buf = reader.buf.slice(i + 1);
      if (!line.trim()) continue;
      reader.lines.push(JSON.parse(line));
    }
    drain();
  });
  proc.once('error', (err) => {
    for (const waiter of reader.waiters.splice(0)) waiter.reject(err);
  });
  mcpReaders.set(proc, reader);
  return reader;
}

function readLine(proc) {
  const reader = readerFor(proc);
  return new Promise((resolve, reject) => {
    if (reader.lines.length) return resolve(reader.lines.shift());
    const waiter = { resolve, reject };
    reader.waiters.push(waiter);
    setTimeout(() => {
      const idx = reader.waiters.indexOf(waiter);
      if (idx >= 0) reader.waiters.splice(idx, 1);
      reject(new Error('timed out waiting for MCP line'));
    }, 2000).unref();
  });
}


async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
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
    await waitFor(() => existsSync(join(root, '.swarmwatch', 'config.json')));
    await writeFile(join(root, '.swarmwatch', 'config.json'), JSON.stringify({ costLimitUsd: 0.5, stuckMs: 300000, deadMs: 900000, fanoutLimit: 6 }));
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{} }) + '\n');
    assert.equal((await readLine(proc)).result.serverInfo.name, 'swarmwatch');
    proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} }) + '\n');
    const tools = await readLine(proc);
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_state'));
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_verify'));
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_operator_respond'));
    assert.match((await call(proc, 3, 'swarm_ingest', { type:'agent_started', agentId:'planner' })).result.content[0].text, /planner/);
    await call(proc, 4, 'swarm_ingest', { type:'cost', agentId:'planner', costUsd:0.6 });
    const state = JSON.parse((await call(proc, 5, 'swarm_state')).result.content[0].text);
    assert.ok(state.alerts.some((a) => a.kind === 'runaway_cost'));
    const verify = JSON.parse((await call(proc, 6, 'swarm_verify')).result.content[0].text);
    assert.equal(verify.ok, true);
    assert.ok(verify.state.alerts.some((a) => a.kind === 'runaway_cost'));
    await call(proc, 7, 'swarm_kill', { agentId:'planner' });
    assert.match(await readFile(join(root, '.swarmwatch', 'kills.jsonl'), 'utf8'), /planner/);
    await call(proc, 8, 'swarm_ingest', { type:'operator_request', agentId:'coder', message:'Need approval', metadata:{ requestId:'op-mcp-1', kind:'approval' } });
    const pending = JSON.parse((await call(proc, 9, 'swarm_operator_list')).result.content[0].text);
    assert.equal(pending.pending.length, 1);
    const response = JSON.parse((await call(proc, 10, 'swarm_operator_respond', { requestId:'op-mcp-1', action:'approve', response:'approved' })).result.content[0].text);
    assert.equal(response.event.type, 'operator_response');
    const afterOperator = JSON.parse((await call(proc, 11, 'swarm_state')).result.content[0].text);
    assert.equal(afterOperator.totals.operatorRequests, 0);
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

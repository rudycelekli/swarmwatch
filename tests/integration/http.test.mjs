import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, workspacePaths, initWorkspace } from '../../dist/index.js';

test('HTTP endpoints ingest events, expose state, and record kill requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-'));
  try {
    await initWorkspace(root);
    const s = await startServer({ root, eventsFile: workspacePaths(root).events });
    try {
      let res = await fetch(`http://127.0.0.1:${s.port}/api/events`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ type:'agent_started', agentId:'planner' }) });
      assert.equal(res.status, 201);
      res = await fetch(`http://127.0.0.1:${s.port}/api/state`);
      const state = await res.json();
      assert.equal(state.totals.agents, 1);
      res = await fetch(`http://127.0.0.1:${s.port}/api/kill/planner`, { method:'POST' });
      assert.equal(res.status, 202);
      res = await fetch(`http://127.0.0.1:${s.port}/api/state`);
      const killed = await res.json();
      assert.equal(killed.agents.find((a) => a.id === 'planner').status, 'killed');
      res = await fetch(`http://127.0.0.1:${s.port}/api/verify`);
      const verify = await res.json();
      assert.equal(verify.ok, true);
    } finally { await s.close(); }
  } finally { await rm(root, { recursive:true, force:true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, workspacePaths, initWorkspace } from '../../dist/index.js';

function headers(token, extra = {}) { return { 'content-type':'application/json', 'x-swarmwatch-token': token, ...extra }; }

test('HTTP endpoints ingest events, expose state/config, verify, and record kill requests consistently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-'));
  try {
    await initWorkspace(root);
    const paths = workspacePaths(root);
    await writeFile(paths.config, JSON.stringify({ costLimitUsd: 0.5, stuckMs: 300000, deadMs: 900000, fanoutLimit: 6 }));
    const s = await startServer({ root, eventsFile: paths.events });
    try {
      let res = await fetch(`http://127.0.0.1:${s.port}/api/events`, { method:'POST', headers:headers(s.token), body: JSON.stringify({ type:'agent_started', agentId:'planner' }) });
      assert.equal(res.status, 201);
      res = await fetch(`http://127.0.0.1:${s.port}/api/events`, { method:'POST', headers:headers(s.token), body: JSON.stringify({ type:'cost', agentId:'planner', costUsd:0.6 }) });
      assert.equal(res.status, 201);
      res = await fetch(`http://127.0.0.1:${s.port}/api/config`);
      assert.equal((await res.json()).costLimitUsd, 0.5);
      res = await fetch(`http://127.0.0.1:${s.port}/api/state`);
      const state = await res.json();
      assert.ok(state.alerts.some((a) => a.kind === 'runaway_cost'));
      res = await fetch(`http://127.0.0.1:${s.port}/api/kill/planner`, { method:'POST', headers:headers(s.token) });
      assert.equal(res.status, 202);
      assert.match(await readFile(paths.kills, 'utf8'), /planner/);
      res = await fetch(`http://127.0.0.1:${s.port}/api/state`);
      const killed = await res.json();
      assert.equal(killed.agents.find((a) => a.id === 'planner').status, 'killed');
      res = await fetch(`http://127.0.0.1:${s.port}/api/verify`);
      const verify = await res.json();
      assert.equal(verify.ok, true);
    } finally { await s.close(); }
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('HTTP rejects invalid and cross-origin mutations without appending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-http-invalid-'));
  try {
    await initWorkspace(root);
    const paths = workspacePaths(root);
    const s = await startServer({ root, eventsFile: paths.events });
    try {
      const invalidBodies = [
        { type:'not-real', agentId:'a' },
        { type:'cost', agentId:'a', costUsd:null },
        { type:'cost', agentId:'a', costUsd:'x' },
        { type:'cost', agentId:'a', costUsd:-1 },
      ];
      for (const body of invalidBodies) {
        const res = await fetch(`http://127.0.0.1:${s.port}/api/events`, { method:'POST', headers:headers(s.token), body: JSON.stringify(body) });
        assert.equal(res.status, 400);
      }
      let res = await fetch(`http://127.0.0.1:${s.port}/api/events`, { method:'POST', headers:headers(s.token, { origin:'http://evil.example' }), body: JSON.stringify({ type:'agent_started', agentId:'a' }) });
      assert.equal(res.status, 403);
      res = await fetch(`http://127.0.0.1:${s.port}/api/events`, { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ type:'agent_started', agentId:'a' }) });
      assert.equal(res.status, 403);
      assert.equal((await readFile(paths.events, 'utf8')).trim(), '');
    } finally { await s.close(); }
  } finally { await rm(root, { recursive:true, force:true }); }
});


test('HTTP verify returns structured JSON for malformed event logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-http-malformed-'));
  try {
    await initWorkspace(root);
    const paths = workspacePaths(root);
    await writeFile(paths.events, '{bad json}\n');
    const s = await startServer({ root, eventsFile: paths.events });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/verify`);
      assert.equal(res.status, 200);
      const result = await res.json();
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((i) => i.code === 'event_log_parse_failed'));
    } finally { await s.close(); }
  } finally { await rm(root, { recursive:true, force:true }); }
});

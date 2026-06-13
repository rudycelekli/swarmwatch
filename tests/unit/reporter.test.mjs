import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSwarmWatchReporter, parseJsonl } from '../../dist/index.js';

const fixed = () => new Date('2026-06-13T00:00:00.000Z');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('SwarmWatch reporter writes valid builder events to the default workspace file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-reporter-file-'));
  try {
    let n = 0;
    const reporter = createSwarmWatchReporter({ root, agentId:'planner', framework:'demo-agent', now:fixed, id:() => `event-${++n}` });
    await reporter.started('boot');
    await reporter.delegation('coder', 'build the adapter');
    await reporter.tool('inspect_repo', { tokens:12 });
    await reporter.done('ready');
    const events = parseJsonl(await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8'));
    assert.equal(events.length, 4);
    assert.deepEqual(events.map((e) => e.id), ['event-1', 'event-2', 'event-3', 'event-4']);
    assert.equal(events[0].framework, 'demo-agent');
    assert.equal(events[1].targetAgentId, 'coder');
    assert.equal(events[2].tool, 'inspect_repo');
    assert.equal(events[3].status, 'done');
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('SwarmWatch reporter rejects invalid events before appending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-reporter-invalid-'));
  try {
    const reporter = createSwarmWatchReporter({ root, agentId:'planner', now:fixed, id:() => 'bad-cost' });
    await assert.rejects(() => reporter.cost(Number.NaN), /event.costUsd must be a finite non-negative number/);
    assert.equal(existsSync(join(root, '.swarmwatch', 'events.jsonl')), false);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('SwarmWatch reporter posts events to the local HTTP API with the mutation token', async () => {
  const seen = [];
  const srv = await listen(async (req, res) => {
    seen.push({ method:req.method, url:req.url, token:req.headers['x-swarmwatch-token'], body:JSON.parse(await readBody(req)) });
    res.writeHead(201, { 'content-type':'application/json' });
    res.end(JSON.stringify({ ok:true }));
  });
  try {
    const reporter = createSwarmWatchReporter({ agentId:'worker', framework:'demo-agent', url:srv.url, token:'secret', now:fixed, id:() => 'http-1' });
    await reporter.message('hello over HTTP');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, '/api/events');
    assert.equal(seen[0].token, 'secret');
    assert.equal(seen[0].body.id, 'http-1');
    assert.equal(seen[0].body.agentId, 'worker');
    assert.equal(seen[0].body.message, 'hello over HTTP');
  } finally {
    await srv.close();
  }
});

test('SwarmWatch reporter surfaces HTTP API rejection details', async () => {
  const srv = await listen(async (_req, res) => {
    res.writeHead(403, { 'content-type':'application/json' });
    res.end(JSON.stringify({ error:'missing or invalid x-swarmwatch-token' }));
  });
  try {
    const reporter = createSwarmWatchReporter({ agentId:'worker', url:`${srv.url}/api/events`, token:'wrong', now:fixed, id:() => 'http-err' });
    await assert.rejects(() => reporter.started(), /HTTP emit failed with 403.*x-swarmwatch-token/);
  } finally {
    await srv.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEvents } from '../../dist/index.js';

const now = new Date('2026-06-13T00:00:10.000Z');

test('detects circular delegation and runaway cost', () => {
  const state = analyzeEvents([
    { id:'1', ts:'2026-06-13T00:00:00.000Z', type:'delegation', agentId:'a', targetAgentId:'b' },
    { id:'2', ts:'2026-06-13T00:00:01.000Z', type:'delegation', agentId:'b', targetAgentId:'a' },
    { id:'3', ts:'2026-06-13T00:00:02.000Z', type:'cost', agentId:'a', costUsd: 2 }
  ], 'test', { now, costLimitUsd: 1 });
  assert.equal(state.totals.agents, 2);
  assert.ok(state.alerts.some((a) => a.kind === 'circular_delegation'));
  assert.ok(state.alerts.some((a) => a.kind === 'runaway_cost' && a.agentId === 'a'));
});

test('detects started agent with no activity as stuck', () => {
  const state = analyzeEvents([{ id:'1', ts:'2026-06-13T00:00:00.000Z', type:'agent_started', agentId:'idle' }], 'test', { now, stuckMs: 1000, deadMs: 60000 });
  assert.ok(state.alerts.some((a) => a.kind === 'stuck_agent'));
});


test('replay mode suppresses clock-relative stuck/dead alerts while live mode enables them', () => {
  const event = { id:'1', ts:'2026-06-13T00:00:00.000Z', type:'agent_started', agentId:'idle' };
  const replay = analyzeEvents([event], 'test', { now, stuckMs:1000, deadMs:5000, mode:'replay' });
  assert.equal(replay.alerts.some((a) => a.kind === 'stuck_agent' || a.kind === 'dead_agent'), false);
  const live = analyzeEvents([event], 'test', { now, stuckMs:1000, deadMs:5000, mode:'live' });
  assert.ok(live.alerts.some((a) => a.kind === 'dead_agent'));
});

test('operator requests create a pending inbox item and waiting agent until responded', () => {
  const request = {
    id:'ask-1',
    ts:'2026-06-13T00:00:00.000Z',
    type:'operator_request',
    agentId:'coder',
    message:'Approve editing package.json?',
    metadata:{ requestId:'req-1', kind:'approval', priority:'high', choices:['approve','deny'] }
  };
  const pending = analyzeEvents([request], 'test', { now });
  assert.equal(pending.totals.operatorRequests, 1);
  assert.equal(pending.agents.find((a) => a.id === 'coder').status, 'waiting');
  assert.deepEqual(pending.operatorRequests[0].choices, ['approve','deny']);
  const resolved = analyzeEvents([
    request,
    { id:'answer-1', ts:'2026-06-13T00:00:01.000Z', type:'operator_response', agentId:'coder', message:'approved', metadata:{ requestId:'req-1', action:'approve' } }
  ], 'test', { now });
  assert.equal(resolved.totals.operatorRequests, 0);
  assert.equal(resolved.operatorRequests[0].status, 'responded');
  assert.equal(resolved.operatorRequests[0].response.action, 'approve');
});

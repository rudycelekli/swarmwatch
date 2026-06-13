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

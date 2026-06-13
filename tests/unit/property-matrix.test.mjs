import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEvents, assertEvent, digestEvents, makeEvent, parseJsonl, verifyEvents } from '../../dist/index.js';

const baseTs = '2026-06-13T00:00:00.000Z';
const liveNow = new Date('2026-06-13T00:10:00.000Z');

function ev(id, type, agentId, extra = {}) {
  return { id, ts: baseTs, type, agentId, ...extra };
}

function alertKinds(state) {
  return state.alerts.map((a) => a.kind).sort();
}

function deterministicShuffle(items, seed) {
  const out = [...items];
  let x = seed;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const invalidValues = [null, 'x', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1];
for (const [field, type] of [['costUsd', 'cost'], ['tokens', 'cost']]) {
  for (const value of invalidValues) {
    test(`assertEvent rejects invalid ${field}: ${String(value)}`, () => {
      assert.throws(() => assertEvent(ev(`bad-${field}-${String(value)}`, type, 'a', { [field]: value })), /finite non-negative/);
    });
  }
}

for (const type of ['made_up', '', 'agent-started', 'kill']) {
  test(`assertEvent rejects invalid type ${JSON.stringify(type)}`, () => {
    assert.throws(() => assertEvent({ id:'x', ts:baseTs, type, agentId:'a' }), /event.type/);
  });
}

for (const ts of ['not-a-date', '', '2026-99-99T00:00:00Z']) {
  test(`assertEvent rejects invalid timestamp ${JSON.stringify(ts)}`, () => {
    assert.throws(() => assertEvent({ id:'x', ts, type:'agent_started', agentId:'a' }), /event.ts/);
  });
}

for (const field of ['parentId', 'targetAgentId', 'framework', 'message', 'tool', 'status']) {
  test(`assertEvent rejects non-string optional field ${field}`, () => {
    assert.throws(() => assertEvent(ev(`bad-${field}`, 'agent_started', 'a', { [field]: 123 })), new RegExp(`event.${field}`));
  });
}

for (let n = 2; n <= 41; n++) {
  test(`cycle detector finds delegation cycle length ${n}`, () => {
    const events = [];
    for (let i = 0; i < n; i++) events.push(ev(`c-${n}-${i}`, 'delegation', `a${i}`, { targetAgentId: `a${(i + 1) % n}` }));
    const state = analyzeEvents(events, 'cycle', { mode:'replay' });
    assert.ok(alertKinds(state).includes('circular_delegation'));
  });
}

for (let n = 2; n <= 41; n++) {
  test(`cycle detector does not flag DAG length ${n}`, () => {
    const events = [];
    for (let i = 0; i < n - 1; i++) events.push(ev(`d-${n}-${i}`, 'delegation', `a${i}`, { targetAgentId: `a${i + 1}` }));
    const state = analyzeEvents(events, 'dag', { mode:'replay' });
    assert.equal(alertKinds(state).includes('circular_delegation'), false);
  });
}

for (let fanout = 1; fanout <= 40; fanout++) {
  test(`high_fanout fires exactly above limit case ${fanout}`, () => {
    const events = [];
    for (let i = 0; i < fanout; i++) events.push(ev(`f-${fanout}-${i}`, 'delegation', 'root', { targetAgentId: `child-${i}` }));
    const state = analyzeEvents(events, 'fanout', { fanoutLimit: fanout - 1, mode:'replay' });
    assert.ok(alertKinds(state).includes('high_fanout'));
    const alert = state.alerts.find((a) => a.kind === 'high_fanout');
    assert.equal(alert.evidence.count, fanout);
    assert.equal(alert.evidence.limit, fanout - 1);
  });
}

for (let fanout = 1; fanout <= 40; fanout++) {
  test(`high_fanout does not fire at limit case ${fanout}`, () => {
    const events = [];
    for (let i = 0; i < fanout; i++) events.push(ev(`fl-${fanout}-${i}`, 'delegation', 'root', { targetAgentId: `child-${i}` }));
    const state = analyzeEvents(events, 'fanout-limit', { fanoutLimit: fanout, mode:'replay' });
    assert.equal(alertKinds(state).includes('high_fanout'), false);
  });
}

for (let i = 1; i <= 50; i++) {
  test(`runaway_cost threshold invariant ${i}`, () => {
    const under = analyzeEvents([ev(`cu-${i}`, 'cost', 'a', { costUsd: i / 10 })], 'cost', { costLimitUsd: i / 10, mode:'replay' });
    assert.equal(alertKinds(under).includes('runaway_cost'), false);
    const over = analyzeEvents([ev(`co-${i}`, 'cost', 'a', { costUsd: i / 10 + 0.001 })], 'cost', { costLimitUsd: i / 10, mode:'replay' });
    assert.ok(alertKinds(over).includes('runaway_cost'));
  });
}

for (let seed = 1; seed <= 50; seed++) {
  test(`analyzeEvents deterministic under shuffled input seed ${seed}`, () => {
    const events = [
      ev(`s-${seed}-1`, 'agent_started', 'planner'),
      ev(`s-${seed}-2`, 'delegation', 'planner', { targetAgentId:'coder' }),
      ev(`s-${seed}-3`, 'delegation', 'coder', { targetAgentId:'reviewer' }),
      ev(`s-${seed}-4`, 'delegation', 'reviewer', { targetAgentId:'planner' }),
      ev(`s-${seed}-5`, 'cost', 'coder', { costUsd: 2, tokens: 1000 }),
    ];
    const a = analyzeEvents(events, 'ordered', { costLimitUsd:1, mode:'replay' });
    const b = analyzeEvents(deterministicShuffle(events, seed), 'ordered', { costLimitUsd:1, mode:'replay' });
    assert.deepEqual(alertKinds(a), alertKinds(b));
    assert.deepEqual(a.edges, b.edges);
    assert.deepEqual(a.agents, b.agents);
  });
}

for (let seconds = 1; seconds <= 40; seconds++) {
  test(`clock-relative alerts are live-only age ${seconds}s`, () => {
    const event = ev(`idle-${seconds}`, 'agent_started', 'idle', { ts: '2026-06-13T00:00:00.000Z' });
    const now = new Date(Date.parse(event.ts) + seconds * 1000);
    const replay = analyzeEvents([event], 'idle', { now, stuckMs: 1, deadMs: 2, mode:'replay' });
    assert.equal(alertKinds(replay).some((x) => x === 'stuck_agent' || x === 'dead_agent'), false);
    const live = analyzeEvents([event], 'idle', { now, stuckMs: 1, deadMs: 2, mode:'live' });
    assert.ok(alertKinds(live).some((x) => x === 'stuck_agent' || x === 'dead_agent'));
  });
}

for (let i = 1; i <= 30; i++) {
  test(`verifyEvents catches duplicate id matrix ${i}`, () => {
    const result = verifyEvents([ev(`dup-${i}`, 'agent_started', 'a'), ev(`dup-${i}`, 'agent_done', 'a')], 'verify', { mode:'replay' });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === 'duplicate_event_id'));
  });
}

for (let i = 1; i <= 30; i++) {
  test(`digestEvents changes when event payload changes ${i}`, () => {
    const a = [ev(`dig-${i}`, 'agent_message', 'a', { message:`hello-${i}` })];
    const b = [ev(`dig-${i}`, 'agent_message', 'a', { message:`hello-${i + 1}` })];
    assert.notEqual(digestEvents(a), digestEvents(b));
  });
}

for (let i = 1; i <= 20; i++) {
  test(`parseJsonl round-trips event line ${i}`, () => {
    const event = makeEvent({ type:'agent_message', agentId:`a-${i}`, ts:baseTs, message:`m-${i}` });
    assert.deepEqual(parseJsonl(JSON.stringify(event) + '\n'), [event]);
  });
}

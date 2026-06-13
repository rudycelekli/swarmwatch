import test from 'node:test';
import assert from 'node:assert/strict';
import { importEvents, verifyEvents } from '../../dist/index.js';

test('verify catches duplicate ids as an integrity error', () => {
  const result = verifyEvents([
    { id:'same', ts:'2026-06-13T00:00:00.000Z', type:'agent_started', agentId:'a' },
    { id:'same', ts:'2026-06-13T00:00:01.000Z', type:'agent_done', agentId:'a' }
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'duplicate_event_id'));
});

test('langgraph and claude transcript importers convert external traces to SwarmEvents', async () => {
  const lang = await importEvents({ adapter:'langgraph', file:'tests/fixtures/langgraph.jsonl' });
  assert.equal(lang.length, 3);
  assert.equal(lang[0].framework, 'langgraph');
  const claude = await importEvents({ adapter:'claude-transcript', file:'tests/fixtures/claude-transcript.jsonl' });
  assert.equal(claude.length, 2);
  assert.equal(claude[0].framework, 'claude-code');
});

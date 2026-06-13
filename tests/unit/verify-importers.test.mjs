import test from 'node:test';
import assert from 'node:assert/strict';
import { importEvents, parseConfig, verifyEvents } from '../../dist/index.js';

test('verify catches duplicate ids as an integrity error', () => {
  const result = verifyEvents([
    { id:'same', ts:'2026-06-13T00:00:00.000Z', type:'agent_started', agentId:'a' },
    { id:'same', ts:'2026-06-13T00:00:01.000Z', type:'agent_done', agentId:'a' }
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'duplicate_event_id'));
});

test('config parser rejects negative thresholds', () => {
  const cfg = parseConfig({ costLimitUsd:-1, stuckMs:-1, deadMs:-1, fanoutLimit:-1 });
  assert.equal(cfg.costLimitUsd, 5);
  assert.equal(cfg.stuckMs, 300000);
});

test('langgraph and claude transcript importers convert external traces without raw private data by default', async () => {
  const lang = await importEvents({ adapter:'langgraph', file:'tests/fixtures/langgraph.jsonl' });
  assert.equal(lang.length, 3);
  assert.equal(lang[0].framework, 'langgraph');
  assert.equal('raw' in lang[0].metadata, false);
  const claude = await importEvents({ adapter:'claude-transcript', file:'tests/fixtures/claude-transcript.jsonl' });
  assert.equal(claude.length, 2);
  assert.equal(claude[0].framework, 'claude-code');
  assert.equal(claude[0].message, 'assistant');
  assert.equal('raw' in claude[0].metadata, false);
  assert.doesNotMatch(JSON.stringify(claude), /I will spawn a coder/);
});

test('raw/text transcript import is explicit', async () => {
  const claude = await importEvents({ adapter:'claude-transcript', file:'tests/fixtures/claude-transcript.jsonl', includeRaw:true, includeText:true });
  assert.match(claude[0].message, /spawn a coder/);
  assert.ok(claude[0].metadata.raw);
});

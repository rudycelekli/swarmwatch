import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportOtel, flattenOtelSpans, importEvents, importOtelEvents } from '../../dist/index.js';

test('OpenInference/OTel importer maps spans to SwarmWatch events with parent topology', async () => {
  const events = await importEvents({ adapter:'openinference', file:'tests/fixtures/openinference-otel.json' });
  assert.equal(events.length, 2);
  assert.equal(events[0].agentId, 'planner');
  assert.equal(events[1].type, 'tool_call');
  assert.equal(events[1].parentId, 'planner');
  assert.equal(events[1].metadata.parentSpanId, 'aaaaaaaaaaaaaaaa');
  assert.equal(events[1].tool, 'get_repo');
  assert.equal(events[1].costUsd, 1.25);
  assert.equal(events[1].tokens, 1000);
});

test('OpenInference/OTel importer sums split prompt/completion token attributes', () => {
  const events = importOtelEvents({ spans:[{
    traceId:'22222222222222222222222222222222',
    spanId:'cccccccccccccccc',
    name:'llm',
    attributes:[
      { key:'openinference.span.kind', value:{ stringValue:'LLM' } },
      { key:'swarmwatch.agent.id', value:{ stringValue:'planner' } },
      { key:'gen_ai.usage.input_tokens', value:{ intValue:12 } },
      { key:'gen_ai.usage.output_tokens', value:{ intValue:30 } }
    ]
  }] }, 'tokens');
  assert.equal(events[0].tokens, 42);
});

test('OTel importer supports raw span arrays', async () => {
  const raw = JSON.parse(await readFile('tests/fixtures/openinference-otel.json', 'utf8'));
  const spans = flattenOtelSpans(raw);
  const events = importOtelEvents(spans, 'array');
  assert.equal(events.length, 2);
  assert.equal(events[1].framework, 'openinference');
});

test('OTel importer flattens arrays of OTLP envelopes such as file-exporter JSONL', async () => {
  const raw = JSON.parse(await readFile('tests/fixtures/openinference-otel.json', 'utf8'));
  const events = importOtelEvents([raw, raw], 'jsonl');
  assert.equal(events.length, 4);
  assert.equal(events[3].parentId, 'planner');
});

test('OTel importer stores raw spans only when includeRaw is explicit', async () => {
  const redacted = await importEvents({ adapter:'otel', file:'tests/fixtures/openinference-otel.json' });
  const raw = await importEvents({ adapter:'otel', file:'tests/fixtures/openinference-otel.json', includeRaw:true });
  assert.equal(redacted[0].metadata.raw, undefined);
  assert.ok(raw[0].metadata.raw);
});

test('OTel importer stores model output text only when includeText is explicit', () => {
  const raw = { spans:[{ spanId:'dddddddddddddddd', name:'llm-call', attributes:[
    { key:'openinference.span.kind', value:{ stringValue:'LLM' } },
    { key:'swarmwatch.agent.id', value:{ stringValue:'planner' } },
    { key:'span.output.value', value:{ stringValue:'secret answer' } }
  ] }] };
  assert.equal(importOtelEvents(raw, 'privacy')[0].message, 'llm-call');
  assert.equal(importOtelEvents(raw, 'privacy', false, true)[0].message, 'secret answer');
});

test('OTel importEventObjects accepts one OTLP envelope object for live JSONL lines', async () => {
  const raw = JSON.parse(await readFile('tests/fixtures/openinference-otel.json', 'utf8'));
  const { importEventObjects } = await import('../../dist/index.js');
  const events = importEventObjects('otel', [raw], 'line');
  assert.equal(events.length, 2);
  assert.equal(events[1].parentId, 'planner');
});

test('exportOtel emits OTLP-style resourceSpans with SwarmWatch attributes', () => {
  const exported = exportOtel([
    { id:'1', ts:'2026-06-13T00:00:00.000Z', type:'agent_message', agentId:'planner', message:'hello' },
    { id:'2', ts:'2026-06-13T00:00:01.000Z', type:'tool_call', agentId:'coder', parentId:'planner', tool:'edit', costUsd:0.5, tokens:42 }
  ]);
  const spans = exported.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, 2);
  assert.ok(spans[0].attributes.some((a) => a.key === 'swarmwatch.agent.id'));
  assert.ok(spans[1].attributes.some((a) => a.key === 'swarmwatch.cost_usd'));
  assert.equal(spans[1].parentSpanId, spans[0].spanId);
});

test('exportOtel preserves imported trace and span identifiers when present', () => {
  const exported = exportOtel([
    { id:'otel-aaaaaaaaaaaaaaaa', ts:'2026-06-13T00:00:00.000Z', type:'agent_message', agentId:'planner', metadata:{ traceId:'11111111111111111111111111111111', spanId:'aaaaaaaaaaaaaaaa' } },
    { id:'otel-bbbbbbbbbbbbbbbb', ts:'2026-06-13T00:00:01.000Z', type:'tool_call', agentId:'coder', parentId:'planner', metadata:{ traceId:'11111111111111111111111111111111', spanId:'bbbbbbbbbbbbbbbb' } },
    { id:'native', ts:'2026-06-13T00:00:02.000Z', type:'agent_message', agentId:'reviewer' }
  ]);
  const spans = exported.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans[0].traceId, '11111111111111111111111111111111');
  assert.equal(spans[0].spanId, 'aaaaaaaaaaaaaaaa');
  assert.equal(spans[1].parentSpanId, 'aaaaaaaaaaaaaaaa');
  assert.match(spans[2].traceId, /^[a-f0-9]{32}$/);
});

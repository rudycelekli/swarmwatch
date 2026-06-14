import { createHash } from 'node:crypto';
import { makeEvent } from '../core/event.js';
import type { SwarmEvent } from '../core/types.js';

type AttrValue = { stringValue?: string; intValue?: number | string; doubleValue?: number; boolValue?: boolean; arrayValue?: unknown; kvlistValue?: unknown };
type OTelAttr = { key: string; value: AttrValue | string | number | boolean | null };
type OTelSpan = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OTelAttr[] | Record<string, unknown>;
  status?: { code?: number | string; message?: string };
};

function hashHex(input: string, len: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, len);
}

function attrValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as AttrValue;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return typeof v.intValue === 'string' ? Number(v.intValue) : v.intValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  return value;
}

function attrs(input: OTelSpan['attributes']): Record<string, unknown> {
  if (!input) return {};
  if (Array.isArray(input)) return Object.fromEntries(input.map((a) => [a.key, attrValue(a.value)]));
  return input;
}

function nsToIso(value: unknown, fallbackIndex: number): string {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (Number.isFinite(n) && n > 0) return new Date(Math.floor(n / 1_000_000)).toISOString();
  return new Date(fallbackIndex).toISOString();
}

function numberAttr(a: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === 'string' && Number.isFinite(Number(v)) && Number(v) >= 0) return Number(v);
  }
  return undefined;
}

function summedNumberAttr(a: Record<string, unknown>, exactKeys: string[], additiveKeys: string[]): number | undefined {
  const exact = numberAttr(a, exactKeys);
  if (exact !== undefined) return exact;
  let total = 0;
  let seen = false;
  for (const k of additiveKeys) {
    const v = numberAttr(a, [k]);
    if (v !== undefined) { total += v; seen = true; }
  }
  return seen ? total : undefined;
}

function stringAttr(a: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) if (typeof a[k] === 'string' && a[k]) return String(a[k]);
  return undefined;
}

export function flattenOtelSpans(raw: unknown): OTelSpan[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      if ('resourceSpans' in item || 'spans' in item) return flattenOtelSpans(item);
      if ('spanId' in item || 'name' in item || 'attributes' in item || 'startTimeUnixNano' in item) return [item as OTelSpan];
      return [];
    });
  }
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  if (Array.isArray(root.spans)) return root.spans as OTelSpan[];
  const out: OTelSpan[] = [];
  for (const rs of Array.isArray(root.resourceSpans) ? root.resourceSpans as any[] : []) {
    for (const ss of Array.isArray(rs.scopeSpans) ? rs.scopeSpans : []) {
      for (const span of Array.isArray(ss.spans) ? ss.spans : []) out.push(span);
    }
  }
  return out;
}

export function importOtelEvents(raw: unknown, source = 'otel', includeRaw = false, includeText = false): SwarmEvent[] {
  const spans = flattenOtelSpans(raw);
  const spanAgents = new Map<string, string>();
  for (const [i, span] of spans.entries()) {
    const a = attrs(span.attributes);
    const agentId = stringAttr(a, ['swarmwatch.agent.id', 'gen_ai.agent.name', 'agent.name', 'openinference.agent.name']) ?? span.name ?? `span-${i}`;
    if (span.spanId) spanAgents.set(span.spanId, agentId);
  }
  return spans.map((span, i) => {
    const a = attrs(span.attributes);
    const kind = String(a['openinference.span.kind'] ?? a['gen_ai.operation.name'] ?? '').toUpperCase();
    const explicitType = stringAttr(a, ['swarmwatch.event.type']);
    const statusCode = typeof span.status?.code === 'string' ? Number(span.status.code) : span.status?.code;
    const type = explicitType === 'agent_started' || explicitType === 'agent_heartbeat' || explicitType === 'agent_message' || explicitType === 'tool_call' || explicitType === 'cost' || explicitType === 'delegation' || explicitType === 'agent_done' || explicitType === 'agent_error' || explicitType === 'kill_requested' || explicitType === 'operator_request' || explicitType === 'operator_response'
      ? explicitType
      : statusCode === 2 ? 'agent_error'
      : kind === 'TOOL' ? 'tool_call'
      : kind === 'AGENT' || kind === 'CHAIN' ? 'agent_message'
      : 'agent_message';
    const agentId = stringAttr(a, ['swarmwatch.agent.id', 'gen_ai.agent.name', 'agent.name', 'openinference.agent.name']) ?? span.name ?? `span-${i}`;
    const parentId = span.parentSpanId ? spanAgents.get(span.parentSpanId) : undefined;
    const tokens = summedNumberAttr(a,
      ['swarmwatch.tokens', 'llm.token_count.total', 'gen_ai.usage.total_tokens'],
      ['gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'llm.token_count.prompt', 'llm.token_count.completion']);
    const costUsd = numberAttr(a, ['swarmwatch.cost_usd', 'gen_ai.usage.cost_usd', 'gen_ai.usage.cost', 'llm.cost.total', 'total_cost']);
    const tool = stringAttr(a, ['swarmwatch.tool', 'tool.name', 'gen_ai.tool.name']);
    const targetAgentId = stringAttr(a, ['swarmwatch.target_agent.id', 'agent.target.name', 'openinference.target_agent.name']);
    const message = stringAttr(a, ['swarmwatch.message'])
      ?? (includeText ? stringAttr(a, ['span.output.value', 'output.value', 'llm.output_messages.0.message.content']) : undefined)
      ?? span.name
      ?? type;
    return makeEvent({
      id: `otel-${span.spanId ?? hashHex(`${source}-${i}-${span.name ?? ''}`, 16)}`,
      ts: nsToIso(span.startTimeUnixNano, i),
      type,
      agentId,
      parentId,
      targetAgentId,
      framework: 'openinference',
      tool,
      tokens,
      costUsd,
      status: statusCode === 2 ? 'error' : undefined,
      message,
      metadata: includeRaw
        ? { source, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId, raw: span }
        : { source, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId },
    });
  });
}

function value(v: unknown): AttrValue {
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  return { stringValue: String(v) };
}

export function exportOtel(events: SwarmEvent[]): Record<string, unknown> {
  const fallbackTraceId = hashHex(events.map((e) => e.id).join('\n') || 'swarmwatch-empty', 32);
  const validTraceId = (v: unknown) => typeof v === 'string' && /^[a-fA-F0-9]{32}$/.test(v) ? v : undefined;
  const validSpanId = (v: unknown) => typeof v === 'string' && /^[a-fA-F0-9]{16}$/.test(v) ? v : undefined;
  const eventSpanId = (e: SwarmEvent) => validSpanId(e.metadata?.spanId) ?? hashHex(e.id, 16);
  const firstSpanByAgent = new Map<string, string>();
  for (const e of events) if (!firstSpanByAgent.has(e.agentId)) firstSpanByAgent.set(e.agentId, eventSpanId(e));
  const spans = events.map((e) => {
    const traceId = validTraceId(e.metadata?.traceId) ?? fallbackTraceId;
    const spanId = eventSpanId(e);
    const parentSpanId = validSpanId(e.metadata?.parentSpanId)
      ?? (e.parentId ? (firstSpanByAgent.get(e.parentId) ?? hashHex(e.parentId, 16)) : undefined);
    const attributes: OTelAttr[] = [
      { key: 'openinference.span.kind', value: value(e.type === 'tool_call' ? 'TOOL' : 'AGENT') },
      { key: 'swarmwatch.event.type', value: value(e.type) },
      { key: 'swarmwatch.agent.id', value: value(e.agentId) },
    ];
    if (e.parentId) attributes.push({ key: 'swarmwatch.parent.id', value: value(e.parentId) });
    if (e.targetAgentId) attributes.push({ key: 'swarmwatch.target_agent.id', value: value(e.targetAgentId) });
    if (e.tool) attributes.push({ key: 'swarmwatch.tool', value: value(e.tool) });
    if (e.tokens !== undefined) attributes.push({ key: 'swarmwatch.tokens', value: value(e.tokens) });
    if (e.costUsd !== undefined) attributes.push({ key: 'swarmwatch.cost_usd', value: value(e.costUsd) });
    if (e.message) attributes.push({ key: 'swarmwatch.message', value: value(e.message) });
    return {
      traceId,
      spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      name: `${e.type}:${e.agentId}`,
      startTimeUnixNano: String(Date.parse(e.ts) * 1_000_000),
      endTimeUnixNano: String(Date.parse(e.ts) * 1_000_000),
      attributes,
    };
  });
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'swarmwatch' } }] },
      scopeSpans: [{ scope: { name: 'swarmwatch', version: '0.1.0' }, spans }],
    }],
  };
}

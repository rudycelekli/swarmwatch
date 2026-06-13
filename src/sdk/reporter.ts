import { appendEvent, workspacePaths } from '../core/store.js';
import { assertEvent, makeEvent } from '../core/event.js';
import type { SwarmEvent, SwarmEventType } from '../core/types.js';

type FetchResponseLike = { ok: boolean; status: number; text: () => Promise<string> };
type FetchLike = (input: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponseLike>;

export interface SwarmWatchReporterOptions {
  /** Default agent id attached to events emitted through helper methods. */
  agentId: string;
  /** Framework or integration name stored on emitted events. */
  framework?: string;
  /** Workspace root used when file is omitted. Defaults to process.cwd(). */
  root?: string;
  /** JSONL event file. If omitted and url is omitted, writes to .swarmwatch/events.jsonl under root. */
  file?: string;
  /** Dashboard/API base URL or full /api/events URL for HTTP emission. */
  url?: string;
  /** Required when url is set; sent as x-swarmwatch-token. */
  token?: string;
  /** Injectable fetch for tests/nonstandard runtimes. Defaults to global fetch. */
  fetch?: FetchLike;
  /** Injectable clock for tests. */
  now?: () => Date | string;
  /** Injectable id factory for tests. */
  id?: () => string;
}

export type ReporterEventInput = Partial<Omit<SwarmEvent, 'type'>> & { type: SwarmEventType; agentId?: string };
export type ReporterEventExtras = Partial<Omit<SwarmEvent, 'id' | 'ts' | 'type' | 'agentId' | 'framework'>>;

function nowIso(clock?: () => Date | string): string | undefined {
  if (!clock) return undefined;
  const value = clock();
  return value instanceof Date ? value.toISOString() : value;
}

function eventEndpoint(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('SwarmWatch reporter url must be non-empty');
  return trimmed.endsWith('/api/events') ? trimmed : `${trimmed.replace(/\/+$/, '')}/api/events`;
}

function globalFetch(): FetchLike {
  const f = globalThis.fetch as unknown as FetchLike | undefined;
  if (!f) throw new Error('SwarmWatch reporter HTTP transport requires fetch; pass opts.fetch in this runtime');
  return f;
}

export class SwarmWatchReporter {
  private readonly opts: SwarmWatchReporterOptions;

  constructor(opts: SwarmWatchReporterOptions) {
    if (!opts.agentId) throw new Error('SwarmWatch reporter requires agentId');
    this.opts = opts;
  }

  async event(input: ReporterEventInput): Promise<SwarmEvent> {
    const eventInput: Partial<SwarmEvent> & { type: SwarmEventType; agentId: string } = {
      ...input,
      type: input.type,
      agentId: input.agentId ?? this.opts.agentId,
      framework: input.framework ?? this.opts.framework ?? 'swarmwatch-sdk',
    };
    const id = input.id ?? this.opts.id?.();
    const ts = input.ts ?? nowIso(this.opts.now);
    if (id !== undefined) eventInput.id = id;
    else delete eventInput.id;
    if (ts !== undefined) eventInput.ts = ts;
    else delete eventInput.ts;
    const event = assertEvent(makeEvent(eventInput));
    await this.emit(event);
    return event;
  }

  started(message?: string, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'agent_started', message: message ?? extras.message });
  }

  heartbeat(message?: string, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'agent_heartbeat', message: message ?? extras.message });
  }

  message(message: string, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'agent_message', message });
  }

  tool(tool: string, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'tool_call', tool });
  }

  cost(costUsd: number, tokens?: number, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'cost', costUsd, tokens: tokens ?? extras.tokens });
  }

  delegation(targetAgentId: string, message?: string, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'delegation', targetAgentId, message: message ?? extras.message });
  }

  done(message?: string, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'agent_done', status: 'done', message: message ?? extras.message });
  }

  error(message: string, extras: ReporterEventExtras = {}): Promise<SwarmEvent> {
    return this.event({ ...extras, type: 'agent_error', status: 'error', message });
  }

  private async emit(event: SwarmEvent): Promise<void> {
    const writes: Promise<void>[] = [];
    if (this.opts.file || !this.opts.url) writes.push(appendEvent(this.opts.file ?? workspacePaths(this.opts.root).events, event));
    if (this.opts.url) writes.push(this.emitHttp(event));
    await Promise.all(writes);
  }

  private async emitHttp(event: SwarmEvent): Promise<void> {
    if (!this.opts.url) return;
    if (!this.opts.token) throw new Error('SwarmWatch reporter HTTP transport requires token');
    const fetchImpl = this.opts.fetch ?? globalFetch();
    const res = await fetchImpl(eventEndpoint(this.opts.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-swarmwatch-token': this.opts.token },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SwarmWatch reporter HTTP emit failed with ${res.status}${body ? `: ${body}` : ''}`);
    }
  }
}

export function createSwarmWatchReporter(opts: SwarmWatchReporterOptions): SwarmWatchReporter {
  return new SwarmWatchReporter(opts);
}

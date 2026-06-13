import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { analyzeEvents } from '../core/analyze.js';
import { appendEvent, appendKill, initWorkspace, readEvents, workspacePaths } from '../core/store.js';
import { assertEvent, makeEvent } from '../core/event.js';
import { dashboardHtml } from './html.js';
import type { AnalyzeOptions, SwarmEvent } from '../core/types.js';

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}
function send(res: ServerResponse, code: number, data: unknown, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
  res.end(type === 'application/json' ? JSON.stringify(data, null, 2) : String(data));
}

export interface ServeOptions { root?: string; eventsFile?: string; port?: number; analyze?: AnalyzeOptions }

export async function startServer(opts: ServeOptions = {}): Promise<{ port: number; close: () => Promise<void>; server: http.Server }> {
  const root = opts.root ?? process.cwd();
  await initWorkspace(root);
  const eventsFile = opts.eventsFile ?? workspacePaths(root).events;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'OPTIONS') return send(res, 204, {});
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, dashboardHtml(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'swarmwatch' });
      if (req.method === 'GET' && url.pathname === '/api/events') return send(res, 200, await readEvents(eventsFile));
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, analyzeEvents(await readEvents(eventsFile), eventsFile, opts.analyze));
      if (req.method === 'POST' && url.pathname === '/api/events') {
        const raw = await body(req);
        const event = assertEvent({ ...makeEvent(raw as Partial<SwarmEvent> & { type: SwarmEvent['type']; agentId: string }), ...(raw as object) });
        await appendEvent(eventsFile, event);
        return send(res, 201, event);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/kill/')) {
        const agentId = decodeURIComponent(url.pathname.slice('/api/kill/'.length));
        const event = makeEvent({ type: 'kill_requested', agentId, status: 'killed', message: 'operator requested kill', framework: 'swarmwatch' });
        await appendEvent(eventsFile, event); await appendKill(root, agentId);
        return send(res, 202, { ok: true, agentId, event });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, JSON.parse(await readFile(workspacePaths(root).config, 'utf8')));
      return send(res, 404, { error: 'not found' });
    } catch (err) { return send(res, 500, { error: (err as Error).message }); }
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : Number(opts.port ?? 0);
  return { port, server, close: () => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())) };
}

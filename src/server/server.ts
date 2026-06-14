import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { appendEvent, initWorkspace, workspacePaths } from '../core/store.js';
import { assertEvent, makeEvent } from '../core/event.js';
import { loadObservedEvents, loadObservedState, requestKill, respondOperator, verifyObserved } from '../core/runtime.js';
import { dashboardHtml } from './html.js';
import type { AnalyzeOptions, SwarmEvent } from '../core/types.js';

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function send(req: IncomingMessage, res: ServerResponse, code: number, data: unknown, type = 'application/json') {
  const headers: Record<string, string> = { 'content-type': type };
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host && origin === `http://${host}`) headers['access-control-allow-origin'] = origin;
  res.writeHead(code, headers);
  res.end(type === 'application/json' ? JSON.stringify(data, null, 2) : String(data));
}

function sendError(req: IncomingMessage, res: ServerResponse, code: number, message: string) {
  return send(req, res, code, { error: message });
}

function assertMutationAllowed(req: IncomingMessage, token: string) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host && origin !== `http://${host}`) throw Object.assign(new Error('cross-origin mutation rejected'), { statusCode: 403 });
  if (req.headers['x-swarmwatch-token'] !== token) throw Object.assign(new Error('missing or invalid x-swarmwatch-token'), { statusCode: 403 });
}

export interface ServeOptions { root?: string; eventsFile?: string; port?: number; analyze?: AnalyzeOptions; token?: string }

export async function startServer(opts: ServeOptions = {}): Promise<{ port: number; close: () => Promise<void>; server: http.Server; token: string }> {
  const root = opts.root ?? process.cwd();
  await initWorkspace(root);
  const eventsFile = opts.eventsFile ?? workspacePaths(root).events;
  const token = opts.token ?? randomBytes(16).toString('hex');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'OPTIONS') return send(req, res, 204, {});
      if (req.method === 'GET' && url.pathname === '/') return send(req, res, 200, dashboardHtml(token), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/health') return send(req, res, 200, { ok: true, service: 'swarmwatch' });
      if (req.method === 'GET' && url.pathname === '/api/events') return send(req, res, 200, await loadObservedEvents(root, eventsFile));
      if (req.method === 'GET' && url.pathname === '/api/verify') return send(req, res, 200, await verifyObserved(root, eventsFile));
      if (req.method === 'GET' && url.pathname === '/api/state') return send(req, res, 200, await loadObservedState(root, eventsFile));
      if (req.method === 'GET' && url.pathname === '/api/config') return send(req, res, 200, JSON.parse(await readFile(workspacePaths(root).config, 'utf8')));
      if (req.method === 'POST' && url.pathname === '/api/events') {
        assertMutationAllowed(req, token);
        const raw = await body(req);
        const event = assertEvent({ ...makeEvent(raw as Partial<SwarmEvent> & { type: SwarmEvent['type']; agentId: string }), ...(raw as object) });
        await appendEvent(eventsFile, event);
        return send(req, res, 201, event);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/kill/')) {
        assertMutationAllowed(req, token);
        const agentId = decodeURIComponent(url.pathname.slice('/api/kill/'.length));
        const event = await requestKill(root, eventsFile, agentId, 'operator requested kill');
        return send(req, res, 202, { ok: true, agentId, event });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/operator/')) {
        assertMutationAllowed(req, token);
        const requestId = decodeURIComponent(url.pathname.slice('/api/operator/'.length));
        const raw = await body(req) as { response?: unknown; action?: unknown };
        const response = typeof raw.response === 'string' ? raw.response : '';
        const action = typeof raw.action === 'string' && raw.action ? raw.action : 'respond';
        const event = await respondOperator(root, eventsFile, requestId, response, action);
        return send(req, res, 202, { ok: true, requestId, event });
      }
      return sendError(req, res, 404, 'not found');
    } catch (err) {
      const code = typeof (err as { statusCode?: unknown }).statusCode === 'number' ? (err as { statusCode: number }).statusCode : 400;
      return sendError(req, res, code, (err as Error).message);
    }
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : Number(opts.port ?? 0);
  return { port, server, token, close: () => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())) };
}

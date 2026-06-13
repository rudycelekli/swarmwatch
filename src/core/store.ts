import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertEvent, parseJsonl } from './event.js';
import type { SwarmEvent } from './types.js';

export const WORKSPACE_DIR = '.swarmwatch';
export const EVENTS_FILE = 'events.jsonl';
export const KILLS_FILE = 'kills.jsonl';

export function workspacePaths(root = process.cwd()) {
  const dir = resolve(root, WORKSPACE_DIR);
  return { dir, events: join(dir, EVENTS_FILE), kills: join(dir, KILLS_FILE), config: join(dir, 'config.json') };
}

export async function initWorkspace(root = process.cwd()): Promise<ReturnType<typeof workspacePaths>> {
  const paths = workspacePaths(root);
  await mkdir(paths.dir, { recursive: true });
  if (!existsSync(paths.events)) await writeFile(paths.events, '', 'utf8');
  if (!existsSync(paths.kills)) await writeFile(paths.kills, '', 'utf8');
  if (!existsSync(paths.config)) {
    await writeFile(paths.config, JSON.stringify({ costLimitUsd: 5, stuckMs: 300000, deadMs: 900000, fanoutLimit: 6 }, null, 2) + '\n');
  }
  return paths;
}

export async function readEvents(file: string): Promise<SwarmEvent[]> {
  if (!existsSync(file)) return [];
  return parseJsonl(await readFile(file, 'utf8'));
}

export async function appendEvent(file: string, event: SwarmEvent): Promise<void> {
  assertEvent(event);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(event) + '\n', 'utf8');
}

export async function appendKill(root: string, agentId: string, reason = 'operator-request'): Promise<void> {
  const paths = await initWorkspace(root);
  await appendFile(paths.kills, JSON.stringify({ ts: new Date().toISOString(), agentId, reason }) + '\n', 'utf8');
}

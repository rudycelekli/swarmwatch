import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SwarmWatchConfig {
  costLimitUsd: number;
  stuckMs: number;
  deadMs: number;
  fanoutLimit: number;
}

export const DEFAULT_CONFIG: SwarmWatchConfig = {
  costLimitUsd: 5,
  stuckMs: 300_000,
  deadMs: 900_000,
  fanoutLimit: 6,
};

export function parseConfig(value: unknown): SwarmWatchConfig {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    costLimitUsd: typeof v.costLimitUsd === 'number' && Number.isFinite(v.costLimitUsd) ? v.costLimitUsd : DEFAULT_CONFIG.costLimitUsd,
    stuckMs: typeof v.stuckMs === 'number' && Number.isFinite(v.stuckMs) ? v.stuckMs : DEFAULT_CONFIG.stuckMs,
    deadMs: typeof v.deadMs === 'number' && Number.isFinite(v.deadMs) ? v.deadMs : DEFAULT_CONFIG.deadMs,
    fanoutLimit: typeof v.fanoutLimit === 'number' && Number.isFinite(v.fanoutLimit) ? v.fanoutLimit : DEFAULT_CONFIG.fanoutLimit,
  };
}

export async function loadConfig(file: string): Promise<SwarmWatchConfig> {
  if (!existsSync(file)) return DEFAULT_CONFIG;
  return parseConfig(JSON.parse(await readFile(file, 'utf8')));
}

export async function saveDefaultConfig(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  if (!existsSync(file)) await writeFile(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
}

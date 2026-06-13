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

function nonNegative(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function parseConfig(value: unknown): SwarmWatchConfig {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    costLimitUsd: nonNegative(v.costLimitUsd, DEFAULT_CONFIG.costLimitUsd),
    stuckMs: nonNegative(v.stuckMs, DEFAULT_CONFIG.stuckMs),
    deadMs: nonNegative(v.deadMs, DEFAULT_CONFIG.deadMs),
    fanoutLimit: nonNegative(v.fanoutLimit, DEFAULT_CONFIG.fanoutLimit),
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

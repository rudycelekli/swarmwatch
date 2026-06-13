#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { analyzeEvents, parseJsonl } from '../dist/index.js';

const events = parseJsonl(await readFile(new URL('../examples/seed-session.jsonl', import.meta.url), 'utf8'));
const started = performance.now();
const state = analyzeEvents(events, 'examples/seed-session.jsonl', { costLimitUsd: 1, now: new Date('2026-06-13T00:00:10.000Z') });
const measuredMs = performance.now() - started;
const alerts = state.alerts.map((a) => a.kind);
const pass = alerts.includes('circular_delegation') && alerts.includes('runaway_cost') && measuredMs < 50;
const report = {
  claim: 'seeded circular delegation and runaway cost are detected from replayed swarm events',
  baseline: 'post-hoc manual trace review',
  dataset: 'examples/seed-session.jsonl',
  metric: 'seeded-failure detection in one local analysis pass under a 50ms latency budget',
  latencyBudgetMs: 50,
  alerts,
  pass,
  note: 'Wall-clock timing is printed by the bench command and intentionally not persisted because it is machine-dependent.'
};
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./results/report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, measuredMs }, null, 2));
if (!pass) process.exit(1);

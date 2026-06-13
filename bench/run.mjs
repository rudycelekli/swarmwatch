#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { analyzeEvents, parseJsonl } from '../dist/index.js';

const events = parseJsonl(await readFile(new URL('../examples/seed-session.jsonl', import.meta.url), 'utf8'));
const started = performance.now();
const report = analyzeEvents(events, 'examples/seed-session.jsonl', { costLimitUsd: 1, now: new Date('2026-06-13T00:00:10.000Z') });
const elapsedMs = performance.now() - started;
const out = { claim: 'seeded circular delegation and runaway cost are detected from replayed swarm events', baseline: 'post-hoc manual trace review', dataset: 'examples/seed-session.jsonl', metric: 'detection latency in analysis pass', elapsedMs, alerts: report.alerts.map((a) => a.kind), pass: report.alerts.some((a) => a.kind === 'circular_delegation') && report.alerts.some((a) => a.kind === 'runaway_cost') };
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./results/report.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
if (!out.pass) process.exit(1);

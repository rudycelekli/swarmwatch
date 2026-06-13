#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { analyzeEvents, parseJsonl } from '../dist/index.js';

const checkOnly = process.argv.includes('--check');
const iterationsArg = process.argv.find((a) => a.startsWith('--iterations='));
const iterations = iterationsArg ? Number(iterationsArg.split('=')[1]) : 25;
const file = new URL('../examples/seed-session.jsonl', import.meta.url);
const raw = await readFile(file, 'utf8');
const datasetSha256 = createHash('sha256').update(raw).digest('hex');
const events = parseJsonl(raw);
const expectedAlerts = ['circular_delegation', 'runaway_cost'];
const latencies = [];
let state;
for (let i = 0; i < iterations; i++) {
  const started = performance.now();
  state = analyzeEvents(events, 'examples/seed-session.jsonl', { costLimitUsd: 1, now: new Date('2026-06-13T00:00:10.000Z'), mode: 'replay' });
  latencies.push(performance.now() - started);
}
const actualAlerts = [...new Set(state.alerts.map((a) => a.kind))].sort();
const falseNegatives = expectedAlerts.filter((a) => !actualAlerts.includes(a));
const falsePositives = actualAlerts.filter((a) => !expectedAlerts.includes(a));
const sorted = [...latencies].sort((a, b) => a - b);
const meanLatencyMs = sorted.reduce((a, b) => a + b, 0) / sorted.length;
const p95LatencyMs = sorted[Math.ceil(sorted.length * 0.95) - 1];
const latencyBudgetMs = 50;
let gitSha = 'unknown';
try { gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const report = {
  schemaVersion: 1,
  claim: 'seeded circular delegation and runaway cost are detected from replayed swarm events',
  benchmarkKind: 'fixture replay smoke benchmark',
  baseline: {
    name: 'post-hoc manual trace review',
    command: 'inspect examples/seed-session.jsonl after the run',
    result: 'no live alarm surface; detection requires human review after capture'
  },
  delta: 'SwarmWatch emits both expected alarms during the local analysis pass; the baseline has no live endpoint to query.',
  dataset: 'examples/seed-session.jsonl',
  datasetSha256,
  expectedAlerts: expectedAlerts.sort(),
  actualAlerts,
  falsePositives,
  falseNegatives,
  iterations,
  latencyBudgetMs,
  meanLatencyMs: Number(meanLatencyMs.toFixed(3)),
  p95LatencyMs: Number(p95LatencyMs.toFixed(3)),
  gitSha,
  nodeVersion: process.version,
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  pass: falseNegatives.length === 0 && falsePositives.length === 0 && p95LatencyMs < latencyBudgetMs,
  note: 'This is a deterministic fixture replay benchmark, not a real-world agent-behavior study.'
};
const required = ['schemaVersion','benchmarkKind','datasetSha256','expectedAlerts','actualAlerts','falsePositives','falseNegatives','iterations','meanLatencyMs','p95LatencyMs','baseline','delta','gitSha','nodeVersion','os','pass'];
for (const key of required) if (!(key in report)) throw new Error(`missing report field ${key}`);
if (!checkOnly) {
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(new URL('./results/report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);

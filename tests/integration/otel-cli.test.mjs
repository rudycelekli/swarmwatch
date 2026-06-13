import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const cwd = new URL('../..', import.meta.url).pathname;

test('CLI imports OpenInference/OTel traces and exports OTLP-style JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-otel-cli-'));
  try {
    let out = await exec(process.execPath, ['dist/cli/index.js', 'import', '--root', root, '--adapter', 'openinference', '--file', 'tests/fixtures/openinference-otel.json'], { cwd });
    assert.equal(JSON.parse(out.stdout).imported, 2);
    out = await exec(process.execPath, ['dist/cli/index.js', 'export', '--root', root, '--format', 'otel'], { cwd });
    const exported = JSON.parse(out.stdout);
    const spans = exported.resourceSpans[0].scopeSpans[0].spans;
    assert.equal(spans.length, 2);
    assert.ok(JSON.stringify(exported).includes('swarmwatch.agent.id'));
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('CLI imports OTLP JSONL file-exporter streams with otel alias and dry-run does not append', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-otel-jsonl-'));
  try {
    const fixture = JSON.parse(await readFile(join(cwd, 'tests/fixtures/openinference-otel.json'), 'utf8'));
    const file = join(root, 'otel-exporter.jsonl');
    await writeFile(file, `${JSON.stringify(fixture)}\n${JSON.stringify(fixture)}\n`);
    let out = await exec(process.execPath, ['dist/cli/index.js', 'import', '--root', root, '--adapter', 'otel', '--file', file, '--dry-run'], { cwd });
    assert.deepEqual(JSON.parse(out.stdout), { ok:true, adapter:'otel', imported:4, dryRun:true });
    assert.equal(await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8'), '');
    out = await exec(process.execPath, ['dist/cli/index.js', 'import', '--root', root, '--adapter', 'otel', '--file', file], { cwd });
    assert.equal(JSON.parse(out.stdout).imported, 4);
    const events = await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8');
    assert.match(events, /get_repo/);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('CLI export with explicit --events file is read-only and does not initialize workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-export-readonly-'));
  try {
    const eventsFile = join(root, 'external-events.jsonl');
    await writeFile(eventsFile, JSON.stringify({ id:'1', ts:'2026-06-13T00:00:00.000Z', type:'agent_started', agentId:'planner' }) + '\n');
    const out = await exec(process.execPath, ['dist/cli/index.js', 'export', '--root', root, '--events', eventsFile, '--format', 'otel'], { cwd });
    const exported = JSON.parse(out.stdout);
    assert.equal(exported.resourceSpans[0].scopeSpans[0].spans.length, 1);
    assert.equal(existsSync(join(root, '.swarmwatch')), false);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const cwd = new URL('../..', import.meta.url).pathname;

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for condition');
}

test('CLI attach follows an actively appended event file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-live-attach-'));
  const source = join(root, 'source.jsonl');
  await writeFile(source, '');
  const proc = spawn(process.execPath, ['dist/cli/index.js', 'attach', '--root', root, '--no-dashboard', '--adapter', 'swarmwatch', '--file', source, '--poll-ms', '50', '--duration', '700'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk; });
  try {
    await waitFor(async () => stdout.includes('SwarmWatch attach: following'));
    await appendFile(source, JSON.stringify({ id:'live-1', ts:'2026-06-13T00:00:00.000Z', type:'agent_started', agentId:'live-agent' }) + '\n');
    const code = await new Promise((resolve) => proc.on('close', resolve));
    assert.equal(code, 0);
    const events = await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8');
    assert.match(events, /live-agent/);
  } finally {
    proc.kill('SIGTERM');
    await rm(root, { recursive:true, force:true });
  }
});

test('CLI run supervises a live process and streams stdout into events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-live-run-'));
  try {
    const out = await exec(process.execPath, ['dist/cli/index.js', 'run', '--root', root, '--agent', 'worker', '--no-dashboard', '--', process.execPath, '-e', "console.log('hello live')"], { cwd });
    assert.equal(out.stderr, '');
    const events = await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8');
    assert.match(events, /agent_started/);
    assert.match(events, /hello live/);
    assert.match(events, /agent_done/);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('CLI run honors kill-request markers for supervised processes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-live-kill-'));
  const proc = spawn(process.execPath, ['dist/cli/index.js', 'run', '--root', root, '--agent', 'slow', '--no-dashboard', '--', process.execPath, '-e', "setInterval(()=>console.log('tick'),100)"], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitFor(async () => existsSync(join(root, '.swarmwatch', 'events.jsonl')) && (await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8')).includes('agent_started'));
    await exec(process.execPath, ['dist/cli/index.js', 'kill', '--root', root, 'slow'], { cwd });
    const code = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('run did not exit after kill')), 5000);
      proc.on('close', (c) => { clearTimeout(t); resolve(c); });
    });
    assert.equal(code, 1);
    const events = await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8');
    assert.match(events, /kill_requested/);
    assert.match(events, /process exited 128/);
  } finally {
    proc.kill('SIGKILL');
    await rm(root, { recursive:true, force:true });
  }
});

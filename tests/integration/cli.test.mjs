import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const cwd = new URL('../..', import.meta.url).pathname;

test('CLI replay calls the real built endpoint surface', async () => {
  const { stdout } = await exec(process.execPath, ['dist/cli/index.js', 'replay', 'examples/seed-session.jsonl', '--json'], { cwd });
  const state = JSON.parse(stdout);
  assert.ok(state.alerts.some((a) => a.kind === 'circular_delegation'));
  assert.ok(state.alerts.some((a) => a.kind === 'runaway_cost'));
});

test('CLI import, verify, and doctor exercise public commands with config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-cli-'));
  try {
    await exec(process.execPath, ['dist/cli/index.js', 'init', '--root', root], { cwd });
    await writeFile(join(root, '.swarmwatch', 'config.json'), JSON.stringify({ costLimitUsd: 0.5, stuckMs: 300000, deadMs: 900000, fanoutLimit: 6 }));
    let out = await exec(process.execPath, ['dist/cli/index.js', 'import', '--root', root, '--adapter', 'langgraph', '--file', 'tests/fixtures/langgraph.jsonl'], { cwd });
    assert.equal(JSON.parse(out.stdout).imported, 3);
    await exec(process.execPath, ['dist/cli/index.js', 'ingest', '--root', root, '--type', 'cost', '--agent', 'planner', '--cost', '0.6'], { cwd });
    try {
      await exec(process.execPath, ['dist/cli/index.js', 'verify', '--root', root, '--json'], { cwd });
      assert.fail('verify should exit 1 when critical alarms exist');
    } catch (err) {
      assert.equal(err.code, 1);
      const result = JSON.parse(err.stdout);
      assert.equal(result.ok, true);
      assert.ok(result.state.alerts.some((a) => a.kind === 'runaway_cost'));
    }
    out = await exec(process.execPath, ['dist/cli/index.js', 'doctor', '--root', root], { cwd });
    assert.equal(JSON.parse(out.stdout).ok, true);
    out = await exec(process.execPath, ['dist/cli/index.js', 'kill', '--root', root, 'planner'], { cwd });
    assert.match(out.stdout, /planner/);
    assert.match(await readFile(join(root, '.swarmwatch', 'kills.jsonl'), 'utf8'), /planner/);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('CLI invalid numeric ingest exits 2 and leaves event log empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-cli-invalid-'));
  try {
    await exec(process.execPath, ['dist/cli/index.js', 'init', '--root', root], { cwd });
    try {
      await exec(process.execPath, ['dist/cli/index.js', 'ingest', '--root', root, '--type', 'cost', '--agent', 'a', '--cost', 'abc'], { cwd });
      assert.fail('ingest should fail');
    } catch (err) {
      assert.equal(err.code, 2);
      assert.match(err.stderr, /--cost must be a finite non-negative number/);
    }
    assert.equal((await readFile(join(root, '.swarmwatch', 'events.jsonl'), 'utf8')).trim(), '');
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});


test('CLI verify returns structured JSON for malformed event logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-cli-malformed-'));
  try {
    await exec(process.execPath, ['dist/cli/index.js', 'init', '--root', root], { cwd });
    await writeFile(join(root, '.swarmwatch', 'events.jsonl'), '{bad json}\n');
    try {
      await exec(process.execPath, ['dist/cli/index.js', 'verify', '--root', root, '--json'], { cwd });
      assert.fail('verify should fail');
    } catch (err) {
      assert.equal(err.code, 2);
      const result = JSON.parse(err.stdout);
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((i) => i.code === 'event_log_parse_failed'));
    }
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

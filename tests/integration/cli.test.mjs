import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

test('CLI replay calls the real built endpoint surface', async () => {
  const { stdout } = await exec(process.execPath, ['dist/cli/index.js', 'replay', 'examples/seed-session.jsonl', '--json'], { cwd: new URL('../..', import.meta.url).pathname });
  const state = JSON.parse(stdout);
  assert.ok(state.alerts.some((a) => a.kind === 'circular_delegation'));
  assert.ok(state.alerts.some((a) => a.kind === 'runaway_cost'));
});


test('CLI import, verify, and doctor exercise public commands', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-cli-'));
  try {
    let out = await exec(process.execPath, ['dist/cli/index.js', 'import', '--root', root, '--adapter', 'langgraph', '--file', 'tests/fixtures/langgraph.jsonl'], { cwd: new URL('../..', import.meta.url).pathname });
    assert.equal(JSON.parse(out.stdout).imported, 3);
    out = await exec(process.execPath, ['dist/cli/index.js', 'verify', '--root', root, '--json'], { cwd: new URL('../..', import.meta.url).pathname });
    assert.equal(JSON.parse(out.stdout).ok, true);
    out = await exec(process.execPath, ['dist/cli/index.js', 'doctor', '--root', root], { cwd: new URL('../..', import.meta.url).pathname });
    assert.equal(JSON.parse(out.stdout).ok, true);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

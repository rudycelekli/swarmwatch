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

#!/usr/bin/env node
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const tmp = await mkdtemp(join(tmpdir(), 'swarmwatch-smoke-'));
function childEnv() {
  const env = { ...process.env };
  // `npm publish --dry-run` sets npm_config_dry_run for lifecycle scripts.
  // This smoke test intentionally creates a real local tarball to install.
  delete env.npm_config_dry_run;
  delete env.npm_config_dryRun;
  return env;
}
try {
  const { stdout: packOut } = await exec('npm', ['pack', '--json'], { cwd: root, env: childEnv() });
  const packed = JSON.parse(packOut)[0].filename;
  const tarball = join(root, packed);
  try {
    await exec('npm', ['init', '-y'], { cwd: tmp, env: childEnv() });
    await exec('npm', ['install', tarball], { cwd: tmp, env: childEnv() });
    const bin = join(tmp, 'node_modules', '.bin', 'swarmwatch');
    await exec(bin, ['init'], { cwd: tmp });
    await exec(bin, ['ingest', '--type', 'agent_started', '--agent', 'planner'], { cwd: tmp });
    const { stdout } = await exec(bin, ['watch', '--once', '--json'], { cwd: tmp });
    const state = JSON.parse(stdout);
    if (state.totals.agents !== 1) throw new Error(`expected 1 agent, got ${stdout}`);
    const { stdout: replay } = await exec(bin, ['demo'], { cwd: tmp });
    if (!replay.includes('circular_delegation')) throw new Error(`smoke replay did not detect circular_delegation: ${replay}`);
    await exec(process.execPath, [join(tmp, 'node_modules', 'swarmwatch', 'bench', 'run.mjs')], { cwd: tmp });
    console.log('tarball smoke passed');
  } finally { await unlink(tarball).catch(() => {}); }
} finally { await rm(tmp, { recursive: true, force: true }); }

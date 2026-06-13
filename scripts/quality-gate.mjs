#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIN_TESTS = 400;
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding:'utf8', ...opts });
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${res.status}`);
  return res;
}
run('npm', ['run', 'build']);
const testFiles = files('tests').sort();
const test = run(process.execPath, ['--test', ...testFiles]);
const combined = `${test.stdout}\n${test.stderr}`;
const match = combined.match(/# tests (\d+)/);
if (!match) throw new Error('could not find node:test count in TAP output');
const count = Number(match[1]);
if (count < MIN_TESTS) throw new Error(`quality gate requires >=${MIN_TESTS} tests, observed ${count}`);
run('npm', ['run', 'bench:check']);
run('npm', ['run', 'smoke:tarball']);
run('npm', ['pack', '--dry-run']);
console.log(`quality gate passed: ${count} tests observed (minimum ${MIN_TESTS})`);

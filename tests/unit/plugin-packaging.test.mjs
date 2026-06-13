import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const cwd = new URL('../..', import.meta.url).pathname;
const plugin = resolve(cwd, 'plugins/swarmwatch/bin/swarmwatch-plugin.mjs');
const alarm = resolve(cwd, 'plugins/swarmwatch/bin/swarmwatch-alarm-monitor.mjs');

async function writeJson(file, value) { await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
async function initProject(prefix) { const root = await mkdtemp(join(tmpdir(), prefix)); await mkdir(join(root, '.swarmwatch'), { recursive:true }); await writeJson(join(root, '.swarmwatch/config.json'), { costLimitUsd:5, stuckMs:1, deadMs:2, fanoutLimit:2 }); return root; }
async function activeSession(root, mode = 'process-live', extra = {}) { await writeJson(join(root, '.swarmwatch/claude-plugin-session.json'), { active:true, mode, startedAt:'2026-06-13T00:00:00.000Z', updatedAt:'2026-06-13T00:00:00.000Z', ...extra }); }
async function runAlarm(root, state = join(root, '.swarmwatch/alarm-state.json')) { return exec(process.execPath, [alarm, '--project', root, '--state', state, '--once'], { cwd }); }

test('Claude Code marketplace and plugin manifests resolve commands, skill, and monitor files', async () => {
  const marketplace = JSON.parse(await readFile(join(cwd, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(marketplace.plugins[0].name, 'swarmwatch');
  assert.equal(marketplace.plugins[0].source, './plugins/swarmwatch');
  const manifest = JSON.parse(await readFile(join(cwd, marketplace.plugins[0].source, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'swarmwatch');
  assert.ok(manifest.commands.every((file) => existsSync(join(cwd, marketplace.plugins[0].source, file))));
  assert.ok(existsSync(join(cwd, marketplace.plugins[0].source, 'skills/swarmwatch-alarm/SKILL.md')));
  assert.ok(existsSync(join(cwd, marketplace.plugins[0].source, 'monitors/monitors.json')));
  const monitors = JSON.parse(await readFile(join(cwd, marketplace.plugins[0].source, 'monitors/monitors.json'), 'utf8'));
  assert.match(monitors[0].command, /swarmwatch-alarm-monitor\.mjs/);
});

test('plugin command markdown maps slash commands to the thin CLI wrapper without injection-live language', async () => {
  for (const name of ['swarmwatch-init', 'swarmwatch-run', 'swarmwatch-attach', 'swarmwatch-kill']) {
    const text = await readFile(join(cwd, `plugins/swarmwatch/commands/${name}.md`), 'utf8');
    assert.match(text, /swarmwatch-plugin\.mjs/);
    assert.doesNotMatch(text, /injection-live introspection of arbitrary|attach to any running session/i);
  }
});

test('plugin run/attach/kill wrappers invoke the existing SwarmWatch CLI subcommands unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-plugin-cli-'));
  try {
    const log = join(root, 'args.log');
    const fake = join(root, 'fake-swarmwatch.mjs');
    await writeFile(fake, `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`, 'utf8');
    await chmod(fake, 0o755);
    const env = { ...process.env, SWARMWATCH_BIN: fake };
    await exec(process.execPath, [plugin, 'run', '--root', root, '--agent', 'a', '--', 'node', 'agent.js'], { cwd, env });
    await exec(process.execPath, [plugin, 'attach', '--root', root, '--adapter', 'swarmwatch', '--file', 'live.jsonl'], { cwd, env });
    await exec(process.execPath, [plugin, 'kill', 'a', '--root', root], { cwd, env });
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls[0], ['run', '--root', root, '--agent', 'a', '--', 'node', 'agent.js']);
    assert.deepEqual(calls[1], ['attach', '--root', root, '--adapter', 'swarmwatch', '--file', 'live.jsonl']);
    assert.deepEqual(calls[2], ['kill', 'a', '--root', root]);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('plugin kill wrapper is explicit about marker-only scope for stream-live sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-plugin-kill-scope-'));
  try {
    await mkdir(join(root, '.swarmwatch'), { recursive:true });
    await activeSession(root, 'stream-live');
    const fake = join(root, 'fake-swarmwatch.mjs');
    await writeFile(fake, '#!/usr/bin/env node\nprocess.exit(0);\n', 'utf8');
    await chmod(fake, 0o755);
    const env = { ...process.env, SWARMWATCH_BIN: fake };
    const { stderr } = await exec(process.execPath, [plugin, 'kill', 'external-agent', '--root', root], { cwd, env });
    assert.match(stderr, /marker-only for stream-live\/external sources/);
    assert.match(stderr, /no arbitrary external process is terminated/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('swarmwatch-alarm stays silent on a healthy active run', async () => {
  const root = await initProject('swarmwatch-alarm-healthy-');
  try {
    await activeSession(root, 'process-live');
    await writeFile(join(root, '.swarmwatch/events.jsonl'), JSON.stringify({ id:'1', ts:'2026-06-13T00:00:00.000Z', type:'agent_message', agentId:'a', message:'ok' }) + '\n');
    const { stdout } = await runAlarm(root);
    assert.equal(stdout, '');
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('swarmwatch-alarm fires once per distinct structural alarm and frequency-caps repeats', async () => {
  const root = await initProject('swarmwatch-alarm-structural-');
  try {
    await activeSession(root, 'process-live');
    const events = [
      { id:'1', ts:'2026-06-13T00:00:00.000Z', type:'cost', agentId:'spender', costUsd:6 },
      { id:'2', ts:'2026-06-13T00:00:01.000Z', type:'delegation', agentId:'a', targetAgentId:'b' },
      { id:'3', ts:'2026-06-13T00:00:02.000Z', type:'delegation', agentId:'b', targetAgentId:'a' },
      { id:'4', ts:'2026-06-13T00:00:03.000Z', type:'delegation', agentId:'hub', targetAgentId:'x' },
      { id:'5', ts:'2026-06-13T00:00:04.000Z', type:'delegation', agentId:'hub', targetAgentId:'y' },
      { id:'6', ts:'2026-06-13T00:00:05.000Z', type:'delegation', agentId:'hub', targetAgentId:'z' }
    ];
    await writeFile(join(root, '.swarmwatch/events.jsonl'), events.map(JSON.stringify).join('\n') + '\n');
    const first = await runAlarm(root);
    assert.match(first.stdout, /runaway_cost/);
    assert.match(first.stdout, /circular_delegation/);
    assert.match(first.stdout, /high_fanout/);
    assert.match(first.stdout, /Process-live action: \/swarmwatch:swarmwatch-kill/);
    const second = await runAlarm(root);
    assert.equal(second.stdout, '');
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('swarmwatch-alarm ignores structural events that predate the active run offset', async () => {
  const root = await initProject('swarmwatch-alarm-offset-');
  try {
    const file = join(root, '.swarmwatch/events.jsonl');
    const stale = JSON.stringify({ id:'stale', ts:'2020-01-01T00:00:00.000Z', type:'cost', agentId:'spender', costUsd:6 }) + '\n';
    await writeFile(file, stale);
    await activeSession(root, 'process-live', { eventsFile:file, eventOffset:Buffer.byteLength(stale) });
    assert.equal((await runAlarm(root)).stdout, '');
    await writeFile(file, stale + JSON.stringify({ id:'fresh', ts:'2026-06-13T00:00:01.000Z', type:'cost', agentId:'spender', costUsd:6 }) + '\n');
    const { stdout } = await runAlarm(root);
    assert.match(stdout, /runaway_cost/);
    assert.doesNotMatch(stdout, /stale/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('swarmwatch-alarm never emits stuck_agent or dead_agent for replay/static transcripts', async () => {
  const root = await initProject('swarmwatch-alarm-replay-');
  try {
    await activeSession(root, 'stream-live');
    await writeFile(join(root, '.swarmwatch/events.jsonl'), JSON.stringify({ id:'old', ts:'2020-01-01T00:00:00.000Z', type:'agent_started', agentId:'old' }) + '\n');
    const { stdout } = await runAlarm(root);
    assert.equal(stdout, '');
    assert.doesNotMatch(stdout, /stuck_agent|dead_agent/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('swarmwatch-init detects claude-flow state as stream-live attach', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-detect-cf-'));
  try {
    await mkdir(join(root, '.swarm'), { recursive:true });
    await writeJson(join(root, '.swarm/state.json'), { agents: [] });
    const { stdout } = await exec(process.execPath, [plugin, 'init', '--root', root, '--json'], { cwd });
    const result = JSON.parse(stdout);
    assert.equal(result.mode, 'stream-live');
    assert.equal(result.adapter, 'claude-flow');
    assert.equal(result.active, false);
    assert.match(result.suggestedCommand, /attach --adapter claude-flow/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

const detectCases = [
  ['swarmwatch', 'live-events.jsonl', { id:'1', ts:'2026-06-13T00:00:00.000Z', type:'agent_started', agentId:'a' }],
  ['langgraph', 'langgraph.jsonl', { event:'on_chain_start', name:'planner', timestamp:'2026-06-13T00:00:00.000Z' }],
  ['claude-transcript', 'claude-transcript.jsonl', { type:'assistant', session_id:'s1', timestamp:'2026-06-13T00:00:00.000Z', message:{ model:'claude-test', content:[] } }],
];
for (const [adapter, file, row] of detectCases) {
  test(`swarmwatch-init detects ${adapter} source as stream-live attach`, async () => {
    const root = await mkdtemp(join(tmpdir(), `swarmwatch-detect-${adapter}-`));
    try {
      await writeFile(join(root, file), JSON.stringify(row) + '\n');
      const { stdout } = await exec(process.execPath, [plugin, 'init', '--root', root, '--json'], { cwd });
      const result = JSON.parse(stdout);
      assert.equal(result.mode, 'stream-live');
      assert.equal(result.adapter, adapter);
      assert.match(result.suggestedCommand, new RegExp(`attach --adapter ${adapter}`));
      assert.equal(result.privacy.includeRaw, false);
      assert.equal(result.privacy.includeText, false);
    } finally { await rm(root, { recursive:true, force:true }); }
  });
}

test('swarmwatch-init detects OTLP/OpenInference source as stream-live attach', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-detect-otel-'));
  try {
    await writeJson(join(root, 'otel-trace.json'), { resourceSpans: [] });
    const { stdout } = await exec(process.execPath, [plugin, 'init', '--root', root, '--json'], { cwd });
    const result = JSON.parse(stdout);
    assert.equal(result.mode, 'stream-live');
    assert.equal(result.adapter, 'otel');
    assert.match(result.suggestedCommand, /attach --adapter otel/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('swarmwatch-init detects launchable agent command as process-live run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swarmwatch-detect-run-'));
  try {
    await writeJson(join(root, 'package.json'), { scripts:{ agent:'node agent.js' } });
    const { stdout } = await exec(process.execPath, [plugin, 'init', '--root', root, '--agent', 'builder', '--json'], { cwd });
    const result = JSON.parse(stdout);
    assert.equal(result.mode, 'process-live');
    assert.deepEqual(result.runCommand, ['npm', 'run', 'agent']);
    assert.match(result.suggestedCommand, /npx -y github:rudycelekli\/swarmwatch run --agent builder -- npm run agent/);
    assert.ok(existsSync(join(root, '.swarmwatch/swarmwatch-start.sh')));
  } finally { await rm(root, { recursive:true, force:true }); }
});

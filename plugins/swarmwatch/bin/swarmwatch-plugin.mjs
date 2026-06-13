#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

const DEFAULT_CONFIG = { costLimitUsd: 5, stuckMs: 300000, deadMs: 900000, fanoutLimit: 6 };
const SESSION_FILE = 'claude-plugin-session.json';
const START_SCRIPT = 'swarmwatch-start.sh';

function arg(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function flag(args, name) { return args.includes(name); }
function dashArgs(args) {
  const i = args.indexOf('--');
  return i >= 0 ? args.slice(i + 1) : [];
}
function rootFrom(args) { return resolve(arg(args, '--root', process.env.CLAUDE_PROJECT_DIR || process.cwd())); }
function rel(root, file) { return relative(root, file) || basename(file); }
function shellQuote(s) { return `'${String(s).replace(/'/g, `'"'"'`)}'`; }
async function ensureWorkspace(root) {
  const dir = join(root, '.swarmwatch');
  await mkdir(dir, { recursive: true });
  const configFile = join(dir, 'config.json');
  if (!existsSync(configFile)) await writeFile(configFile, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
  const eventsFile = join(dir, 'events.jsonl');
  if (!existsSync(eventsFile)) await writeFile(eventsFile, '', 'utf8');
  const killsFile = join(dir, 'kills.jsonl');
  if (!existsSync(killsFile)) await writeFile(killsFile, '', 'utf8');
  return { dir, configFile, eventsFile, killsFile, sessionFile: join(dir, SESSION_FILE), startScript: join(dir, START_SCRIPT) };
}
async function writeSession(root, session) {
  const paths = await ensureWorkspace(root);
  const now = new Date().toISOString();
  const active = session.active ?? true;
  await writeFile(paths.sessionFile, `${JSON.stringify({ ...session, schemaVersion: 1, active, startedAt: session.startedAt ?? now, updatedAt: now }, null, 2)}\n`, 'utf8');
  return paths.sessionFile;
}
async function readSession(root) {
  const file = join(root, '.swarmwatch', SESSION_FILE);
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; }
}
function swarmwatchCommand(root) {
  if (process.env.SWARMWATCH_BIN) return { command: process.env.SWARMWATCH_BIN, prefix: [] };
  const local = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'swarmwatch.cmd' : 'swarmwatch');
  if (existsSync(local)) return { command: local, prefix: [] };
  const global = process.platform === 'win32'
    ? spawnSync('where', ['swarmwatch'], { encoding: 'utf8' })
    : spawnSync('sh', ['-lc', 'command -v swarmwatch >/dev/null 2>&1'], { encoding: 'utf8' });
  if (global.status === 0) return { command: 'swarmwatch', prefix: [] };
  return { command: 'npx', prefix: ['-y', 'swarmwatch'] };
}
function runSwarmWatch(root, cliArgs) {
  const bin = swarmwatchCommand(root);
  const result = spawnSync(bin.command, [...bin.prefix, ...cliArgs], { cwd: root, stdio: 'inherit', env: process.env });
  return result.status ?? 1;
}
function eventFileFromArgs(root, paths, args) {
  const raw = arg(args, '--events');
  return raw ? resolve(root, raw) : paths.eventsFile;
}
function fileSize(file) {
  try { return statSync(file).size; } catch { return 0; }
}
async function finishSession(root) {
  const session = await readSession(root);
  if (session?.active) await writeSession(root, { ...session, active: false });
}
function listFiles(root, max = 500) {
  const out = [];
  const skip = new Set(['.git', 'node_modules', 'dist', '.swarmwatch', 'coverage']);
  function walk(dir, depth) {
    if (out.length >= max || depth > 4) return;
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (skip.has(name)) continue;
      const file = join(dir, name);
      let st;
      try { st = statSync(file); } catch { continue; }
      if (st.isDirectory()) walk(file, depth + 1);
      else if (st.isFile() && st.size <= 5_000_000) out.push(file);
      if (out.length >= max) return;
    }
  }
  walk(root, 0);
  return out;
}
function parseJsonLines(text, limit = 8) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { return rows.length ? rows : undefined; }
    if (rows.length >= limit) break;
  }
  return rows;
}
function classifyObject(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj.resourceSpans) || Array.isArray(obj.spans)) return 'otel';
  if (typeof obj.type === 'string' && typeof obj.agentId === 'string') return 'swarmwatch';
  if (typeof obj.event === 'string' && (typeof obj.name === 'string' || typeof obj.node === 'string' || typeof obj.run_id === 'string')) return 'langgraph';
  if ((typeof obj.session_id === 'string' || typeof obj.sessionId === 'string') && (obj.message || obj.type === 'assistant' || obj.type === 'result')) return 'claude-transcript';
  return undefined;
}
function classifyFile(file) {
  let text;
  try { text = statSync(file).size ? String(requireRead(file)).slice(0, 200_000) : ''; } catch { return undefined; }
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(classifyObject).find(Boolean);
    return classifyObject(parsed);
  } catch {}
  const rows = parseJsonLines(text);
  return rows?.map(classifyObject).find(Boolean);
}
function requireRead(file) {
  return readFileSync(file, 'utf8');
}
function priority(file) {
  const n = basename(file).toLowerCase();
  if (n.includes('swarmwatch') || n.includes('events')) return 0;
  if (n.includes('langgraph')) return 1;
  if (n.includes('transcript') || n.includes('claude')) return 2;
  if (n.includes('otel') || n.includes('openinference') || n.includes('trace')) return 3;
  return 10;
}
function detectPackageCommand(root) {
  const pkg = join(root, 'package.json');
  if (!existsSync(pkg)) return undefined;
  try {
    const json = JSON.parse(requireRead(pkg));
    const scripts = json && typeof json === 'object' ? json.scripts || {} : {};
    for (const name of ['agent', 'swarm', 'start:agent', 'dev:agent']) {
      if (typeof scripts[name] === 'string') return { command: ['npm', 'run', name], reason: `package.json script ${name}` };
    }
  } catch {}
  return undefined;
}
function detect(root, args) {
  const explicit = dashArgs(args);
  const command = explicit.length ? explicit : arg(args, '--command')?.split(/\s+/).filter(Boolean);
  if (command?.length) return { mode: 'process-live', reason: 'explicit launch command', runCommand: command };
  const packageCommand = detectPackageCommand(root);
  if (packageCommand) return { mode: 'process-live', ...packageCommand, runCommand: packageCommand.command };
  if (existsSync(join(root, '.swarm', 'state.json'))) return { mode: 'stream-live', adapter: 'claude-flow', reason: '.swarm/state.json', file: '.swarm/state.json' };
  const candidates = listFiles(root)
    .filter((f) => /\.(jsonl|ndjson|json)$/i.test(f) || /(trace|events|langgraph|transcript|otel|openinference)/i.test(f))
    .sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  for (const file of candidates) {
    const adapter = classifyFile(file);
    if (adapter) return { mode: 'stream-live', adapter, file: rel(root, file), reason: `${adapter} shaped source ${rel(root, file)}` };
  }
  return { mode: 'none', reason: 'no launch command or followable event stream detected' };
}
function commandForDetection(detection, root, agentId) {
  if (detection.mode === 'process-live') {
    const cmd = detection.runCommand || ['node', 'agent.js'];
    return ['npx', 'swarmwatch', 'run', '--agent', agentId, '--', ...cmd];
  }
  if (detection.mode === 'stream-live') {
    if (detection.adapter === 'claude-flow') return ['npx', 'swarmwatch', 'attach', '--adapter', 'claude-flow'];
    return ['npx', 'swarmwatch', 'attach', '--adapter', detection.adapter, '--file', detection.file];
  }
  return ['npx', 'swarmwatch', 'watch'];
}
async function writeStartScript(file, command) {
  const body = `#!/usr/bin/env bash\nset -euo pipefail\n${command.map(shellQuote).join(' ')} "$@"\n`;
  await writeFile(file, body, 'utf8');
  await chmod(file, 0o755);
}
async function cmdInit(args) {
  const root = rootFrom(args);
  const paths = await ensureWorkspace(root);
  const agentId = arg(args, '--agent', 'agent');
  const detection = detect(root, args);
  const suggested = commandForDetection(detection, root, agentId);
  const session = {
    mode: detection.mode,
    adapter: detection.adapter,
    file: detection.file,
    runCommand: detection.runCommand,
    suggestedCommand: suggested.join(' '),
    root,
    killScope: detection.mode === 'process-live' ? 'supervised-child' : detection.mode === 'stream-live' ? 'marker-only' : 'none',
    privacy: { includeRaw: false, includeText: false },
    thresholds: DEFAULT_CONFIG,
    detectionReason: detection.reason,
    active: false,
  };
  await writeSession(root, session);
  await writeStartScript(paths.startScript, suggested);
  const result = { ok: true, ...session, config: rel(root, paths.configFile), startScript: rel(root, paths.startScript) };
  if (flag(args, '--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('SwarmWatch configured for Claude Code.');
    console.log(`Detected: ${detection.mode}${detection.adapter ? ` (${detection.adapter})` : ''} — ${detection.reason}`);
    console.log(`Suggested command: ${suggested.join(' ')}`);
    console.log(`Start script: ${rel(root, paths.startScript)}`);
    console.log('Privacy default: raw/text payloads are off unless explicitly opted in.');
    console.log('Scope: process-live means SwarmWatch launched the child; stream-live means following a growing event stream. No injection-live introspection is claimed.');
  }
}
async function cmdRun(args) {
  const root = rootFrom(args);
  const paths = await ensureWorkspace(root);
  const agentId = arg(args, '--agent', 'process');
  const eventsFile = eventFileFromArgs(root, paths, args);
  await writeSession(root, { mode: 'process-live', agentId, root, killScope: 'supervised-child', cliArgs: ['run', ...args], eventsFile, eventOffset: fileSize(eventsFile) });
  const code = runSwarmWatch(root, ['run', ...args]);
  await finishSession(root);
  process.exit(code);
}
async function cmdAttach(args) {
  const root = rootFrom(args);
  const paths = await ensureWorkspace(root);
  const eventsFile = eventFileFromArgs(root, paths, args);
  await writeSession(root, { mode: 'stream-live', adapter: arg(args, '--adapter', 'swarmwatch'), file: arg(args, '--file'), root, killScope: 'marker-only', cliArgs: ['attach', ...args], eventsFile, eventOffset: fileSize(eventsFile) });
  const code = runSwarmWatch(root, ['attach', ...args]);
  await finishSession(root);
  process.exit(code);
}
async function cmdKill(args) {
  const root = rootFrom(args);
  const session = await readSession(root);
  if (session?.mode === 'stream-live') console.error('SwarmWatch kill scope: marker-only for stream-live/external sources; no arbitrary external process is terminated.');
  else if (session?.mode === 'process-live') console.error('SwarmWatch kill scope: supervised child may terminate when this kill marker matches the process-live agent.');
  process.exit(runSwarmWatch(root, ['kill', ...args]));
}
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log('Usage: swarmwatch-plugin.mjs init|run|attach|kill [args...]');
    return;
  }
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'run') return cmdRun(args);
  if (cmd === 'attach') return cmdAttach(args);
  if (cmd === 'kill') return cmdKill(args);
  throw new Error(`unknown command ${cmd}`);
}
main().catch((err) => { console.error(`swarmwatch plugin: ${err.message}`); process.exit(2); });

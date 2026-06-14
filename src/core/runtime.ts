import { analyzeEvents } from './analyze.js';
import { loadConfig, type SwarmWatchConfig } from './config.js';
import { makeEvent } from './event.js';
import { appendEvent, appendKill, initWorkspace, readEvents, workspacePaths } from './store.js';
import { verifyEvents, type VerifyResult } from './verify.js';
import { readClaudeFlowState } from '../adapters/claudeFlow.js';
import type { SwarmEvent, SwarmState } from './types.js';

export async function loadObservedEvents(root: string, eventsFile: string, includeClaudeFlow = true): Promise<SwarmEvent[]> {
  const base = await readEvents(eventsFile);
  if (!includeClaudeFlow) return base;
  const cf = await readClaudeFlowState(root).catch(() => []);
  return [...base, ...cf];
}

export async function loadRuntimeConfig(root: string): Promise<SwarmWatchConfig> {
  return loadConfig(workspacePaths(root).config);
}

export async function loadObservedState(root: string, eventsFile: string): Promise<SwarmState> {
  const cfg = await loadRuntimeConfig(root);
  return analyzeEvents(await loadObservedEvents(root, eventsFile), eventsFile, cfg);
}

export async function verifyObserved(root: string, eventsFile: string): Promise<VerifyResult> {
  const cfg = await loadRuntimeConfig(root);
  try {
    return verifyEvents(await loadObservedEvents(root, eventsFile), eventsFile, { ...cfg, mode: 'replay' });
  } catch (err) {
    return verifyEvents([], eventsFile, { ...cfg, mode: 'replay' }, [{
      severity: 'error',
      code: 'event_log_parse_failed',
      message: (err as Error).message,
    }]);
  }
}

export async function requestKill(root: string, eventsFile: string, agentId: string, reason = 'operator-request'): Promise<SwarmEvent> {
  await initWorkspace(root);
  const event = makeEvent({ type: 'kill_requested', agentId, status: 'killed', message: reason, framework: 'swarmwatch' });
  await appendEvent(eventsFile, event);
  await appendKill(root, agentId, reason);
  return event;
}

export async function respondOperator(root: string, eventsFile: string, requestId: string, response: string, action = 'respond'): Promise<SwarmEvent> {
  await initWorkspace(root);
  const state = await loadObservedState(root, eventsFile);
  const request = state.operatorRequests.find((r) => r.requestId === requestId && r.status === 'pending');
  if (!request) throw Object.assign(new Error(`pending operator request not found: ${requestId}`), { statusCode: 404 });
  const event = makeEvent({
    type: 'operator_response',
    agentId: request.agentId,
    message: response || action,
    framework: 'swarmwatch',
    metadata: { requestId, action, respondedBy: 'operator' },
  });
  await appendEvent(eventsFile, event);
  return event;
}

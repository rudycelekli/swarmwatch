export type SwarmEventType =
  | 'agent_started'
  | 'agent_heartbeat'
  | 'agent_message'
  | 'tool_call'
  | 'cost'
  | 'delegation'
  | 'agent_done'
  | 'agent_error'
  | 'kill_requested';

export interface SwarmEvent {
  id: string;
  ts: string;
  type: SwarmEventType;
  agentId: string;
  parentId?: string;
  targetAgentId?: string;
  framework?: 'swarmwatch' | 'claude-code' | 'claude-flow' | 'langgraph' | string;
  message?: string;
  tool?: string;
  costUsd?: number;
  tokens?: number;
  status?: 'running' | 'done' | 'error' | 'killed';
  metadata?: Record<string, unknown>;
}

export interface AgentNode {
  id: string;
  parentId?: string;
  framework: string;
  status: 'running' | 'done' | 'error' | 'killed' | 'unknown';
  firstSeen: string;
  lastSeen: string;
  messageCount: number;
  toolCalls: number;
  costUsd: number;
  tokens: number;
  lastMessage?: string;
}

export interface AgentEdge {
  from: string;
  to: string;
  kind: 'delegation' | 'message';
  count: number;
  lastSeen: string;
}

export type AlertKind = 'runaway_cost' | 'stuck_agent' | 'circular_delegation' | 'dead_agent' | 'high_fanout';

export interface SwarmAlert {
  id: string;
  kind: AlertKind;
  severity: 'info' | 'warn' | 'critical';
  agentId?: string;
  message: string;
  evidence: Record<string, unknown>;
  ts: string;
}

export interface SwarmState {
  generatedAt: string;
  source: string;
  agents: AgentNode[];
  edges: AgentEdge[];
  alerts: SwarmAlert[];
  totals: { agents: number; running: number; costUsd: number; tokens: number; events: number };
}

export interface AnalyzeOptions {
  now?: Date;
  costLimitUsd?: number;
  stuckMs?: number;
  deadMs?: number;
  fanoutLimit?: number;
  mode?: 'live' | 'replay';
}


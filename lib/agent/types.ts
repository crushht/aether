/**
 * The data contract shared by the client stores, the API routes and the
 * provider layer. Everything the agent does is described here once: a model is
 * reached through a Provider, a conversation picks its provider through a
 * scene route, and the tools only ever see those shapes.
 */

import type { ToolCard } from './tool-cards';

/* ------------------------------------------------------------------ routes */

export type ModelRouteKey = 'chat' | 'issue' | 'workflow' | 'knowledge';

export interface ModelRouteMeta {
  key: ModelRouteKey;
  label: string;
  hint: string;
}

/** The four places that can use a different model. */
export const MODEL_ROUTES: ModelRouteMeta[] = [
  { key: 'chat', label: 'Workspace chat', hint: 'The ⌘J agent — summaries, planning, bulk edits.' },
  { key: 'issue', label: 'Issue agent', hint: 'The agent inside an issue: status, comments, sub-issues.' },
  { key: 'workflow', label: 'Workflows', hint: 'Automations that run on a schedule or on demand.' },
  { key: 'knowledge', label: 'Knowledge', hint: 'Cataloguing and summarising knowledge entries.' },
];

/** Which provider (and optionally which model) a scene uses. */
export interface RouteBinding {
  providerId: string | null;
  /** empty = the provider's default model */
  model: string;
}

export type ModelRoutes = Record<ModelRouteKey, RouteBinding>;

export const emptyRoutes = (): ModelRoutes => ({
  chat: { providerId: null, model: '' },
  issue: { providerId: null, model: '' },
  workflow: { providerId: null, model: '' },
  knowledge: { providerId: null, model: '' },
});

/* --------------------------------------------------------------- providers */

export interface ProviderConfig {
  id: string;
  name: string;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  /** only in memory: the stored key is returned as `hasKey`/`keyHint` */
  apiKey?: string;
  hasKey: boolean;
  /** `sk-…abcd`, so a person can recognise which key is stored */
  keyHint: string;
  models: string[];
  defaultModel: string;
  temperature: number;
  maxSteps: number;
  /** used by the context meter; not guessed at request time */
  contextWindow: number;
  /** optional embeddings model id (e.g. text-embedding-3-small, bge-m3) */
  embeddingModel?: string;
  presetId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  contextWindow: number;
  hint?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    contextWindow: 128_000,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    contextWindow: 64_000,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.5-pro'],
    contextWindow: 200_000,
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k'],
    contextWindow: 128_000,
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air'],
    contextWindow: 128_000,
  },
  {
    id: 'local',
    name: 'Ollama / LM Studio',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['llama3.1', 'qwen2.5-coder', 'deepseek-r1'],
    contextWindow: 32_000,
    hint: 'Local endpoints usually ignore the API key — type any placeholder.',
  },
  {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    models: [],
    contextWindow: 128_000,
    hint: 'Any endpoint that implements POST /chat/completions with tools.',
  },
];

/** A provider being edited in the settings page (never carries a stored key). */
export interface ProviderDraft {
  id?: string;
  name: string;
  baseUrl: string;
  presetId?: string;
  /** new key typed in this session; empty = leave the stored one alone */
  apiKey?: string;
  clearKey?: boolean;
  models: string[];
  defaultModel: string;
  embeddingModel?: string;
  temperature: number;
  maxSteps: number;
  contextWindow: number;
}

/* --------------------------------------------------------------- connectors */

export interface ConnectorConfig {
  id: string;
  name: string;
  baseUrl: string;
  /** token material never leaves the server; the UI only sees these */
  hasToken: boolean;
  tokenHint: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConnectorDraft {
  id?: string;
  name: string;
  baseUrl: string;
  /** new token typed in this session; empty = keep the stored one */
  token?: string;
  clearToken?: boolean;
}

/* ---------------------------------------------------------------- messages */

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentToolResult {
  id: string;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** what the model sees */
  content: string;
  /** one line for the transcript */
  summary: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** data URLs attached to the turn; the wire layer turns them into image_url parts */
  images?: string[];
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
}

/** Something the user attached to a turn. Text is inlined into the prompt. */
export interface AgentAttachment {
  id: string;
  name: string;
  kind: 'file' | 'web' | 'image';
  mime?: string;
  size?: number;
  /** file / web body, already trimmed */
  text?: string;
  /** images only */
  dataUrl?: string;
  url?: string;
}

export type AgentLogKind = 'user' | 'assistant' | 'tool' | 'final' | 'error' | 'status';

export interface AgentLogEntry {
  id: string;
  kind: AgentLogKind;
  text: string;
  /** tool rows */
  name?: string;
  ok?: boolean;
  args?: Record<string, unknown>;
  /** structured receipt (search hits, artifact report) — expandable in the chat */
  card?: ToolCard;
  attachments?: AgentAttachment[];
  /** thumbs on a final answer; local-first, mirrored with the conversation */
  feedback?: 'up' | 'down';
  at: number;
}

/** A write tool parked until the user approves it. */
export interface AgentPendingRow {
  field: string;
  from?: string;
  to?: string;
}

export interface AgentPending {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /** issue key, or the new title for create_issue */
  title: string;
  rows: AgentPendingRow[];
  note?: string;
}

export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  /** how many assistant turns + tool calls this run used */
  steps: number;
  tools: number;
}

/** One finished run, kept so a person can audit what the agent actually did. */
export interface AgentRunRecord {
  id: string;
  at: number;
  ms: number;
  model: string;
  provider: string;
  status: 'ok' | 'error' | 'stopped';
  steps: number;
  tools: number;
  promptTokens: number;
  completionTokens: number;
  error?: string;
}

/**
 * The resolved model for one turn: a provider plus the scene override. This is
 * what `chat()` needs; components never build a request out of raw settings.
 */
export interface ModelTarget {
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxSteps: number;
  contextWindow: number;
  requireApproval: boolean;
  /** global instructions + persona, already resolved */
  systemPrompt: string;
  persona: string;
  hasKey: boolean;
  keyHint: string;
  apiKey?: string;
}

/** Backwards-compatible alias: the settings surface reads this shape. */
export type AgentSettings = ModelTarget;

export const defaultAgentSettings: AgentSettings = {
  providerId: '',
  providerName: '',
  baseUrl: '',
  model: '',
  temperature: 0.3,
  maxSteps: 8,
  contextWindow: 128_000,
  requireApproval: true,
  systemPrompt: '',
  persona: '',
  hasKey: false,
  keyHint: '',
  apiKey: '',
};

/* ------------------------------------------------------------------ memory */

export type MemoryKind = 'fact' | 'preference' | 'decision' | 'note';
export type MemoryScope = 'global' | 'chat' | 'issue';

export interface MemoryEntry {
  id: string;
  text: string;
  kind: MemoryKind;
  scope: MemoryScope;
  /** chat id or issue id when the scope is not global */
  ref?: string;
  projectId?: string | null;
  at: number;
  /** the agent added it rather than the person */
  source?: 'user' | 'agent' | 'workflow';
}

/* --------------------------------------------------------------- knowledge */

export type KnowledgeKind = 'note' | 'web' | 'file';

export interface KnowledgeItem {
  id: string;
  title: string;
  kind: KnowledgeKind;
  url?: string;
  content: string;
  tags: string[];
  at: number;
  updatedAt: number;
  chars: number;
  /** set when the entry is pinned to the top of the list */
  pinnedAt?: number;
  /** true when `content` is only the first lines (the index shape) */
  excerpt?: boolean;
}

/* --------------------------------------------------------------- workflows */

export type WorkflowTriggerKind = 'manual' | 'daily' | 'weekly' | 'interval';

export interface WorkflowTrigger {
  kind: WorkflowTriggerKind;
  /** daily / weekly: 0-23 local hour */
  hour?: number;
  /** weekly: 1 (Mon) – 7 (Sun) */
  weekday?: number;
  /** interval: minutes */
  minutes?: number;
}

export interface WorkflowRunEvent {
  kind: 'step' | 'tool' | 'final' | 'error';
  text: string;
  at: number;
  ok?: boolean;
}

export interface WorkflowRun {
  id: string;
  at: number;
  status: 'running' | 'ok' | 'error' | 'canceled';
  summary: string;
  steps: number;
  tools: number;
  /** wall-clock duration of the run */
  ms?: number;
  /** the model that actually ran it */
  model?: string;
  issueKey?: string;
  error?: string;
  /** bounded trace of what each step and tool did */
  events?: WorkflowRunEvent[];
}

export interface AgentWorkflow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** null = the scene route decides */
  providerId: string | null;
  /** empty = the provider's default model */
  model: string;
  trigger: WorkflowTrigger;
  enabled: boolean;
  /** allow write tools (create/update issues) without approval */
  allowWrites: boolean;
  /** turn the final answer into an issue */
  createIssue: boolean;
  /** initial status for the generated report issue */
  issueStatus: 'backlog' | 'todo' | 'in_progress';
  projectId: string | null;
  maxSteps: number;
  lastRunAt: number | null;
  runs: WorkflowRun[];
  createdAt: number;
  updatedAt: number;
}

export const describeTrigger = (trigger: WorkflowTrigger) => {
  switch (trigger.kind) {
    case 'daily':
      return `Daily at ${String(trigger.hour ?? 9).padStart(2, '0')}:00`;
    case 'weekly':
      return `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(trigger.weekday ?? 1) - 1]} at ${String(
        trigger.hour ?? 9,
      ).padStart(2, '0')}:00`;
    case 'interval':
      return `Every ${trigger.minutes ?? 60} min`;
    default:
      return 'Manual';
  }
};

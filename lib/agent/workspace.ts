'use client';

import { create } from 'zustand';
import {
  emptyRoutes,
  type AgentWorkflow,
  type KnowledgeItem,
  type MemoryEntry,
  type ModelRouteKey,
  type ModelRoutes,
  type ModelTarget,
  type ProviderConfig,
  type ProviderDraft,
  type WorkflowRun,
} from './types';

/**
 * The account's Aether profile. One store, one source of truth:
 * providers and scene routes resolve to a ModelTarget, and memory / knowledge /
 * workflows are edited here and persisted through /api/agent/*.
 */

interface ApiResult {
  ok: boolean;
  error?: string;
}

interface WorkspaceState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  providers: ProviderConfig[];
  routes: ModelRoutes;
  persona: string;
  instructions: string;
  requireApproval: boolean;
  memoryEnabled: boolean;
  memory: MemoryEntry[];
  /** index shape (content is an excerpt); full bodies load on demand */
  knowledge: KnowledgeItem[];
  knowledgeTotal: number;
  workflows: AgentWorkflow[];

  hydrate: (force?: boolean) => Promise<void>;
  saveProviders: (drafts: ProviderDraft[]) => Promise<ApiResult>;
  saveProfile: (patch: {
    persona?: string;
    instructions?: string;
    requireApproval?: boolean;
    memoryEnabled?: boolean;
    routes?: ModelRoutes;
  }) => Promise<ApiResult>;
  setRoutes: (routes: ModelRoutes) => void;
  addMemory: (input: Pick<MemoryEntry, 'text' | 'kind' | 'scope' | 'ref'>) => Promise<ApiResult>;
  removeMemory: (id: string) => Promise<void>;
  clearMemory: () => Promise<void>;
  addKnowledge: (input: {
    kind: 'note' | 'web' | 'file';
    title?: string;
    url?: string;
    content?: string;
    tags?: string[];
  }) => Promise<ApiResult & { item?: KnowledgeItem }>;
  updateKnowledge: (id: string, patch: { title?: string; content?: string; tags?: string[]; pin?: boolean }) => Promise<ApiResult>;
  deleteKnowledge: (id: string) => Promise<void>;
  loadKnowledge: (id: string) => Promise<KnowledgeItem | null>;
  createWorkflow: (input: Partial<AgentWorkflow> & { prompt: string }) => Promise<ApiResult & { workflow?: AgentWorkflow }>;
  updateWorkflow: (
    id: string,
    patch: Partial<AgentWorkflow>,
    appendRun?: Partial<WorkflowRun>,
  ) => Promise<ApiResult & { workflow?: AgentWorkflow }>;
  deleteWorkflow: (id: string) => Promise<void>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T & { ok?: boolean; error?: string }> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!response.ok) {
    return { ...json, ok: false, error: json.error ?? `HTTP ${response.status}` };
  }
  return json;
}

let hydrating: Promise<void> | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  providers: [],
  routes: emptyRoutes(),
  persona: '',
  instructions: '',
  requireApproval: true,
  memoryEnabled: true,
  memory: [],
  knowledge: [],
  knowledgeTotal: 0,
  workflows: [],

  hydrate: async (force = false) => {
    if (typeof window === 'undefined') return;
    if (get().loading) return hydrating ?? undefined;
    if (get().loaded && !force) return;

    set({ loading: true, error: null });
    hydrating = (async () => {
      const json = await request<{ config?: Record<string, unknown> }>('/api/agent/config');
      if (json.ok && json.config) {
        const config = json.config as unknown as {
          providers?: ProviderConfig[];
          routes?: ModelRoutes;
          persona?: string;
          instructions?: string;
          requireApproval?: boolean;
          memoryEnabled?: boolean;
          memory?: MemoryEntry[];
          knowledge?: KnowledgeItem[];
          workflows?: AgentWorkflow[];
        };
        set({
          providers: config.providers ?? [],
          routes: { ...emptyRoutes(), ...(config.routes ?? {}) },
          persona: config.persona ?? '',
          instructions: config.instructions ?? '',
          requireApproval: config.requireApproval !== false,
          memoryEnabled: config.memoryEnabled !== false,
          memory: config.memory ?? [],
          knowledge: config.knowledge ?? [],
          knowledgeTotal: config.knowledge?.length ?? 0,
          workflows: config.workflows ?? [],
          loaded: true,
          loading: false,
          error: null,
        });
        return;
      }
      set({ loading: false, loaded: true, error: json.error ?? 'Could not load the agent profile.' });
    })();

    try {
      await hydrating;
    } finally {
      hydrating = null;
    }
  },

  saveProviders: async (drafts) => {
    const json = await request<{ config?: { providers?: ProviderConfig[]; routes?: ModelRoutes } }>(
      '/api/agent/config',
      {
        method: 'PUT',
        body: JSON.stringify({ providers: drafts }),
      },
    );
    if (!json.ok) return { ok: false, error: json.error };
    set({
      providers: json.config?.providers ?? get().providers,
      routes: { ...emptyRoutes(), ...(json.config?.routes ?? get().routes) },
      loaded: true,
    });
    return { ok: true };
  },

  saveProfile: async (patch) => {
    const json = await request<{ config?: Record<string, unknown> }>('/api/agent/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    if (!json.ok) return { ok: false, error: json.error };
    set((state) => ({
      persona: patch.persona ?? state.persona,
      instructions: patch.instructions ?? state.instructions,
      requireApproval: patch.requireApproval ?? state.requireApproval,
      memoryEnabled: patch.memoryEnabled ?? state.memoryEnabled,
      routes: patch.routes ?? state.routes,
    }));
    return { ok: true };
  },

  setRoutes: (routes) => {
    set({ routes });
    void get().saveProfile({ routes });
  },

  addMemory: async (input) => {
    const json = await request<{ memory?: MemoryEntry[]; entry?: MemoryEntry }>('/api/agent/memory', {
      method: 'POST',
      body: JSON.stringify({ ...input, source: 'user' }),
    });
    if (!json.ok) return { ok: false, error: json.error };
    set({ memory: json.memory ?? get().memory });
    return { ok: true };
  },

  removeMemory: async (id) => {
    const json = await request<{ memory?: MemoryEntry[] }>(`/api/agent/memory?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
    if (json.ok) set({ memory: json.memory ?? get().memory });
  },

  clearMemory: async () => {
    const json = await request<{ memory?: MemoryEntry[] }>('/api/agent/memory', {
      method: 'DELETE',
      body: JSON.stringify({ all: true }),
    });
    if (json.ok) set({ memory: [] });
  },

  addKnowledge: async (input) => {
    const json = await request<{ item?: KnowledgeItem; total?: number }>('/api/agent/knowledge', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!json.ok || !json.item) return { ok: false, error: json.error };
    const indexItem: KnowledgeItem = { ...json.item, content: json.item.content.slice(0, 320), excerpt: true };
    set((state) => ({
      knowledge: [indexItem, ...state.knowledge.filter((item) => item.id !== indexItem.id)],
      knowledgeTotal: state.knowledgeTotal + 1,
    }));
    return { ok: true, item: json.item };
  },

  updateKnowledge: async (id, patch) => {
    const json = await request<{ item?: KnowledgeItem }>('/api/agent/knowledge', {
      method: 'PATCH',
      body: JSON.stringify({ id, ...patch }),
    });
    if (!json.ok || !json.item) return { ok: false, error: json.error };
    const item = json.item;
    set((state) => ({
      knowledge: state.knowledge.map((entry) =>
        entry.id === id ? { ...item, content: item.content.slice(0, 320), excerpt: true } : entry,
      ),
    }));
    return { ok: true };
  },

  deleteKnowledge: async (id) => {
    const json = await request<{ total?: number }>(`/api/agent/knowledge?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (json.ok) {
      set((state) => ({
        knowledge: state.knowledge.filter((item) => item.id !== id),
        knowledgeTotal: Math.max(0, state.knowledgeTotal - 1),
      }));
    }
  },

  loadKnowledge: async (id) => {
    const json = await request<{ item?: KnowledgeItem }>(`/api/agent/knowledge?id=${encodeURIComponent(id)}`);
    return json.ok && json.item ? json.item : null;
  },

  createWorkflow: async (input) => {
    const json = await request<{ workflow?: AgentWorkflow; workflows?: AgentWorkflow[] }>('/api/agent/workflows', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!json.ok || !json.workflow) return { ok: false, error: json.error };
    set({ workflows: json.workflows ?? [json.workflow, ...get().workflows] });
    return { ok: true, workflow: json.workflow };
  },

  updateWorkflow: async (id, patch, appendRun) => {
    const json = await request<{ workflow?: AgentWorkflow; workflows?: AgentWorkflow[] }>('/api/agent/workflows', {
      method: 'PATCH',
      body: JSON.stringify({ id, patch, appendRun }),
    });
    if (!json.ok || !json.workflow) return { ok: false, error: json.error };
    set({ workflows: json.workflows ?? get().workflows.map((item) => (item.id === id ? json.workflow! : item)) });
    return { ok: true, workflow: json.workflow };
  },

  deleteWorkflow: async (id) => {
    const json = await request<{ workflows?: AgentWorkflow[] }>(`/api/agent/workflows?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (json.ok) set({ workflows: json.workflows ?? get().workflows.filter((item) => item.id !== id) });
  },
}));

/** Which provider + model a scene resolves to right now (client side mirror of the server rule). */
export function resolveModelTarget(
  state: Pick<
    WorkspaceState,
    'providers' | 'routes' | 'persona' | 'instructions' | 'requireApproval'
  >,
  route: ModelRouteKey,
): ModelTarget | null {
  const binding = state.routes[route];
  const provider =
    (binding?.providerId ? state.providers.find((item) => item.id === binding.providerId) : undefined) ??
    state.providers.find((item) => item.hasKey) ??
    state.providers[0];
  if (!provider) return null;

  const model =
    (binding?.providerId === provider.id ? binding.model : '') ||
    provider.defaultModel ||
    provider.models[0] ||
    '';

  return {
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    model,
    temperature: provider.temperature,
    maxSteps: provider.maxSteps,
    contextWindow: provider.contextWindow,
    requireApproval: state.requireApproval,
    systemPrompt: state.instructions,
    persona: state.persona,
    hasKey: provider.hasKey,
    keyHint: provider.keyHint,
  };
}

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

export function isModelReady(target: ModelTarget | null | undefined) {
  if (!target) return false;
  if (!target.model || !target.baseUrl) return false;
  if (target.hasKey || target.apiKey) return true;
  try {
    return LOCAL.test(new URL(target.baseUrl).hostname);
  } catch {
    return false;
  }
}

/** The target for a scene, re-rendering when providers or routes change. */
export function useModelTarget(route: ModelRouteKey): ModelTarget | null {
  const providers = useWorkspace((state) => state.providers);
  const routes = useWorkspace((state) => state.routes);
  const persona = useWorkspace((state) => state.persona);
  const instructions = useWorkspace((state) => state.instructions);
  const requireApproval = useWorkspace((state) => state.requireApproval);
  return resolveModelTarget({ providers, routes, persona, instructions, requireApproval }, route);
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_WORKSPACE__?: typeof useWorkspace }).__AETHER_WORKSPACE__ = useWorkspace;
}

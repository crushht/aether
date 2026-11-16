import { randomUUID } from 'node:crypto';
import { readJson, withLock, writeJson } from './store';
import { decryptSecret, encryptSecret, readAgentConfig } from './accounts';
import { connectorUrl } from '@/lib/agent/connectors';
import {
  emptyRoutes,
  PROVIDER_PRESETS,
  type AgentWorkflow,
  type KnowledgeItem,
  type MemoryEntry,
  type ModelRouteKey,
  type ModelRoutes,
  type ProviderConfig,
  type ProviderDraft,
  type ConnectorConfig,
  type ConnectorDraft,
} from '@/lib/agent/types';

/**
 * The Aether profile of one account: providers, scene routes, persona, memory,
 * knowledge and workflows. A single JSON file per account keeps a backup a copy,
 * and `withLock` makes the read-modify-write safe under concurrent requests.
 *
 * Provider keys are encrypted with the instance secret and never leave this
 * module in plaintext — `publicAether()` strips them before a response.
 */

export interface StoredProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnc?: string;
  keyHint?: string;
  models: string[];
  defaultModel: string;
  embeddingModel?: string;
  temperature: number;
  maxSteps: number;
  contextWindow: number;
  presetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredConnector {
  id: string;
  name: string;
  baseUrl: string;
  tokenEnc?: string;
  tokenHint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AetherStore {
  version: number;
  providers: StoredProvider[];
  routes: ModelRoutes;
  persona: string;
  instructions: string;
  requireApproval: boolean;
  memoryEnabled: boolean;
  memory: MemoryEntry[];
  knowledge: KnowledgeItem[];
  workflows: AgentWorkflow[];
  connectors: StoredConnector[];
  updatedAt: string;
}

export interface PublicProvider extends Omit<StoredProvider, 'apiKeyEnc'> {
  hasKey: boolean;
}

export interface PublicAether {
  providers: PublicProvider[];
  routes: ModelRoutes;
  persona: string;
  instructions: string;
  requireApproval: boolean;
  memoryEnabled: boolean;
  memory: MemoryEntry[];
  knowledge: KnowledgeItem[];
  workflows: AgentWorkflow[];
  connectors: ConnectorConfig[];
  updatedAt: string;
}

const VERSION = 2;
const MAX_PROVIDERS = 12;
const MAX_MEMORY = 500;
const MAX_KNOWLEDGE = 300;
const MAX_WORKFLOWS = 60;
const MAX_CONNECTORS = 20;
const MAX_KNOWLEDGE_CHARS = 200_000;

const aetherFile = (accountId: string) => `aether/${accountId}.json`;

const now = () => new Date().toISOString();

const clampText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

function emptyStore(): AetherStore {
  return {
    version: VERSION,
    providers: [],
    routes: emptyRoutes(),
    persona: '',
    instructions: '',
    requireApproval: true,
    memoryEnabled: true,
    memory: [],
    knowledge: [],
    workflows: [],
    connectors: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function maskKey(key: string) {
  if (key.length <= 8) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function providerNameFor(baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname.replace(/^api\./, '');
    const preset = PROVIDER_PRESETS.find((item) => item.baseUrl && item.baseUrl.includes(host));
    return preset?.name ?? host;
  } catch {
    return 'Provider';
  }
}

function presetFor(baseUrl: string) {
  return PROVIDER_PRESETS.find((item) => item.baseUrl && baseUrl.startsWith(item.baseUrl.replace(/\/+$/, '')))?.id;
}

/** Older installs kept one provider; fold it into the new shape exactly once. */
function migrateLegacy(
  store: AetherStore,
  legacy: Awaited<ReturnType<typeof readAgentConfig>>,
): AetherStore {
  if (store.providers.length) return store;
  const configured = Boolean(legacy.apiKeyEnc) || legacy.updatedAt !== new Date(0).toISOString();
  if (!configured || !legacy.baseUrl) return store;

  const id = 'primary';
  const preset = presetFor(legacy.baseUrl);
  const contextWindow = PROVIDER_PRESETS.find((item) => item.id === preset)?.contextWindow ?? 128_000;
  const provider: StoredProvider = {
    id,
    name: providerNameFor(legacy.baseUrl),
    baseUrl: legacy.baseUrl,
    apiKeyEnc: legacy.apiKeyEnc,
    keyHint: legacy.keyHint ?? '',
    models: legacy.model ? [legacy.model] : [],
    defaultModel: legacy.model || '',
    temperature: legacy.temperature ?? 0.3,
    maxSteps: legacy.maxSteps ?? 8,
    contextWindow,
    presetId: preset,
    createdAt: now(),
    updatedAt: now(),
  };
  const routes = emptyRoutes();
  for (const key of Object.keys(routes) as ModelRouteKey[]) routes[key] = { providerId: id, model: '' };
  return {
    ...store,
    providers: [provider],
    routes,
    instructions: store.instructions || legacy.systemPrompt || '',
    requireApproval: store.requireApproval ?? legacy.requireApproval ?? true,
  };
}

export async function readAether(accountId: string): Promise<AetherStore> {
  const stored = await readJson<Partial<AetherStore>>(aetherFile(accountId), {});
  const base = emptyStore();
  const merged: AetherStore = {
    ...base,
    ...stored,
    version: VERSION,
    providers: Array.isArray(stored.providers) ? stored.providers : [],
    routes: { ...emptyRoutes(), ...(stored.routes ?? {}) },
    memory: Array.isArray(stored.memory) ? stored.memory : [],
    knowledge: Array.isArray(stored.knowledge) ? stored.knowledge : [],
    workflows: Array.isArray(stored.workflows) ? stored.workflows : [],
    connectors: Array.isArray(stored.connectors) ? stored.connectors : [],
    memoryEnabled: stored.memoryEnabled !== false,
    requireApproval: stored.requireApproval !== false,
  };
  const legacy = await readAgentConfig(accountId).catch(() => null);
  return legacy ? migrateLegacy(merged, legacy) : merged;
}

export function publicAether(store: AetherStore): PublicAether {
  return {
    providers: store.providers.map(({ apiKeyEnc, ...provider }) => ({
      ...provider,
      hasKey: Boolean(apiKeyEnc),
    })),
    routes: store.routes,
    persona: store.persona,
    instructions: store.instructions,
    requireApproval: store.requireApproval,
    memoryEnabled: store.memoryEnabled,
    // the index travels light: bodies live behind /api/agent/knowledge?id=
    knowledge: store.knowledge.map((item) => ({
      ...item,
      content: item.content.slice(0, 320),
      excerpt: true,
    })),
    memory: store.memory,
    workflows: store.workflows.map((workflow) => ({
      ...workflow,
      runs: workflow.runs.slice(0, 5).map((run) => ({ ...run, summary: run.summary.slice(0, 600) })),
    })),
    connectors: store.connectors.map(({ tokenEnc, ...connector }) => ({
      ...connector,
      hasToken: Boolean(tokenEnc),
      tokenHint: connector.tokenHint ?? '',
    })),
    updatedAt: store.updatedAt,
  };
}

export function providerPublic(provider: StoredProvider): ProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    hasKey: Boolean(provider.apiKeyEnc),
    keyHint: provider.keyHint ?? '',
    models: provider.models,
    defaultModel: provider.defaultModel,
    embeddingModel: provider.embeddingModel ?? '',
    temperature: provider.temperature,
    maxSteps: provider.maxSteps,
    contextWindow: provider.contextWindow,
    presetId: provider.presetId,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

async function sealProvider(input: ProviderDraft, existing?: StoredProvider): Promise<StoredProvider> {
  const id = (input.id ?? '').trim() || `pr_${randomUUID().slice(0, 8)}`;
  const baseUrl = clampText(input.baseUrl, 500).trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Base URL is required.');

  let apiKeyEnc = existing?.apiKeyEnc ?? '';
  let keyHint = existing?.keyHint ?? '';
  if (input.clearKey) {
    apiKeyEnc = '';
    keyHint = '';
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    const key = input.apiKey.trim();
    apiKeyEnc = await encryptSecret(key);
    keyHint = maskKey(key);
  }

  const models = Array.isArray(input.models)
    ? [...new Set(input.models.map((model) => String(model).trim()).filter(Boolean))].slice(0, 200)
    : existing?.models ?? [];
  const defaultModel = clampText(input.defaultModel, 120).trim() || models[0] || '';

  return {
    id,
    name: clampText(input.name, 80).trim() || providerNameFor(baseUrl),
    baseUrl,
    apiKeyEnc,
    keyHint,
    models: defaultModel && !models.includes(defaultModel) ? [defaultModel, ...models] : models,
    defaultModel,
    embeddingModel: clampText(input.embeddingModel ?? existing?.embeddingModel ?? '', 120).trim(),
    temperature: Math.min(2, Math.max(0, Number(input.temperature ?? existing?.temperature ?? 0.3))),
    maxSteps: Math.min(20, Math.max(1, Math.round(Number(input.maxSteps ?? existing?.maxSteps ?? 8)))),
    contextWindow: Math.min(2_000_000, Math.max(2_000, Math.round(Number(input.contextWindow ?? existing?.contextWindow ?? 128_000)))),
    presetId: input.presetId ?? existing?.presetId ?? presetFor(baseUrl),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
}

/** Connectors reuse the same encryption as provider keys. */
async function sealConnector(input: ConnectorDraft, existing?: StoredConnector): Promise<StoredConnector> {
  const id = (input.id ?? '').trim() || `cn_${randomUUID().slice(0, 8)}`;
  const baseUrl = clampText(input.baseUrl, 500).trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Connector base URL is required.');
  if (!connectorUrl(baseUrl, '/')) {
    throw new Error('Connector base URL must be http(s); plain http is only allowed for localhost.');
  }

  let tokenEnc = existing?.tokenEnc ?? '';
  let tokenHint = existing?.tokenHint ?? '';
  if (input.clearToken) {
    tokenEnc = '';
    tokenHint = '';
  } else if (typeof input.token === 'string' && input.token.trim()) {
    const token = input.token.trim();
    tokenEnc = await encryptSecret(token);
    tokenHint = maskKey(token);
  }

  return {
    id,
    name: clampText(input.name, 80).trim() || (() => {
      try {
        return new URL(baseUrl).hostname;
      } catch {
        return 'Connector';
      }
    })(),
    baseUrl,
    tokenEnc,
    tokenHint,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
}

export interface AetherPatch {
  providers?: ProviderDraft[];
  routes?: Partial<ModelRoutes>;
  persona?: string;
  instructions?: string;
  requireApproval?: boolean;
  memoryEnabled?: boolean;
  memory?: MemoryEntry[];
  knowledge?: KnowledgeItem[];
  workflows?: AgentWorkflow[];
  connectors?: ConnectorDraft[];
}

export async function writeAether(accountId: string, patch: AetherPatch): Promise<AetherStore> {
  return withLock(aetherFile(accountId), () => applyAetherPatch(accountId, patch));
}

/** Read-modify-write under one lock; never call writeAether from inside it. */
export async function updateAether(accountId: string, update: (store: AetherStore) => AetherPatch): Promise<AetherStore> {
  return withLock(aetherFile(accountId), async () => {
    const current = await readAether(accountId);
    return applyAetherPatch(accountId, update(current));
  });
}

/** The unlocked body, shared by writeAether and updateAether. */
async function applyAetherPatch(accountId: string, patch: AetherPatch): Promise<AetherStore> {
  const current = await readAether(accountId);

    let providers = current.providers;
    if (Array.isArray(patch.providers)) {
      const sealed: StoredProvider[] = [];
      for (const draft of patch.providers.slice(0, MAX_PROVIDERS)) {
        const existing = current.providers.find((provider) => provider.id === draft.id);
        sealed.push(await sealProvider(draft, existing));
      }
      providers = sealed;
    }

    const routes: ModelRoutes = { ...current.routes };
    if (patch.routes) {
      for (const key of Object.keys(routes) as ModelRouteKey[]) {
        const next = patch.routes[key];
        if (!next) continue;
        routes[key] = {
          providerId: typeof next.providerId === 'string' && next.providerId ? next.providerId : null,
          model: clampText(next.model, 120).trim(),
        };
      }
      // a route that points at a removed provider falls back to the first one
      for (const key of Object.keys(routes) as ModelRouteKey[]) {
        const binding = routes[key];
        if (binding.providerId && !providers.some((provider) => provider.id === binding.providerId)) {
          routes[key] = { providerId: providers[0]?.id ?? null, model: '' };
        }
      }
    }

    // first provider ever added: bind every scene instead of leaving "automatic"
    if (
      current.providers.length === 0 &&
      providers.length > 0 &&
      !Object.values(routes).some((binding) => binding.providerId)
    ) {
      for (const key of Object.keys(routes) as ModelRouteKey[]) {
        routes[key] = { providerId: providers[0].id, model: '' };
      }
    }

    const memory = Array.isArray(patch.memory)
      ? patch.memory.slice(-MAX_MEMORY).map((entry) => ({
          ...entry,
          text: clampText(entry.text, 2_000),
          at: Number(entry.at) || Date.now(),
        }))
      : current.memory;

    const knowledge = Array.isArray(patch.knowledge)
      ? patch.knowledge.slice(-MAX_KNOWLEDGE).map((item) => {
          const content = clampText(item.content, MAX_KNOWLEDGE_CHARS);
          return { ...item, content, chars: content.length, updatedAt: Number(item.updatedAt) || Date.now() };
        })
      : current.knowledge;

    const workflows = Array.isArray(patch.workflows)
      ? patch.workflows.slice(0, MAX_WORKFLOWS).map((workflow) => ({
          ...workflow,
          runs: Array.isArray(workflow.runs)
            ? workflow.runs.slice(0, 20).map((run) => ({ ...run, summary: clampText(run.summary, 4_000) }))
            : [],
        }))
      : current.workflows;

    let connectors = current.connectors;
    if (Array.isArray(patch.connectors)) {
      const sealed: StoredConnector[] = [];
      for (const draft of patch.connectors.slice(0, MAX_CONNECTORS)) {
        const existing = current.connectors.find((connector) => connector.id === draft.id);
        sealed.push(await sealConnector(draft, existing));
      }
      connectors = sealed;
    }

    const next: AetherStore = {
      ...current,
      providers,
      routes,
      persona: patch.persona !== undefined ? clampText(patch.persona, 20_000) : current.persona,
      instructions: patch.instructions !== undefined ? clampText(patch.instructions, 20_000) : current.instructions,
      requireApproval: patch.requireApproval ?? current.requireApproval,
      memoryEnabled: patch.memoryEnabled ?? current.memoryEnabled,
      memory,
      knowledge,
      workflows,
      connectors,
      version: VERSION,
      updatedAt: now(),
    };
    await writeJson(aetherFile(accountId), next);
    return next;
}

export interface ResolvedTarget {
  provider: StoredProvider;
  model: string;
  apiKey: string;
  temperature: number;
  maxSteps: number;
  contextWindow: number;
  requireApproval: boolean;
  persona: string;
  instructions: string;
}

/**
 * Which provider and model a request actually uses. Precedence:
 * explicit provider → scene route → first provider that has a key → first provider.
 */
export async function resolveTarget(
  accountId: string,
  options: { route?: ModelRouteKey; providerId?: string; model?: string } = {},
): Promise<ResolvedTarget | null> {
  const store = await readAether(accountId);
  const route = options.route ?? 'chat';
  const explicit = options.providerId ? store.providers.find((item) => item.id === options.providerId) : undefined;
  const boundId = store.routes[route]?.providerId;
  const provider =
    explicit ??
    (boundId ? store.providers.find((item) => item.id === boundId) : undefined) ??
    store.providers.find((item) => Boolean(item.apiKeyEnc)) ??
    store.providers[0];

  if (!provider) return null;

  const model =
    (options.model || '').trim() ||
    (explicit ? '' : store.routes[route]?.model || '') ||
    provider.defaultModel ||
    provider.models[0] ||
    '';

  return {
    provider,
    model,
    apiKey: provider.apiKeyEnc ? await decryptSecret(provider.apiKeyEnc) : '',
    temperature: provider.temperature,
    maxSteps: provider.maxSteps,
    contextWindow: provider.contextWindow,
    requireApproval: store.requireApproval,
    persona: store.persona,
    instructions: store.instructions,
  };
}

'use client';

import { create } from 'zustand';
import { uid } from '@/lib/utils';
import { useData } from '@/lib/store/data';
import { currentUserId } from '@/lib/session';
import { useUI } from '@/lib/store/ui';
import { useToolApprovals } from '@/lib/store/tool-approvals';
import { needsToolApproval } from './tool-approval';
import { projectContextText } from './project-context';
import { chat, ProviderError } from './provider';
import { compactMessages } from './compact';
import { getLocale, translate } from '@/lib/i18n';
import { isReadOnlyToolCall, previewTool, runTool, toolSchemas, workspaceContext, workspaceSummary } from './tools';
import { addSources, sourcesMarkdown } from './citations';
import { chatKey, useChats } from './chats';
import { isModelReady, resolveModelTarget, useWorkspace } from './workspace';
import {
  defaultAgentSettings,
  type AgentAttachment,
  type AgentLogEntry,
  type AgentMessage,
  type AgentPending,
  type AgentRunRecord,
  type AgentSettings,
  type AgentUsage,
  type ChatSource,
  type ModelRouteKey,
} from './types';

const LEGACY_SETTINGS_KEY = 'linear-lab:agent';
const SESSION_KEY = `linear-lab:agent:sessions:${currentUserId()}`;
const MAX_PERSISTED_SESSIONS = 40;
const MAX_PERSISTED_LOG = 120;
const MAX_PERSISTED_MESSAGES = 24;
/** tool cards kept per transcript when it is written to storage */
const MAX_PERSISTED_CARDS = 12;

const BASE_PROMPT = `You are the agent inside Aether, a workspace that combines issue tracking with an AI agent.
You can read and change the workspace with tools. Rules:
- Reply in the language of the user's message.
- When asked to change something, call the tools; never claim a change that no tool confirmed.
- Write tools may be rejected by the user. If a tool result says it was rejected, do not retry the same call; explain briefly or suggest another approach.
- Use issue keys like ENG-1. If you are not sure which issue is meant, call list_issues first.
- Projects and cycles are first-class: create_project / set_project / create_cycle / set_cycle organise work, and bulk_update applies one change to several issues.
- The workspace has a knowledge base: call search_knowledge before answering a question that may be covered, and read_knowledge for the body.
- You can keep durable facts with remember (a preference, a decision, a constraint). Do not remember transient state.
- You can reach the public web: web_search finds candidates, fetch_url reads a page (title, text, links) before you quote it. Quote the URL you actually read; if a lookup fails, say so instead of guessing.
- inspect_artifact triages an attachment or pasted blob (format, hashes, entropy, headers, strings, indicators) without running it. Use it before speculating about a file.
- In user-facing prose, write statuses and priorities as words in the user's language (in_progress → 进行中 / In Progress); never paste raw keys such as in_progress or high.
- Do a few focused tool calls and stop as soon as the request is satisfied.
- Keep the final answer to 1-3 short sentences, no headings, no long bullet lists.`;

/** The same agent, but the conversation is about the workspace, not one issue. */
const CHAT_PROMPT = `You are the agent inside Aether, a workspace that combines issue tracking with an AI agent.
The user is talking to you in a workspace-level chat, not about a single issue.
You can read and change the whole workspace with tools. Rules:
- Reply in the language of the user's message.
- Look things up before acting: list_issues / list_projects / list_cycles, then get_issue when you need detail.
- When asked to change something, call the tools; never claim a change that no tool confirmed.
- Write tools may be rejected by the user. If a tool result says it was rejected, do not retry the same call; explain briefly or suggest another approach.
- Use issue keys like ENG-1. Projects and cycles are first-class (create_project / set_project / create_cycle / set_cycle), and bulk_update applies one change to several issues.
- The workspace has a knowledge base (search_knowledge / read_knowledge) and durable memory (remember / recall). Use them when the answer depends on earlier context.
- You can reach the public web: web_search finds candidates, fetch_url reads the page before you quote it. Cite the URL you actually read; when a search only returns weak hits, say what you could not confirm.
- inspect_artifact triages an attachment or pasted blob (format, hashes, entropy, headers, strings, indicators) without running it — use it before guessing what a file is.
- In user-facing prose, write statuses and priorities as words in the user's language (in_progress → 进行中 / In Progress); never paste raw keys such as in_progress or high.
- Answer at the length the question deserves: a sentence for a lookup, short paragraphs or a compact list for a summary. No headings, no filler.`;

export interface AgentSession {
  targetId: string;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  messages: AgentMessage[];
  log: AgentLogEntry[];
  error?: string;
  prompt: string;
  at: number;
  pending?: AgentPending | null;
  usage?: AgentUsage;
  /** the last N finished runs of this conversation */
  runs?: AgentRunRecord[];
  /** the model that produced this transcript, for the header chip */
  model?: string;
  provider?: string;
}

interface AgentState {
  settings: AgentSettings;
  /** true once the account's configuration has been read from the server */
  ready: boolean;
  sessions: Record<string, AgentSession>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSettings: (patch: Partial<AgentSettings>) => void;
  /** store a new key on the server; the browser forgets it immediately */
  setApiKey: (key: string) => Promise<void>;
  run: (targetId: string, prompt: string, attachments?: AgentAttachment[]) => Promise<void>;
  /** re-run the last prompt of this target without retyping it */
  retry: (targetId: string) => void;
  /** drop a chosen user turn and everything after it, so it can be edited and resent */
  rewind: (targetId: string, logId?: string) => void;
  /** branch from a particular user turn without changing the original */
  branch: (targetId: string, logId: string) => string | null;
  /** re-answer the last question, without duplicating the question in the model context */
  regenerate: (targetId: string) => void;
  /** rate one final answer: up / down / clear */
  setFeedback: (targetId: string, logId: string, value: 'up' | 'down' | null) => void;
  /** whether a live run owns this target, including runs started in another view */
  isRunning: (targetId: string) => boolean;
  /** mirror a conversation's current title/transcript to the account */
  syncChat: (id: string) => void;
  cancel: (targetId: string) => void;
  reset: (targetId: string) => void;
  approve: (targetId: string) => void;
  reject: (targetId: string) => void;
  /** one-shot: turn an answer into an issue and return its key */
  toIssue: (targetId: string, text: string) => string | null;
}

const controllers = new Map<string, AbortController>();
const decisions = new Map<string, (decision: 'approve' | 'reject') => void>();
let saveTimer: number | null = null;
const syncTimers = new Map<string, number>();
let subscribed = false;

const entry = (kind: AgentLogEntry['kind'], text: string, extra?: Partial<AgentLogEntry>): AgentLogEntry => ({
  id: uid('log'),
  kind,
  text,
  at: Date.now(),
  ...extra,
});

export function estimateTokens(text: string) {
  return Math.max(1, Math.round(text.length / 3.6));
}

const stripImages = (messages: AgentMessage[]) =>
  messages.map((message) => (message.images?.length ? { ...message, images: undefined } : message));

/**
 * Tool cards are the only heavy part of a log entry (a search hit list, an
 * artifact report). Keep the newest few so a long transcript cannot eat the
 * storage quota; older rows keep their one-line receipt.
 */
function capCards(log: AgentLogEntry[], keep = MAX_PERSISTED_CARDS): AgentLogEntry[] {
  const out = [...log];
  let kept = 0;
  for (let index = out.length - 1; index >= 0; index -= 1) {
    if (!out[index].card) continue;
    if (kept < keep) {
      kept += 1;
      continue;
    }
    out[index] = { ...out[index], card: undefined };
  }
  return out;
}

/** Sessions survive a reload, but only the tail of each transcript. */
function persistSessions(sessions: Record<string, AgentSession>) {
  if (typeof window === 'undefined') return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const trimmed = Object.values(sessions)
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_PERSISTED_SESSIONS)
        .map((session) => {
          const interrupted = session.status === 'running' || session.status === 'waiting';
          const log = session.log.filter((item) => item.kind !== 'status').slice(-MAX_PERSISTED_LOG);
          const firstUser = log.findIndex((item) => item.kind === 'user');
          const validLog = capCards(firstUser > 0 ? log.slice(firstUser) : log);
          return {
            ...session,
            status: interrupted ? 'error' as const : session.status,
            error: interrupted ? 'interrupted' : session.error,
            pending: null,
            messages: session.messages.length > MAX_PERSISTED_MESSAGES ? compactMessages(stripImages(session.messages), 60_000) : stripImages(session.messages),
            log: interrupted ? [...validLog, entry('status', translate(getLocale(), 'Run interrupted'))] : validLog,
          };
        });
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(trimmed));
    } catch {
      /* quota or private mode */
    }
  }, 400);
}

/** Mirror one workspace conversation to the account so another device can continue it. */
function syncChatSession(session: AgentSession | undefined) {
  if (typeof window === 'undefined' || !session?.targetId.startsWith('chat:')) return;
  const snapshot = { ...session, log: capCards(session.log).map((item) => ({ ...item })), messages: stripImages(session.messages) };
  const timer = syncTimers.get(session.targetId);
  if (timer) window.clearTimeout(timer);
  syncTimers.set(session.targetId, window.setTimeout(() => {
    const id = session.targetId.slice('chat:'.length);
    const meta = useChats.getState().chats.find((item) => item.id === id);
    void fetch('/api/agent/sessions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat: {
          id,
          title: meta?.title || session.prompt.slice(0, 80),
          at: snapshot.at,
          prompt: snapshot.prompt,
          log: snapshot.log,
          usage: snapshot.usage,
          messages: snapshot.messages,
          runs: snapshot.runs,
          model: snapshot.model,
          provider: snapshot.provider,
          projectId: meta?.projectId ?? null,
          pinned: meta?.pinned ?? false,
        },
      }),
    }).then((response) => {
      if (!response.ok) useUI.getState().pushToast({ title: 'Conversation sync failed', description: 'Your local copy is kept; retry from the next edit.', tone: 'danger' });
    }).catch(() => {
      useUI.getState().pushToast({ title: 'Conversation is saved locally', description: 'Server sync will retry on the next change.' });
    }).finally(() => syncTimers.delete(session.targetId));
  }, 1200));
}

/** Pull conversations that were written on another device. */
async function pullChatSessions() {
  try {
    const response = await fetch('/api/agent/sessions', { cache: 'no-store' });
    if (!response.ok) return;
    const json = (await response.json()) as {
      chats?: { id: string; title: string; at: number; log?: AgentLogEntry[]; usage?: AgentUsage; prompt?: string; messages?: AgentMessage[]; runs?: import('./types').AgentRunRecord[]; model?: string; provider?: string; projectId?: string | null; pinned?: boolean }[];
    };
    const local = useAgent.getState().sessions;
    const chats = useChats.getState();
    for (const chat of json.chats ?? []) {
      const key = chatKey(chat.id);
      const existing = local[key];
      if (!chat.log?.length) continue;
      chats.remember?.({ id: chat.id, title: chat.title, at: chat.at, projectId: chat.projectId, pinned: chat.pinned });
      if (controllers.has(key) || (existing && existing.at >= chat.at)) continue;
      useAgent.setState((state) => ({
        sessions: {
          ...state.sessions,
          [key]: {
            targetId: key,
            status: 'idle',
            messages: compactMessages(chat.messages ?? [], 60_000),
            log: (chat.log ?? []).slice(-MAX_PERSISTED_LOG),
            prompt: chat.prompt ?? '',
            at: chat.at,
            usage: chat.usage,
            runs: chat.runs ?? [],
            model: chat.model,
            provider: chat.provider,
          },
        },
      }));
    }
  } catch {
    /* offline: keep the local copy */
  }
}

function buildSystemPrompt(targetId: string, settings: AgentSettings) {
  const issue = useData.getState().issues.find((item) => item.id === targetId);
  const chat = targetId.startsWith('chat:') ? useChats.getState().chats.find((item) => item.id === targetId.slice(5)) : undefined;
  const project = chat?.projectId ? useData.getState().projects.find((item) => item.id === chat.projectId) : issue?.projectId ? useData.getState().projects.find((item) => item.id === issue.projectId) : undefined;
  const workspace = useWorkspace.getState();
  const custom = settings.systemPrompt.trim();
  const persona = settings.persona.trim();

  const scopedMemory = workspace.memory.filter((item) => item.scope === 'global' || (issue ? item.scope === 'issue' && item.ref === issue.id : item.scope === 'chat' && (item.ref === targetId || item.ref === targetId.slice(5))));
  const memory =
    workspace.memoryEnabled && scopedMemory.length
      ? `\nLong-term memory (durable facts from earlier sessions; rely on them, do not list them back):\n${scopedMemory
          .slice(-24)
          .map((item) => `- [${item.scope}/${item.kind}] ${item.text}`)
          .join('\n')}`
      : '';

  const availableKnowledge = project?.knowledgeIds?.length ? workspace.knowledge.filter((item) => project.knowledgeIds?.includes(item.id)) : workspace.knowledge;
  const knowledge = availableKnowledge.length
    ? `\nKnowledge base: ${availableKnowledge.length} entries. Call search_knowledge before answering something it may cover. Titles:\n${availableKnowledge
        .slice(0, 24)
        .map((item) => `- ${item.title} (${item.kind})`)
        .join('\n')}`
    : '';

  const projectContext = project ? `\n${projectContextText(project, useData.getState().issues)}\n` : '';

  return [
    persona ? `${persona}\n\n` : '',
    project ? `You are working inside project ${project.name}. Prefer its issues and context before making workspace-wide changes.\n` : '',
    issue ? BASE_PROMPT : CHAT_PROMPT,
    custom ? `\nAdditional instructions from this workspace:\n${custom}` : '',
    memory,
    knowledge,
    projectContext,
    `\nWorkspace context:\n${issue ? workspaceContext(issue) : workspaceSummary()}`,
  ].join('');
}

function estimateContext(messages: AgentMessage[]) {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

function attachmentBlock(attachments: AgentAttachment[]) {
  return attachments
    .filter((file) => file.kind !== 'image' && file.text)
    .map((file) => `\n\n[Attached ${file.kind}: ${file.name}${file.url ? ` · ${file.url}` : ''}]\n${file.text}`)
    .join('');
}

/** `@ENG-1` or `@发布节奏` pulls an issue / knowledge entry into the turn. */
async function mentionBlock(prompt: string) {
  const tokens = [
    ...new Set([...prompt.matchAll(/@([^\s@,，。；;:：!！?？()（）]+)/g)].map((match) => match[1])),
  ].slice(0, 6);
  if (!tokens.length) return '';

  const issues = useData.getState().issues;
  const workspace = useWorkspace.getState();
  const issueLines: string[] = [];
  const knowledgeLines: string[] = [];
  const loaded = new Set<string>();

  for (const token of tokens) {
    const issue = issues.find((item) => item.key.toUpperCase() === token.toUpperCase());
    if (issue) {
      const description = issue.description.replace(/\s+/g, ' ').slice(0, 400);
      issueLines.push(
        `- ${issue.key} [${issue.status}/${issue.priority}] ${issue.title}${description ? `\n  ${description}` : ''}`,
      );
      continue;
    }

    const needle = token.toLowerCase();
    const matches = workspace.knowledge
      .filter((item) => item.title.toLowerCase().includes(needle) || item.tags.some((tag) => tag === needle))
      .slice(0, 2);
    for (const match of matches) {
      if (knowledgeLines.length >= 2) break;
      if (loaded.has(match.id)) continue;
      loaded.add(match.id);
      const full = match.excerpt ? await workspace.loadKnowledge(match.id) : match;
      const body = (full?.content ?? match.content).slice(0, 1_200);
      knowledgeLines.push(`- ${match.title} (${match.kind})\n  ${body.replace(/\n/g, '\n  ')}`);
    }
  }

  return [
    issueLines.length ? `\n\n[Referenced issues — use these, do not create duplicates]\n${issueLines.join('\n')}` : '',
    knowledgeLines.length
      ? `\n\n[Referenced knowledge — quote it when it answers the question]\n${knowledgeLines.join('\n')}`
      : '',
  ].join('');
}

export const useAgent = create<AgentState>((set, get) => {
  const patch = (targetId: string, fn: (session: AgentSession) => AgentSession) =>
    set((state) => {
      const current = state.sessions[targetId];
      if (!current) return state;
      const next = { ...state.sessions, [targetId]: fn(current) };
      next[targetId].at = Date.now();
      persistSessions(next);
      return { sessions: next };
    });

  const pendingCall = (targetId: string) => get().sessions[targetId]?.pending?.callId ?? null;

  const settle = (targetId: string, decision: 'approve' | 'reject') => {
    const callId = pendingCall(targetId);
    const resolve = callId ? decisions.get(callId) : undefined;
    if (callId) decisions.delete(callId);
    patch(targetId, (session) => ({ ...session, status: 'running', pending: null }));
    resolve?.(decision);
  };

  return {
    settings: defaultAgentSettings,
    ready: false,
    sessions: {},
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated || typeof window === 'undefined') return;

      const sessions: Record<string, AgentSession> = {};
      let legacyKey = '';

      try {
        const raw = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<AgentSettings>;
          legacyKey = saved.apiKey ?? '';
        }
        const rawSessions = window.localStorage.getItem(SESSION_KEY);
        if (rawSessions) {
          const list = JSON.parse(rawSessions) as AgentSession[];
          for (const session of list) {
            const id = session?.targetId ?? (session as { issueId?: string })?.issueId;
            if (id) sessions[id] = { ...session, targetId: id, pending: null };
          }
        }
      } catch {
        /* ignore malformed storage */
      }

      set({ sessions, hydrated: true });
      await useWorkspace.getState().hydrate();

      const resolved = resolveModelTarget(useWorkspace.getState(), 'chat');
      const migratedKey = Boolean(legacyKey) && !useWorkspace.getState().providers.length;
      set({ settings: resolved ?? { ...defaultAgentSettings, persona: useWorkspace.getState().persona }, ready: true });

      if (migratedKey && legacyKey) {
        // an old single-provider install: fold the key into a provider
        await useWorkspace.getState().saveProviders([
          {
            name: 'Imported provider',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: legacyKey,
            models: [],
            defaultModel: 'gpt-4o-mini',
            temperature: 0.3,
            maxSteps: 8,
            contextWindow: 128_000,
          },
        ]);
        const after = resolveModelTarget(useWorkspace.getState(), 'chat');
        set({ settings: after ?? get().settings });
        window.localStorage.removeItem(LEGACY_SETTINGS_KEY);
      }

      if (!subscribed) {
        subscribed = true;
        useWorkspace.subscribe(() => {
          const next = resolveModelTarget(useWorkspace.getState(), 'chat');
          if (next) set({ settings: next });
        });
      }

      void pullChatSessions();
    },

    setSettings: (patchSettings) => {
      const settings = { ...get().settings, ...patchSettings };
      set({ settings });
    },

    setApiKey: async (key) => {
      const trimmed = key.trim();
      const current = get().settings;
      const provider = useWorkspace.getState().providers.find((item) => item.id === current.providerId);
      if (!provider) return;
      await useWorkspace.getState().saveProviders([
        {
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: trimmed,
          clearKey: !trimmed,
          models: provider.models,
          defaultModel: provider.defaultModel,
          temperature: provider.temperature,
          maxSteps: provider.maxSteps,
          contextWindow: provider.contextWindow,
        },
      ]);
      const next = resolveModelTarget(useWorkspace.getState(), 'chat');
      set({ settings: next ?? get().settings });
    },

    reset: (targetId) => {
      const callId = pendingCall(targetId);
      if (callId) {
        decisions.get(callId)?.('reject');
        decisions.delete(callId);
      }
      controllers.get(targetId)?.abort();
      controllers.delete(targetId);
      set((state) => {
        const sessions = { ...state.sessions };
        delete sessions[targetId];
        persistSessions(sessions);
        return { sessions };
      });
      if (targetId.startsWith('chat:')) {
        void fetch(`/api/agent/sessions?id=${encodeURIComponent(targetId.slice(5))}`, { method: 'DELETE' }).catch(
          () => undefined,
        );
      }
    },

    retry: (targetId) => {
      const session = get().sessions[targetId];
      const prompt = session?.prompt?.trim();
      if (!prompt || !session) return;
      // Retry an interrupted run; a completed response is regenerated instead of
      // teaching the model that the same question appeared twice.
      const lastUser = session.log.map((item) => item.kind === 'user').lastIndexOf(true);
      if (lastUser >= 0 && session.log.slice(lastUser + 1).some((item) => item.kind === 'final')) {
        get().rewind(targetId, session.log[lastUser].id);
        void get().run(targetId, prompt, session.log[lastUser].attachments);
      } else {
        void get().run(targetId, prompt, session.log[lastUser]?.attachments);
      }
    },

    regenerate: (targetId) => get().retry(targetId),

    setFeedback: (targetId, logId, value) => {
      patch(targetId, (session) => ({
        ...session,
        log: session.log.map((item) =>
          item.id === logId && item.kind === 'final'
            ? { ...item, feedback: value ?? undefined }
            : item,
        ),
      }));
      syncChatSession(get().sessions[targetId]);
    },

    isRunning: (targetId) => controllers.has(targetId),

    branch: (targetId, logId) => {
      const session = get().sessions[targetId];
      if (!session || !targetId.startsWith('chat:')) return null;
      const index = session.log.findIndex((item) => item.id === logId && item.kind === 'user');
      if (index < 0) return null;
      const log = session.log.slice(0, index);
      const userMessages = session.messages.map((message, index) => (message.role === 'user' ? index : -1)).filter((index) => index >= 0);
      const selectedIndex = session.log.slice(0, index + 1).filter((item) => item.kind === 'user').length - 1;
      const messageIndex = userMessages[selectedIndex] ?? -1;
      const chat = useChats.getState().newChat({ parentId: targetId.slice(5), branchFromId: logId, projectId: useChats.getState().chats.find((item) => item.id === targetId.slice(5))?.projectId });
      const nextId = chatKey(chat.id);
      const next: AgentSession = {
        ...session,
        targetId: nextId,
        log,
        messages: messageIndex >= 0 ? session.messages.slice(0, messageIndex) : [],
        status: 'idle',
        pending: null,
        error: undefined,
        prompt: '',
        at: Date.now(),
        runs: [],
      };
      set((state) => {
        const sessions = { ...state.sessions, [nextId]: next };
        persistSessions(sessions);
        return { sessions };
      });
      const sourceId = targetId.slice(5);
      useChats.getState().rename(chat.id, `Branch · ${useChats.getState().chats.find((item) => item.id === sourceId)?.title || 'Conversation'}`);
      syncChatSession(next);
      useAgent.getState().syncChat(chat.id);
      return chat.id;
    },

    rewind: (targetId, logId) => {
      const session = get().sessions[targetId];
      if (!session || session.status === 'running' || session.status === 'waiting') return;
      const userLogIds = session.log.filter((item) => item.kind === 'user').map((item) => item.id);
      const selectedIndex = logId ? userLogIds.indexOf(logId) : userLogIds.length - 1;
      if (selectedIndex < 0) return;
      const userMessages = session.messages.map((message, index) => (message.role === 'user' ? index : -1)).filter((index) => index >= 0);
      const messageIndex = userMessages[selectedIndex] ?? -1;
      const logIndex = logId ? session.log.findIndex((item) => item.id === logId) : session.log.findLastIndex((item) => item.kind === 'user');
      patch(targetId, (current) => ({
        ...current,
        messages: messageIndex >= 0 ? current.messages.slice(0, messageIndex) : current.messages,
        log: logIndex >= 0 ? current.log.slice(0, logIndex) : current.log,
        status: 'idle',
        pending: null,
        error: undefined,
        prompt: '',
      }));
    },

    cancel: (targetId) => {
      const callId = pendingCall(targetId);
      if (callId) {
        decisions.get(callId)?.('reject');
        decisions.delete(callId);
      }
      controllers.get(targetId)?.abort();
      controllers.delete(targetId);
      patch(targetId, (session) => ({
        ...session,
        status: 'idle',
        pending: null,
        log: [...session.log, entry('status', translate(getLocale(), 'Stopped'))],
      }));
    },

    approve: (targetId) => settle(targetId, 'approve'),
    reject: (targetId) => settle(targetId, 'reject'),

    syncChat: (id) => {
      syncChatSession(get().sessions[chatKey(id)]);
    },

    toIssue: (targetId, text) => {
      const session = get().sessions[targetId];
      const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? 'Agent note';
      const title = firstLine.replace(/^#+\s*/, '').replace(/[*_`]/g, '').slice(0, 120);
      const issue = useData.getState().createIssue({ title, status: 'todo', priority: 'none' });
      useData.getState().addComment(issue.id, 'agent', text);
      if (session) useData.getState().addActivity(issue.id, 'agent', 'Created from an agent conversation', 'agent');
      return issue.key;
    },

    run: async (targetId, prompt, attachments = []) => {
      if (controllers.has(targetId)) return;
      const isChat = targetId.startsWith('chat:');
      const chatProjectId = isChat ? useChats.getState().chats.find((item) => item.id === targetId.slice(5))?.projectId : undefined;
      const issue = useData.getState().issues.find((item) => item.id === targetId);
      if (!issue && !isChat) return;

      const route: ModelRouteKey = isChat ? 'chat' : 'issue';
      await useWorkspace.getState().hydrate();
      const target = resolveModelTarget(useWorkspace.getState(), route);
      const settings = target ?? get().settings;

      if (!target || !isModelReady(target)) {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [targetId]: {
              targetId,
              status: 'error',
              messages: [],
              log: [
                entry(
                  'error',
                  target
                    ? 'This provider has no API key yet. Open Settings → Agents to add one.'
                    : 'No model provider is configured. Open Settings → Agents to add one.',
                ),
              ],
              error: target ? 'no-key' : 'no-provider',
              prompt,
              at: Date.now(),
            },
          },
        }));
        return;
      }

      const controller = new AbortController();
      controllers.set(targetId, controller);
      const startedAt = Date.now();

      const images = attachments.filter((file) => file.kind === 'image' && file.dataUrl).map((file) => file.dataUrl!);
      if (images.length && !isChat) {
        // the issue surface remains text-only until its picker exposes images
      }
      const projectInstruction = chatProjectId ? `\n\nWhen creating or updating issues for this conversation, keep them in project ${chatProjectId} unless the user asks otherwise.` : '';
      const userContent = `${prompt}${projectInstruction}${await mentionBlock(prompt)}${attachmentBlock(attachments)}`;

      const previous = get().sessions[targetId];
      const reuse = previous && previous.status !== 'error' && previous.messages.length > 0;
      const system = buildSystemPrompt(targetId, settings);
      const messages: AgentMessage[] = reuse
        ? [
            { role: 'system', content: system },
            ...previous.messages.slice(previous.messages[0]?.role === 'system' ? 1 : 0),
            { role: 'user', content: userContent, ...(images.length ? { images } : {}) },
          ]
        : [
            { role: 'system', content: system },
            { role: 'user', content: userContent, ...(images.length ? { images } : {}) },
          ];

      const usage: AgentUsage =
        previous?.usage && reuse
          ? { ...previous.usage }
          : { promptTokens: 0, completionTokens: 0, steps: 0, tools: 0 };

      set((state) => {
        const sessions = {
          ...state.sessions,
          [targetId]: {
            targetId,
            status: 'running' as const,
            messages,
            log: [
              ...(reuse ? previous.log : []),
              entry('user', prompt, attachments.length ? { attachments } : undefined),
              entry('status', translate(getLocale(), 'Thinking…')),
            ],
            prompt,
            at: Date.now(),
            usage,
            model: target.model,
            provider: target.providerName,
          },
        };
        persistSessions(sessions);
        return { sessions };
      });

      let toolCount = 0;
      const toolLines: string[] = [];
      // Everything the tools actually opened this run; the final bubble cites
      // it, and an issue comment gets the same list as Markdown.
      let sources: ChatSource[] = [];

      try {
        for (let step = 0; step < Math.max(1, target.maxSteps); step += 1) {
          let streamId: string | null = null;
          const streamedIds: string[] = [];
          const result = await chat({
            target,
            messages: compactMessages(messages, Math.round(target.contextWindow * 0.62)),
            tools: toolSchemas,
            signal: controller.signal,
            onDelta: (text) => {
              if (!streamId) {
                streamId = uid('stream');
                streamedIds.push(streamId);
                const id = streamId;
                patch(targetId, (session) => ({
                  ...session,
                  log: [...session.log, { id, kind: 'assistant', text, at: Date.now() }],
                }));
              } else {
                const id = streamId;
                patch(targetId, (session) => ({
                  ...session,
                  log: session.log.map((item) => (item.id === id ? { ...item, text: item.text + text } : item)),
                }));
              }
            },
          });

          messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls });

          usage.steps += 1;
          usage.promptTokens += result.usage?.promptTokens ?? estimateContext(messages);
          usage.completionTokens += result.usage?.completionTokens ?? estimateTokens(result.content);

          if (!result.toolCalls.length) {
            const runRecord: AgentRunRecord = {
              id: uid('run'),
              at: startedAt,
              ms: Date.now() - startedAt,
              model: target.model,
              provider: target.providerName,
              status: 'ok',
              steps: usage.steps,
              tools: usage.tools,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            };
            patch(targetId, (session) => ({
              ...session,
              status: 'done',
              usage: { ...usage },
              runs: [...(session.runs ?? []), runRecord].slice(-20),
              // the streamed copy becomes the final bubble; status rows were scaffolding
              log: [
                ...session.log.filter((item) => item.kind !== 'status' && !streamedIds.includes(item.id)),
                entry('final', result.content.trim() || '(no answer)', sources.length ? { sources } : undefined),
              ],
            }));
            if (toolCount > 0 && issue) {
              useData.getState().addActivity(targetId, 'agent', `${toolCount} tool call${toolCount > 1 ? 's' : ''}`, 'agent');
              useData.getState().pushNotification({ issueId: targetId, kind: 'agent', count: toolCount });
              const shown = toolLines.slice(0, 5);
              const extra = toolLines.length - shown.length;
              const references = sourcesMarkdown(sources);
              const body = [
                `**Agent session** · ${toolCount} tool call${toolCount > 1 ? 's' : ''}`,
                ...shown.map((line) => `- ${line}`),
                ...(extra > 0 ? [`- … +${extra} more`] : []),
                '',
                result.content.trim() || '(no answer)',
                ...(references ? ['', references] : []),
              ].join('\n');
              useData.getState().addComment(targetId, 'agent', body);
            }
            syncChatSession(get().sessions[targetId]);
            return;
          }

          for (const call of result.toolCalls) {
            const approvals = useToolApprovals.getState();
            approvals.hydrate();
            const needsApproval = needsToolApproval({
              requireApproval: settings.requireApproval,
              isReadOnly: isReadOnlyToolCall(call.name, call.args ?? {}),
              allowed: approvals.allowed,
              name: call.name,
            });

            if (needsApproval) {
              const preview = previewTool(call.name, call.args ?? {});
              const pending: AgentPending = {
                callId: call.id,
                name: call.name,
                args: call.args ?? {},
                title: preview.title,
                rows: preview.rows,
                note: preview.note,
              };
              patch(targetId, (session) => ({
                ...session,
                status: 'waiting',
                pending,
                log: [
                  ...session.log.filter((item) => item.kind !== 'status'),
                  entry('status', translate(getLocale(), 'Waiting for your approval')),
                ],
              }));
              const decision = await new Promise<'approve' | 'reject'>((resolve) => {
                decisions.set(call.id, resolve);
              });
              if (decision === 'reject') {
                const rejected = `User rejected ${call.name}. Do not retry it.`;
                messages.push({ role: 'tool', toolCallId: call.id, content: rejected });
                patch(targetId, (session) => ({
                  ...session,
                  log: [
                    ...session.log.filter((item) => item.kind !== 'status'),
                    entry('tool', 'Rejected by you', { name: call.name, ok: false, args: call.args }),
                  ],
                }));
                toolLines.push(`${call.name} · rejected`);
                continue;
              }
            }

            const outcome = await runTool(call.name, { ...call.args, targetId, ...(isChat && chatProjectId ? { projectId: chatProjectId } : {}) });
            toolCount += 1;
            usage.tools = toolCount;
            sources = addSources(sources, outcome.sources);
            toolLines.push(`${call.name} · ${outcome.summary}`);
            messages.push({ role: 'tool', toolCallId: call.id, content: outcome.content });
            patch(targetId, (session) => ({
              ...session,
              usage: { ...usage },
              log: [
                ...session.log.filter((item) => item.kind !== 'status'),
                entry('tool', outcome.summary, {
                  name: call.name,
                  ok: outcome.ok,
                  args: call.args,
                  ...(outcome.card ? { card: outcome.card } : {}),
                }),
              ],
            }));
          }
        }

        patch(targetId, (session) => ({
          ...session,
          status: 'error',
          error: 'step-limit',
          log: [...session.log, entry('error', `Stopped after ${target.maxSteps} steps. Ask again or raise the step limit.`)],
        }));
        syncChatSession(get().sessions[targetId]);
      } catch (error) {
        const aborted = controller.signal.aborted;
        const code = error instanceof ProviderError ? error.code : 'request-failed';
        const message = error instanceof Error ? error.message : String(error);
        const record: AgentRunRecord = {
          id: uid('run'),
          at: startedAt,
          ms: Date.now() - startedAt,
          model: target.model,
          provider: target.providerName,
          status: aborted ? 'stopped' : 'error',
          steps: usage.steps,
          tools: usage.tools,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          error: aborted ? undefined : message,
        };
        patch(targetId, (session) => ({
          ...session,
          status: aborted ? 'idle' : 'error',
          error: aborted ? undefined : code,
          pending: null,
          runs: [...(session.runs ?? []), record].slice(-20),
          log: aborted ? session.log : [...session.log, entry('error', message)],
        }));
        if (!aborted) syncChatSession(get().sessions[targetId]);
      } finally {
        controllers.delete(targetId);
        for (const call of messages) {
          if (call.role !== 'assistant') continue;
          for (const tool of call.toolCalls ?? []) decisions.delete(tool.id);
        }
      }
    },
  };
});

/** How full the context window is for a session, 0..1. */
export function contextUsage(session: AgentSession | undefined, contextWindow: number) {
  if (!session || !contextWindow) return 0;
  const used = estimateContext(session.messages) + (session.usage?.completionTokens ?? 0);
  return Math.min(1, used / contextWindow);
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_AGENT__?: typeof useAgent }).__AETHER_AGENT__ = useAgent;
}

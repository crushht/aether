'use client';

import { create } from 'zustand';
import { uid } from '@/lib/utils';
import { currentUserId } from '@/lib/session';

export interface ChatMeta {
  id: string;
  title: string;
  at: number;
  pinned?: boolean;
  /** optional ChatGPT-style project boundary for context and instructions */
  projectId?: string | null;
  /** source chat / message this conversation branched from */
  parentId?: string;
  branchFromId?: string;
  archivedAt?: number;
}

export interface ChatDraft {
  text: string;
  attachments: import('./types').AgentAttachment[];
  updatedAt: number;
}

const KEY = `linear-lab:chats:${currentUserId()}`;
const MAX_CHATS = 40;

interface ChatState {
  chats: ChatMeta[];
  activeId: string | null;
  hydrated: boolean;
  hydrate: () => void;
  newChat: (input?: Partial<Pick<ChatMeta, 'projectId' | 'parentId' | 'branchFromId'>>) => ChatMeta;
  select: (id: string) => void;
  /** the first user message becomes the title, like every chat product */
  title: (id: string, text: string) => void;
  rename: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  /** merge a conversation discovered on the server */
  remember: (chat: ChatMeta) => void;
  setProject: (id: string, projectId: string | null) => void;
  remove: (id: string) => void;
}

const sort = (chats: ChatMeta[]) =>
  [...chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.at - a.at);

function persist(chats: ChatMeta[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
  } catch {
    /* quota */
  }
}

const blank = (): ChatMeta => ({ id: uid('chat'), title: '', at: Date.now() });

export const useChats = create<ChatState>((set, get) => ({
  chats: [],
  activeId: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    let chats: ChatMeta[] = [];
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as ChatMeta[];
        if (Array.isArray(saved)) chats = saved.filter((chat) => chat && chat.id);
      }
    } catch {
      /* malformed */
    }
    chats = sort(chats);
    set({ chats, hydrated: true, activeId: chats[0]?.id ?? null });
  },

  newChat: (input = {}) => {
    const chat = { ...blank(), ...input };
    set((state) => {
      const chats = sort([chat, ...state.chats]).slice(0, MAX_CHATS);
      persist(chats);
      return { chats, activeId: chat.id };
    });
    return chat;
  },

  select: (id) => set({ activeId: id }),

  title: (id, text) => {
    const title = text.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!title) return;
    set((state) => {
      const chats = state.chats.map((chat) => (chat.id === id && !chat.title ? { ...chat, title, at: Date.now() } : chat));
      persist(chats);
      return { chats };
    });
  },

  rename: (id, title) => {
    const next = title.replace(/\s+/g, ' ').trim().slice(0, 60);
    set((state) => {
      const chats = state.chats.map((chat) => (chat.id === id ? { ...chat, title: next || chat.title } : chat));
      persist(chats);
      return { chats };
    });
  },

  togglePin: (id) => {
    set((state) => {
      const chats = sort(state.chats.map((chat) => (chat.id === id ? { ...chat, pinned: !chat.pinned } : chat)));
      persist(chats);
      return { chats };
    });
  },

  remember: (chat) => {
    set((state) => {
      const exists = state.chats.some((item) => item.id === chat.id);
      const chats = sort(exists ? state.chats.map((item) => (item.id === chat.id ? { ...item, ...chat } : item)) : [chat, ...state.chats]).slice(0, MAX_CHATS);
      persist(chats);
      return { chats, activeId: state.activeId ?? chat.id };
    });
  },

  setProject: (id, projectId) => {
    set((state) => {
      const chats = state.chats.map((chat) => (chat.id === id ? { ...chat, projectId } : chat));
      persist(chats);
      return { chats };
    });
  },

  remove: (id) => {
    set((state) => {
      const chats = state.chats.filter((chat) => chat.id !== id);
      persist(chats);
      return { chats, activeId: state.activeId === id ? (chats[0]?.id ?? null) : state.activeId };
    });
  },
}));

/** The agent session key for a conversation. */
export const chatKey = (id: string) => `chat:${id}`;

// Dev-only debug handle for browser tests
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_DEBUG__?: { useChats: typeof useChats } }).__AETHER_DEBUG__ = { useChats };
}

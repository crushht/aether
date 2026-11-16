'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';
import { isStringArray, readStorage, writeStorage } from './storage';

const KEY = `linear-lab:chat-history:${currentUserId()}`;
const MAX = 30;

const persist = (entries: string[]) => writeStorage(KEY, entries.slice(0, MAX));

interface State {
  entries: string[];
  hydrated: boolean;
  hydrate: () => void;
  push: (text: string) => void;
  clear: () => void;
}

/** Recently sent prompts, newest first, for ArrowUp recall in the composer. */
export const useChatInputHistory = create<State>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    set({ entries: readStorage(KEY, (value) => isStringArray(value, MAX), []), hydrated: true });
  },

  push: (text) => {
    const value = text.replace(/\s+/g, ' ').trim().slice(0, 2_000);
    if (!value) return;
    set((state) => {
      const entries = [value, ...state.entries.filter((entry) => entry !== value)].slice(0, MAX);
      persist(entries);
      return { entries };
    });
  },

  clear: () => {
    persist([]);
    set({ entries: [] });
  },
}));

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_CHAT_HISTORY__?: typeof useChatInputHistory }).__AETHER_CHAT_HISTORY__ =
    useChatInputHistory;
}

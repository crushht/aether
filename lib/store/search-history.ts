'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';
import { isStringArray, readStorage, writeStorage } from './storage';

const KEY = `linear-lab:search-history:${currentUserId()}`;
const MAX = 6;

const persist = (entries: string[]) => writeStorage(KEY, entries.slice(0, MAX));

interface State {
  entries: string[];
  hydrated: boolean;
  hydrate: () => void;
  push: (query: string) => void;
  clear: () => void;
}

/** Recent global-search queries, newest first. */
export const useSearchHistory = create<State>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    set({ entries: readStorage(KEY, (value) => isStringArray(value, MAX), []), hydrated: true });
  },

  push: (query) => {
    const value = query.replace(/\s+/g, ' ').trim().slice(0, 120);
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
  (window as unknown as { __AETHER_SEARCH_HISTORY__?: typeof useSearchHistory }).__AETHER_SEARCH_HISTORY__ =
    useSearchHistory;
}

'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';
import { isStringArray, readStorage, writeStorage } from './storage';

const KEY = `linear-lab:allowed-tools:${currentUserId()}`;
const MAX = 30;

const persist = (allowed: string[]) => writeStorage(KEY, allowed.slice(0, MAX));

interface State {
  allowed: string[];
  hydrated: boolean;
  hydrate: () => void;
  allow: (name: string) => void;
  revoke: (name: string) => void;
  clear: () => void;
  isAllowed: (name: string) => boolean;
}

/** "Always allow this tool" decisions, kept per account in this browser. */
export const useToolApprovals = create<State>((set, get) => ({
  allowed: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    set({ allowed: readStorage(KEY, (value) => isStringArray(value, MAX), []), hydrated: true });
  },

  allow: (name) => {
    const tool = name.trim().slice(0, 80);
    if (!tool) return;
    set((state) => {
      if (state.allowed.includes(tool)) return state;
      const allowed = [...state.allowed, tool].slice(0, MAX);
      persist(allowed);
      return { allowed };
    });
  },

  revoke: (name) => {
    set((state) => {
      const allowed = state.allowed.filter((tool) => tool !== name);
      persist(allowed);
      return { allowed };
    });
  },

  clear: () => {
    persist([]);
    set({ allowed: [] });
  },

  isAllowed: (name) => get().allowed.includes(name),
}));

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_TOOL_APPROVALS__?: typeof useToolApprovals }).__AETHER_TOOL_APPROVALS__ =
    useToolApprovals;
}

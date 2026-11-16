'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';
import { type DisplayOptions, type Filters, type SortKey, type TabKey, useView } from './view';
import type { ViewMode } from '@/lib/types';

export interface SavedView {
  id: string;
  name: string;
  tab: TabKey;
  sort: SortKey;
  filters: Filters;
  viewMode: ViewMode;
  display: DisplayOptions;
  createdAt: number;
}

const KEY = `linear-lab:saved-views:${currentUserId()}`;
const MAX_VIEWS = 40;

const persist = (views: SavedView[]) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(views.slice(0, MAX_VIEWS)));
  } catch {
    /* quota */
  }
};

interface SavedViewsState {
  views: SavedView[];
  hydrated: boolean;
  hydrate: () => void;
  /** snapshot the current list/board state under a name */
  saveCurrent: (name: string) => SavedView | null;
  /** overwrite an existing view with the current state */
  updateFromCurrent: (id: string) => void;
  apply: (id: string) => boolean;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

export const useSavedViews = create<SavedViewsState>((set, get) => ({
  views: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    let views: SavedView[] = [];
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedView[];
        if (Array.isArray(parsed)) {
          views = parsed.filter(
            (view) => view && typeof view.id === 'string' && typeof view.name === 'string' && view.filters && view.display,
          );
        }
      }
    } catch {
      /* malformed */
    }
    set({ views, hydrated: true });
  },

  saveCurrent: (name) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return null;
    const view = useView.getState();
    const entry: SavedView = {
      id: `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: trimmed,
      tab: view.tab,
      sort: view.sort,
      filters: { ...view.filters },
      viewMode: view.viewMode,
      display: { ...view.display },
      createdAt: Date.now(),
    };
    set((state) => {
      const views = [entry, ...state.views].slice(0, MAX_VIEWS);
      persist(views);
      return { views };
    });
    return entry;
  },

  updateFromCurrent: (id) => {
    const view = useView.getState();
    set((state) => {
      const views = state.views.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              tab: view.tab,
              sort: view.sort,
              filters: { ...view.filters },
              viewMode: view.viewMode,
              display: { ...view.display },
            }
          : entry,
      );
      persist(views);
      return { views };
    });
  },

  apply: (id) => {
    const entry = get().views.find((view) => view.id === id);
    if (!entry) return false;
    useView.setState({
      tab: entry.tab,
      sort: entry.sort,
      filters: { ...entry.filters },
      viewMode: entry.viewMode,
      display: { ...entry.display },
      // a view is a fresh starting point: stale selection/composer must not leak
      selectedIds: [],
      cursorId: null,
      composing: null,
    });
    return true;
  },

  rename: (id, name) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    set((state) => {
      const views = state.views.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry));
      persist(views);
      return { views };
    });
  },

  remove: (id) => {
    set((state) => {
      const views = state.views.filter((entry) => entry.id !== id);
      persist(views);
      return { views };
    });
  },
}));

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_SAVED_VIEWS__?: typeof useSavedViews }).__AETHER_SAVED_VIEWS__ = useSavedViews;
}

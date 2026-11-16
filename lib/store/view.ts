'use client';

import { create } from 'zustand';
import type { Priority, StatusKey, ViewMode } from '../types';
import { NOW } from '../mock-data';
import { currentUserId } from '../session';
import { useData } from './data';

const ISSUE_HISTORY_KEY = '__aetherIssue';

export type SortKey = 'manual' | 'priority' | 'updated' | 'created';
export type TabKey = 'all' | 'active' | 'backlog';
export type DueFilter = 'any' | 'overdue' | 'this_week' | 'no_date';
export type GroupKey = 'status' | 'assignee' | 'none';

export interface Filters {
  status: StatusKey[];
  priority: Priority[];
  assigneeId: string[];
  labelIds: string[];
  /** due-date window; 'any' means no restriction */
  due: DueFilter;
  query: string;
}

export const emptyFilters: Filters = {
  status: [],
  priority: [],
  assigneeId: [],
  labelIds: [],
  due: 'any',
  query: '',
};

/**
 * A page-level restriction (My issues / Reviews). Kept apart from `filters`
 * so a page can scope the list without overwriting what the user picked.
 */
export interface IssueScope {
  /** assigned to or created by this person */
  mineId?: string;
  status?: StatusKey[];
}

export interface DisplayOptions {
  showEmptyGroups: boolean;
  showLabels: boolean;
  showPriority: boolean;
  showAssignee: boolean;
  showDates: boolean;
  showId: boolean;
}

interface ViewState {
  viewMode: ViewMode;
  tab: TabKey;
  sort: SortKey;
  groupBy: GroupKey;
  filters: Filters;
  scope: IssueScope | null;
  display: DisplayOptions;
  selectedIds: string[];
  cursorId: string | null;
  activeIssueId: string | null;
  collapsedGroups: string[];
  composing: StatusKey | null;
  setComposing: (status: StatusKey | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setTab: (tab: TabKey) => void;
  setSort: (sort: SortKey) => void;
  setGroupBy: (group: GroupKey) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  toggleFilterValue: (key: 'status' | 'priority' | 'assigneeId' | 'labelIds', value: string) => void;
  clearFilters: () => void;
  setScope: (scope: IssueScope | null) => void;
  toggleDisplay: (key: keyof DisplayOptions) => void;
  setCursor: (id: string | null) => void;
  select: (id: string, mode?: 'single' | 'toggle' | 'range', ordered?: string[]) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  openIssue: (id: string) => void;
  closeIssue: () => void;
  toggleGroup: (key: string) => void;
  isCollapsed: (key: string) => boolean;
}

export const useView = create<ViewState>((set, get) => ({
  viewMode: 'list',
  tab: 'all',
  sort: 'manual',
  groupBy: 'status',
  filters: emptyFilters,
  scope: null,
  display: {
    showEmptyGroups: false,
    showLabels: true,
    showPriority: true,
    showAssignee: true,
    showDates: true,
    showId: true,
  },
  selectedIds: [],
  cursorId: null,
  activeIssueId: null,
  collapsedGroups: [],
  composing: null,

  setComposing: (composing) => set({ composing }),
  setViewMode: (viewMode) => set({ viewMode }),
  setTab: (tab) => set({ tab }),
  setSort: (sort) => set({ sort }),
  setGroupBy: (groupBy) => set({ groupBy }),
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  toggleFilterValue: (key, value) =>
    set((s) => {
      const list = s.filters[key] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { filters: { ...s.filters, [key]: next } };
    }),
  clearFilters: () => set({ filters: emptyFilters }),
  setScope: (scope) => set({ scope }),
  toggleDisplay: (key) => set((s) => ({ display: { ...s.display, [key]: !s.display[key] } })),

  // J/K moves a *cursor*, it does not select (selection stays explicit via X / checkbox)
  setCursor: (cursorId) => set({ cursorId }),

  select: (id, mode = 'single', ordered = []) => {
    const { cursorId, selectedIds } = get();
    if (mode === 'single') {
      set({ selectedIds: [id], cursorId: id });
      return;
    }
    if (mode === 'toggle') {
      set({
        selectedIds: selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id],
        cursorId: id,
      });
      return;
    }
    // range
    const anchor = cursorId ?? id;
    const a = ordered.indexOf(anchor);
    const b = ordered.indexOf(id);
    if (a === -1 || b === -1) {
      set({ selectedIds: [id], cursorId: id });
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    set({ selectedIds: ordered.slice(lo, hi + 1), cursorId: id });
  },

  selectMany: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [] }),

  openIssue: (id) => {
    const issue = useData.getState().issues.find((row) => row.id === id || row.key.toLowerCase() === id.toLowerCase());
    if (issue) {
      const url = new URL(window.location.href);
      const current = url.searchParams.get('issue');
      const resolved = current?.toLowerCase() === issue.key.toLowerCase() || current === issue.id;
      if (resolved) {
        if (current !== issue.key) {
          url.searchParams.set('issue', issue.key);
          window.history.replaceState(window.history.state, '', url);
        }
      } else {
        url.searchParams.set('issue', issue.key);
        window.history.pushState(
          { ...(window.history.state ?? {}), [ISSUE_HISTORY_KEY]: true },
          '',
          url,
        );
      }
    }
    set({ activeIssueId: issue?.id ?? id });
  },
  closeIssue: () => {
    const url = new URL(window.location.href);
    if (!get().activeIssueId && !url.searchParams.has('issue')) return;
    set({ activeIssueId: null });
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.[ISSUE_HISTORY_KEY]) {
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete('issue');
      window.history.replaceState(window.history.state, '', url);
    }
  },

  toggleGroup: (key) =>
    set((s) => ({
      collapsedGroups: s.collapsedGroups.includes(key)
        ? s.collapsedGroups.filter((k) => k !== key)
        : [...s.collapsedGroups, key],
    })),

  isCollapsed: (key) => get().collapsedGroups.includes(key),
}));

/** Sort helper shared by list + board so both read the same order. */
export function sortIssues<T extends { priority: string; updatedAt: string; createdAt: string }>(
  issues: T[],
  sort: SortKey,
) {
  const weight: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
  const arr = [...issues];
  if (sort === 'priority') arr.sort((a, b) => weight[a.priority] - weight[b.priority]);
  if (sort === 'updated') arr.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  if (sort === 'created') arr.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return arr;
}

export const viewNow = NOW;

const VIEW_KEY = `linear-lab:view:${currentUserId()}`;

const defaultDisplay: DisplayOptions = {
  showEmptyGroups: false,
  showLabels: true,
  showPriority: true,
  showAssignee: true,
  showDates: true,
  showId: true,
};

/**
 * View preferences survive a reload; filters do not (a stale filter that hides
 * everything is worse than starting fresh).
 */
export function hydrateView() {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Pick<ViewState, 'viewMode' | 'sort' | 'groupBy' | 'display' | 'collapsedGroups'>>;
      useView.setState({
        viewMode: saved.viewMode === 'board' ? 'board' : 'list',
        sort: saved.sort ?? 'manual',
        groupBy: saved.groupBy === 'assignee' || saved.groupBy === 'none' ? saved.groupBy : 'status',
        display: { ...defaultDisplay, ...(saved.display ?? {}) },
        collapsedGroups: Array.isArray(saved.collapsedGroups)
          ? saved.collapsedGroups.filter((key): key is string => typeof key === 'string').slice(0, 40)
          : [],
      });
    }
  } catch {
    /* malformed */
  }

  useView.subscribe((state, previous) => {
    if (
      state.viewMode === previous.viewMode &&
      state.sort === previous.sort &&
      state.groupBy === previous.groupBy &&
      state.display === previous.display &&
      state.collapsedGroups === previous.collapsedGroups
    ) {
      return;
    }
    try {
      window.localStorage.setItem(
        VIEW_KEY,
        JSON.stringify({
          viewMode: state.viewMode,
          sort: state.sort,
          groupBy: state.groupBy,
          display: state.display,
          collapsedGroups: state.collapsedGroups,
        }),
      );
    } catch {
      /* quota */
    }
  });
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_VIEW__?: typeof useView }).__AETHER_VIEW__ = useView;
}

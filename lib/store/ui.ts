'use client';

import { create } from 'zustand';
import { uid } from '../utils';
import { setActiveLocale, type Locale } from '../i18n';
import { useView } from './view';

export type QuickEditKind = 'status' | 'priority' | 'assignee' | 'labels';

/** A property menu opened from the keyboard (S / P / A / L) on the cursor row or selection. */
export interface QuickEdit {
  kind: QuickEditKind;
  ids: string[];
  /** viewport coordinates to hang the menu from */
  left: number;
  top: number;
}

export interface Toast {
  id: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'success' | 'danger';
}

interface UIState {
  sidebarCollapsed: boolean;
  /** Overlay drawer state for widths below `lg`; independent of the desktop collapse. */
  mobileNavOpen: boolean;
  commandOpen: boolean;
  commandQuery: string;
  /** the workspace-level agent chat (⌘J) */
  chatOpen: boolean;
  chatProjectId: string | null;
  helpOpen: boolean;
  chord: string | null;
  toasts: Toast[];
  theme: 'dark' | 'light';
  locale: Locale;
  quickEdit: QuickEdit | null;
  /** inbox read state is per person, so it lives with the other preferences */
  readNotifications: string[];
  markNotificationRead: (id: string) => void;
  markNotificationUnread: (id: string) => void;
  toggleNotificationRead: (id: string) => void;
  markAllNotificationsRead: (ids: string[]) => void;
  setReadNotifications: (ids: string[]) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setMobileNavOpen: (v: boolean) => void;
  toggleMobileNav: () => void;
  openCommand: (query?: string) => void;
  closeCommand: () => void;
  openChat: (projectId?: string) => void;
  closeChat: () => void;
  toggleChat: () => void;
  setHelpOpen: (v: boolean) => void;
  setChord: (c: string | null) => void;
  pushToast: (t: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  setTheme: (t: 'dark' | 'light') => void;
  setLocale: (l: Locale) => void;
  openQuickEdit: (kind: QuickEditKind) => void;
  closeQuickEdit: () => void;
}

export const useUI = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  commandOpen: false,
  commandQuery: '',
  chatOpen: false,
  chatProjectId: null,
  helpOpen: false,
  chord: null,
  toasts: [],
  theme: 'dark',
  locale: 'zh',
  quickEdit: null,
  readNotifications: [],

  markNotificationRead: (id) =>
    set((state) =>
      state.readNotifications.includes(id) ? state : { readNotifications: [...state.readNotifications, id] },
    ),
  markNotificationUnread: (id) =>
    set((state) => ({ readNotifications: state.readNotifications.filter((entry) => entry !== id) })),
  toggleNotificationRead: (id) =>
    set((state) =>
      state.readNotifications.includes(id)
        ? { readNotifications: state.readNotifications.filter((entry) => entry !== id) }
        : { readNotifications: [...state.readNotifications, id] },
    ),
  markAllNotificationsRead: (ids) =>
    set((state) => ({
      readNotifications: [...new Set([...state.readNotifications, ...ids])].slice(-500),
    })),
  setReadNotifications: (ids) => set({ readNotifications: ids.slice(-500) }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  openCommand: (query = '') => set({ commandOpen: true, commandQuery: query }),
  closeCommand: () => set({ commandOpen: false, commandQuery: '' }),
  openChat: (projectId) => set({ chatOpen: true, chatProjectId: projectId ?? null }),
  closeChat: () => set({ chatOpen: false, chatProjectId: null }),
  toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),
  setHelpOpen: (v) => set({ helpOpen: v }),
  setChord: (chord) => set({ chord }),

  pushToast: (t) => {
    const id = uid('toast');
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        if (get().toasts.some((x) => x.id === id)) get().dismissToast(id);
      }, 4200);
    }
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
  },

  setLocale: (locale) => {
    set({ locale });
    setActiveLocale(locale);
  },

  openQuickEdit: (kind) => {
    if (typeof document === 'undefined') return;
    const view = useView.getState();
    const ids = view.selectedIds.length ? view.selectedIds : view.cursorId ? [view.cursorId] : [];
    if (!ids.length) return;
    const row =
      document.querySelector<HTMLElement>(`[data-issue-row="${ids[0]}"]`) ??
      document.querySelector<HTMLElement>(`[data-card-id="${ids[0]}"]`);
    const rect = row?.getBoundingClientRect();
    // hang it off the row's status glyph; rows outside the viewport fall back to the middle
    const left = rect ? Math.round(rect.left + 30) : Math.round(window.innerWidth / 2 - 110);
    const top = rect ? Math.round(Math.min(rect.bottom - 2, window.innerHeight - 320)) : 180;
    set({ quickEdit: { kind, ids, left, top } });
  },
  closeQuickEdit: () => set({ quickEdit: null }),
}));

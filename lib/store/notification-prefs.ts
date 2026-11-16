'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';
import { normalizeQuiet, type QuietHours } from '@/lib/notification-quiet';
import type { AppNotification } from '@/lib/types';
import { readStorage, writeStorage } from './storage';

export type NotificationKind = AppNotification['kind'];
export type NotificationChannel = 'inbox' | 'desktop';

const KINDS: NotificationKind[] = ['mention', 'agent', 'cycle', 'project_update', 'digest'];

interface Prefs {
  inbox: Record<NotificationKind, boolean>;
  desktop: Record<NotificationKind, boolean>;
  quiet: QuietHours;
}

const defaults = (): Prefs => ({
  inbox: { mention: true, agent: true, cycle: true, project_update: true, digest: true },
  desktop: { mention: true, agent: false, cycle: false, project_update: false, digest: false },
  quiet: normalizeQuiet(undefined),
});

const KEY = `linear-lab:notification-prefs:${currentUserId()}`;

const persist = (prefs: Prefs) => writeStorage(KEY, prefs);

interface State extends Prefs {
  hydrated: boolean;
  hydrate: () => void;
  setEnabled: (channel: NotificationChannel, kind: NotificationKind, enabled: boolean) => void;
  setQuiet: (patch: Partial<QuietHours>) => void;
  enabled: (channel: NotificationChannel, kind: NotificationKind) => boolean;
}

export const useNotificationPrefs = create<State>((set, get) => ({
  ...defaults(),
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    const prefs = defaults();
    const parsed = readStorage<Partial<Prefs> | null>(
      KEY,
      (value) => (value && typeof value === 'object' ? (value as Partial<Prefs>) : null),
      null,
    );
    if (parsed) {
      for (const channel of ['inbox', 'desktop'] as const) {
        for (const kind of KINDS) {
          const value = parsed?.[channel]?.[kind];
          if (typeof value === 'boolean') prefs[channel][kind] = value;
        }
      }
      prefs.quiet = normalizeQuiet(parsed?.quiet);
    }
    set({ ...prefs, hydrated: true });
  },

  setEnabled: (channel, kind, enabled) => {
    set((state) => {
      const next: Prefs = {
        inbox: { ...state.inbox },
        desktop: { ...state.desktop },
        quiet: state.quiet,
      };
      next[channel][kind] = enabled;
      persist(next);
      return next;
    });
  },

  setQuiet: (patch) => {
    set((state) => {
      const next: Prefs = {
        inbox: state.inbox,
        desktop: state.desktop,
        quiet: normalizeQuiet({ ...state.quiet, ...patch }),
      };
      persist(next);
      return next;
    });
  },

  enabled: (channel, kind) => get()[channel][kind] ?? true,
}));

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_NOTIFICATION_PREFS__?: typeof useNotificationPrefs }).__AETHER_NOTIFICATION_PREFS__ =
    useNotificationPrefs;
}

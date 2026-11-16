'use client';

import * as React from 'react';

const KEY = 'linear-lab:recent-commands';
const EVENT = 'linear-lab:recent';
const LIMIT = 6;

export function readRecentCommands(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const next = [id, ...readRecentCommands().filter((x) => x !== id)].slice(0, LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* private windows can refuse storage */
  }
}

export function clearRecentCommands() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* private windows can refuse storage */
  }
}

/** Recently executed palette entries, newest first; stays in sync across tabs. */
export function useRecentCommands() {
  const [ids, setIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    const sync = () => setIds(readRecentCommands());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return ids;
}

'use client';

import { useUI } from './store/ui';
import { useView, type DisplayOptions } from './store/view';

interface ServerPrefs {
  theme?: 'dark' | 'light';
  locale?: 'zh' | 'en';
  sidebarCollapsed?: boolean;
  readNotifications?: string[];
  display?: Partial<DisplayOptions>;
}

let started = false;
let timer: number | null = null;

function apply(prefs: ServerPrefs) {
  const ui = useUI.getState();
  if (prefs.theme === 'dark' || prefs.theme === 'light') ui.setTheme(prefs.theme);
  if (prefs.locale === 'zh' || prefs.locale === 'en') ui.setLocale(prefs.locale);
  if (typeof prefs.sidebarCollapsed === 'boolean') ui.setSidebarCollapsed(prefs.sidebarCollapsed);
  if (Array.isArray(prefs.readNotifications)) ui.setReadNotifications(prefs.readNotifications);
  if (prefs.display && typeof prefs.display === 'object') {
    useView.setState((state) => ({ display: { ...state.display, ...prefs.display } }));
  }
}

function snapshot() {
  const ui = useUI.getState();
  const view = useView.getState();
  return {
    theme: ui.theme,
    locale: ui.locale,
    sidebarCollapsed: ui.sidebarCollapsed,
    readNotifications: ui.readNotifications,
    display: view.display,
  };
}

function schedulePush() {
  if (typeof window === 'undefined') return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot()),
    }).catch(() => undefined);
  }, 800);
}

/**
 * Preferences belong to the account: theme, language, sidebar, column display
 * and inbox read state follow you between browsers. localStorage still paints
 * the first frame; the server copy wins once it arrives.
 */
export async function startPrefsSync() {
  if (started || typeof window === 'undefined') return;
  started = true;

  let remote: ServerPrefs | null = null;
  try {
    const response = await fetch('/api/prefs', { cache: 'no-store' });
    if (response.ok) {
      const json = (await response.json()) as { prefs?: ServerPrefs };
      remote = json.prefs ?? {};
      apply(remote);
    }
  } catch {
    /* offline: stay on the browser copy */
  }

  // seed the server with whatever this browser already had
  const empty = !remote || (!remote.theme && !remote.locale && !remote.readNotifications?.length);
  if (empty) schedulePush();

  useUI.subscribe((state, previous) => {
    if (
      state.theme !== previous.theme ||
      state.locale !== previous.locale ||
      state.sidebarCollapsed !== previous.sidebarCollapsed ||
      state.readNotifications !== previous.readNotifications
    ) {
      schedulePush();
    }
  });

  useView.subscribe((state, previous) => {
    if (state.display !== previous.display) schedulePush();
  });
}

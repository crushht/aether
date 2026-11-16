'use client';

import * as React from 'react';
import { MotionConfig } from 'framer-motion';
import { Sidebar } from './sidebar';
import { Topbar } from '@/components/topbar/topbar';
import { CommandMenu } from '@/components/command/command-menu';
import { RealtimeStatus } from '@/components/shell/realtime-status';
import { DeepLinks } from '@/components/shell/deep-links';
import { HelpSheet } from '@/components/overlays/help-sheet';
import { IssueDrawer } from '@/components/issue/issue-drawer';
import { Toasts } from '@/components/ui/toasts';
import { DesktopNotifications } from './desktop-notifications';
import { ShortcutLayer } from './shortcuts';
import { QuickEdit } from './quick-edit';
import { IssueRouting } from './issue-routing';
import { AuthGate } from './auth-gate';
import { AgentChat } from '@/components/agent/agent-chat';
import { useUI } from '@/lib/store/ui';
import { useView, hydrateView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { startPrefsSync } from '@/lib/prefs-sync';
import { startWorkflowScheduler } from '@/lib/agent/workflow-runner';
import { startWorkspaceEvents } from '@/lib/store/workspace-events';

function usePersistedPreferences() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUI((s) => s.setSidebarCollapsed);
  const locale = useUI((s) => s.locale);
  const setLocale = useUI((s) => s.setLocale);

  // read once after mount (the inline script already painted the theme)
  React.useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('linear-lab:theme');
      // dark is the product default; an explicit "light" is the only override
      if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
      const savedSidebar = localStorage.getItem('linear-lab:sidebar');
      if (savedSidebar === 'collapsed') setSidebarCollapsed(true);
      else if (!savedSidebar && window.innerWidth < 900) setSidebarCollapsed(true);
      document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';
      const savedLocale = localStorage.getItem('linear-lab:locale');
      setLocale(savedLocale === 'en' ? 'en' : 'zh');
    } catch {
      /* storage can be unavailable in private windows */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem('linear-lab:theme', theme);
    } catch {}
  }, [theme]);

  React.useEffect(() => {
    try {
      localStorage.setItem('linear-lab:sidebar', sidebarCollapsed ? 'collapsed' : 'open');
    } catch {}
  }, [sidebarCollapsed]);

  React.useEffect(() => {
    try {
      localStorage.setItem('linear-lab:locale', locale);
    } catch {}
  }, [locale]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <ShellInner>{children}</ShellInner>
    </AuthGate>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  usePersistedPreferences();
  const drawerOpen = useView((s) => Boolean(s.activeIssueId));

  // the workspace lives in localStorage; the first paint renders the empty one
  React.useEffect(() => {
    useData.getState().hydrate();
    hydrateView();
    void startPrefsSync();
    startWorkflowScheduler();
    const stopEvents = startWorkspaceEvents();
    return stopEvents;
  }, []);

  // another tab (or another browser) may have written since; pull on focus
  React.useEffect(() => {
    let last = 0;
    const pull = () => {
      if (Date.now() - last < 3000) return;
      last = Date.now();
      void useData.getState().refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull();
    };
    window.addEventListener('focus', pull);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', pull);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh w-full overflow-hidden bg-base text-t1">
      <Sidebar />
      {/* the drawer owns focus while it is open: the page behind it is inert */}
      <main
        aria-hidden={drawerOpen || undefined}
        inert={drawerOpen || undefined}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden border-l border-[var(--line-subtle)] bg-panel"
      >
        <Topbar />
        <div
          id="app-scroll"
          className="scroll-container relative flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        >
          {children}
        </div>
      </main>
      <IssueRouting />
      <IssueDrawer />
      <CommandMenu />
      <RealtimeStatus />
      <DeepLinks />
      <AgentChat />
      <HelpSheet />
      <Toasts />
      <DesktopNotifications />
      <QuickEdit />
      <ShortcutLayer />
    </div>
    </MotionConfig>
  );
}

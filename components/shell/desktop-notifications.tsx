'use client';

import * as React from 'react';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useRouter } from 'next/navigation';
import { useNotificationPrefs } from '@/lib/store/notification-prefs';
import { getLocale, translate } from '@/lib/i18n';
import { canNotifyDesktop } from '@/lib/notification-quiet';
import { routeForNotification } from '@/lib/desktop-notification-route';

/**
 * Desktop notifications for other-window updates. The browser build has no
 * `window.desktop.notify`, so this is a no-op there; Electron shows a native
 * notification, and only while the app is in the background.
 */
export function DesktopNotifications() {
  const router = useRouter();
  const openIssue = useView((s) => s.openIssue);

  React.useEffect(() => {
    const off = window.desktop?.onNotificationClick?.((payload) => {
      const route = routeForNotification(payload);
      if (!route) return;
      if (route.kind === 'project') router.push(`/projects/${route.id}`);
      else openIssue(route.id);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [router, openIssue]);

  React.useEffect(() => {
    const prefs = useNotificationPrefs.getState();
    prefs.hydrate();
    let seen = new Set(useData.getState().notifications.map((notification) => notification.id));

    const unsubscribe = useData.subscribe((state) => {
      const fresh = state.notifications.filter((notification) => !seen.has(notification.id));
      seen = new Set(state.notifications.map((notification) => notification.id));
      if (!fresh.length || document.visibilityState === 'visible') return;
      if (typeof window.desktop?.notify !== 'function') return;
      const locale = getLocale();
      const issues = state.issues;
      const projects = state.projects;
      for (const notification of fresh.slice(0, 3)) {
        if (!canNotifyDesktop(prefs.enabled('desktop', notification.kind), prefs.quiet)) continue;
        const title =
          notification.kind === 'mention'
            ? translate(locale, 'Mentioned you')
            : notification.kind === 'project_update'
              ? translate(locale, 'Project update')
              : notification.kind === 'cycle'
                ? translate(locale, 'Cycle update')
                : translate(locale, 'Agent update');
        const issue = issues.find((item) => item.id === notification.issueId);
        const project = notification.projectId
          ? projects.find((item) => item.id === notification.projectId)
          : undefined;
        const body =
          project?.name ??
          notification.projectName ??
          issue?.title ??
          notification.cycleName ??
          translate(locale, 'Open Aether to see the update');
        try {
          void window.desktop.notify(title, body, {
            issueId: notification.issueId || null,
            projectId: notification.projectId ?? null,
          });
        } catch {
          /* the bridge is best-effort */
        }
      }
    });

    return unsubscribe;
  }, []);

  return null;
}

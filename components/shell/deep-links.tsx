'use client';

import * as React from 'react';
import { useView } from '@/lib/store/view';

/**
 * Routes `aether://` deep links (from the desktop shell) to the right issue.
 * The same payload also arrives as a `aether:deeplink` DOM event so the web
 * build — and the acceptance test — can exercise the exact same path.
 */
export function DeepLinks() {
  React.useEffect(() => {
    const apply = (payload: { issueId?: string | null; projectId?: string | null } | null | undefined) => {
      if (!payload) return;
      if (payload.issueId) useView.getState().openIssue(String(payload.issueId));
    };

    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ issueId?: string; projectId?: string }>).detail;
      apply(detail);
    };
    window.addEventListener('aether:deeplink', onEvent);

    const off = window.desktop?.onDeepLink?.((payload) => apply(payload));
    return () => {
      window.removeEventListener('aether:deeplink', onEvent);
      off?.();
    };
  }, []);

  return null;
}

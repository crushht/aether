'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { useView } from '@/lib/store/view';
import { isEditableTarget } from '@/lib/utils';

function issueFromUrl(issues: ReturnType<typeof useData.getState>['issues']) {
  const key = new URLSearchParams(window.location.search).get('issue');
  if (!key) return null;
  return issues.find((issue) => issue.id === key || issue.key.toLowerCase() === key.toLowerCase());
}

/** Owns the issue query parameter for every workspace route. */
export function IssueRouting() {
  const pathname = usePathname();
  React.useEffect(() => {
    const applyUrl = () => {
      const found = issueFromUrl(useData.getState().issues);
      const active = useView.getState().activeIssueId;
      if (!found) {
        if (active) useView.setState({ activeIssueId: null });
        return;
      }
      if (active !== found.id) useView.setState({ activeIssueId: found.id });
      // Canonicalize ids to keys once; normal store mutations never touch history.
      const url = new URL(window.location.href);
      if (url.searchParams.get('issue') !== found.key) {
        url.searchParams.set('issue', found.key);
        window.history.replaceState(window.history.state, '', url);
      }
    };

    // A key can arrive after either local or server hydration; stay subscribed
    // until it does, rather than using an arbitrary timeout.
    applyUrl();
    const unsubscribe = useData.subscribe(applyUrl);
    window.addEventListener('popstate', applyUrl);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', applyUrl);
    };
  }, [pathname]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(event.target)) return;
      const ui = useUI.getState();
      if (ui.commandOpen || ui.helpOpen || ui.quickEdit) return;
      const data = useData.getState();
      if (event.shiftKey ? data.redoIssues() : data.undoIssues()) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}

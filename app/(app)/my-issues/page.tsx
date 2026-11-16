'use client';

import * as React from 'react';
import { useView } from '@/lib/store/view';
import { usePeople } from '@/lib/people';
import { IssueList } from '@/components/views/issue-list';

export default function MyIssuesPage() {
  const { meId } = usePeople();

  React.useEffect(() => {
    useView.getState().setScope({ mineId: meId });
    return () => {
      useView.getState().setScope(null);
      useView.getState().clearFilters();
      useView.getState().clearSelection();
      useView.getState().setComposing(null);
    };
  }, [meId]);

  return <IssueList />;
}

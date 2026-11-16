'use client';

import * as React from 'react';
import { useView } from '@/lib/store/view';
import { IssueList } from '@/components/views/issue-list';

export default function ReviewsPage() {
  React.useEffect(() => {
    useView.getState().setScope({ status: ['in_review'] });
    return () => {
      useView.getState().setScope(null);
      useView.getState().clearFilters();
      useView.getState().clearSelection();
      useView.getState().setComposing(null);
    };
  }, []);

  return <IssueList />;
}

'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useView } from '@/lib/store/view';
import { IssueList } from '@/components/views/issue-list';
import { BoardView } from '@/components/views/board';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

export default function TeamPage() {
  const viewMode = useView((s) => s.viewMode);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={viewMode}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3, transition: { duration: 0.1 } }}
        transition={{ duration: 0.16, ease: EASE }}
      >
        {viewMode === 'list' ? <IssueList /> : <BoardView />}
      </motion.div>
    </AnimatePresence>
  );
}

'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';
import { Kbd } from '@/components/ui/primitives';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'General',
    rows: [
      [['⌘', 'K'], 'Open command menu'],
    [['⌘', 'J'], 'Open the agent chat'],
      [['/'], 'Search'],
      [['?'], 'Keyboard shortcuts'],
      [['⌘', '\\'], 'Toggle sidebar'],
      [['esc'], 'Close / clear selection'],
    ],
  },
  {
    title: 'Issues',
    rows: [
      [['J'], 'Next issue'],
      [['K'], 'Previous issue'],
      [['X'], 'Select issue'],
      [['shift', '↑ ↓'], 'Extend selection'],
      [['↵'], 'Open issue'],
      [['C'], 'Create issue'],
      [['S'], 'Set status'],
      [['P'], 'Set priority'],
      [['A'], 'Assign issue'],
      [['L'], 'Set labels'],
    ],
  },
  {
    title: 'Views',
    rows: [
      [['V', 'L'], 'List view'],
      [['V', 'B'], 'Board view'],
      [['G', 'I'], 'Go to Inbox'],
      [['G', 'M'], 'Go to My issues'],
      [['G', 'P'], 'Go to Projects'],
      [['G', 'R'], 'Go to Roadmap'],
      [['G', 'C'], 'Go to Cycles'],
      [['G', 'K'], 'Go to Knowledge'],
      [['G', 'W'], 'Go to Workflows'],
      [['G', 'S'], 'Go to Settings'],
    ],
  },
  {
    title: 'Agent',
    rows: [
      [['@'], 'Reference an issue or knowledge entry'],
      [['/clear'], 'Clear the current conversation'],
      [['/new'], 'Start a new conversation'],
      [['⌘', 'K'], 'Run a workflow from the command menu'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      [['⌘', '↵'], 'Save description / comment'],
      [['⌘', 'B'], 'Bold'],
      [['⌘', 'I'], 'Italic'],
    ],
  },
];

export function HelpSheet() {
  const open = useUI((s) => s.helpOpen);
  const setOpen = useUI((s) => s.setHelpOpen);
  const t = useT();

  if (typeof document === 'undefined') return null;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[910] flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.16 }}
        >
          <div className="absolute inset-0 bg-[rgba(8,9,10,.6)] backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden />
          <motion.div
            initial={{ opacity: 0, scale: 0.985, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99, y: 4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative flex max-h-[calc(100dvh-32px)] w-full max-w-[720px] flex-col overflow-hidden rounded-r12 bg-[var(--bg-command)] shadow-pop"
          >
            <div className="flex h-[52px] items-center justify-between border-b border-[var(--line-subtle)] px-5">
              <div className="text-[14px] font-[590] text-t1">{t('Keyboard shortcuts')}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-r4 px-1.5 py-0.5 text-[12.5px] text-t4 transition-colors hover:bg-[var(--bg-active)] hover:text-t2"
              >
                {t('close')}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 overflow-y-auto p-5 sm:grid-cols-2">
              {GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="mb-2 text-[12px] font-[510] uppercase tracking-[.06em] text-t4">{t(group.title)}</div>
                  <div className="flex flex-col gap-1">
                    {group.rows.map(([keys, label]) => (
                      <div key={label} className="flex h-[26px] items-center justify-between">
                        <span className="text-mini text-t2">{t(label)}</span>
                        <span className="flex items-center gap-1">
                          {keys.map((k) => (
                            <Kbd key={k} className={cn(k.length > 3 && 'px-1.5')}>
                              {k}
                            </Kbd>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex h-[40px] items-center justify-between border-t border-[var(--line-subtle)] px-5 text-[12.5px] text-t4">
              <span>{t('Press ? again to toggle this panel')}</span>
              <span className="tnum">Aether v0.3 · BYOM</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

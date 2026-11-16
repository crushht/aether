'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useUI } from '@/lib/store/ui';
import { useView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { selectVisibleIssues } from '@/lib/selectors';
import { isEditableTarget } from '@/lib/utils';
import { Kbd } from '@/components/ui/primitives';

const CHORD_TIMEOUT = 1400;

export function ShortcutLayer() {
  const router = useRouter();
  const chord = useUI((s) => s.chord);
  const setChord = useUI((s) => s.setChord);
  const commandOpen = useUI((s) => s.commandOpen);
  const openCommand = useUI((s) => s.openCommand);
  const closeCommand = useUI((s) => s.closeCommand);
  const helpOpen = useUI((s) => s.helpOpen);
  const setHelpOpen = useUI((s) => s.setHelpOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const toggleMobileNav = useUI((s) => s.toggleMobileNav);

  const pending = React.useRef<{ key: string; at: number } | null>(null);
  const timer = React.useRef<number | null>(null);

  const setChordTimed = React.useCallback((key: string | null) => {
    pending.current = key ? { key, at: Date.now() } : null;
    setChord(key);
    if (timer.current) window.clearTimeout(timer.current);
    if (key) {
      timer.current = window.setTimeout(() => {
        pending.current = null;
        setChord(null);
      }, CHORD_TIMEOUT);
    }
  }, [setChord]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const editable = isEditableTarget(e.target);

      // global, works everywhere
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (commandOpen) closeCommand();
        else openCommand();
        return;
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        // below lg the sidebar is an overlay drawer, so the same chord opens it
        if (window.matchMedia('(max-width: 1023px)').matches) toggleMobileNav();
        else toggleSidebar();
        return;
      }
      // ⌘J opens the workspace-level agent (a chat window over the app)
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        useUI.getState().toggleChat();
        return;
      }

      if (e.key === 'Escape') {
        if (commandOpen) {
          e.preventDefault();
          closeCommand();
          return;
        }
        if (helpOpen) {
          e.preventDefault();
          setHelpOpen(false);
          return;
        }
      }

      if (editable || commandOpen || helpOpen) return;
      // The inbox owns J/K/Enter/A/U for its own rows.
      if (window.location.pathname.startsWith('/inbox')) return;

      const view = useView.getState();
      const issues = useData.getState().issues;
      const visible = selectVisibleIssues({
        issues,
        tab: view.tab,
        filters: view.filters,
        sort: view.sort,
        scope: view.scope,
      });

      // chords — a key that starts a chord but does not complete one must
      // fall through, otherwise a stray `g` swallows the next keystroke
      if (pending.current && Date.now() - pending.current.at < CHORD_TIMEOUT) {
        const first = pending.current.key;
        const second = e.key.toLowerCase();
        setChordTimed(null);
        const goto: Record<string, string> = {
          i: '/inbox',
          m: '/my-issues',
          p: '/projects',
          s: '/settings',
          t: '/team/ENG',
          r: '/roadmap',
          c: '/cycles',
          k: '/knowledge',
          w: '/workflows',
        };
        let matched = false;
        if (first === 'g' && goto[second]) {
          router.push(goto[second]);
          matched = true;
        } else if (first === 'v' && (second === 'l' || second === 'b')) {
          useView.getState().setViewMode(second === 'l' ? 'list' : 'board');
          matched = true;
        }
        if (matched) {
          e.preventDefault();
          return;
        }
      }

      const key = e.key;

      if (key === 'g' || key === 'v') {
        e.preventDefault();
        setChordTimed(key);
        return;
      }

      if (key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (key === '/') {
        e.preventDefault();
        openCommand();
        return;
      }

      if (key === 'c' && !e.shiftKey) {
        e.preventDefault();
        useView.getState().setComposing('todo');
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('[data-inline-composer]')?.focus();
        }, 30);
        return;
      }

      // property menus on the cursor row / selection — only outside the drawer,
      // where the drawer's own rail already exposes the same pickers
      const quickKind = ({ s: 'status', p: 'priority', a: 'assignee', l: 'labels' } as const)[
        key.toLowerCase()
      ];
      if (quickKind && !e.shiftKey && !mod && !e.altKey && !view.activeIssueId) {
        if (!view.selectedIds.length && !view.cursorId) return;
        e.preventDefault();
        useUI.getState().openQuickEdit(quickKind);
        return;
      }

      if (key === 'j' || key === 'k') {
        e.preventDefault();
        const dir = key === 'j' ? 1 : -1;
        const current = view.cursorId ? visible.findIndex((i) => i.id === view.cursorId) : -1;
        const nextIndex = current === -1 ? (dir === 1 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, current + dir));
        const target = visible[nextIndex];
        if (!target) return;
        if (view.activeIssueId) {
          useView.getState().openIssue(target.id);
        } else {
          useView.getState().setCursor(target.id);
        }
        window.requestAnimationFrame(() => {
          document.querySelector(`[data-issue-row="${target.id}"]`)?.scrollIntoView({ block: 'nearest' });
        });
        return;
      }

      if (key === 'x') {
        e.preventDefault();
        if (!view.cursorId) {
          const first = visible[0];
          if (first) useView.getState().select(first.id, 'single', visible.map((i) => i.id));
          return;
        }
        useView.getState().select(view.cursorId, 'toggle', visible.map((i) => i.id));
        return;
      }

      if (key === 'Enter' && !e.shiftKey) {
        if (view.cursorId && !view.activeIssueId) {
          e.preventDefault();
          useView.getState().openIssue(view.cursorId);
        }
        return;
      }

      if (e.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp')) {
        e.preventDefault();
        const dir = key === 'ArrowDown' ? 1 : -1;
        const current = view.cursorId ? visible.findIndex((i) => i.id === view.cursorId) : -1;
        const base = current === -1 ? 0 : current;
        const next = Math.min(visible.length - 1, Math.max(0, base + dir));
        const anchor = view.cursorId ?? visible[base]?.id;
        const target = visible[next];
        if (!target) return;
        const ids = visible.map((i) => i.id);
        const a = anchor ? ids.indexOf(anchor) : next;
        const [lo, hi] = a < next ? [a, next] : [next, a];
        useView.getState().selectMany(ids.slice(lo, hi + 1));
        useView.setState({ cursorId: target.id });
        window.requestAnimationFrame(() => {
          document.querySelector(`[data-issue-row="${target.id}"]`)?.scrollIntoView({ block: 'nearest' });
        });
        return;
      }

      if (key === 'Escape') {
        if (view.composing) {
          useView.getState().setComposing(null);
          return;
        }
        if (view.activeIssueId) {
          useView.getState().closeIssue();
          return;
        }
        if (view.selectedIds.length) {
          useView.getState().clearSelection();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    chord,
    commandOpen,
    closeCommand,
    helpOpen,
    openCommand,
    router,
    setChord,
    setChordTimed,
    setHelpOpen,
    toggleSidebar,
    toggleMobileNav,
  ]);

  return (
    <AnimatePresence>
      {chord ? (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="fixed bottom-5 left-1/2 z-[800] flex -translate-x-1/2 items-center gap-3 rounded-r8 bg-[var(--bg-float)] px-3 py-2 text-[13px] text-t3 shadow-[0_12px_36px_rgba(0,0,0,.5),inset_0_0_0_1px_var(--float-ring)]"
        >
          <Kbd>{chord}</Kbd>
          <span className="text-t4">then</span>
          <span className="flex items-center gap-2">
            {(chord === 'g'
              ? [
                  ['I', 'Inbox'],
                  ['M', 'My issues'],
                  ['P', 'Projects'],
                  ['R', 'Roadmap'],
                  ['T', 'Team'],
                  ['C', 'Cycles'],
                  ['K', 'Knowledge'],
                  ['W', 'Workflows'],
                  ['S', 'Settings'],
                ]
              : [
                  ['L', 'List'],
                  ['B', 'Board'],
                ]
            ).map(([k, label]) => (
              <span key={k} className="flex items-center gap-1">
                <Kbd>{k}</Kbd>
                <span className="text-t4">{label}</span>
              </span>
            ))}
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

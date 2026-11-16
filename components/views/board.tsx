'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Plus, ListChecks } from 'lucide-react';
import { getLocale, translate } from '@/lib/i18n';
import { useView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';
import { selectVisibleIssues } from '@/lib/selectors';
import { STATUSES, type Issue, type StatusKey } from '@/lib/types';
import { currentUserId } from '@/lib/session';
import { usePeople } from '@/lib/people';
import { cn, shortDate } from '@/lib/utils';
import Link from 'next/link';
import { Avatar, IconButton, LabelChip } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/popover';
import { PriorityIcon, StatusIcon } from '@/components/ui/icons';
import { BulkBar } from './bulk-bar';
import { RowActions, RowStatus } from './row-actions';
import { countActiveFilters } from '@/lib/selectors';

function statusColor(status: StatusKey) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

const BoardCard = React.memo(function BoardCard({
  issue,
  onOpen,
  dragging,
  style,
  innerRef,
  compact,
}: {
  issue: Issue;
  onOpen?: () => void;
  dragging?: boolean;
  style?: React.CSSProperties;
  innerRef?: React.Ref<HTMLDivElement>;
  compact?: boolean;
}) {
  const labels = useData((s) => s.labels);
  const { userById } = usePeople();
  const assignee = issue.assigneeId ? userById.get(issue.assigneeId) : undefined;
  const issueLabels = issue.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter(Boolean)
    .slice(0, 2);
  // scalars only, so the card memo is not invalidated by unrelated issue edits
  const subTotal = useData((s) => s.issues.reduce((n, i) => n + (i.parentId === issue.id ? 1 : 0), 0));
  const subDone = useData((s) =>
    s.issues.reduce((n, i) => n + (i.parentId === issue.id && i.status === 'done' ? 1 : 0), 0),
  );

  // dev-only instrumentation: proves that a drag only re-renders the lifted card
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const w = window as unknown as { __boardCardCommits?: number };
      w.__boardCardCommits = (w.__boardCardCommits ?? 0) + 1;
    }
  });

  const fresh = Date.now() - new Date(issue.createdAt).getTime() < 30_000;

  return (
    <div
      ref={innerRef}
      data-card-id={issue.id}
      onClick={() => {
        // cards keep the same keyboard cursor as list rows, so S/P/A/L work here too
        useView.getState().setCursor(issue.id);
        onOpen?.();
      }}
      style={style}
      className={cn(
        'group/card cursor-pointer select-none rounded-r9 bg-[var(--bg-card)] p-[9px] pr-[10px] pb-2.5',
        'shadow-[inset_0_0_0_1px_var(--line)] transition-[background-color,box-shadow] duration-100 ease-out',
        'hover:bg-[var(--bg-card-hover)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
        fresh && 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]',
        dragging && 'opacity-100 shadow-drag',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="tnum text-[12.5px] font-[510] tracking-[.01em] text-t4">{issue.key}</span>
        <span className="flex items-center gap-1">
          <span className="relative grid h-[18px] w-[18px] shrink-0 place-items-center">
            {issue.priority !== 'none' ? (
              <PriorityIcon
                priority={issue.priority}
                size={13}
                className="text-t4 transition-opacity duration-100 group-hover/card:opacity-0 coarse-hide max-sm:opacity-0"
              />
            ) : null}
            {/* hover swaps the priority glyph for a status picker: moving a card
                between columns without dragging it */}
            <span className="coarse-show absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-100 group-hover/card:opacity-100 max-sm:opacity-100">
              <RowStatus issue={issue} />
            </span>
          </span>
          <span className="coarse-show grid place-items-center opacity-0 transition-opacity duration-100 group-hover/card:opacity-100 max-sm:opacity-100">
            <RowActions issue={issue} />
          </span>
          {assignee ? <Avatar name={assignee.name} color={assignee.color} size="xs" /> : null}
        </span>
      </div>

      <div className="mt-1 line-clamp-2 text-[14px] font-[510] leading-[1.35] text-t2 group-hover/card:text-t1">
        {(() => {
          const tag = issue.title.match(/^\[([^\]]+)\]\s*/);
          return tag ? (
            <span
              role="button"
              tabIndex={0}
              title={`${tag[1]} · ${translate(getLocale(), 'Filter by workflow')}`}
              onClick={(event) => {
                event.stopPropagation();
                useView.getState().setFilter('query', `[${tag[1]}]`);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  useView.getState().setFilter('query', `[${tag[1]}]`);
                }
              }}
              className="mr-1 inline-flex max-w-[120px] items-center truncate rounded-[3px] bg-[var(--bg-selected)] px-1 py-[1px] align-[1px] text-[10px] font-[510] text-t4 transition-colors hover:bg-[var(--bg-active)] hover:text-t2"
            >
              {tag[1]}
            </span>
          ) : null;
        })()}
        {issue.title.replace(/^\[[^\]]+\]\s*/, '')}
      </div>

      {!compact ? (
        <div className="mt-2 flex min-h-[20px] flex-wrap items-center gap-1">
          {subTotal ? (
            <span className="tnum flex items-center gap-1 rounded-full bg-[var(--bg-hover)] px-1.5 text-[12px] text-t4">
              <ListChecks size={11} strokeWidth={1.9} />
              {subDone}/{subTotal}
            </span>
          ) : null}
          {issueLabels.map((l) => (
            <LabelChip key={l!.id} name={l!.name} color={l!.color} className="h-[19px] text-[12px]" />
          ))}
          {issueLabels.length === 0 ? (
            <span className="text-[12px] text-t4 opacity-0 transition-opacity group-hover/card:opacity-100">
              {shortDate(issue.updatedAt)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export function BoardView() {
  const issues = useData((s) => s.issues);
  const moveIssue = useData((s) => s.moveIssue);
  const reorder = useData((s) => s.reorder);
  const createIssue = useData((s) => s.createIssue);
  const { tab, filters, sort, scope, selectedIds } = useView();
  const openIssue = useView((s) => s.openIssue);
  const select = useView((s) => s.select);
  const t = useT();

  const visible = React.useMemo(
    () => selectVisibleIssues({ issues, tab, filters, sort, scope }),
    [issues, tab, filters, sort, scope],
  );

  // every status gets a column, including `duplicate`: a card must never be
  // in the data but in no column (it would be impossible to drag back out)
  const columns = STATUSES;

  const columnRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const [drag, setDrag] = React.useState<{
    issue: Issue;
    width: number;
    height: number;
    dx: number;
    dy: number;
    x: number;
    y: number;
  } | null>(null);
  const [drop, setDrop] = React.useState<{ status: StatusKey; index: number; beforeId: string | null } | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`linear-lab:board-expanded:${currentUserId()}`) ?? '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem(`linear-lab:board-expanded:${currentUserId()}`, JSON.stringify(expanded));
    } catch {
      /* quota */
    }
  }, [expanded]);
  const dropRef = React.useRef<typeof drop>(null);
  const draggedRef = React.useRef(false);
  const scrollDirRef = React.useRef(0);

  const onCardPointerDown = (e: React.PointerEvent, issue: Issue) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const isTouch = e.pointerType !== 'mouse';
    let active = false;
    let longPress: number | null = null;
    let raf = 0;

    // One drag session: mouse lifts after 4px, touch lifts after a 220ms hold
    // (so a horizontal swipe still scrolls the board).
    const startDrag = (x: number, y: number) => {
      if (active) return;
      active = true;
      draggedRef.current = true;
      document.body.classList.add('dragging-cursor');
      setDrag({ issue, width: r.width, height: r.height, dx: startX - r.left, dy: startY - r.top, x, y });
      // once lifted, claim the gesture: without this the browser would start
      // panning the board on the first move
      if (isTouch) {
        window.addEventListener('touchmove', blockTouchScroll, { passive: false });
        navigator.vibrate?.(8);
      }

      // smooth edge scrolling: one loop per drag, direction comes from the pointer.
      // Holding near an edge ramps the speed up instead of crawling at a fixed rate.
      scrollDirRef.current = 0;
      let boost = 0;
      raf = requestAnimationFrame(function tick() {
        const scroller = document.getElementById('board-scroll');
        const dir = scrollDirRef.current;
        if (scroller && dir !== 0) {
          boost = Math.min(12, boost + 0.4);
          scroller.scrollLeft += dir * (6 + boost);
        } else {
          boost = 0;
        }
        raf = requestAnimationFrame(tick);
      });
    };

    const blockTouchScroll = (ev: TouchEvent) => {
      // the card is lifted, so the gesture belongs to us now
      if (ev.cancelable) ev.preventDefault();
    };

    const move = (ev: PointerEvent) => {
      if (longPress !== null) {
        // moved before the hold completed: this is a scroll, not a drag
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
          window.clearTimeout(longPress);
          longPress = null;
          cleanup();
        }
        return;
      }
      if (!active) {
        if (isTouch) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        startDrag(ev.clientX, ev.clientY);
      }
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));

      // hit test columns
      let next: typeof drop = null;
      for (const status of columns) {
        const col = columnRefs.current[status.key];
        if (!col) continue;
        const cr = col.getBoundingClientRect();
        if (ev.clientX >= cr.left - 6 && ev.clientX <= cr.right + 6 && ev.clientY >= cr.top - 20 && ev.clientY <= cr.bottom + 40) {
          const cards = [...col.querySelectorAll<HTMLElement>('[data-card-id]')].filter(
            (c) => c.dataset.cardId !== issue.id,
          );
          let index = cards.length;
          let beforeId: string | null = null;
          for (let i = 0; i < cards.length; i++) {
            const rr = cards[i].getBoundingClientRect();
            if (ev.clientY < rr.top + rr.height / 2) {
              index = i;
              beforeId = cards[i].dataset.cardId ?? null;
              break;
            }
          }
          next = { status: status.key, index, beforeId };
          break;
        }
      }
      dropRef.current = next;
      setDrop(next);

      // horizontal auto-scroll near edges (rate ramps with how close the pointer is)
      const scroller = document.getElementById('board-scroll');
      if (scroller) {
        const sr = scroller.getBoundingClientRect();
        const edge = 88;
        if (ev.clientX < sr.left + edge) {
          scrollDirRef.current = -Math.min(3, 1 + (sr.left + edge - ev.clientX) / 40);
        } else if (ev.clientX > sr.right - edge) {
          scrollDirRef.current = Math.min(3, 1 + (ev.clientX - (sr.right - edge)) / 40);
        } else {
          scrollDirRef.current = 0;
        }
      }
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', blockTouchScroll);
      if (longPress !== null) {
        window.clearTimeout(longPress);
        longPress = null;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      scrollDirRef.current = 0;
      document.body.classList.remove('dragging-cursor');
    };

    const resetDrag = () => {
      setDrag(null);
      setDrop(null);
      dropRef.current = null;
    };

    const up = () => {
      cleanup();
      if (active) {
        const target = dropRef.current;
        if (target) moveIssue(issue.id, target.status, target.beforeId);
        resetDrag();
        // the synthetic click lands right after pointerup; a later tap must not
        // be swallowed by the drag guard
        window.setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }
    };

    const onCancel = () => {
      cleanup();
      if (active) resetDrag();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', onCancel);

    if (isTouch) {
      longPress = window.setTimeout(() => {
        longPress = null;
        startDrag(startX, startY);
      }, 220);
    }
  };

  const activeFilters = countActiveFilters(filters);

  /** Keyboard alternative to dragging: move between columns or reorder in place. */
  const onCardKeyDown = (event: React.KeyboardEvent, issue: Issue) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openIssue(issue.id);
      return;
    }
    if (!mod) return;
    const statusKeys = STATUSES.map((status) => status.key);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const current = statusKeys.indexOf(issue.status);
      const next = Math.min(statusKeys.length - 1, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)));
      if (next === current) return;
      moveIssue(issue.id, statusKeys[next]);
      // the card lands at the end of the target column; make sure that column
      // is fully expanded so keyboard focus has somewhere to go
      setExpanded((state) => ({ ...state, [statusKeys[next]]: true }));
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-board-card="${issue.id}"]`)?.focus(), 60);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const columnIssues = visible.filter((item) => item.status === issue.status);
      const index = columnIssues.findIndex((item) => item.id === issue.id);
      const target = index + (event.key === 'ArrowDown' ? 1 : -1);
      if (index < 0 || target < 0 || target >= columnIssues.length) return;
      const ordered = columnIssues.map((item) => item.id);
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      reorder(issue.status, ordered);
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-board-card="${issue.id}"]`)?.focus(), 60);
    }
  };

  return (
    <div
      className={cn(
        'relative',
        activeFilters
          ? 'max-sm:h-[calc(100dvh-112px)] sm:h-[calc(100dvh-78px)]'
          : 'max-sm:h-[calc(100dvh-78px)] sm:h-[calc(100dvh-44px)]',
      )}
    >
      <div
        id="board-scroll"
        className="scroll-container flex h-full snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overflow-y-hidden px-3 pb-4 sm:snap-none sm:px-4"
      >
        {issues.length === 0 ? (
          <div className="flex h-full w-full max-w-[420px] shrink-0 snap-start flex-col justify-center rounded-r10 bg-[var(--bg-elevated)] p-5 shadow-[0_1px_2px_rgba(9,10,12,.04),inset_0_0_0_1px_var(--line-subtle)]">
            <p className="text-[14px] font-[590] text-t1">{t('This workspace is empty')}</p>
            <p className="mt-1 text-[12.5px] leading-[1.6] text-t4">
              {t('Start with an issue, a project, or an automated workflow.')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const issue = createIssue({ title: t('Untitled issue'), status: 'todo' });
                  useView.getState().openIssue(issue.id);
                }}
                className="flex h-[28px] items-center rounded-r6 bg-[var(--accent)] px-2.5 text-[12.5px] font-[510] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
              >
                {t('Create issue')}
              </button>
              <Link
                href="/projects"
                className="flex h-[28px] items-center rounded-r6 px-2.5 text-[12.5px] font-[510] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
              >
                {t('Create a project')}
              </Link>
              <Link
                href="/workflows?new=1"
                className="flex h-[28px] items-center rounded-r6 px-2.5 text-[12.5px] font-[510] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
              >
                {t('Create a workflow')}
              </Link>
            </div>
          </div>
        ) : null}
        {columns.map((column) => {
          const items = visible.filter((i) => i.status === column.key);
          // A column mounts at most a screenful; the rest is one click away.
          const shown = expanded[column.key] ? items : items.slice(0, 60);
          const isTarget = drop?.status === column.key;
          return (
            <div
              key={column.key}
              className="group/col flex h-full w-[84vw] max-w-[320px] shrink-0 snap-start flex-col sm:w-[296px] sm:max-w-none"
              ref={(el) => {
                columnRefs.current[column.key] = el;
              }}
            >
              <div className="flex h-[40px] shrink-0 items-center gap-2 px-1.5">
                <StatusIcon status={column.key} size={14} style={{ color: statusColor(column.key) }} />
                <span className="text-[13.5px] font-[510] text-t2">{t(column.label)}</span>
                <span className="tnum text-[13px] text-t4">{items.length}</span>
                <div className="flex-1" />
                <Tooltip label={t('New issue in {group}', { group: t(column.label) })}>
                  <IconButton
                    aria-label={t('New issue in {group}', { group: t(column.label) })}
                    size={24}
                    onClick={() => {
                      const issue = createIssue({ title: t('Untitled issue'), status: column.key });
                      openIssue(issue.id);
                    }}
                    className="text-t4 opacity-0 transition-opacity duration-100 hover:text-t2 focus-visible:opacity-100 group-hover/col:opacity-100"
                  >
                    <Plus size={14} strokeWidth={2} />
                  </IconButton>
                </Tooltip>
              </div>

              <div className="scroll-container flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-10 pr-1">
                {shown.map((issue, index) => (
                  <React.Fragment key={issue.id}>
                    {isTarget && drop?.index === index ? (
                      <div className="h-[2px] shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_rgba(94,106,210,.16)]" />
                    ) : null}
                    <div
                      data-board-card={issue.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${issue.key} ${issue.title}`}
                      title={t('Enter opens · Ctrl+←/→ moves columns · Ctrl+↑/↓ reorders')}
                      className={cn('shrink-0 rounded-r9 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]', drag?.issue.id === issue.id && 'opacity-30')}
                      onPointerDown={(e) => onCardPointerDown(e, issue)}
                      onKeyDown={(e) => onCardKeyDown(e, issue)}
                      onClick={(e) => {
                        if (draggedRef.current) {
                          draggedRef.current = false;
                          return;
                        }
                        if (e.metaKey || e.ctrlKey || e.shiftKey) {
                          select(issue.id, 'toggle', visible.map((i) => i.id));
                          return;
                        }
                        openIssue(issue.id);
                      }}
                    >
                      <BoardCard issue={issue} />
                    </div>
                  </React.Fragment>
                ))}
                {isTarget && drop && drop.index >= items.length ? (
                  <div className="h-[2px] shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_rgba(94,106,210,.16)]" />
                ) : null}

                {items.length === 0 && !isTarget ? (
                  <div className="flex h-[62px] shrink-0 items-center justify-center rounded-r9 border border-dashed border-[var(--line)] text-[13px] text-t4">
                    {t('No issues')}
                  </div>
                ) : null}

                {items.length > shown.length ? (
                  <button
                    type="button"
                    data-board-more={column.key}
                    onClick={() => setExpanded((state) => ({ ...state, [column.key]: true }))}
                    className="flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-r6 text-[12.5px] text-t4 shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
                  >
                    {t('Show {n} more', { n: items.length - shown.length })}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    const issue = createIssue({ title: t('Untitled issue'), status: column.key });
                    openIssue(issue.id);
                  }}
                  className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-r6 px-1.5 text-[13.5px] text-t4 transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-t3"
                >
                  <Plus size={13} strokeWidth={2} />
                  {t('New issue')}
                </button>
              </div>
            </div>
          );
        })}
        <div className="w-2 shrink-0" />
      </div>

      {selectedIds.length > 0 ? <BulkBar /> : null}

      {drag && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[900]"
              style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}
            >
              <div className="rotate-[1.2deg] scale-[1.02] transition-transform duration-100">
                <BoardCard issue={drag.issue} dragging />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

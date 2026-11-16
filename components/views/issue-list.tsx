'use client';

import * as React from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useView } from '@/lib/store/view';
import Link from 'next/link';
import { useData } from '@/lib/store/data';
import { useWorkspace } from '@/lib/agent/workspace';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { selectVisibleIssues, countActiveFilters } from '@/lib/selectors';
import { STATUSES, type Issue, type StatusKey } from '@/lib/types';
import { usePeople } from '@/lib/people';
import { cn, isImeComposing } from '@/lib/utils';
import { Button, IconButton, Kbd, Avatar } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/popover';
import { StatusIcon } from '@/components/ui/icons';
import { IssueRow } from './issue-row';
import { BulkBar } from './bulk-bar';

function statusColor(status: Issue['status']) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

/* ------------------------------------------------------------------ */

function InlineComposer({ status, onClose }: { status: StatusKey; onClose: () => void }) {
  const createIssue = useData((s) => s.createIssue);
  const openIssue = useView((s) => s.openIssue);
  const t = useT();
  const [value, setValue] = React.useState('');
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const t = window.setTimeout(() => ref.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  const commit = (openAfter: boolean) => {
    const title = value.trim();
    if (!title) {
      onClose();
      return;
    }
    const issue = createIssue({ title, status });
    setValue('');
    if (openAfter) {
      onClose();
      openIssue(issue.id);
    } else {
      ref.current?.focus();
    }
  };

  return (
    <div
      data-inline-composer-row
      className="flex h-[40px] items-center gap-2 bg-[var(--bg-hover)] pl-2 pr-2 shadow-[inset_0_1px_0_var(--line-subtle),inset_0_-1px_0_var(--line-subtle)] sm:pl-3 sm:pr-4"
    >
      <span className="hidden w-[20px] sm:block" />
      <span className="tnum hidden w-[62px] shrink-0 text-[13.5px] text-t4 sm:inline">ENG-new</span>
      <span className="grid h-[20px] w-[16px] shrink-0 place-items-center">
        <StatusIcon status={status} size={14} style={{ color: statusColor(status) }} />
      </span>
      <input
        data-inline-composer
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) {
            e.preventDefault();
            commit(false);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={t('Issue title')}
        className="min-w-0 flex-1 bg-transparent text-[14.5px] font-[510] text-t1 outline-none placeholder:text-t4"
        spellCheck={false}
      />
      <span className="hidden items-center gap-1 text-[12px] text-t4 sm:flex">
        <Kbd>↵</Kbd>
        <span>{t('create')}</span>
        <Kbd>esc</Kbd>
        <span>{t('cancel')}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function IssueList() {
  const { userById } = usePeople();
  const issues = useData((s) => s.issues);
  const labels = useData((s) => s.labels);
  const { tab, filters, sort, scope, display, selectedIds, cursorId, collapsedGroups, composing, groupBy } = useView();
  const select = useView((s) => s.select);
  const openIssue = useView((s) => s.openIssue);
  const setCursor = useView((s) => s.setCursor);
  const toggleGroup = useView((s) => s.toggleGroup);
  const setComposing = useView((s) => s.setComposing);
  const clearFilters = useView((s) => s.clearFilters);
  const setTab = useView((s) => s.setTab);
  const toggleSidebar = useUI((s) => s.sidebarCollapsed);
  const t = useT();

  const visibleAll = React.useMemo(
    () => selectVisibleIssues({ issues, tab, filters, sort, scope }),
    [issues, tab, filters, sort, scope],
  );

  // Large workspaces: render a window and grow it on demand instead of
  // mounting every row at once. J/K still walks the rendered window.
  const PAGE = 120;
  const [limit, setLimit] = React.useState(PAGE);
  React.useEffect(() => setLimit(PAGE), [tab, filters, sort, scope, groupBy]);
  const visible = React.useMemo(() => visibleAll.slice(0, limit), [visibleAll, limit]);
  const remaining = visibleAll.length - visible.length;

  const orderedIds = React.useMemo(() => visible.map((i) => i.id), [visible]);

  // roll sub-issue progress up into the parent row (ENG-319); primitive props
  // keep IssueRow's memo intact
  const subProgress = React.useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const issue of issues) {
      if (!issue.parentId) continue;
      const entry = map.get(issue.parentId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (issue.status === 'done') entry.done += 1;
      map.set(issue.parentId, entry);
    }
    return map;
  }, [issues]);

  const groups = React.useMemo(() => {
    if (groupBy === 'none') {
      return [{ kind: 'none' as const, key: 'all', label: 'All issues', items: visible, assigneeId: null as string | null, status: null as StatusKey | null }];
    }
    if (groupBy === 'assignee') {
      const buckets = new Map<string, Issue[]>();
      for (const issue of visible) {
        const key = issue.assigneeId ?? '__none';
        buckets.set(key, [...(buckets.get(key) ?? []), issue]);
      }
      return [...buckets.entries()]
        .map(([key, items]) => ({
          kind: 'assignee' as const,
          key: `assignee:${key}`,
          label: key === '__none' ? 'No assignee' : userById.get(key)?.name ?? key,
          items,
          assigneeId: key === '__none' ? null : key,
          status: null as StatusKey | null,
        }))
        .sort((a, b) => {
          if (a.assigneeId === null) return 1;
          if (b.assigneeId === null) return -1;
          return a.label.localeCompare(b.label);
        });
    }
    return STATUSES.map((status) => ({
      kind: 'status' as const,
      key: status.key,
      label: status.label,
      color: status.color,
      items: visible.filter((i) => i.status === status.key),
      assigneeId: null as string | null,
      status: status.key,
      // keep the group whose inline composer is open, even when it has no rows yet
    })).filter((g) => g.items.length > 0 || composing === g.key || display.showEmptyGroups);
  }, [groupBy, visible, userById, composing, display.showEmptyGroups]);

  const hasFilters = countActiveFilters(filters) > 0;

  const onClickRow = (issue: Issue, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      select(issue.id, 'toggle', orderedIds);
      return;
    }
    if (e.shiftKey) {
      select(issue.id, 'range', orderedIds);
      return;
    }
    setCursor(issue.id);
    openIssue(issue.id);
  };

  return (
    <div className="relative min-h-full pb-28">
      {groups.map((group) => {
        const collapsed = collapsedGroups.includes(group.key);
        return (
          <section key={group.key} className="group/grp pt-1">
            <div className="sticky top-0 z-[5] flex h-[40px] items-center gap-1.5 bg-panel/95 px-3 backdrop-blur-[2px] sm:px-4">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex h-[22px] items-center gap-2 rounded-r4 pr-1 text-[13.5px] font-[510] text-t2 transition-colors duration-100 hover:text-t1"
              >
                <ChevronDown
                  size={13}
                  strokeWidth={2}
                  className={cn('text-t4 transition-transform duration-160 ease-out', collapsed && '-rotate-90')}
                />
                {group.kind === 'assignee' ? (
                  group.assigneeId ? (
                    <Avatar name={group.label} color={userById.get(group.assigneeId)?.color ?? '#5E6AD2'} size="xs" />
                  ) : (
                    <span className="grid h-[14px] w-[14px] place-items-center rounded-full text-t4 shadow-[inset_0_0_0_1px_var(--line-strong)]">
                      <Plus size={9} strokeWidth={2} className="rotate-45" />
                    </span>
                  )
                ) : group.kind === 'status' && group.status ? (
                  <StatusIcon status={group.status} size={14} style={{ color: statusColor(group.status) }} />
                ) : null}
                <span>{t(group.label)}</span>
                <span className="tnum font-[400] text-t4">{group.items.length}</span>
              </button>
              <div className="flex-1" />
              {group.kind === 'status' ? (
                <Tooltip label={t('New issue in {group}', { group: t(group.label) })} shortcut="C">
                  <IconButton
                    aria-label={t('New issue in {group}', { group: t(group.label) })}
                    size={22}
                    onClick={() => {
                      setComposing(group.key as StatusKey);
                      if (collapsed) toggleGroup(group.key);
                      window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-inline-composer]')?.focus(), 40);
                    }}
                    className="text-t4 opacity-0 transition-opacity duration-100 hover:text-t2 focus-visible:opacity-100 group-hover/grp:opacity-100"
                  >
                    <Plus size={14} strokeWidth={2} />
                  </IconButton>
                </Tooltip>
              ) : null}
            </div>

            {!collapsed && group.kind === 'status' && composing === group.key ? (
              <InlineComposer status={group.key as StatusKey} onClose={() => setComposing(null)} />
            ) : null}

            {!collapsed
              ? group.items.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    cursor={cursorId === issue.id}
                    selected={selectedIds.includes(issue.id)}
                    display={display}
                    labels={labels}
                    assignee={issue.assigneeId ? userById.get(issue.assigneeId) : undefined}
                    onOpen={() => openIssue(issue.id)}
                    onClickRow={(e) => onClickRow(issue, e)}
                    onToggleSelect={() => select(issue.id, 'toggle', orderedIds)}
                    showCheckbox={selectedIds.length > 0}
                    subDone={subProgress.get(issue.id)?.done ?? 0}
                    subTotal={subProgress.get(issue.id)?.total ?? 0}
                  />
                ))
              : null}

            {!collapsed && group.kind === 'status' && group.items.length === 0 && composing !== group.key ? (
              <button
                type="button"
                onClick={() => setComposing(group.key as StatusKey)}
                className="flex h-[40px] w-full items-center gap-2 pl-6 text-left text-[14px] text-t4 transition-colors hover:text-t3 sm:pl-8"
              >
                <Plus size={13} strokeWidth={2} />
                {t('Add issue')}
              </button>
            ) : null}
          </section>
        );
      })}

      {groups.length === 0 ? (
        <EmptyState
          hasFilters={hasFilters}
          onClear={() => {
            clearFilters();
            setTab('all');
          }}
          onCreate={() => {
            setComposing('todo');
            window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-inline-composer]')?.focus(), 40);
          }}
        />
      ) : null}

      {groups.length > 0 ? (
        <div className="mt-1 px-3 sm:px-4">
          <button
            type="button"
            onClick={() => {
              setComposing('todo');
              window.setTimeout(() => {
                document.querySelector('[data-inline-composer-row]')?.scrollIntoView({ block: 'center' });
                document.querySelector<HTMLInputElement>('[data-inline-composer]')?.focus();
              }, 40);
            }}
            className="flex h-[40px] w-full items-center gap-2 rounded-r6 pl-1 text-[14px] text-t4 transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-t2"
          >
            <Plus size={14} strokeWidth={2} />
            {t('New issue')}
          </button>
        </div>
      ) : null}

      {remaining > 0 ? (
        <div className="mt-2 flex items-center justify-center px-4 pb-2">
          <button
            type="button"
            data-load-more
            onClick={() => setLimit((value) => value + PAGE)}
            className="flex h-[32px] items-center gap-2 rounded-r8 px-3 text-[13px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {t('Show {n} more issues', { n: Math.min(remaining, PAGE) })}
            <span className="tnum text-[11.5px] text-t4">
              {visible.length} / {visibleAll.length}
            </span>
          </button>
        </div>
      ) : null}

      <BulkBar />
      {/* keeps the last row from hiding under the floating bar */}
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-0" data-sidebar-collapsed={toggleSidebar} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EmptyState({
  hasFilters,
  onClear,
  onCreate,
}: {
  hasFilters: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  const t = useT();
  const projectCount = useData((s) => s.projects.length);
  const workflowCount = useWorkspace((s) => s.workflows.length);
  const seedWorkspace = useData((s) => s.seedWorkspace);
  const pushToast = useUI((s) => s.pushToast);
  const firstRun = !hasFilters && projectCount === 0 && workflowCount === 0;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="relative mb-4 grid h-[52px] w-[52px] place-items-center rounded-full">
        <span className="absolute inset-0 rounded-full border border-dashed border-[var(--line-strong)]" />
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-t4" fill="none">
          <path d="M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-[15px] font-[590] text-t1">
        {hasFilters ? t('No issues match these filters') : t('No issues yet')}
      </h3>
      <p className="mt-1 max-w-[340px] text-[14px] leading-[1.5] text-t4">
        {hasFilters
          ? t('Try removing a filter, or press Esc to clear the current selection.')
          : t('Issues you create will show up here. Press C to create your first one.')}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {hasFilters ? (
          <Button variant="secondary" size="sm" onClick={onClear}>
            {t('Clear filters')}
          </Button>
        ) : null}
        <Button variant="primary" size="sm" onClick={onCreate}>
          {t('Create issue')}
        </Button>
        {firstRun ? (
          <>
            <button
              type="button"
              data-seed-workspace
              onClick={() => {
                seedWorkspace();
                pushToast({ title: t('Sample data loaded'), tone: 'success' });
              }}
              className="flex h-[28px] items-center rounded-r6 bg-[var(--accent)] px-2.5 text-[13px] font-[510] text-[var(--accent-fg)] transition-opacity hover:opacity-90"
            >
              {t('Load sample data')}
            </button>
            <Link
              href="/settings/data"
              data-restore-backup
              className="flex h-[28px] items-center rounded-r6 px-2.5 text-[13px] font-[510] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              {t('Restore from a backup')}
            </Link>
            <Link
              href="/projects"
              className="flex h-[28px] items-center rounded-r6 px-2.5 text-[13px] font-[510] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              {t('Create a project')}
            </Link>
            <Link
              href="/workflows?new=1"
              className="flex h-[28px] items-center rounded-r6 px-2.5 text-[13px] font-[510] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              {t('Create a workflow')}
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import { LayoutList, Rows3, SlidersHorizontal, ArrowUpDown, ListFilter, Bookmark, RefreshCw, Trash2 } from 'lucide-react';
import { useSavedViews } from '@/lib/store/saved-views';
import { useView } from '@/lib/store/view';
import { useT } from '@/lib/use-t';
import type { Priority, StatusKey } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';
import { usePeople } from '@/lib/people';
import { useData } from '@/lib/store/data';
import { Avatar, PillButton } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from '@/components/ui/popover';
import { PriorityIcon, StatusIcon } from '@/components/ui/icons';
import { cn, isImeComposing } from '@/lib/utils';

const statusColor = (key: StatusKey, color: string) => ({
  color:
    key === 'in_progress'
      ? 'var(--status-progress)'
      : key === 'done'
        ? 'var(--status-done)'
        : key === 'in_review'
          ? 'var(--status-review)'
          : color,
});

/** Saved views: a name for the current tab + filters + sort + layout. */
export function SavedViewsButton() {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const views = useSavedViews((s) => s.views);
  const hydrate = useSavedViews((s) => s.hydrate);
  const saveCurrent = useSavedViews((s) => s.saveCurrent);
  const updateFromCurrent = useSavedViews((s) => s.updateFromCurrent);
  const remove = useSavedViews((s) => s.remove);
  const apply = useSavedViews((s) => s.apply);
  const t = useT();

  React.useEffect(() => hydrate(), [hydrate]);

  // A shared link may carry ?view=…; apply it once the list is loaded.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('view');
    if (id) apply(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const entry = saveCurrent(name);
    if (entry) {
      setName('');
      apply(entry.id);
      const url = new URL(window.location.href);
      url.searchParams.set('view', entry.id);
      window.history.replaceState(window.history.state, '', url);
    }
  };

  return (
    <>
      <PillButton ref={ref} data-views-menu aria-label={t('Views')} onClick={() => setOpen((v) => !v)} active={views.length > 0}>
        <Bookmark size={14} strokeWidth={1.8} />
        <span className="hidden text-[13.5px] lg:inline">{t('Views')}</span>
      </PillButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={300} align="end">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[13px] font-[510] text-t2">{t('Saved views')}</span>
          <span className="text-[11px] text-t4">{views.length}</span>
        </div>
        <MenuSeparator />
        <div className="p-1">
          <div className="flex h-[30px] items-center gap-1.5 rounded-r6 px-2 shadow-[inset_0_0_0_1px_var(--line)]">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isImeComposing(event)) commit();
                if (event.key === 'Escape') setOpen(false);
              }}
              placeholder={t('Name this view…')}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-t1 outline-none placeholder:text-t4"
            />
            <button
              type="button"
              disabled={!name.trim()}
              onClick={commit}
              className="rounded-r4 px-1.5 py-0.5 text-[12px] font-[510] text-[var(--accent)] transition-colors hover:bg-[var(--bg-hover)] disabled:text-t4"
            >
              {t('Save')}
            </button>
          </div>
        </div>
        {views.length ? (
          <div className="max-h-[280px] overflow-y-auto pb-1">
            {views.map((view) => (
              <div key={view.id} data-saved-view={view.id} className="group/view flex h-[32px] items-center gap-1 rounded-r6 px-1.5 hover:bg-[var(--bg-hover)]">
                <button
                  type="button"
                  onClick={() => {
                    apply(view.id);
                    const url = new URL(window.location.href);
                    url.searchParams.set('view', view.id);
                    window.history.replaceState(window.history.state, '', url);
                    setOpen(false);
                  }}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-t2"
                >
                  <Bookmark size={12} className="shrink-0 text-t4" />
                  <span className="truncate">{view.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('Update with current filters')}
                  title={t('Update with current filters')}
                  onClick={() => updateFromCurrent(view.id)}
                  className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1"
                >
                  <RefreshCw size={11} />
                </button>
                <button
                  type="button"
                  aria-label={t('Delete view')}
                  onClick={() => remove(view.id)}
                  className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-r4 text-t4 hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-2 pb-2 text-[12px] leading-[1.55] text-t4">
            {t('Save the current filters, sort and layout, then reopen them from here or a shared link.')}
          </p>
        )}
      </Popover>
    </>
  );
}

export function FilterButton({ activeCount }: { activeCount: number }) {  const { users } = usePeople();
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const { filters, toggleFilterValue, clearFilters } = useView();
  const labels = useData((s) => s.labels);
  const t = useT();

  const rows: { key: 'status' | 'priority' | 'assigneeId' | 'labelIds'; title: string }[] = [
    { key: 'status', title: 'Status' },
    { key: 'priority', title: 'Priority' },
    { key: 'assigneeId', title: 'Assignee' },
    { key: 'labelIds', title: 'Labels' },
  ];
  const { setFilter } = useView();
  const dueOptions: { id: 'overdue' | 'this_week' | 'no_date'; label: string }[] = [
    { id: 'overdue', label: 'Overdue' },
    { id: 'this_week', label: 'Due this week' },
    { id: 'no_date', label: 'No due date' },
  ];

  const optionFor = (row: (typeof rows)[number]) => {
    if (row.key === 'status')
      return STATUSES.map((s) => ({
        id: s.key,
        label: t(s.label),
        icon: <StatusIcon status={s.key} size={14} style={statusColor(s.key, s.color)} />,
      }));
    if (row.key === 'priority')
      return PRIORITIES.filter((p) => p.key !== 'none').map((p) => ({
        id: p.key,
        label: t(p.label),
        icon: <PriorityIcon priority={p.key as Priority} size={14} className="text-t3" />,
      }));
    if (row.key === 'assigneeId')
      return users.map((u) => ({
        id: u.id,
        label: u.name,
        icon: <Avatar name={u.name} color={u.color} size="xs" />,
      }));
    return labels.map((l) => ({
      id: l.id,
      label: l.name,
      icon: <span className="h-[7px] w-[7px] rounded-full" style={{ background: l.color }} />,
    }));
  };

  return (
    <>
      <PillButton
        ref={ref}
        data-filter-menu
        aria-label={t('Filter')}
        active={activeCount > 0}
        onClick={() => setOpen((v) => !v)}
        className="gap-1 pr-1.5"
      >
        <ListFilter size={14} strokeWidth={1.8} />
        <span className="hidden text-[13.5px] sm:inline">
          {activeCount > 0 ? t('Filter · {n}', { n: activeCount }) : t('Filter')}
        </span>
        {activeCount > 0 ? (
          <span className="tnum text-[12px] font-[510] text-t1 sm:hidden">{activeCount}</span>
        ) : null}
      </PillButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={258} align="end">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[13px] font-[510] text-t2">{t('Filter issues')}</span>
          {activeCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-r4 px-1 text-[12.5px] text-t4 transition-colors hover:text-t2"
            >
              {t('Clear')}
            </button>
          ) : null}
        </div>
        <MenuSeparator />
        {rows.map((row) => {
          const selected = filters[row.key] as string[];
          return (
            <div key={row.key} className="pb-1">
              <MenuLabel>{t(row.title)}</MenuLabel>
              {optionFor(row).map((opt) => (
                <MenuItem
                  key={opt.id}
                  icon={opt.icon}
                  label={opt.label}
                  checked={selected.includes(opt.id)}
                  onSelect={() => toggleFilterValue(row.key, opt.id)}
                />
              ))}
            </div>
          );
        })}
        <MenuSeparator />
        <div className="pb-1">
          <MenuLabel>{t('Due date')}</MenuLabel>
          {dueOptions.map((option) => (
            <MenuItem
              key={option.id}
              label={t(option.label)}
              checked={filters.due === option.id}
              onSelect={() => setFilter('due', filters.due === option.id ? 'any' : option.id)}
            />
          ))}
        </div>
      </Popover>
    </>
  );
}

export function SortButton() {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const sort = useView((s) => s.sort);
  const setSort = useView((s) => s.setSort);
  const t = useT();

  const options = [
    { key: 'manual', label: 'Manual' },
    { key: 'priority', label: 'Priority' },
    { key: 'updated', label: 'Last updated' },
    { key: 'created', label: 'Created' },
  ] as const;

  return (
    <>
      <PillButton ref={ref} data-sort-menu aria-label={t('Order by')} onClick={() => setOpen((v) => !v)} active={sort !== 'manual'} className="inline-flex">
        <ArrowUpDown size={14} strokeWidth={1.8} />
      </PillButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={210} align="end">
        <MenuLabel>{t('Order by')}</MenuLabel>
        {options.map((o) => (
          <MenuItem key={o.key} label={t(o.label)} checked={sort === o.key} onSelect={() => { setSort(o.key); setOpen(false); }} />
        ))}
      </Popover>
    </>
  );
}

export function DisplayButton() {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const display = useView((s) => s.display);
  const toggleDisplay = useView((s) => s.toggleDisplay);
  const groupBy = useView((s) => s.groupBy);
  const setGroupBy = useView((s) => s.setGroupBy);
  const t = useT();

  const groups = [
    { key: 'status', label: 'Status' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'none', label: 'No grouping' },
  ] as const;

  const items = [
    { key: 'showEmptyGroups', label: 'Empty groups' },
    { key: 'showLabels', label: 'Labels' },
    { key: 'showPriority', label: 'Priority' },
    { key: 'showAssignee', label: 'Assignee' },
    { key: 'showDates', label: 'Dates' },
    { key: 'showId', label: 'Issue ID' },
  ] as const;

  return (
    <>
      <PillButton ref={ref} data-display-menu aria-label={t('Display properties')} onClick={() => setOpen((v) => !v)} className="inline-flex">
        <SlidersHorizontal size={14} strokeWidth={1.8} />
      </PillButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={220} align="end">
        <MenuLabel>{t('Group by')}</MenuLabel>
        {groups.map((group) => (
          <MenuItem
            key={group.key}
            label={t(group.label)}
            checked={groupBy === group.key}
            onSelect={() => setGroupBy(group.key)}
          />
        ))}
        <MenuSeparator />
        <MenuLabel>{t('Display properties')}</MenuLabel>
        {items.map((item) => (
          <MenuItem
            key={item.key}
            label={t(item.label)}
            checked={display[item.key]}
            onSelect={() => toggleDisplay(item.key)}
          />
        ))}
      </Popover>
    </>
  );
}

export function ViewSwitch() {
  const viewMode = useView((s) => s.viewMode);
  const setViewMode = useView((s) => s.setViewMode);
  const t = useT();

  return (
    <div className="flex items-center gap-0 rounded-full bg-[var(--bg-hover)] p-0.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
      {(
        [
          { key: 'list', icon: Rows3, label: 'List view', hint: 'V L' },
          { key: 'board', icon: LayoutList, label: 'Board view', hint: 'V B' },
        ] as const
      ).map(({ key, icon: Icon, label, hint }) => (
        <Tooltip key={key} label={t(label)} shortcut={hint}>
          <button
            type="button"
            onClick={() => setViewMode(key)}
            aria-pressed={viewMode === key}
            className={cn(
              'grid h-[24px] w-[30px] place-items-center rounded-full transition-all duration-100 ease-out',
              viewMode === key
                ? 'bg-[var(--bg-selected)] text-t1 shadow-[inset_0_0_0_1px_var(--line)]'
                : 'text-t4 hover:text-t2',
            )}
          >
            <Icon size={14} strokeWidth={1.8} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

export function ActiveFilterChips() {
  const { users } = usePeople();
  const { filters, toggleFilterValue, clearFilters, setFilter } = useView();
  const t = useT();
  const labels = useData((s) => s.labels);
  const chips: { key: 'status' | 'priority' | 'assigneeId' | 'labelIds' | 'due'; id: string; label: string; color?: string; icon?: React.ReactNode }[] = [];

  for (const s of filters.status) {
    const meta = STATUSES.find((x) => x.key === s);
    if (meta)
      chips.push({
        key: 'status',
        id: s,
        label: t(meta.label),
        icon: <StatusIcon status={s} size={13} style={statusColor(s, meta.color)} />,
      });
  }
  for (const p of filters.priority) {
    const meta = PRIORITIES.find((x) => x.key === p);
    if (meta) chips.push({ key: 'priority', id: p, label: t(meta.label), icon: <PriorityIcon priority={p} size={13} /> });
  }
  for (const a of filters.assigneeId) {
    const u = users.find((x) => x.id === a);
    if (u) chips.push({ key: 'assigneeId', id: a, label: u.name, icon: <Avatar name={u.name} color={u.color} size="xs" /> });
  }
  for (const l of filters.labelIds) {
    const lb = labels.find((x) => x.id === l);
    if (lb) chips.push({ key: 'labelIds', id: l, label: lb.name, color: lb.color });
  }
  if (filters.due !== 'any') {
    const dueLabel: Record<string, string> = {
      overdue: 'Overdue',
      this_week: 'Due this week',
      no_date: 'No due date',
    };
    chips.push({ key: 'due', id: filters.due, label: t(dueLabel[filters.due] ?? filters.due) });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex h-[40px] items-center gap-1.5 overflow-x-auto border-b border-[var(--line-subtle)] px-3 [scrollbar-width:none] sm:px-4">
      {chips.map((c) => (
        <button
          key={`${c.key}-${c.id}`}
          type="button"
          onClick={() => (c.key === 'due' ? setFilter('due', 'any') : toggleFilterValue(c.key, c.id))}
          className="group flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--bg-hover)] pl-1.5 pr-1 text-[13px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[var(--bg-selected)]"
        >
          {c.icon ?? (c.color ? <span className="h-2 w-2 rounded-full" style={{ background: c.color }} /> : null)}
          <span>{c.label}</span>
          <span className="grid h-3.5 w-3.5 place-items-center rounded-full text-t4 group-hover:text-t2">
            <svg viewBox="0 0 14 14" className="h-2 w-2" fill="none">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={clearFilters}
        className="ml-1 rounded-r4 px-1.5 py-0.5 text-[13px] text-t4 transition-colors hover:bg-[var(--bg-active)] hover:text-t2"
      >
        {t('Clear')}
      </button>
    </div>
  );
}


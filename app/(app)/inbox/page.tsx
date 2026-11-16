'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  AtSign,
  CalendarDays,
  Check,
  CheckCheck,
  Inbox as InboxIcon,
  Mail,
  MailOpen,
  Megaphone,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useUI } from '@/lib/store/ui';
import { Button, Kbd } from '@/components/ui/primitives';
import { StatusIcon } from '@/components/ui/icons';
import { useT } from '@/lib/use-t';
import { relativeTime, cn, isEditableTarget } from '@/lib/utils';
import { localDayKey } from '@/lib/notification-digest';
import { highlightSegments } from '@/lib/highlight';
import { inboxDay } from '@/lib/inbox-groups';

type InboxFilter = 'all' | 'unread' | 'mentions' | 'updates' | 'archived';

export default function InboxPage() {
  const issues = useData((s) => s.issues);
  const notifications = useData((s) => s.notifications);
  const archive = useData((s) => s.setNotificationArchived);
  const remove = useData((s) => s.deleteNotification);
  const read = useUI((s) => s.readNotifications);
  const markRead = useUI((s) => s.markNotificationRead);
  const markUnread = useUI((s) => s.markNotificationUnread);
  const markAll = useUI((s) => s.markAllNotificationsRead);
  const openIssue = useView((s) => s.openIssue);
  const router = useRouter();
  const pushToast = useUI((s) => s.pushToast);
  const t = useT();

  const [filter, setFilter] = React.useState<InboxFilter>('all');
  const [query, setQuery] = React.useState('');
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number; index: number } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (menu) menuRef.current?.focus();
    // Focus only when a different menu opens; depending on the whole object would
    // steal focus on every hover-driven re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.id]);
  const active = notifications.filter((notification) => !notification.archivedAt);
  const unread = active.filter((notification) => !read.includes(notification.id)).length;
  const mentionCount = active.filter((notification) => notification.kind === 'mention').length;
  const updateCount = active.filter((notification) => notification.kind === 'project_update').length;
  const archived = notifications.filter((notification) => notification.archivedAt);
  const needle = query.trim().toLowerCase();

  const filtered = notifications.filter((notification) => {
    if (filter === 'archived') {
      if (!notification.archivedAt) return false;
    } else {
      if (notification.archivedAt) return false;
      if (filter === 'unread' && read.includes(notification.id)) return false;
      if (filter === 'mentions' && notification.kind !== 'mention') return false;
      if (filter === 'updates' && notification.kind !== 'project_update') return false;
    }
    if (!needle) return true;
    const issue = issues.find((item) => item.id === notification.issueId);
    const project = notification.projectId
      ? useData.getState().projects.find((item) => item.id === notification.projectId)
      : undefined;
    const haystack = [
      notification.kind,
      notification.event ?? '',
      notification.cycleName ?? '',
      notification.projectName ?? '',
      issue?.key ?? '',
      issue?.title ?? '',
      project?.name ?? '',
      notification.kind === 'mention'
        ? t('Mention')
        : notification.kind === 'project_update'
          ? t('Project update')
          : notification.kind === 'cycle'
            ? t('Cycle')
            : t('Agent'),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });

  const kindIcon = (kind: (typeof notifications)[number]['kind']) =>
    kind === 'cycle' ? (
      <RefreshCw size={11} strokeWidth={2.2} />
    ) : kind === 'mention' ? (
      <AtSign size={12} strokeWidth={2} />
    ) : kind === 'project_update' ? (
      <Megaphone size={11} strokeWidth={2} />
    ) : kind === 'digest' ? (
      <CalendarDays size={11} strokeWidth={2} />
    ) : (
      <Sparkles size={12} strokeWidth={2} />
    );

  const kindTone = (kind: (typeof notifications)[number]['kind']) =>
    kind === 'cycle'
      ? 'bg-[color-mix(in_srgb,#00B8CC_20%,transparent)] text-[#79e0ea]'
      : kind === 'mention'
        ? 'bg-[color-mix(in_srgb,#B87CF0_20%,transparent)] text-[#d5b6ff]'
        : kind === 'project_update'
          ? 'bg-[color-mix(in_srgb,#FC7840_20%,transparent)] text-[#ffb08a]'
          : kind === 'digest'
            ? 'bg-[var(--bg-selected)] text-t3'
            : 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[#9aa4ff]';

  const kindTitle = (notification: (typeof notifications)[number]) => {
    if (notification.kind === 'mention') return t('Mention');
    if (notification.kind === 'project_update') return t('Project update');
    if (notification.kind === 'digest') return t('Daily digest');
    if (notification.kind !== 'cycle') return t('Agent');
    if (notification.event === 'started') return t('Cycle started');
    if (notification.event === 'ending') return t('Cycle ending');
    return t('Cycle rollover');
  };

  const renderHighlighted = (text: string) =>
    highlightSegments(text, needle).map((segment, index) =>
      segment.hit ? (
        <mark key={`${segment.text}-${index}`} className="rounded-[2px] bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] px-0.5 text-t1">
          {segment.text}
        </mark>
      ) : (
        <span key={`${segment.text}-${index}`}>{segment.text}</span>
      ),
    );

  const [cursorId, setCursorId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!filtered.length) {
      setCursorId(null);
      return;
    }
    if (!filtered.some((notification) => notification.id === cursorId)) setCursorId(filtered[0].id);
  }, [filtered, cursorId]);

  const toggleSelected = (id: string) =>
    setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));

  const exitSelection = () => {
    setSelecting(false);
    setSelected([]);
  };

  const archiveSelected = () => {
    if (!selected.length) return;
    selected.forEach((id) => archive(id, true));
    pushToast({ title: t('Archived {n} notifications', { n: selected.length }), tone: 'success' });
    setSelected([]);
  };

  const deleteSelected = () => {
    if (!selected.length) return;
    if (!window.confirm(t('Delete {n} notifications?', { n: selected.length }))) return;
    selected.forEach((id) => remove(id));
    pushToast({ title: t('Deleted {n} notifications', { n: selected.length }), tone: 'danger' });
    setSelected([]);
  };

  const openNotification = (notification: (typeof notifications)[number]) => {
    markRead(notification.id);
    if (notification.kind === 'digest') {
      const day = notification.digestDate;
      const sameDay = notifications.filter(
        (item) =>
          item.kind !== 'digest' &&
          (!day || localDayKey(new Date(item.createdAt)) === day),
      );
      const target = sameDay.find((item) => !read.includes(item.id)) ?? sameDay[0];
      if (!target) {
        pushToast({ title: t('Nothing else from that day'), tone: 'default' });
        return;
      }
      const targetUnread = !read.includes(target.id);
      setFilter(targetUnread ? 'unread' : 'all');
      setCursorId(target.id);
      window.setTimeout(() => {
        document
          .querySelector<HTMLElement>(`[data-notification="${target.id}"]`)
          ?.scrollIntoView({ block: 'center' });
      }, 120);
      return;
    }
    if (notification.kind === 'project_update' && notification.projectId) {
      router.push(`/projects/${notification.projectId}`);
      return;
    }
    const issue = issues.find((item) => item.id === notification.issueId);
    if (issue) openIssue(issue.id);
  };

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (!filtered.length) return;
      const index = Math.max(0, filtered.findIndex((notification) => notification.id === cursorId));
      const current = filtered[index] ?? filtered[0];
      const move = (delta: number) => {
        const next = filtered[Math.min(filtered.length - 1, Math.max(0, index + delta))];
        setCursorId(next.id);
        document
          .querySelector<HTMLElement>(`[data-notification="${next.id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      };
      const key = event.key.toLowerCase();
      if (key === 'escape' && selecting) {
        event.preventDefault();
        exitSelection();
        return;
      }
      if (selecting && (key === 'enter' || key === ' ')) {
        event.preventDefault();
        toggleSelected(current.id);
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        move(1);
      } else if (key === 'k') {
        event.preventDefault();
        move(-1);
      } else if (key === 'enter') {
        event.preventDefault();
        openNotification(current);
      } else if (key === 'a') {
        event.preventDefault();
        archive(current.id, !current.archivedAt);
      } else if (key === 'u') {
        event.preventDefault();
        if (read.includes(current.id)) markUnread(current.id);
        else markRead(current.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="mx-auto max-w-[760px] px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-4 flex items-center gap-2">
        <InboxIcon size={15} strokeWidth={1.8} className="text-t4" />
        <h1 className="text-[15px] font-[590] text-t1">{t('Inbox')}</h1>
        {unread > 0 ? (
          <span className="rounded-full bg-[var(--bg-selected)] px-1.5 text-[12px] leading-[16px] text-t3">{unread}</span>
        ) : null}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          aria-label={selecting ? t('Exit selection') : t('Select')}
          onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          className="gap-1.5"
        >
          <CheckCheck size={13} strokeWidth={1.9} />
          <span className="hidden sm:inline">{selecting ? t('Exit selection') : t('Select')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('Mark all read')}
          disabled={unread === 0}
          onClick={() => {
            markAll(active.map((notification) => notification.id));
            pushToast({ title: t('Inbox cleared'), description: t('All notifications marked as read') });
          }}
          className="gap-1.5"
        >
          <CheckCheck size={13} strokeWidth={1.9} />
          <span className="hidden sm:inline">{t('Mark all read')}</span>
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-1 overflow-x-auto [scrollbar-width:none]" data-inbox-filter>
        {(
          [
            ['all', t('All'), active.length],
            ['unread', t('Unread'), unread],
            ['mentions', t('Mentions'), mentionCount],
            ['updates', t('Updates'), updateCount],
            ['archived', t('Archived'), archived.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            data-mobile-hit
            data-inbox-tab={key}
            onClick={() => setFilter(key)}
            className={cn(
              'flex h-[26px] shrink-0 items-center gap-1.5 rounded-r6 px-2 text-[13px] transition-colors',
              filter === key ? 'bg-[var(--bg-selected)] text-t1' : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
            )}
          >
            {label}
            <span className="tnum text-[11.5px] text-t4">{count}</span>
          </button>
        ))}
      </div>

      {selecting ? (
        <div data-bulk-toolbar className="mb-3 flex flex-wrap items-center gap-2 rounded-r6 bg-[var(--bg-hover)] px-2 py-1.5 text-[12px] shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="text-t2">{t('{n} selected', { n: selected.length })}</span>
          <button
            type="button"
            onClick={() => setSelected(filtered.map((notification) => notification.id))}
            className="rounded-r4 px-1.5 py-0.5 text-t3 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
          >
            {t('Select all')}
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="rounded-r4 px-1.5 py-0.5 text-t3 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
          >
            {t('Clear selection')}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            data-bulk-archive
            disabled={!selected.length}
            onClick={archiveSelected}
            className="flex h-[24px] items-center gap-1 rounded-r5 px-2 text-t3 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1 disabled:opacity-40"
          >
            <Archive size={11} />
            {t('Archive')}
          </button>
          <button
            type="button"
            data-bulk-delete
            disabled={!selected.length}
            onClick={deleteSelected}
            className="flex h-[24px] items-center gap-1 rounded-r5 px-2 text-t3 transition-colors hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)] disabled:opacity-40"
          >
            <Trash2 size={11} />
            {t('Delete')}
          </button>
          <button
            type="button"
            onClick={exitSelection}
            className="h-[24px] rounded-r5 px-2 text-t4 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
          >
            {t('Cancel')}
          </button>
        </div>
      ) : (
      <div className="mb-3 flex items-center gap-2">
        <input
          data-inbox-search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder={t('Search notifications…')}
          className="h-[28px] w-full max-w-[320px] rounded-r6 bg-[var(--bg-hover)] px-2.5 text-[12.5px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-t4 focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="rounded-r4 px-1.5 py-0.5 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {t('Clear')}
          </button>
        ) : null}
        {filter === 'archived' && archived.length ? (
          <button
            type="button"
            data-clear-archived
            onClick={() => {
              if (!window.confirm(t('Delete {n} archived notifications?', { n: archived.length }))) return;
              archived.forEach((notification) => remove(notification.id));
              pushToast({ title: t('Archived notifications cleared'), tone: 'danger' });
            }}
            className="ml-auto flex h-[26px] shrink-0 items-center gap-1.5 rounded-r6 px-2 text-[12px] text-t4 transition-colors hover:bg-[rgba(235,87,87,.1)] hover:text-[var(--red)]"
          >
            <Trash2 size={11} />
            {t('Clear archived')}
          </button>
        ) : null}
        <span className="ml-auto hidden shrink-0 items-center gap-1 text-[11px] text-t4 md:flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
          <Kbd>↵</Kbd>
          <Kbd>A</Kbd>
        </span>
      </div>
      )}

      {menu ? (() => {
        const notification = notifications.find((item) => item.id === menu.id);
        if (!notification) return null;
        const unread = !read.includes(notification.id);
        return (
          <>
            <div className="fixed inset-0 z-[800]" onMouseDown={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }} />
            <div
              ref={menuRef}
              tabIndex={-1}
              data-notification-menu
              style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 180) }}
              className="fixed z-[810] w-[180px] rounded-r8 bg-[var(--bg-elevated)] p-1 shadow-pop outline-none"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMenu(null);
                  return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const delta = event.key === 'ArrowDown' ? 1 : -1;
                  setMenu((current) => (current ? { ...current, index: (current.index + delta + 4) % 4 } : current));
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  document.querySelector<HTMLElement>('[data-notification-menu] [data-menu-active="true"]')?.click();
                }
              }}
            >
              {[
                { key: 'open', label: t('Open'), run: () => { setMenu(null); openNotification(notification); }, danger: false },
                {
                  key: 'read',
                  label: unread ? t('Mark as read') : t('Mark as unread'),
                  run: () => { if (unread) markRead(notification.id); else markUnread(notification.id); setMenu(null); },
                  danger: false,
                },
                {
                  key: 'archive',
                  label: notification.archivedAt ? t('Restore from archive') : t('Archive'),
                  run: () => { archive(notification.id, !notification.archivedAt); setMenu(null); },
                  danger: false,
                },
                { key: 'delete', label: t('Delete'), run: () => { remove(notification.id); setMenu(null); }, danger: true },
              ].map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  data-menu-action={item.key}
                  data-menu-active={menu.index === index ? 'true' : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={item.run}
                  className={cn(
                    'flex h-[28px] w-full items-center rounded-r5 px-2 text-left text-[12.5px]',
                    item.danger ? 'text-[var(--red)]' : 'text-t2',
                    menu.index === index
                      ? item.danger
                        ? 'bg-[rgba(235,87,87,.12)]'
                        : 'bg-[var(--bg-hover)] text-t1'
                      : 'hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        );
      })() : null}

      {notifications.length === 0 ? (        <div className="mb-3 rounded-r8 px-3.5 py-2.5 text-[13.5px] text-t4 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          {t("You're all caught up — new notifications will show up here.")}
        </div>
      ) : null}

      {filtered.length ? (
        <div className="overflow-clip rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          {filtered.map((notification, index) => {
            const issue = issues.find((item) => item.id === notification.issueId);
            const isUnread = !read.includes(notification.id);
            const isArchived = Boolean(notification.archivedAt);
            const day = inboxDay(notification.createdAt);
            const previousDay = index > 0 ? inboxDay(filtered[index - 1].createdAt) : null;
            return (
              <React.Fragment key={notification.id}>
                {day !== previousDay ? (
                  <div
                    data-inbox-day={day}
                    className="sticky top-0 z-[1] bg-[var(--bg-panel)] px-3.5 py-1 text-[11px] font-[510] uppercase tracking-[.05em] text-t4"
                  >
                    {t(day === 'today' ? 'Today' : day === 'yesterday' ? 'Yesterday' : 'Earlier')}
                  </div>
                ) : null}
              <div
                data-notification={notification.id}
                data-notification-cursor={cursorId === notification.id ? 'true' : undefined}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setCursorId(notification.id);
                  setMenu({ id: notification.id, x: event.clientX, y: event.clientY, index: 0 });
                }}
                className={cn(
                  'group flex items-center gap-1 pr-2 transition-colors duration-100 hover:bg-[var(--bg-hover)]',
                  day === previousDay && 'border-t border-[var(--line-subtle)]',
                  cursorId === notification.id && 'bg-[var(--bg-hover)] shadow-[inset_2px_0_0_var(--accent)]',
                  selecting && selected.includes(notification.id) && 'bg-[var(--bg-selected)]',
                )}
              >
                {selecting ? (
                  <span
                    data-notification-select={notification.id}
                    role="checkbox"
                    aria-checked={selected.includes(notification.id)}
                    aria-label={t('Select notification')}
                    className={cn(
                      'ml-2 grid h-[14px] w-[14px] shrink-0 place-items-center rounded-[3px] transition-colors',
                      selected.includes(notification.id)
                        ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                        : 'bg-[var(--bg-panel)] shadow-[inset_0_0_0_1px_var(--line-strong)]',
                    )}
                  >
                    {selected.includes(notification.id) ? <Check size={9} strokeWidth={3} /> : null}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setCursorId(notification.id);
                    if (selecting) toggleSelected(notification.id);
                    else openNotification(notification);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5 text-left"
                >
                  <span className="relative shrink-0">
                    <span className={cn('grid h-6 w-6 place-items-center rounded-full', kindTone(notification.kind))}>
                      {kindIcon(notification.kind)}
                    </span>
                    {isUnread && !isArchived ? (
                      <span className="absolute -left-[7px] top-1/2 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-accent" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[14px]">
                      <span className={cn('font-[510]', isUnread ? 'text-t1' : 'text-t2')}>{kindTitle(notification)}</span>
                      <span className="text-t4">
                        {notification.kind === 'digest'
                          ? t('{n} updates today', { n: notification.count ?? 0 })
                          : notification.kind === 'project_update'
                          ? t('posted an update in {project}', { project: notification.projectName ?? '' })
                          : notification.kind === 'cycle'
                            ? notification.event === 'started'
                              ? t('{n} issue(s) in scope', { n: notification.count ?? 0 })
                              : notification.event === 'ending'
                                ? t('{n} unfinished issue(s)', { n: notification.count ?? 0 })
                                : t('carried {n} issue(s) into {cycle}', {
                                    n: notification.count ?? 0,
                                    cycle: notification.cycleName ?? '',
                                  })
                            : notification.kind === 'mention'
                              ? t('mentioned you in a comment')
                              : t('updated this issue · {n} change(s)', { n: notification.count ?? 0 })}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[13.5px] text-t4">
                      {issue ? <StatusIcon status={issue.status} size={12} style={{ color: 'var(--status-progress)' }} /> : null}
                      <span className="tnum">
                        {notification.kind === 'project_update'
                          ? t('Project')
                          : notification.kind === 'digest'
                            ? notification.digestDate ?? '—'
                            : issue?.key ?? '—'}
                      </span>
                      <span className="truncate">
                        {renderHighlighted(
                          notification.kind === 'digest'
                            ? [
                                notification.digest?.counts.mention
                                  ? `${notification.digest.counts.mention} ${t('Mention')}`
                                  : '',
                                notification.digest?.counts.project_update
                                  ? `${notification.digest.counts.project_update} ${t('Project updates')}`
                                  : '',
                                notification.digest?.counts.agent
                                  ? `${notification.digest.counts.agent} ${t('Agent')}`
                                  : '',
                                notification.digest?.counts.cycle
                                  ? `${notification.digest.counts.cycle} ${t('Cycle')}`
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : notification.kind === 'project_update'
                              ? notification.projectName ?? t('(deleted project)')
                              : notification.kind === 'cycle'
                                ? notification.event === 'started'
                                  ? t('A new cycle is underway.')
                                  : notification.event === 'ending'
                                    ? t('Wrap up or carry work before the cycle closes.')
                                    : t('Unfinished work moved automatically at the end of a cycle.')
                                : issue?.title ?? t('(deleted issue)'),
                        )}
                      </span>
                    </div>
                  </div>
                  <span className="hidden shrink-0 text-[12.5px] text-t4 sm:inline">
                    {relativeTime(notification.createdAt)}
                  </span>
                </button>

                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    data-notification-read={notification.id}
                    aria-label={isUnread ? t('Mark as read') : t('Mark as unread')}
                    title={isUnread ? t('Mark as read') : t('Mark as unread')}
                    onClick={() => (isUnread ? markRead(notification.id) : markUnread(notification.id))}
                    className="grid h-[24px] w-[24px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1"
                  >
                    {isUnread ? <MailOpen size={12} /> : <Mail size={12} />}
                  </button>
                  <button
                    type="button"
                    data-notification-archive={notification.id}
                    aria-label={isArchived ? t('Restore from archive') : t('Archive')}
                    title={isArchived ? t('Restore from archive') : t('Archive')}
                    onClick={() => {
                      archive(notification.id, !isArchived);
                      pushToast({
                        title: isArchived ? t('Notification restored') : t('Notification archived'),
                      });
                    }}
                    className="grid h-[24px] w-[24px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1"
                  >
                    {isArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                  </button>
                  <button
                    type="button"
                    data-notification-delete={notification.id}
                    aria-label={t('Delete notification')}
                    title={t('Delete notification')}
                    onClick={() => {
                      remove(notification.id);
                      pushToast({ title: t('Notification deleted'), tone: 'danger' });
                    }}
                    className="grid h-[24px] w-[24px] place-items-center rounded-r4 text-t4 hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              </React.Fragment>
            );
          })}
        </div>
      ) : (
        <div className="flex h-[140px] flex-col items-center justify-center gap-2 rounded-r8 border border-dashed border-[var(--line)] px-6 text-center">
          <p className="text-[14px] text-t2">
            {filter === 'mentions'
              ? t('No mentions yet')
              : filter === 'updates'
                ? t('No project updates yet')
                : filter === 'unread'
                  ? t('Nothing unread')
                  : filter === 'archived'
                    ? t('Nothing archived')
                    : t('No notifications yet')}
          </p>
          <p className="max-w-[340px] text-[13px] leading-[1.6] text-t4">
            {t('When the agent changes an issue, it lands here.')}
          </p>
        </div>
      )}
    </div>
  );
}

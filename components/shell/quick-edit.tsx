'use client';

import * as React from 'react';
import { MenuItem, MenuLabel, Popover } from '@/components/ui/popover';
import { Avatar, LabelChip } from '@/components/ui/primitives';
import { PriorityIcon, StatusIcon } from '@/components/ui/icons';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { PRIORITIES, STATUSES, type Issue, type Priority, type StatusKey } from '@/lib/types';
import { usePeople } from '@/lib/people';

function statusColor(status: StatusKey) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

/**
 * S / P / A / L on the cursor row (or the whole selection) — the property
 * menus Linear opens without leaving the list. Anchored to the row's status
 * glyph, so the pointer never has to travel.
 */
export function QuickEdit() {
  const { users } = usePeople();
  const quick = useUI((s) => s.quickEdit);
  const close = useUI((s) => s.closeQuickEdit);
  const pushToast = useUI((s) => s.pushToast);
  const issues = useData((s) => s.issues);
  const labels = useData((s) => s.labels);
  const data = useData();
  const t = useT();
  const anchorRef = React.useRef<HTMLSpanElement>(null);

  const rows = React.useMemo<Issue[]>(() => {
    if (!quick) return [];
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    return quick.ids.map((id) => byId.get(id)).filter((issue): issue is Issue => !!issue);
  }, [quick, issues]);

  const ids = quick?.ids ?? [];
  const all = (predicate: (issue: Issue) => boolean) => rows.length > 0 && rows.every(predicate);

  const setStatus = (status: StatusKey, label: string) => {
    data.batchIssues(() => ids.forEach((id) => data.setStatus(id, status)));
    if (ids.length > 1)
      pushToast({ title: t('{n} issues moved to {status}', { n: ids.length, status: t(label) }) });
    close();
  };

  const setPriority = (priority: Priority, label: string) => {
    data.batchIssues(() => ids.forEach((id) => data.setPriority(id, priority)));
    if (ids.length > 1) pushToast({ title: t('Priority set to {label}', { label: t(label) }) });
    close();
  };

  const setAssignee = (userId: string | null, name?: string) => {
    data.batchIssues(() => ids.forEach((id) => data.setAssignee(id, userId)));
    if (ids.length > 1 && userId)
      pushToast({ title: t('Assigned {n} issues to {name}', { n: ids.length, name: name ?? '' }) });
    close();
  };

  const toggleLabel = (labelId: string, name: string) => {
    const allHave = all((issue) => issue.labelIds.includes(labelId));
    data.batchIssues(() => ids.forEach((id) => {
      const issue = issues.find((i) => i.id === id);
      if (!issue) return;
      const has = issue.labelIds.includes(labelId);
      if (has === allHave) data.toggleLabel(id, labelId);
    }));
    // stays open: picking two labels in a row is the common case
    if (ids.length > 1)
      pushToast({
        title: allHave
          ? t('Removed {label} from {n} issues', { label: name, n: ids.length })
          : t('Added {label} to {n} issues', { label: name, n: ids.length }),
      });
  };

  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        data-quick-anchor
        style={{
          position: 'fixed',
          left: quick?.left ?? -200,
          top: quick?.top ?? -200,
          width: 0,
          height: 0,
        }}
      />
      <Popover
        open={!!quick}
        onClose={close}
        anchorRef={anchorRef}
        width={quick?.kind === 'assignee' ? 232 : quick?.kind === 'status' ? 212 : 208}
      >
        {quick?.kind === 'status' ? (
          <>
            <MenuLabel>{t('Status')}</MenuLabel>
            {STATUSES.map((status) => (
              <MenuItem
                key={status.key}
                icon={<StatusIcon status={status.key} size={14} style={{ color: statusColor(status.key) }} />}
                label={t(status.label)}
                checked={all((issue) => issue.status === status.key)}
                onSelect={() => setStatus(status.key, status.label)}
              />
            ))}
          </>
        ) : null}

        {quick?.kind === 'priority' ? (
          <>
            <MenuLabel>{t('Priority')}</MenuLabel>
            {PRIORITIES.map((priority) => (
              <MenuItem
                key={priority.key}
                icon={<PriorityIcon priority={priority.key} size={14} />}
                label={t(priority.label)}
                checked={all((issue) => issue.priority === priority.key)}
                onSelect={() => setPriority(priority.key, priority.label)}
              />
            ))}
          </>
        ) : null}

        {quick?.kind === 'assignee' ? (
          <>
            <MenuLabel>{t('Assignee')}</MenuLabel>
            <MenuItem
              label={t('No assignee')}
              checked={all((issue) => !issue.assigneeId)}
              onSelect={() => setAssignee(null)}
            />
            {users.map((user) => (
              <MenuItem
                key={user.id}
                icon={<Avatar name={user.name} color={user.color} size="xs" />}
                label={user.name}
                checked={all((issue) => issue.assigneeId === user.id)}
                onSelect={() => setAssignee(user.id, user.name)}
              />
            ))}
          </>
        ) : null}

        {quick?.kind === 'labels' ? (
          <>
            <MenuLabel>{t('Labels')}</MenuLabel>
            {labels.map((label) => (
              <MenuItem
                key={label.id}
                label={
                  <span className="flex min-w-0 items-center gap-2">
                    <LabelChip name={label.name} color={label.color} className="h-[19px] text-[12px]" />
                  </span>
                }
                checked={all((issue) => issue.labelIds.includes(label.id))}
                onSelect={() => toggleLabel(label.id, label.name)}
              />
            ))}
          </>
        ) : null}
      </Popover>
    </>
  );
}

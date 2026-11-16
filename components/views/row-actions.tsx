'use client';

import * as React from 'react';
import { Check, Link2, MoreHorizontal, Trash2, UserPlus } from 'lucide-react';
import type { Issue } from '@/lib/types';
import { STATUSES } from '@/lib/types';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { useView } from '@/lib/store/view';
import { useT } from '@/lib/use-t';
import { usePeople } from '@/lib/people';
import { MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/ui/popover';import { PriorityIcon, StatusIcon } from '@/components/ui/icons';

function statusColor(status: Issue['status']) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

/** Clicking the status glyph in a row opens the status picker — same as Linear. */
export function RowStatus({ issue }: { issue: Issue }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const data = useData();
  const t = useT();

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`Change status of ${issue.key}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="grid h-[20px] w-[18px] place-items-center rounded-r4 transition-colors duration-100 hover:bg-[var(--bg-selected)]"
      >
        <StatusIcon status={issue.status} size={14} style={{ color: statusColor(issue.status) }} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={210}>
        <MenuLabel>{t('Status')}</MenuLabel>
        {STATUSES.map((s) => (
          <MenuItem
            key={s.key}
            icon={<StatusIcon status={s.key} size={14} style={{ color: statusColor(s.key) }} />}
            label={t(s.label)}
            checked={issue.status === s.key}
            onSelect={() => {
              data.setStatus(issue.id, s.key);
              setOpen(false);
            }}
          />
        ))}
      </Popover>
    </>
  );
}

/**
 * The `⋯` affordance revealed on row hover. Deliberately small: six actions,
 * one keyboard hint, no submenus — the point is speed, not completeness.
 */
export function RowActions({ issue }: { issue: Issue }) {
  const { meId } = usePeople();
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const data = useData();
  const pushToast = useUI((s) => s.pushToast);
  const openIssue = useView((s) => s.openIssue);
  const clearSelection = useView((s) => s.clearSelection);
  const select = useView((s) => s.select);
  const selectedIds = useView((s) => s.selectedIds);
  const t = useT();

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`Actions for ${issue.key}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 transition-colors duration-100 hover:bg-[var(--bg-selected)] hover:text-t2"
      >
        <MoreHorizontal size={14} strokeWidth={1.9} />
      </button>
      <Popover open={open} onClose={close} anchorRef={ref} width={224} align="end">
        <MenuItem
          label={t('Open issue')}
          hint="↵"
          onSelect={() => {
            close();
            openIssue(issue.id);
          }}
        />
        <MenuItem
          label={t('Select issue')}
          hint="X"
          checked={selectedIds.includes(issue.id)}
          onSelect={() => {
            // phones have no hover checkbox, so multi-select lives here
            select(issue.id, 'toggle', data.issues.map((i) => i.id));
            close();
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Check size={13} strokeWidth={1.9} />}
          label={t('Mark as Done')}
          checked={issue.status === 'done'}
          onSelect={() => {
            data.setStatus(issue.id, 'done');
            close();
            pushToast({ title: t('{key} moved to Done', { key: issue.key }) });
          }}
        />
        <MenuItem
          icon={<UserPlus size={13} strokeWidth={1.9} />}
          label={t('Assign to me')}
          checked={issue.assigneeId === meId}
          onSelect={() => {
            data.setAssignee(issue.id, meId);
            close();
            pushToast({ title: t('{key} assigned to you', { key: issue.key }) });
          }}
        />
        <MenuItem
          icon={<PriorityIcon priority="urgent" size={13} />}
          label={t('Mark as Urgent')}
          checked={issue.priority === 'urgent'}
          onSelect={() => {
            data.setPriority(issue.id, 'urgent');
            close();
            pushToast({ title: t('{key} set to Urgent', { key: issue.key }) });
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Link2 size={13} strokeWidth={1.8} />}
          label={t('Copy issue link')}
          onSelect={() => {
            const url = `${window.location.origin}/team/${issue.teamKey}?issue=${issue.key}`;
            navigator.clipboard?.writeText(url);
            close();
            pushToast({ title: t('Link copied'), description: url });
          }}
        />
        <MenuItem
          icon={<Trash2 size={13} strokeWidth={1.8} />}
          label={t('Delete issue')}
          danger
          onSelect={() => {
            data.deleteIssues([issue.id]);
            clearSelection();
            close();
            pushToast({ title: t('{key} deleted', { key: issue.key }), tone: 'danger' });
          }}
        />
      </Popover>
    </>
  );
}

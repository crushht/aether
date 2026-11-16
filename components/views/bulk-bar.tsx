'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleDashed, Tag, Trash2, UserCircle2, X } from 'lucide-react';
import { useView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { PRIORITIES, STATUSES, type Priority } from '@/lib/types';
import { usePeople } from '@/lib/people';
import { Avatar, IconButton } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/ui/popover';
import { PriorityIcon, StatusIcon } from '@/components/ui/icons';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

function statusColor(status: string) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

function Trigger({
  icon,
  label,
  onClick,
  refEl,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  refEl: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={refEl}
      type="button"
      onClick={onClick}
      className="flex h-[30px] items-center gap-1.5 rounded-r6 px-2 text-[13.5px] text-t2 transition-colors duration-100 hover:bg-[var(--bg-selected)] hover:text-t1"
    >
      <span className="grid h-3.5 w-3.5 place-items-center text-t3">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function BulkBar() {
  const { users } = usePeople();
  const selectedIds = useView((s) => s.selectedIds);
  const clearSelection = useView((s) => s.clearSelection);
  const data = useData();
  const pushToast = useUI((s) => s.pushToast);
  const t = useT();

  const [open, setOpen] = React.useState<null | 'status' | 'priority' | 'assignee' | 'labels'>(null);
  const statusRef = React.useRef<HTMLButtonElement>(null);
  const priorityRef = React.useRef<HTMLButtonElement>(null);
  const assigneeRef = React.useRef<HTMLButtonElement>(null);
  const labelsRef = React.useRef<HTMLButtonElement>(null);
  const close = () => setOpen(null);
  const labels = useData((s) => s.labels);

  const ids = selectedIds;

  return (
    // The wrapper owns the fixed placement and centring; framer-motion animates
    // the bar itself, and its inline transform would fight a CSS -translate-x-1/2.
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[500] flex justify-center px-2 sm:bottom-6">
      <AnimatePresence>
        {ids.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: EASE }}
            className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-r8 bg-[var(--bg-float)] p-1 pl-2.5 shadow-pop [scrollbar-width:none] sm:pl-2.5"
          >
          <span className="mr-1 text-[13.5px] text-t2">{t('{n} selected', { n: ids.length })}</span>
          <div className="mx-1 h-4 w-px bg-[var(--bg-selected)]" />

          <Trigger
            refEl={statusRef}
            icon={<CircleDashed size={13} strokeWidth={1.8} />}
            label={t('Status')}
            onClick={() => setOpen(open === 'status' ? null : 'status')}
          />
          <Trigger
            refEl={priorityRef}
            icon={<PriorityIcon priority="high" size={13} />}
            label={t('Priority')}
            onClick={() => setOpen(open === 'priority' ? null : 'priority')}
          />
          <Trigger
            refEl={assigneeRef}
            icon={<UserCircle2 size={13} strokeWidth={1.8} />}
            label={t('Assignee')}
            onClick={() => setOpen(open === 'assignee' ? null : 'assignee')}
          />
          <Trigger
            refEl={labelsRef}
            icon={<Tag size={13} strokeWidth={1.8} />}
            label={t('Label')}
            onClick={() => setOpen(open === 'labels' ? null : 'labels')}
          />

          <div className="mx-1 h-4 w-px bg-[var(--bg-selected)]" />
          <IconButton
            aria-label={t('Delete issues')}
            size={28}
            onClick={() => {
              data.deleteIssues(ids);
              clearSelection();
              pushToast({ title: t('{n} issues deleted', { n: ids.length }), tone: 'danger' });
            }}
            className="text-t3 hover:bg-[rgba(235,87,87,.12)] hover:text-[#f08080]"
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </IconButton>
          <IconButton aria-label={t('Clear selection')} size={28} onClick={clearSelection} className="text-t4">
            <X size={14} strokeWidth={1.8} />
          </IconButton>

          <Popover open={open === 'status'} onClose={close} anchorRef={statusRef} width={230} side="top" align="center">
            <MenuLabel>{t('Set status')}</MenuLabel>
            {STATUSES.map((s) => (
              <MenuItem
                key={s.key}
                icon={<StatusIcon status={s.key} size={14} style={{ color: statusColor(s.key) }} />}
                label={t(s.label)}
                onSelect={() => {
                  data.batchIssues(() => ids.forEach((id) => data.setStatus(id, s.key)));
                  close();
                  clearSelection();
                  pushToast({ title: t('{n} issues moved to {status}', { n: ids.length, status: t(s.label) }) });
                }}
              />
            ))}
          </Popover>

          <Popover open={open === 'priority'} onClose={close} anchorRef={priorityRef} width={220} side="top" align="center">
            <MenuLabel>{t('Set priority')}</MenuLabel>
            {PRIORITIES.map((p) => (
              <MenuItem
                key={p.key}
                icon={<PriorityIcon priority={p.key as Priority} size={14} className="text-t3" />}
                label={t(p.label)}
                onSelect={() => {
                  data.batchIssues(() => ids.forEach((id) => data.setPriority(id, p.key)));
                  close();
                  clearSelection();
                  pushToast({ title: t('Priority set to {label}', { label: t(p.label) }) });
                }}
              />
            ))}
          </Popover>

          <Popover open={open === 'assignee'} onClose={close} anchorRef={assigneeRef} width={240} side="top" align="center">
            <MenuLabel>{t('Assign to')}</MenuLabel>
            <MenuItem
              icon={<UserCircle2 size={13} strokeWidth={1.8} />}
              label={t('No assignee')}
              onSelect={() => {
                data.batchIssues(() => ids.forEach((id) => data.setAssignee(id, null)));
                close();
                clearSelection();
              }}
            />
            <MenuSeparator />
            {users.map((u) => (
              <MenuItem
                key={u.id}
                icon={<Avatar name={u.name} color={u.color} size="xs" />}
                label={u.name}
                onSelect={() => {
                  data.batchIssues(() => ids.forEach((id) => data.setAssignee(id, u.id)));
                  close();
                  clearSelection();
                  pushToast({ title: t('Assigned {n} issues to {name}', { n: ids.length, name: u.name }) });
                }}
              />
            ))}
          </Popover>

          <Popover
            open={open === 'labels'}
            onClose={close}
            anchorRef={labelsRef}
            width={220}
            side="top"
            align="center"
          >
            <MenuLabel>{t('Toggle label')}</MenuLabel>
            {labels.map((l) => (
              <MenuItem
                key={l.id}
                icon={<span className="h-[7px] w-[7px] rounded-full" style={{ background: l.color }} />}
                label={l.name}
                onSelect={() => {
                  // every selected issue carrying the label → remove it, else add
                  const rows = ids.map((id) => data.issues.find((i) => i.id === id)).filter(Boolean);
                  const allHave = rows.length > 0 && rows.every((issue) => issue!.labelIds.includes(l.id));
                  data.batchIssues(() => rows.forEach((issue) => {
                    if (allHave ? issue!.labelIds.includes(l.id) : !issue!.labelIds.includes(l.id)) {
                      data.toggleLabel(issue!.id, l.id);
                    }
                  }));
                  close();
                  pushToast({
                    title: allHave
                      ? t('Removed {label} from {n} issues', { label: l.name, n: ids.length })
                      : t('Added {label} to {n} issues', { label: l.name, n: ids.length }),
                  });
                }}
              />
            ))}
          </Popover>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}


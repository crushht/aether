'use client';

import * as React from 'react';
import { Calendar, CircleDashed, Hash, Layers, Plus, Tag, UserCircle2 } from 'lucide-react';
import type { Issue, Priority, StatusKey } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';
import { usePeople } from '@/lib/people';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';
import { cn, shortDate, plural, isImeComposing } from '@/lib/utils';
import { Avatar } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/ui/popover';
import { PriorityIcon, StatusIcon } from '@/components/ui/icons';

type PropKey = 'status' | 'priority' | 'assignee' | 'labels' | 'project' | 'cycle' | 'due' | 'estimate';

function statusColor(status: StatusKey) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

function Row({
  icon,
  value,
  empty,
  active,
  onClick,
  buttonRef,
  children,
  indent,
  chips,
  propKey,
}: {
  icon: React.ReactNode;
  value?: React.ReactNode;
  empty?: boolean;
  active?: boolean;
  onClick?: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  children?: React.ReactNode;
  indent?: boolean;
  chips?: boolean;
  propKey?: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-prop={propKey}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2 text-left transition-colors duration-100',
        chips
          ? 'h-[30px] shrink-0 gap-1.5 rounded-full bg-[var(--bg-hover)] pl-2 pr-2.5 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[var(--bg-active)]'
          : [
              'h-[26px] w-full rounded-r6',
              indent ? 'pl-[30px] pr-2' : 'pl-[7px] pr-2',
              active ? 'bg-[var(--bg-active)]' : 'hover:bg-[var(--bg-hover)]',
            ],
        active && chips && 'bg-[var(--bg-selected)]',
      )}
    >
      <span className={cn('grid h-4 w-4 shrink-0 place-items-center', empty ? 'text-t4 opacity-60' : 'text-t3')}>
        {icon}
      </span>
      <span
        className={cn(
          'min-w-0 truncate',
          chips ? 'text-[13px]' : 'flex-1 text-[13.5px]',
          empty ? 'text-t4' : 'text-t2',
        )}
      >
        {children ?? value}
      </span>
      {empty && !chips ? (
        <Plus size={12} className="shrink-0 text-t4 opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </button>
  );
}

export function IssueProperties({
  issue,
  layout = 'list',
}: {
  issue: Issue;
  /** `chips` is the phone layout: one horizontally scrollable row of pills. */
  layout?: 'list' | 'chips';
}) {
  const chips = layout === 'chips';
  const t = useT();
  const { users, meId } = usePeople();
  const [open, setOpen] = React.useState<PropKey | null>(null);
  const statusRef = React.useRef<HTMLButtonElement>(null);
  const priorityRef = React.useRef<HTMLButtonElement>(null);
  const assigneeRef = React.useRef<HTMLButtonElement>(null);
  const labelsRef = React.useRef<HTMLButtonElement>(null);
  const projectRef = React.useRef<HTMLButtonElement>(null);
  const cycleRef = React.useRef<HTMLButtonElement>(null);
  const dueRef = React.useRef<HTMLButtonElement>(null);
  const estimateRef = React.useRef<HTMLButtonElement>(null);
  const [labelQuery, setLabelQuery] = React.useState('');

  const data = useData();
  const labels = useData((s) => s.labels);
  const projects = useData((s) => s.projects);
  const cycles = useData((s) => s.cycles);
  // imported or legacy data can carry an unknown status; never deref undefined
  const status = STATUSES.find((s) => s.key === issue.status) ?? STATUSES[0];
  const assignee = users.find((u) => u.id === issue.assigneeId);
  const project = issue.projectId ? projects.find((p) => p.id === issue.projectId) : null;
  const cycle = issue.cycleId ? cycles.find((c) => c.id === issue.cycleId) : null;
  const issueLabels = issue.labelIds.map((id) => labels.find((l) => l.id === id)).filter(Boolean);
  const close = () => setOpen(null);

  const dueOptions: { label: string; days: number | null }[] = [
    { label: 'Today', days: 0 },
    { label: 'Tomorrow', days: 1 },
    { label: 'In 3 days', days: 3 },
    { label: 'Next week', days: 7 },
    { label: 'In 2 weeks', days: 14 },
  ];

  const filteredLabels = labels.filter((l) => l.name.toLowerCase().includes(labelQuery.toLowerCase().trim()));

  return (
    <div className={cn(chips ? 'flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]' : 'flex flex-col gap-6')}>
      <div className={chips ? 'flex items-center gap-1.5' : undefined}>
        {chips ? null : <div className="flex h-[24px] items-center px-2 text-[13px] font-[510] text-t4">{t('Properties')}</div>}
        <div className={cn(chips ? 'flex items-center gap-1.5' : 'flex flex-col gap-[1px]')}>
          <Row
            chips={chips}
            buttonRef={statusRef}
            icon={<StatusIcon status={issue.status} size={14} style={{ color: statusColor(issue.status) }} />}
            value={t(status.label)}
            active={open === 'status'}
            onClick={() => setOpen(open === 'status' ? null : 'status')}
          />
          <Row
            chips={chips}
            buttonRef={priorityRef}
            icon={<PriorityIcon priority={issue.priority} size={14} className="text-t3" />}
            value={t(PRIORITIES.find((p) => p.key === issue.priority)?.label ?? '')}
            empty={issue.priority === 'none'}
            active={open === 'priority'}
            onClick={() => setOpen(open === 'priority' ? null : 'priority')}
          />
          <Row
            chips={chips}
            buttonRef={assigneeRef}
            icon={
              assignee ? (
                <Avatar name={assignee.name} color={assignee.color} size="xs" />
              ) : (
                <UserCircle2 size={14} strokeWidth={1.7} />
              )
            }
            value={assignee?.name}
            empty={!assignee}
            active={open === 'assignee'}
            onClick={() => setOpen(open === 'assignee' ? null : 'assignee')}
          />
          <Row
            chips={chips}
            buttonRef={labelsRef}
            icon={<Tag size={13} strokeWidth={1.7} />}
            empty={issueLabels.length === 0}
            active={open === 'labels'}
            onClick={() => setOpen(open === 'labels' ? null : 'labels')}
          >
            {issueLabels.length ? (
              <span className={cn('flex items-center gap-1', chips ? 'flex-nowrap' : 'flex-wrap')}>
                {issueLabels.map((l) => (
                  <span
                    key={l!.id}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-1.5 text-t2',
                      chips
                        ? 'h-[19px] whitespace-nowrap text-[12.5px]'
                        : 'h-[20px] text-[12.5px] shadow-[inset_0_0_0_1px_var(--line-solid)]',
                    )}
                  >
                    <span className="h-[6px] w-[6px] rounded-full" style={{ background: l!.color }} />
                    {l!.name}
                  </span>
                ))}
              </span>
            ) : (
              t('Add labels')
            )}
          </Row>
          <Row
            chips={chips}
            buttonRef={projectRef}
            icon={<Layers size={13} strokeWidth={1.7} />}
            value={project?.name}
            empty={!project}
            active={open === 'project'}
            onClick={() => setOpen(open === 'project' ? null : 'project')}
          />
          <Row
            chips={chips}
            propKey="cycle"
            buttonRef={cycleRef}
            icon={<CircleDashed size={13} strokeWidth={1.7} />}
            value={cycle?.name}
            empty={!cycle}
            active={open === 'cycle'}
            onClick={() => setOpen(open === 'cycle' ? null : 'cycle')}
          />
          <Row
            chips={chips}
            buttonRef={dueRef}
            icon={<Calendar size={13} strokeWidth={1.7} />}
            value={issue.dueDate ? shortDate(issue.dueDate) : undefined}
            empty={!issue.dueDate}
            active={open === 'due'}
            onClick={() => setOpen(open === 'due' ? null : 'due')}
          />
          <Row
            chips={chips}
            buttonRef={estimateRef}
            icon={<Hash size={13} strokeWidth={1.7} />}
            value={issue.estimate != null ? plural(issue.estimate, 'point') : undefined}
            empty={issue.estimate == null}
            active={open === 'estimate'}
            onClick={() => setOpen(open === 'estimate' ? null : 'estimate')}
          />
        </div>
      </div>

      {chips ? null : (
        <div>
          <div className="flex h-[24px] items-center px-2 text-[13px] font-[510] text-t4">{t('Context')}</div>
          <div className="flex flex-col gap-[1px]">
            <div className="flex h-[26px] items-center gap-2 pl-[7px] pr-2 text-[13.5px] text-t3">
              <span className="grid h-4 w-4 place-items-center text-t4">
                <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                  <path d="M3 3.4h8v7.2H3z" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M5 6h4M5 8h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
              <span className="truncate">{plural(issue.comments.length, 'comment')}</span>
            </div>
            <div className="flex h-[26px] items-center gap-2 pl-[7px] pr-2 text-[13.5px] text-t3">
              <span className="grid h-4 w-4 place-items-center text-t4">
                <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                  <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M7 4v3.2l2 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
              <span className="truncate">{t('Updated {date}', { date: shortDate(issue.updatedAt) })}</span>
            </div>
          </div>
        </div>
      )}

      {/* status */}
      <Popover open={open === 'status'} onClose={close} anchorRef={statusRef} width={240}>
        <MenuLabel>{t('Status')}</MenuLabel>
        {STATUSES.map((s) => (
          <MenuItem
            key={s.key}
            icon={<StatusIcon status={s.key} size={14} style={{ color: statusColor(s.key) }} />}
            label={t(s.label)}
            checked={issue.status === s.key}
            onSelect={() => {
              data.setStatus(issue.id, s.key);
              close();
            }}
          />
        ))}
      </Popover>

      {/* priority */}
      <Popover open={open === 'priority'} onClose={close} anchorRef={priorityRef} width={230}>
        <MenuLabel>{t('Priority')}</MenuLabel>
        {PRIORITIES.map((p) => (
          <MenuItem
            key={p.key}
            icon={<PriorityIcon priority={p.key as Priority} size={14} className="text-t3" />}
            label={t(p.label)}
            checked={issue.priority === p.key}
            onSelect={() => {
              data.setPriority(issue.id, p.key);
              close();
            }}
          />
        ))}
      </Popover>

      {/* assignee */}
      <Popover open={open === 'assignee'} onClose={close} anchorRef={assigneeRef} width={250}>
        <MenuLabel>{t('Assignee')}</MenuLabel>
        <MenuItem
          icon={<UserCircle2 size={14} strokeWidth={1.7} />}
          label={t('No assignee')}
          checked={!issue.assigneeId}
          onSelect={() => {
            data.setAssignee(issue.id, null);
            close();
          }}
        />
        <MenuSeparator />
        {users.map((u) => (
          <MenuItem
            key={u.id}
            icon={<Avatar name={u.name} color={u.color} size="xs" />}
            label={u.name}
            hint={u.id === meId ? 'me' : undefined}
            checked={issue.assigneeId === u.id}
            onSelect={() => {
              data.setAssignee(issue.id, u.id);
              close();
            }}
          />
        ))}
      </Popover>

      {/* labels */}
      <Popover open={open === 'labels'} onClose={close} anchorRef={labelsRef} width={250}>
        <div className="px-1 pb-1 pt-1">
          <input
            value={labelQuery}
            onChange={(e) => setLabelQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && labelQuery.trim() && !isImeComposing(e)) {
                const existing = labels.find((l) => l.name.toLowerCase() === labelQuery.trim().toLowerCase());
                const label = existing ?? data.addLabel(labelQuery.trim());
                if (!issue.labelIds.includes(label.id)) data.toggleLabel(issue.id, label.id);
                setLabelQuery('');
              }
            }}
            placeholder={t('Filter or create label…')}
            className="h-[26px] w-full rounded-r6 bg-[var(--bg-hover)] px-2 text-[13.5px] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line)] placeholder:text-t4"
          />
        </div>
        <MenuSeparator />
        {filteredLabels.map((l) => (
          <MenuItem
            key={l.id}
            icon={<span className="h-[7px] w-[7px] rounded-full" style={{ background: l.color }} />}
            label={l.name}
            checked={issue.labelIds.includes(l.id)}
            onSelect={() => data.toggleLabel(issue.id, l.id)}
          />
        ))}
        {filteredLabels.length === 0 && labelQuery.trim() ? (
          <MenuItem
            icon={<Plus size={13} />}
            label={t('Create "{q}"', { q: labelQuery.trim() })}
            onSelect={() => {
              const label = data.addLabel(labelQuery.trim());
              data.toggleLabel(issue.id, label.id);
              setLabelQuery('');
            }}
          />
        ) : null}
      </Popover>

      {/* project */}
      <Popover open={open === 'project'} onClose={close} anchorRef={projectRef} width={260}>
        <MenuLabel>{t('Project')}</MenuLabel>
        <MenuItem
          icon={<Layers size={13} strokeWidth={1.7} />}
          label={t('No project')}
          checked={!issue.projectId}
          onSelect={() => {
            data.setProject(issue.id, null);
            close();
          }}
        />
        <MenuSeparator />
        {projects.map((p) => (
          <MenuItem
            key={p.id}
            icon={
              <span className="grid h-4 w-4 place-items-center rounded-[4px] text-[10px]" style={{ background: `color-mix(in srgb, ${p.color} 20%, transparent)`, color: p.color }}>
                {p.icon}
              </span>
            }
            label={p.name}
            checked={issue.projectId === p.id}
            onSelect={() => {
              data.setProject(issue.id, p.id);
              close();
            }}
          />
        ))}
      </Popover>

      {/* cycle */}
      <Popover open={open === 'cycle'} onClose={close} anchorRef={cycleRef} width={230}>
        <MenuLabel>{t('Cycle')}</MenuLabel>
        <MenuItem
          icon={<CircleDashed size={13} strokeWidth={1.7} />}
          label={t('No cycle')}
          checked={!issue.cycleId}
          onSelect={() => {
            data.setCycle(issue.id, null);
            close();
          }}
        />
        <MenuSeparator />
        {cycles.map((c) => (
          <MenuItem
            key={c.id}
            icon={<CircleDashed size={13} strokeWidth={1.7} />}
            label={c.name}
            hint={c.current ? 'current' : undefined}
            checked={issue.cycleId === c.id}
            onSelect={() => {
              data.setCycle(issue.id, c.id);
              close();
            }}
          />
        ))}
      </Popover>

      {/* due date */}
      <Popover open={open === 'due'} onClose={close} anchorRef={dueRef} width={200}>
        <MenuLabel>{t('Due date')}</MenuLabel>
        {dueOptions.map((o) => (
          <MenuItem
            key={o.label}
            label={t(o.label)}
            onSelect={() => {
              const d = new Date();
              d.setDate(d.getDate() + (o.days ?? 0));
              data.patchIssue(issue.id, { dueDate: d.toISOString() });
              close();
            }}
          />
        ))}
        <MenuSeparator />
        <MenuItem
          label={t('Clear due date')}
          onSelect={() => {
            data.patchIssue(issue.id, { dueDate: null });
            close();
          }}
        />
      </Popover>

      {/* estimate */}
      <Popover open={open === 'estimate'} onClose={close} anchorRef={estimateRef} width={200}>
        <MenuLabel>{t('Estimate')}</MenuLabel>
        {[1, 2, 3, 5, 8].map((n) => (
          <MenuItem
            key={n}
            label={plural(n, 'point')}
            checked={issue.estimate === n}
            onSelect={() => {
              data.setEstimate(issue.id, n);
              close();
            }}
          />
        ))}
        <MenuSeparator />
        <MenuItem
          label={t('No estimate')}
          checked={issue.estimate == null}
          onSelect={() => {
            data.setEstimate(issue.id, null);
            close();
          }}
        />
      </Popover>
    </div>
  );
}

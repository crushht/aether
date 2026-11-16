'use client';

import * as React from 'react';
import { Activity } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useT } from '@/lib/use-t';
import { getLocale, localeTag, translate } from '@/lib/i18n';
import { resolvePerson } from '@/lib/people';
import { Avatar } from '@/components/ui/primitives';
import { StatusIcon } from '@/components/ui/icons';
import { relativeTime } from '@/lib/utils';

interface Row {
  id: string;
  actorId: string;
  createdAt: string;
  issueKey: string;
  issueId: string;
  issueTitle: string;
  status: string;
  kind: string;
  from?: string;
  to?: string;
}

const VERB: Record<string, string> = {
  created: 'created',
  status: 'moved',
  assignee: 'assigned',
  priority: 'prioritised',
  label: 'labelled',
  project: 'moved to project',
  cycle: 'added to cycle',
  comment: 'commented on',
  estimate: 'estimated',
  agent: 'ran an agent session',
};

function statusColor(status: string) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

function pretty(value?: string) {
  if (!value) return '';
  const status: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
    canceled: 'Canceled',
    duplicate: 'Duplicate',
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    none: 'No priority',
  };
  return status[value] ?? resolvePerson(value)?.name ?? value;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff <= 0) return translate(getLocale(), 'Today');
  if (diff === 1) return translate(getLocale(), 'Yesterday');
  if (diff < 7) return d.toLocaleDateString(localeTag(getLocale()), { weekday: 'long' });
  return d.toLocaleDateString(localeTag(getLocale()), { month: 'short', day: 'numeric' });
}

export default function PulsePage() {
  const issues = useData((s) => s.issues);
  const openIssue = useView((s) => s.openIssue);
  const t = useT();

  const rows: Row[] = React.useMemo(() => {
    const out: Row[] = [];
    for (const issue of issues) {
      for (const a of issue.activities) {
        out.push({
          id: a.id,
          actorId: a.actorId,
          createdAt: a.createdAt,
          issueKey: issue.key,
          issueId: issue.id,
          issueTitle: issue.title,
          status: issue.status,
          kind: a.kind,
          from: a.from,
          to: a.to,
        });
      }
    }
    return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 60);
  }, [issues]);

  const groups = React.useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const key = dayLabel(r.createdAt);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-4 flex items-center gap-2">
        <Activity size={15} strokeWidth={1.8} className="text-t4" />
        <h1 className="text-[15px] font-[590] text-t1">{t('Pulse')}</h1>
        <span className="text-[13px] text-t4">{t('everything happening across the team')}</span>
      </div>

      <div className="flex flex-col gap-5">
        {groups.length === 0 ? (
          <div className="flex h-[140px] flex-col items-center justify-center gap-2 rounded-r8 border border-dashed border-[var(--line)] text-center">
            <p className="text-[14px] text-t2">{t('Nothing has happened yet')}</p>
            <p className="max-w-[320px] text-[13px] leading-[1.6] text-t4">
              {t('Create or change an issue and the activity shows up here.')}
            </p>
          </div>
        ) : null}
        {groups.map(([day, items]) => (
          <section key={day}>
            <div className="sticky top-0 z-[5] mb-1 flex h-[26px] items-center bg-panel/95 backdrop-blur-[2px]">
              <span className="text-[12px] font-[510] uppercase tracking-[.06em] text-t4">{day}</span>
              <span className="tnum ml-2 text-[12px] text-t4 opacity-60">{items.length}</span>
            </div>
            <div className="flex flex-col">
              {items.map((row) => {
                const actor = resolvePerson(row.actorId);
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => openIssue(row.issueId)}
                    className="group flex items-start gap-2.5 rounded-r6 px-1.5 py-[7px] text-left transition-colors duration-100 hover:bg-[var(--bg-hover)]"
                  >
                    <Avatar name={actor?.name ?? 'Unknown'} color={actor?.color ?? '#5E6AD2'} size="sm" className="mt-[2px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13.5px]">
                        <span className="font-[510] text-t2">{actor?.name}</span>
                        <span className="text-t4">{t(VERB[row.kind] ?? row.kind)}</span>
                        <span className="flex items-center gap-1 text-t4">
                          <StatusIcon status={row.status as never} size={11} style={{ color: statusColor(row.status) }} />
                          <span className="tnum">{row.issueKey}</span>
                        </span>
                        {row.kind === 'status' && row.to ? (
                          <span className="flex items-center gap-1 text-[12.5px] text-t4">
                            {row.from ? <span className="rounded-[3px] bg-[var(--bg-active)] px-1">{t(pretty(row.from))}</span> : null}
                            {row.from && row.to ? <span>{'\u2192'}</span> : null}
                            {row.to ? <span className="rounded-[3px] bg-[var(--bg-active)] px-1 text-t3">{t(pretty(row.to))}</span> : null}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-[13.5px] text-t3 group-hover:text-t2">{row.issueTitle}</div>
                    </div>
                    <span className="shrink-0 pt-[2px] text-[12px] text-t4">{relativeTime(row.createdAt)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import { resolvePerson } from '@/lib/people';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { burnUp, cycleIssues, cyclePhase, cycleStats } from '@/lib/cycles';
import { STATUSES, type Cycle } from '@/lib/types';
import { cn, dateRange, shortDate } from '@/lib/utils';
import { Avatar, Button } from '@/components/ui/primitives';
import { StatusIcon } from '@/components/ui/icons';
import { Plus } from 'lucide-react';

const PHASE_LABEL: Record<string, string> = {
  current: 'Current cycle',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

function statusColor(status: string) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

export default function CyclesPage() {
  const issues = useData((s) => s.issues);
  const cycles = useData((s) => s.cycles);
  const createCycle = useData((s) => s.createCycle);
  const rolloverCycle = useData((s) => s.rolloverCycle);
  const openIssue = useView((s) => s.openIssue);
  const pushToast = useUI((s) => s.pushToast);
  const t = useT();

  const [now] = React.useState(() => Date.now());
  const cycleById = React.useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle])), [cycles]);

  const ordered = React.useMemo(() => {
    const weight = { current: 0, upcoming: 1, completed: 2 } as const;
    return [...cycles].sort((a, b) => {
      const wa = weight[cyclePhase(a, now)];
      const wb = weight[cyclePhase(b, now)];
      if (wa !== wb) return wa - wb;
      return wa === 2 ? b.number - a.number : a.number - b.number;
    });
  }, [cycles, now]);

  const [activeId, setActiveId] = React.useState('');
  const [composing, setComposing] = React.useState(false);
  const [name, setName] = React.useState('');

  // `?cycle=c1` deep link, read after mount so the route stays static
  React.useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('cycle');
    if (requested && cycleById.has(requested)) {
      setActiveId(requested);
      return;
    }
    if (!activeId && cycles.length) {
      const running = cycles.find(
        (cycle) => +new Date(cycle.startsAt) <= now && now <= +new Date(cycle.endsAt),
      );
      const latest = [...cycles].sort((a, b) => +new Date(b.startsAt) - +new Date(a.startsAt))[0];
      setActiveId((running ?? latest).id);
    }
  }, [cycleById, cycles, activeId, now]);

  const select = (id: string) => {
    setActiveId(id);
    window.history.replaceState(null, '', `/cycles?cycle=${id}`);
  };

  const create = () => {
    const cycle = createCycle({ name });
    setName('');
    setComposing(false);
    select(cycle.id);
  };
  const cycle = cycleById.get(activeId) ?? null;
  const stats = cycle ? cycleStats(issues, cycle) : null;
  const scope = React.useMemo(() => {
    if (!cycle) return [];
    const rank = (key: string) => STATUSES.findIndex((s) => s.key === key);
    return cycleIssues(issues, cycle.id).sort((a, b) => rank(a.status) - rank(b.status));
  }, [issues, cycle]);

  if (!cycle || !stats) {
    return (
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-3 sm:px-6 lg:px-10">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-[17px] font-[590] text-t1">{t('Cycles')}</h1>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setComposing(true)}>
            <Plus size={13} strokeWidth={2} />
            {t('New cycle')}
          </Button>
        </div>
        {composing ? (
          <div className="mt-3 flex items-center gap-2 rounded-r8 bg-[var(--bg-hover)] p-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create();
                if (event.key === 'Escape') setComposing(false);
              }}
              placeholder={t('Cycle name (optional)')}
              className="h-[30px] min-w-0 flex-1 rounded-r6 bg-[var(--bg-panel)] px-2.5 text-[14px] text-t1 outline-none placeholder:text-t4"
            />
            <Button variant="primary" size="sm" onClick={create}>
              {t('Create cycle')}
            </Button>
          </div>
        ) : null}
        <div className="mt-4 flex h-[180px] flex-col items-center justify-center gap-2 rounded-r8 border border-dashed border-[var(--line)] text-center">
          <p className="text-[14px] text-t2">{t('No cycles yet')}</p>
          <p className="max-w-[340px] text-[13px] leading-[1.6] text-t4">
            {t('A cycle is a two-week window of work. Create one, then put issues into it from their detail panel.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-3 sm:px-6 lg:px-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-[590] text-t1">{t('Cycles')}</h1>
          <p className="mt-0.5 text-[13.5px] text-t4">
            {t('Two-week windows of work, newest first.')}
          </p>
        </div>
        <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setComposing((value) => !value)}>
          <Plus size={13} strokeWidth={2} />
          {t('New cycle')}
        </Button>
      </div>

      {composing ? (
        <div className="mt-3 flex items-center gap-2 rounded-r8 bg-[var(--bg-hover)] p-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
              if (event.key === 'Escape') setComposing(false);
            }}
            placeholder={t('Cycle name (optional)')}
            className="h-[30px] min-w-0 flex-1 rounded-r6 bg-[var(--bg-panel)] px-2.5 text-[14px] text-t1 outline-none placeholder:text-t4"
          />
          <Button variant="primary" size="sm" onClick={create}>
            {t('Create cycle')}
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-1">
          {ordered.map((item) => {
            const phase = cyclePhase(item, now);
            const itemStats = cycleStats(issues, item);
            return (
              <button
                key={item.id}
                type="button"
                data-cycle={item.id}
                onClick={() => select(item.id)}
                className={cn(
                  'w-full rounded-r8 px-2.5 py-2 text-left transition-colors duration-100',
                  item.id === cycle.id ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-[510] text-t1">{item.name}</span>
                  <span className="shrink-0 text-[12px] text-t4">{t(PHASE_LABEL[phase])}</span>
                </div>
                <div className="tnum mt-0.5 text-[12.5px] text-t4">{dateRange(item.startsAt, item.endsAt)}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--bg-active)]">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${itemStats.percent}%` }} />
                  </span>
                  <span className="tnum shrink-0 text-[12px] text-t4">
                    {itemStats.done}/{itemStats.total}
                  </span>
                </div>
              </button>
            );
          })}
        </aside>

        <section className="min-w-0">
          <CycleDetail
            cycle={cycle}
            stats={stats}
            scope={scope}
            issues={issues}
            now={now}
            onOpen={openIssue}
            onCarryOver={() => {
              const open = issues.filter(
                (issue) => issue.cycleId === cycle.id && !['done', 'canceled', 'duplicate'].includes(issue.status),
              ).length;
              const next = rolloverCycle(cycle.id);
              if (!next) return;
              select(next.id);
              pushToast({ title: t('{n} issue(s) carried into {cycle}', { n: open, cycle: next.name }) });
            }}
          />
        </section>
      </div>
    </div>
  );
}

function CycleDetail({
  cycle,
  stats,
  scope,
  issues,
  now,
  onOpen,
  onCarryOver,
}: {
  cycle: Cycle;
  stats: ReturnType<typeof cycleStats>;
  scope: ReturnType<typeof cycleIssues>;
  issues: ReturnType<typeof useData.getState>['issues'];
  now: number;
  onOpen: (id: string) => void;
  onCarryOver: () => void;
}) {
  const t = useT();
  const phase = cyclePhase(cycle, now);
  const series = React.useMemo(() => burnUp(issues, cycle, now), [issues, cycle, now]);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-[590] text-t1">{cycle.name}</h2>
        <span className="rounded-full bg-[var(--bg-hover)] px-2 py-[1px] text-[12px] text-t3">
          {t(PHASE_LABEL[phase])}
        </span>
        <span className="tnum text-[13px] text-t4">{dateRange(cycle.startsAt, cycle.endsAt)}</span>
        <div className="flex-1" />
        {phase !== 'upcoming' ? (
          <Button variant="ghost" size="sm" onClick={onCarryOver}>
            {t('Carry over open issues')}
          </Button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          [t('Scope'), stats.total],
          [t('Completed'), stats.done],
          [t('Remaining'), stats.open],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-r8 bg-[var(--bg-hover)] px-3 py-2">
            <div className="text-[12px] text-t4">{label}</div>
            <div className="tnum mt-0.5 text-[16px] font-[590] text-t1">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-r8 bg-[var(--bg-hover)] p-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-[510] text-t2">{t('Burn-up')}</span>
          <span className="tnum text-[12.5px] text-t4">
            {t('{done} of {total} completed', { done: stats.done, total: stats.total })}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-t4">
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-[var(--text-4)]" />
            {t('Scope')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded-full bg-accent" />
            {t('Completed')}
          </span>
        </div>
        <BurnUpChart cycle={cycle} series={series} now={now} />
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-[510] text-t2">{t('Issues in this cycle')}</span>
          <span className="tnum text-[12.5px] text-t4">{scope.length}</span>
        </div>

        {scope.length ? (
          <div className="mt-1.5 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
            {scope.map((issue, index) => {
              const assignee = resolvePerson(issue.assigneeId) ?? undefined;
              return (
                <button
                  key={issue.id}
                  type="button"
                  data-cycle-issue={issue.id}
                  onClick={() => onOpen(issue.id)}
                  className={cn(
                    'flex h-[40px] w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]',
                    index > 0 && 'border-t border-[var(--line-subtle)]',
                  )}
                >
                  <StatusIcon status={issue.status} size={14} style={{ color: statusColor(issue.status) }} />
                  <span className="tnum w-[58px] shrink-0 text-[13px] text-t4">{issue.key}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-t2">{issue.title}</span>
                  {assignee ? <Avatar name={assignee.name} color={assignee.color} size="xs" /> : null}
                  <span className="tnum hidden w-[68px] shrink-0 whitespace-nowrap text-right text-[13px] text-t4 sm:block">
                    {shortDate(issue.updatedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-1.5 flex h-[62px] items-center justify-center rounded-r8 border border-dashed border-[var(--line)] text-[13px] text-t4">
            {t('No issues in this cycle')}
          </div>
        )}
      </div>
    </div>
  );
}

function BurnUpChart({
  cycle,
  series,
  now,
}: {
  cycle: Cycle;
  series: { at: number; scope: number; done: number }[];
  now: number;
}) {
  const id = React.useId().replace(/:/g, '');
  const W = 720;
  const H = 176;
  const TOP = 12;
  const BOTTOM = 24;
  const start = +new Date(cycle.startsAt);
  const end = +new Date(cycle.endsAt);
  const max = Math.max(1, ...series.map((point) => point.scope));
  const x = (at: number) => ((at - start) / Math.max(1, end - start)) * W;
  const y = (value: number) => TOP + (1 - value / max) * (H - TOP - BOTTOM);
  const line = (key: 'scope' | 'done') =>
    series.map((point, i) => `${i ? 'L' : 'M'}${x(point.at).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  const area = last
    ? `${line('done')} L${x(last.at).toFixed(1)},${y(0).toFixed(1)} L${x(series[0].at).toFixed(1)},${y(0).toFixed(1)} Z`
    : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${cycle.name} burn-up`}>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {[0, 0.5, 1].map((fraction) => (
        <line
          key={fraction}
          x1={0}
          x2={W}
          y1={y(max * fraction)}
          y2={y(max * fraction)}
          stroke="var(--line-subtle)"
          strokeWidth={1}
        />
      ))}

      {area ? <path d={area} fill={`url(#fill-${id})`} /> : null}
      <path d={line('scope')} fill="none" stroke="var(--text-4)" strokeWidth={1.4} strokeDasharray="3 3" />
      <path d={line('done')} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" />

      {now > start && now < end ? (
        <line
          x1={x(now)}
          x2={x(now)}
          y1={TOP}
          y2={H - BOTTOM}
          stroke="var(--line-strong)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      ) : null}

      <text x={0} y={H - 8} fontSize={10} fill="var(--text-4)">
        {shortDate(new Date(start).toISOString())}
      </text>
      <text x={W / 2} y={H - 8} fontSize={10} fill="var(--text-4)" textAnchor="middle">
        {shortDate(new Date(start + (end - start) / 2).toISOString())}
      </text>
      <text x={W} y={H - 8} fontSize={10} fill="var(--text-4)" textAnchor="end">
        {shortDate(new Date(end).toISOString())}
      </text>
      <text x={0} y={TOP - 2} fontSize={10} fill="var(--text-4)">
        {max}
      </text>
    </svg>
  );
}

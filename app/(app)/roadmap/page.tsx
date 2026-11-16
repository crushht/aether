'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { NOW } from '@/lib/mock-data';
import { useData } from '@/lib/store/data';
import { projectProgress } from '@/lib/selectors';
import { useT } from '@/lib/use-t';
import { getLocale, localeTag } from '@/lib/i18n';
import { cn, dateRange, plural } from '@/lib/utils';

const DAY = 86_400_000;
const TOTAL_DAYS = 112; // 16 weeks
const LOOKBACK_DAYS = 21;

const start = new Date(NOW - LOOKBACK_DAYS * DAY);
const end = new Date(NOW + (TOTAL_DAYS - LOOKBACK_DAYS) * DAY);

const pct = (d: Date) => ((d.getTime() - start.getTime()) / (TOTAL_DAYS * DAY)) * 100;

const months: { at: Date; left: number; width: number }[] = (() => {
  const out: { at: Date; left: number; width: number }[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < end) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const from = cursor < start ? start : cursor;
    const to = next > end ? end : next;
    out.push({
      at: new Date(cursor),
      left: pct(from),
      width: pct(to) - pct(from),
    });
    cursor = next;
  }
  return out;
})();

const weekLines = (() => {
  const out: number[] = [];
  for (let d = 0; d <= TOTAL_DAYS; d += 7) out.push((d / TOTAL_DAYS) * 100);
  return out;
})();

const todayPct = pct(new Date(NOW));

type Row =
  | { kind: 'section'; id: string; label: string; hint?: string }
  | {
      kind: 'bar';
      id: string;
      name: string;
      color: string;
      from: Date;
      to: Date;
      progress?: number;
      href?: string;
      meta?: string;
      glyph?: string;
    };

export default function RoadmapPage() {
  const t = useT();
  const router = useRouter();
  const issues = useData((s) => s.issues);
  const projects = useData((s) => s.projects);
  const cycles = useData((s) => s.cycles);

  const rows: Row[] = [
    { kind: 'section', id: 'cycles', label: 'Cycles', hint: `${cycles.length}` },
    ...cycles.map<Row>((c) => ({
      kind: 'bar',
      id: c.id,
      name: c.name,
      color: c.current ? '#5E6AD2' : '#4a4d55',
      from: new Date(c.startsAt),
      to: new Date(c.endsAt),
      progress: c.progress,
      meta: dateRange(c.startsAt, c.endsAt),
      glyph: c.current ? '\u25C6' : undefined,
    })),
    { kind: 'section', id: 'projects', label: 'Projects', hint: `${projects.length}` },
    ...[...projects]
      .sort((a, b) => +new Date(a.targetDate) - +new Date(b.targetDate))
      .map<Row>((p) => {
        const to = new Date(p.targetDate);
        const from = new Date(to.getTime() - 28 * DAY);
        const open = issues.filter((i) => i.projectId === p.id && i.status !== 'done' && i.status !== 'canceled').length;
        return {
          kind: 'bar',
          id: p.id,
          name: p.name,
          color: p.color,
          from,
          to,
          progress: Math.round(projectProgress(issues, p.id).ratio * 100),
          href: `/projects/${p.id}`,
          meta: plural(open, 'open issue'),
          glyph: p.icon,
        };
      }),
  ];

  return (
    <div className="mx-auto max-w-[1220px] px-3 py-4 sm:px-6 sm:py-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-y-2">
        <div>
          <h1 className="text-[15px] font-[590] text-t1">{t('Roadmap')}</h1>
          <p className="mt-0.5 text-[13.5px] text-t4">{t('Cycles and projects across the next 16 weeks.')}</p>
          {rows.filter((row) => row.kind === 'bar').length === 0 ? (
            <p className="mt-2 inline-flex items-center rounded-full bg-[var(--bg-hover)] px-2 py-1 text-[12.5px] text-t4">
              {t('Nothing scheduled yet — create a project to put it on the timeline.')}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-[12.5px] text-t4">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-[14px] rounded-full bg-accent" />
            {t('Today')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[8px] w-[8px] rounded-[2px] bg-[var(--bg-selected)] shadow-[inset_0_0_0_1px_var(--line-strong)]" />
            {t('Cycle')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[8px] w-[8px] rounded-[2px] bg-[rgba(94,106,210,.3)] shadow-[inset_0_0_0_1px_rgba(94,106,210,.5)]" />
            {t('Project')}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <div className="min-w-[680px]">
        {/* month header */}
        <div className="flex h-[30px] items-center border-b border-[var(--line-subtle)] bg-[var(--bg-hover)]">
          <div className="w-[156px] shrink-0 px-3 text-[12px] uppercase tracking-[.06em] text-t4 sm:w-[248px] sm:px-4">{t('Timeline')}</div>
          <div className="relative h-full flex-1">
            {months.map((m) => (
              <span
                key={m.left}
                className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] text-t4"
                style={{ left: `${m.left}%`, width: `${m.width}%` }}
              >
                {m.left >= 0 ? m.at.toLocaleDateString(localeTag(getLocale()), { month: 'short' }) : ''}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          {/* week grid + today */}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-[156px] sm:left-[248px]">
            {weekLines.map((left) => (
              <div
                key={left}
                className="absolute inset-y-0 w-px bg-[var(--bg-active)]"
                style={{ left: `${left}%` }}
              />
            ))}
            <div className="absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--accent)_70%,transparent)]" style={{ left: `${todayPct}%` }}>
              <span className="absolute -top-0 left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-accent" />
            </div>
          </div>

          {rows.map((row) =>
            row.kind === 'section' ? (
              <div key={row.id} className="relative flex h-[30px] items-center border-t border-[var(--line-subtle)] bg-[var(--bg-hover)]">
                <div className="flex w-[156px] shrink-0 items-center gap-1.5 px-3 sm:w-[248px] sm:px-4">
                  <span className="text-[12px] font-[510] uppercase tracking-[.06em] text-t4">{t(row.label)}</span>
                  {row.hint ? <span className="tnum text-[12px] text-t4 opacity-70">{row.hint}</span> : null}
                </div>
              </div>
            ) : (
              <div
                key={row.id}
                className="group relative flex h-[42px] cursor-pointer items-center border-t border-[var(--line-subtle)] transition-colors duration-100 hover:bg-[var(--bg-hover)]"
                onClick={() => row.href && router.push(row.href)}
              >
                <div className="flex w-[156px] shrink-0 items-center gap-2 px-3 sm:w-[248px] sm:px-4">
                  <span
                    className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[4px] text-[9px]"
                    style={{
                      background: `color-mix(in srgb, ${row.color} 18%, transparent)`,
                      color: row.color,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${row.color} 34%, transparent)`,
                    }}
                  >
                    {row.glyph ?? '\u25C6'}
                  </span>
                  <span className="truncate text-[13.5px] font-[510] text-t2 group-hover:text-t1">{row.name}</span>
                  <span className="tnum ml-auto hidden shrink-0 text-[12px] text-t4 sm:inline">{row.progress ?? 0}%</span>
                  <ChevronRight size={12} className="shrink-0 text-t4 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>

                <div className="relative h-full flex-1">
                  <div
                    className="absolute top-1/2 h-[22px] -translate-y-1/2 overflow-hidden rounded-r6 transition-shadow duration-160"
                    style={{
                      left: `${Math.max(0, pct(row.from))}%`,
                      width: `${Math.min(100, pct(row.to)) - Math.max(0, pct(row.from))}%`,
                      background: `color-mix(in srgb, ${row.color} 14%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${row.color} 38%, transparent)`,
                    }}
                  >
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${row.progress ?? 0}%`,
                        background: `color-mix(in srgb, ${row.color} 30%, transparent)`,
                      }}
                    />
                    <span className="relative flex h-full items-center gap-1.5 truncate px-2 text-[12px] text-t3">
                      {row.meta}
                    </span>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[12.5px] text-t4">
        <span>
          {start.toLocaleDateString(localeTag(getLocale()), { month: 'short', day: 'numeric' })} {'\u2014'}{' '}
          {end.toLocaleDateString(localeTag(getLocale()), { month: 'short', day: 'numeric' })}
        </span>
        <span className="flex items-center gap-2">
          <Link href="/projects" className={cn('transition-colors hover:text-t2')}>
            {t('All projects')}
          </Link>
          <ChevronRight size={12} />
        </span>
      </div>
    </div>
  );
}

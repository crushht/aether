'use client';

import * as React from 'react';
import { useAgent } from '@/lib/agent/store';
import { startOfLocalDay, summarizeUsage, usageByModel, usageSinceDays } from '@/lib/agent/usage-summary';
import { useT } from '@/lib/use-t';

const nf = new Intl.NumberFormat();

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[.05em] text-t4">{label}</div>
      <div className="tnum mt-0.5 text-[15px] font-[590] text-t1">{value}</div>
      {hint ? <div className="truncate text-[11px] text-t4">{hint}</div> : null}
    </div>
  );
}

/**
 * Token usage of the agent, rolled up from the per-chat run records. Everything
 * stays local: no counters leave this browser.
 */
export function UsageSummaryCard() {
  const t = useT();
  const sessions = useAgent((s) => s.sessions);

  const runs = React.useMemo(
    () => Object.values(sessions).flatMap((session) => session.runs ?? []),
    [sessions],
  );

  const [range, setRange] = React.useState<'today' | 'week'>('today');
  const since = range === 'today' ? startOfLocalDay() : usageSinceDays(7);
  const summary = React.useMemo(() => summarizeUsage(runs, since), [runs, since]);
  const models = React.useMemo(() => usageByModel(runs, since), [runs, since]);

  return (
    <section data-usage-summary className="mt-7 rounded-r10 bg-[var(--bg-elevated)] p-3.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-[590] text-t1">{t('Agent usage')}</h2>
        <div className="flex items-center gap-0.5 rounded-full bg-[var(--bg-hover)] p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
          {(
            [
              { key: 'today' as const, label: t('Today') },
              { key: 'week' as const, label: t('7 days') },
            ]
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              data-usage-range={option.key}
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
              className={
                range === option.key
                  ? 'h-[22px] rounded-full bg-[var(--bg-selected)] px-2 text-[11.5px] text-t1'
                  : 'h-[22px] rounded-full px-2 text-[11.5px] text-t4 hover:text-t2'
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <span className="text-[11px] text-t4">{t('Local to this browser')}</span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('Tokens')} value={nf.format(summary.totalTokens)} hint={`${nf.format(summary.promptTokens)} → ${nf.format(summary.completionTokens)}`} />
        <Stat label={t('Runs')} value={nf.format(summary.runs)} hint={summary.failed ? `${summary.failed} ${t('failed')}` : undefined} />
        <Stat label={t('Steps')} value={nf.format(summary.steps)} />
        <Stat label={t('Tool calls')} value={nf.format(summary.tools)} />
      </div>

      {models.length ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-usage-models>
          {models.map((model) => (
            <span
              key={model.model}
              className="flex items-center gap-1.5 rounded-full bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[11px] text-t3"
            >
              {model.model}
              <span className="text-t4">
                {model.runs} · {nf.format(model.tokens)}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-t4">{t('No agent runs in this window yet.')}</p>
      )}
    </section>
  );
}

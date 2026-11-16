'use client';

import * as React from 'react';
import { Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn, relativeTime } from '@/lib/utils';
import { describeUserAgent } from '@/lib/ua';
import { downloadTextFile } from '@/lib/download';
import {
  securityAuditFileName,
  securityAuditMarkdown,
  type SecurityAuditEvent,
  type SecurityAuditSummary,
  type SecurityEventFilter,
  type SecurityEventKind,
} from '@/lib/security-audit';
import type { AuditRange } from '@/lib/audit-range';

interface AuditPayload {
  ok?: boolean;
  canSeeAll?: boolean;
  scope?: 'all' | 'self';
  stored?: number;
  total?: number;
  matched?: number;
  events?: SecurityAuditEvent[];
  summary?: SecurityAuditSummary;
  error?: string;
}

const FILTERS: { key: SecurityEventFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sign_in', label: 'Sign-ins' },
  { key: 'password', label: 'Passwords' },
  { key: 'code', label: 'Codes' },
  { key: 'account', label: 'Accounts' },
];

const RANGES: { key: AuditRange; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

const PAGE = 50;

/**
 * The security trail: who got in, from where, and what was refused.
 *
 * The events are written by the server on the request that performed the action
 * — this panel is a read-only window on them. A member only ever sees their own
 * rows; an owner sees the workspace.
 */
export function SecurityPanel() {
  const t = useT();
  const pushToast = useUI((s) => s.pushToast);
  const [payload, setPayload] = React.useState<AuditPayload | null>(null);
  const [group, setGroup] = React.useState<SecurityEventFilter>('all');
  const [range, setRange] = React.useState<AuditRange>('all');
  const [failuresOnly, setFailuresOnly] = React.useState(false);
  const [limit, setLimit] = React.useState(PAGE);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ group, range, limit: String(limit) });
      if (failuresOnly) query.set('failures', '1');
      const response = await fetch(`/api/security/audit?${query.toString()}`, { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as AuditPayload;
      if (!response.ok || !json.ok) {
        setError(json.error ?? t('Could not load the security audit.'));
        return;
      }
      setPayload(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [failuresOnly, group, limit, range, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const kindLabel = (kind: SecurityEventKind) => {
    switch (kind) {
      case 'sign_in':
        return t('Sign-in');
      case 'sign_out':
        return t('Sign-out');
      case 'code':
        return t('Email code');
      case 'password_change':
        return t('Password change');
      case 'password_reset':
        return t('Password reset');
      case 'register':
        return t('Registration');
      case 'session_revoke':
        return t('Session revoke');
      default:
        return kind;
    }
  };

  const events = payload?.events ?? [];
  const summary = payload?.summary;
  const canSeeAll = Boolean(payload?.canSeeAll);

  const exportMarkdown = () => {
    const filterLabel = [
      FILTERS.find((row) => row.key === group)?.label ?? 'All',
      RANGES.find((row) => row.key === range)?.label ?? 'All time',
      ...(failuresOnly ? ['refused only'] : []),
    ].join(' · ');
    const markdown = securityAuditMarkdown(events, {
      scope: canSeeAll ? 'all' : 'self',
      filter: filterLabel,
      now: new Date(),
    });
    downloadTextFile(securityAuditFileName(), markdown, 'text/markdown;charset=utf-8');
    pushToast({ title: t('Security audit exported'), tone: 'success' });
  };

  return (
    <div data-security-audit>
      <h1 className="text-title2 font-[590] text-t1">{t('Security')}</h1>
      <p className="mt-1 max-w-[600px] text-[14px] leading-[1.6] text-t4">
        {t(
          'Every sign-in, mailed code, password change and session revocation, newest first. Addresses are stored masked; codes and passwords never are.',
        )}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-r8 px-4 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <span className="flex items-center gap-1.5 text-[12.5px] text-t3">
          <ShieldCheck size={13} strokeWidth={1.9} className="text-t4" />
          <span data-audit-total className="tnum text-t2">
            {summary?.total ?? 0}
          </span>
          {t('Events')}
        </span>
        <span className="text-[12.5px] text-t4">·</span>
        <span className="text-[12.5px] text-t4">
          {t('Today')} <span data-audit-today className="tnum text-t2">{summary?.today ?? 0}</span>
        </span>
        <span className="text-[12.5px] text-t4">·</span>
        <span className="text-[12.5px] text-t4">
          {t('Refused')} <span data-audit-failures className="tnum text-t2">{summary?.failures ?? 0}</span>
        </span>
        {summary?.lastAt ? (
          <>
            <span className="text-[12.5px] text-t4">·</span>
            <span data-audit-last className="text-[12.5px] text-t4">
              {t('Last event {when}', { when: relativeTime(summary.lastAt) })}
            </span>
          </>
        ) : null}
        <span className="flex-1" />
        {loading ? <Loader2 size={13} className="animate-spin text-t4" /> : null}
        <Button data-audit-refresh variant="ghost" size="sm" className="gap-1.5" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={12} strokeWidth={2} />
          {t('Refresh')}
        </Button>
        <Button
          data-audit-export
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={!events.length}
          onClick={exportMarkdown}
        >
          <Download size={12} strokeWidth={2} />
          {t('Export Markdown')}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((row) => (
          <button
            key={row.key}
            type="button"
            data-audit-group={row.key}
            aria-pressed={group === row.key}
            onClick={() => {
              setGroup(row.key);
              setLimit(PAGE);
            }}
            className={cn(
              'h-[26px] rounded-full px-2.5 text-[12.5px] transition-colors duration-100',
              group === row.key ? 'bg-[var(--bg-selected)] text-t1' : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
            )}
          >
            {t(row.label)}
            <span className="tnum ml-1 text-[11px] text-t4">{summary?.byGroup?.[row.key] ?? 0}</span>
          </button>
        ))}
        <span className="mx-1 h-[14px] w-px bg-[var(--line-subtle)]" />
        <select
          data-audit-range
          value={range}
          onChange={(event) => {
            setRange(event.target.value as AuditRange);
            setLimit(PAGE);
          }}
          className="h-[26px] rounded-r6 bg-[var(--bg-hover)] px-1.5 text-[12.5px] text-t2 outline-none"
        >
          {RANGES.map((row) => (
            <option key={row.key} value={row.key}>
              {t(row.label)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-audit-failures-toggle
          aria-pressed={failuresOnly}
          onClick={() => {
            setFailuresOnly((current) => !current);
            setLimit(PAGE);
          }}
          className={cn(
            'h-[26px] rounded-full px-2.5 text-[12.5px] transition-colors duration-100',
            failuresOnly ? 'bg-[rgba(240,128,128,.16)] text-[#f08080]' : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
          )}
        >
          {t('Refused only')}
        </button>
      </div>

      {!canSeeAll && payload ? (
        <p data-audit-scope className="mt-2 text-[12.5px] text-t4">
          {t('You see the events recorded for your account.')}
        </p>
      ) : null}
      {error ? (
        <p data-audit-error className="mt-2 text-[12.5px] text-[#f08080]">
          {error}
        </p>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {events.length === 0 ? (
          <p data-audit-empty className="px-4 py-3 text-[13px] text-t4">
            {loading ? t('Loading…') : t('No events match this filter.')}
          </p>
        ) : (
          <ul>
            {events.map((event) => (
              <li
                key={event.id}
                data-audit-row
                data-audit-kind={event.kind}
                data-audit-ok={event.ok ? '1' : '0'}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-[var(--line-subtle)] px-4 py-2 last:border-0"
              >
                <span className="w-[132px] shrink-0 text-[13px] font-[510] text-t2">{kindLabel(event.kind)}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-[10.5px] leading-[16px]',
                    event.ok ? 'bg-[var(--bg-selected)] text-t3' : 'bg-[rgba(240,128,128,.16)] text-[#f08080]',
                  )}
                >
                  {event.ok ? t('Ok') : t('Refused')}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-t3">
                  {event.actorName || event.actorEmail || '—'}
                  {event.actorName && event.actorEmail ? (
                    <span className="ml-1.5 font-mono text-[11px] text-t4">{event.actorEmail}</span>
                  ) : null}
                </span>
                {event.ip ? <span className="shrink-0 font-mono text-[11px] text-t4">{event.ip}</span> : null}
                <span className="shrink-0 text-[11.5px] text-t4">{describeUserAgent(event.ua)}</span>
                <span className="w-[92px] shrink-0 text-right text-[11.5px] text-t4">{relativeTime(event.at)}</span>
                {event.detail ? (
                  <span data-audit-detail className="w-full truncate text-[11.5px] text-t4">
                    {event.detail}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {payload && (payload.total ?? 0) > events.length && events.length > 0 ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            data-audit-more
            variant="ghost"
            size="sm"
            disabled={loading || limit >= 500}
            onClick={() => setLimit((current) => Math.min(500, current + PAGE))}
          >
            {t('Show more')}
          </Button>
          <span className="text-[12px] text-t4">
            {events.length} / {payload.total}
          </span>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import * as React from 'react';
import { Bell, Monitor } from 'lucide-react';
import { useNotificationPrefs, type NotificationChannel, type NotificationKind } from '@/lib/store/notification-prefs';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';

const KINDS: { key: NotificationKind; label: string }[] = [
  { key: 'mention', label: 'Mentions' },
  { key: 'agent', label: 'Agent updates' },
  { key: 'cycle', label: 'Cycle notices' },
  { key: 'project_update', label: 'Project updates' },
  { key: 'digest', label: 'Daily digest' },
];

function Toggle({
  checked,
  onChange,
  label,
  channel,
  kind,
  dataAttr,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  channel: NotificationChannel;
  kind: NotificationKind;
  dataAttr?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-notify-pref={dataAttr ?? `${channel}:${kind}`}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-selected)]',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[14px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function NotificationsPanel() {
  const t = useT();
  const prefs = useNotificationPrefs();
  const hydrate = useNotificationPrefs((s) => s.hydrate);
  const setEnabled = useNotificationPrefs((s) => s.setEnabled);
  const setQuiet = useNotificationPrefs((s) => s.setQuiet);

  React.useEffect(() => hydrate(), [hydrate]);

  return (
    <div data-notification-prefs className="max-w-[640px]">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-r6 bg-[var(--bg-hover)] text-t3">
          <Bell size={14} />
        </span>
        <div>
          <h2 className="text-[15px] font-[590] text-t1">{t('Notifications')}</h2>
          <p className="mt-0.5 text-[13px] leading-[1.55] text-t3">
            {t('Choose which updates reach the inbox and which also raise a desktop notification.')}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-r9 bg-[var(--bg-elevated)] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <div className="flex items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2 text-[11px] uppercase tracking-[.05em] text-t4">
          <span className="flex-1">{t('Type')}</span>
          <span className="flex w-[92px] items-center justify-center gap-1">
            <Bell size={11} />
            {t('Inbox')}
          </span>
          <span className="flex w-[92px] items-center justify-center gap-1">
            <Monitor size={11} />
            {t('Desktop')}
          </span>
        </div>
        {KINDS.map((row) => (
          <div key={row.key} data-notify-row={row.key} className="flex items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2.5 last:border-0">
            <span className="flex-1 text-[13px] text-t2">{t(row.label)}</span>
            <span className="flex w-[92px] justify-center">
              <Toggle
                channel="inbox"
                kind={row.key}
                checked={prefs.inbox[row.key]}
                onChange={(value) => setEnabled('inbox', row.key, value)}
                label={`${t('Inbox')}: ${t(row.label)}`}
              />
            </span>
            <span className="flex w-[92px] justify-center">
              <Toggle
                channel="desktop"
                kind={row.key}
                checked={prefs.desktop[row.key]}
                onChange={(value) => setEnabled('desktop', row.key, value)}
                label={`${t('Desktop')}: ${t(row.label)}`}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] leading-[1.5] text-t4">
        {t('Desktop notifications are sent by the desktop app while it is in the background.')}
      </p>

      <div data-quiet-hours className="mt-4 rounded-r9 bg-[var(--bg-elevated)] p-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-[510] text-t2">{t('Quiet hours')}</div>
            <p className="mt-0.5 text-[12px] leading-[1.5] text-t4">
              {t('Notifications stay in the inbox, but no desktop notification is raised during this window.')}
            </p>
          </div>
          <Toggle
            channel="inbox"
            kind="mention"
            dataAttr="quiet-toggle"
            checked={prefs.quiet.enabled}
            onChange={(value) => setQuiet({ enabled: value })}
            label={t('Quiet hours')}
          />
        </div>
        <div className={cn('mt-2 flex items-center gap-2', !prefs.quiet.enabled && 'opacity-50')}>
          <span className="text-[12px] text-t3">{t('From')}</span>
          <select
            data-quiet-start
            value={prefs.quiet.start}
            disabled={!prefs.quiet.enabled}
            onChange={(event) => setQuiet({ start: Number(event.target.value) })}
            className="h-[24px] rounded-r5 bg-[var(--bg-hover)] px-1 text-[12px] text-t2 outline-none"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>
            ))}
          </select>
          <span className="text-[12px] text-t3">{t('to')}</span>
          <select
            data-quiet-end
            value={prefs.quiet.end}
            disabled={!prefs.quiet.enabled}
            onChange={(event) => setQuiet({ end: Number(event.target.value) })}
            className="h-[24px] rounded-r5 bg-[var(--bg-hover)] px-1 text-[12px] text-t2 outline-none"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>
            ))}
          </select>
          <span className="text-[11.5px] text-t4">{t('Crossing midnight is supported.')}</span>
        </div>
      </div>
    </div>
  );
}

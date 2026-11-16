'use client';

import * as React from 'react';
import { Loader2, Mail, RefreshCw, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';

const field =
  'h-[36px] w-full rounded-r6 bg-[var(--bg-hover)] px-2.5 text-[13.5px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]';
const labelClass = 'mb-1 block text-[12px] font-[510] text-t4';

interface SavedMail {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  starttls: boolean;
  user: string;
  from: string;
  fromName: string;
  hasPass: boolean;
  passHint: string;
  updatedAt: string;
  updatedBy?: string;
}

interface MailPayload {
  ok?: boolean;
  canManage?: boolean;
  saved?: SavedMail | null;
  effective?: { ready: boolean; host: string; from: string; source: 'settings' | 'env' | 'none' };
  env?: { host: string; user: string; from: string } | null;
  error?: string;
  notices?: string[];
  errors?: Partial<Record<'host' | 'port' | 'user' | 'pass' | 'from' | 'fromName' | 'starttls', string>>;
}

interface Draft {
  enabled: boolean;
  host: string;
  port: string;
  secure: boolean;
  starttls: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

const EMPTY: Draft = {
  enabled: true,
  host: '',
  port: '465',
  secure: true,
  starttls: false,
  user: '',
  pass: '',
  from: '',
  fromName: 'Aether',
};

const PRESET_HOSTS = [
  { id: 'qq', host: 'smtp.qq.com', port: '465' },
  { id: '163', host: 'smtp.163.com', port: '465' },
  { id: 'gmail', host: 'smtp.gmail.com', port: '465' },
  { id: 'outlook', host: 'smtp.office365.com', port: '587' },
];

function draftOf(payload: MailPayload | null): Draft {
  const saved = payload?.saved;
  if (saved) {
    return {
      enabled: saved.enabled,
      host: saved.host,
      port: String(saved.port),
      secure: saved.secure,
      starttls: saved.starttls,
      user: saved.user,
      pass: '',
      from: saved.from,
      fromName: saved.fromName,
    };
  }
  const env = payload?.env;
  return {
    ...EMPTY,
    user: env?.user ?? '',
    host: env?.host ?? '',
    from: env?.from ?? '',
    port: env?.host ? '465' : EMPTY.port,
  };
}

/**
 * Mail service: host, account and authorization code, saved into this data
 * directory (the code is encrypted server-side) instead of a read-only
 * `.env.local`. Saving is enough — `/api/auth` reads the same file on its next
 * request, so the sign-in screen offers email codes immediately.
 */
export function MailPanel() {
  const t = useT();
  const pushToast = useUI((s) => s.pushToast);
  const [payload, setPayload] = React.useState<MailPayload | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [errors, setErrors] = React.useState<MailPayload['errors']>({});
  const [note, setNote] = React.useState('');

  const apply = React.useCallback((next: MailPayload) => {
    setPayload(next);
    setDraft(draftOf(next));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/mail', { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as MailPayload;
      if (!response.ok || !json.ok) setError(json.error ?? 'Could not load the mail settings.');
      else apply(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const canManage = Boolean(payload?.canManage);

  const request = async (method: 'PUT' | 'POST' | 'DELETE', body?: unknown) => {
    const response = await fetch('/api/settings/mail', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => ({}))) as MailPayload & { sent?: boolean; tested?: boolean; to?: string };
    return { ok: response.ok && Boolean(json.ok), json, status: response.status };
  };

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setError('');
    setErrors({});
    setNote('');
    try {
      const result = await request('PUT', {
        enabled: draft.enabled,
        host: draft.host,
        port: draft.port,
        secure: draft.secure,
        starttls: draft.starttls,
        user: draft.user,
        pass: draft.pass,
        from: draft.from,
        fromName: draft.fromName,
      });
      if (!result.ok) {
        setError(result.json.error ?? `Save failed (${result.status})`);
        setErrors(result.json.errors ?? {});
        return;
      }
      apply(result.json);
      setNote(t('Saved. Email codes work from the next sign-in attempt.'));
      pushToast({ title: t('Mail settings saved'), tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const test = async (mode: 'test' | 'send') => {
    if (busy) return;
    setBusy(mode);
    setError('');
    setErrors({});
    setNote('');
    try {
      const result = await request('POST', {
        action: mode,
        host: draft.host,
        port: draft.port,
        secure: draft.secure,
        starttls: draft.starttls,
        user: draft.user,
        pass: draft.pass,
        from: draft.from,
        fromName: draft.fromName,
        ...(mode === 'send' ? { to: draft.from || draft.user } : {}),
      });
      if (!result.ok) {
        setError(t('The test failed: {detail}', { detail: result.json.error ?? '' }));
        return;
      }
      setNote(
        mode === 'test'
          ? t('Connected and signed in to {host}.', { host: draft.host })
          : t('Test message sent to {to}.', { to: result.json.to ?? draft.from }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const reset = async () => {
    if (busy) return;
    if (!window.confirm(t('Forget the saved relay and fall back to .env.local?'))) return;
    setBusy('reset');
    setError('');
    setNote('');
    try {
      const result = await request('DELETE');
      if (!result.ok) {
        setError(result.json.error ?? `Reset failed (${result.status})`);
        return;
      }
      apply(result.json);
      setNote(t('Saved relay cleared.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const source = payload?.effective?.source ?? 'none';
  const sourceLabel =
    source === 'settings'
      ? t('Saved in this workspace')
      : source === 'env'
        ? t('From .env.local')
        : t('Not configured');
  const plaintextRelay = Boolean(
    payload?.saved && payload.saved.enabled && !payload.saved.secure && !payload.saved.starttls,
  );

  return (
    <div data-mail-panel className="max-w-[720px]">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-r6 bg-[var(--bg-hover)] text-t3">
          <Mail size={14} />
        </span>
        <div>
          <h2 className="text-[15px] font-[590] text-t1">{t('Email')}</h2>
          <p className="mt-0.5 text-[13px] leading-[1.55] text-t3">
            {t(
              'Aether mails six-digit codes for sign-in, sign-up and password resets. Point it at your own SMTP relay; the password is encrypted on the server and never leaves it.',
            )}
          </p>
        </div>
      </div>

      <div
        data-mail-status
        data-mail-source={source}
        className="mb-3 flex flex-wrap items-center gap-2 rounded-r6 bg-[var(--bg-elevated)] px-3 py-2 text-[12.5px] text-t3 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
      >
        <span
          className={cn(
            'h-[6px] w-[6px] rounded-full',
            payload?.effective?.ready ? 'bg-[var(--green)]' : 'bg-[var(--orange)]',
          )}
        />
        <span className="text-t2">{payload?.effective?.ready ? t('Relay in use') : t('Email codes are off')}</span>
        <span className="text-t4">· {sourceLabel}</span>
        {payload?.effective?.host ? <span className="font-mono text-[11.5px] text-t4">{payload.effective.host}</span> : null}
        {payload?.saved ? (
          <span className="text-[11.5px] text-t4">
            · {t('Saved {when}', { when: new Date(payload.saved.updatedAt).toLocaleString() })}
          </span>
        ) : null}
        <button
          type="button"
          data-mail-refresh
          aria-label={t('Reload mail settings')}
          onClick={() => void load()}
          className="ml-auto grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      {error ? (
        <div data-mail-error className="mb-3 rounded-r6 bg-[color-mix(in_srgb,var(--red)_9%,transparent)] px-2.5 py-2 text-[12.5px] text-[var(--red)]">
          {t(error)}
        </div>
      ) : null}
      {note ? (
        <div data-mail-note className="mb-3 rounded-r6 bg-[color-mix(in_srgb,var(--green)_10%,transparent)] px-2.5 py-2 text-[12.5px] text-[var(--green)]">
          {note}
        </div>
      ) : null}

      <div className="rounded-r9 bg-[var(--bg-elevated)] p-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <div className="flex items-center justify-between gap-4 pb-2">
          <div>
            <div className="text-[13px] font-[510] text-t2">{t('Use this relay')}</div>
            <div className="mt-0.5 text-[12px] text-t4">
              {t('Turn this off to keep the settings but stop offering email codes.')}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            data-mail-enabled
            aria-checked={draft.enabled}
            disabled={!canManage}
            onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
            className={cn(
              'relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-160 ease-out disabled:opacity-50',
              draft.enabled ? 'bg-accent' : 'bg-[var(--bg-selected)]',
            )}
          >
            <span
              className={cn(
                'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.32)] transition-transform duration-160 ease-out',
                draft.enabled ? 'translate-x-[14px]' : 'translate-x-[2px]',
              )}
            />
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>{t('SMTP account')}</span>
            <input
              data-mail-user
              value={draft.user}
              onChange={(event) => setDraft({ ...draft, user: event.target.value })}
              placeholder="you@qq.com"
              spellCheck={false}
              autoComplete="off"
              disabled={!canManage}
              className={cn(field, 'font-mono')}
            />
            {errors?.user ? <span className="mt-1 block text-[11.5px] text-[var(--red)]">{t(errors.user)}</span> : null}
          </label>
          <label className="block">
            <span className={labelClass}>{t('Password or authorization code')}</span>
            <input
              data-mail-pass
              value={draft.pass}
              onChange={(event) => setDraft({ ...draft, pass: event.target.value })}
              placeholder={payload?.saved?.hasPass ? (payload.saved.passHint || t('Saved — leave blank to keep')) : '••••••••'}
              type="password"
              autoComplete="new-password"
              disabled={!canManage}
              className={field}
            />
            {errors?.pass ? <span className="mt-1 block text-[11.5px] text-[var(--red)]">{t(errors.pass)}</span> : null}
          </label>
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-[1.6fr_.6fr]">
          <label className="block">
            <span className={labelClass}>{t('SMTP host')}</span>
            <input
              data-mail-host
              value={draft.host}
              onChange={(event) => setDraft({ ...draft, host: event.target.value })}
              placeholder="smtp.qq.com"
              spellCheck={false}
              autoComplete="off"
              disabled={!canManage}
              className={cn(field, 'font-mono')}
            />
            {errors?.host ? <span className="mt-1 block text-[11.5px] text-[var(--red)]">{t(errors.host)}</span> : null}
          </label>
          <label className="block">
            <span className={labelClass}>{t('Port')}</span>
            <input
              data-mail-port
              value={draft.port}
              onChange={(event) => setDraft({ ...draft, port: event.target.value.replace(/[^0-9]/g, '') })}
              inputMode="numeric"
              disabled={!canManage}
              className={cn(field, 'font-mono')}
            />
            {errors?.port ? <span className="mt-1 block text-[11.5px] text-[var(--red)]">{t(errors.port)}</span> : null}
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-t4">{t('TLS')}</span>
          <div className="flex items-center gap-0.5 rounded-full bg-[var(--bg-hover)] p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
            {(
              [
                { id: 'implicit', label: 'Implicit TLS (465)', secure: true, starttls: false, port: '465' },
                { id: 'starttls', label: 'STARTTLS (587)', secure: false, starttls: true, port: '587' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                data-mail-tls={mode.id}
                aria-pressed={draft.secure === mode.secure && draft.starttls === mode.starttls}
                disabled={!canManage}
                onClick={() =>
                  setDraft({
                    ...draft,
                    secure: mode.secure,
                    starttls: mode.starttls,
                    port: mode.port === '587' && draft.port === '465' ? '587' : mode.port === '465' && draft.port === '587' ? '465' : draft.port,
                  })
                }
                className={cn(
                  'flex h-[24px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors duration-100 disabled:opacity-50',
                  draft.secure === mode.secure && draft.starttls === mode.starttls
                    ? 'bg-[var(--bg-selected)] text-t1'
                    : 'text-t4 hover:text-t2',
                )}
              >
                {t(mode.label)}
              </button>
            ))}
          </div>
          <span className="ml-1 flex flex-wrap items-center gap-1">
            {PRESET_HOSTS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-mail-preset={preset.id}
                disabled={!canManage}
                onClick={() =>
                  setDraft({
                    ...draft,
                    host: preset.host,
                    port: preset.port,
                    secure: preset.port === '465',
                    starttls: preset.port !== '465',
                  })
                }
                className="rounded-full bg-[var(--bg-hover)] px-2 py-[2px] text-[11px] text-t4 transition-colors hover:text-t2 disabled:opacity-50"
              >
                {preset.host}
              </button>
            ))}
          </span>
        </div>
        {errors?.starttls ? (
          <div className="mt-1 text-[11.5px] text-[var(--red)]">{t(errors.starttls)}</div>
        ) : null}
        {plaintextRelay ? (
          <div data-mail-plaintext className="mt-1 text-[11.5px] text-[var(--orange)]">
            {t('This relay is on this machine or the LAN, so mail is sent without TLS.')}
          </div>
        ) : null}

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>{t('Sender address')}</span>
            <input
              data-mail-from
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              placeholder={draft.user || 'you@qq.com'}
              spellCheck={false}
              autoComplete="off"
              disabled={!canManage}
              className={cn(field, 'font-mono')}
            />
            {errors?.from ? <span className="mt-1 block text-[11.5px] text-[var(--red)]">{t(errors.from)}</span> : null}
          </label>
          <label className="block">
            <span className={labelClass}>{t('Sender name')}</span>
            <input
              data-mail-from-name
              value={draft.fromName}
              onChange={(event) => setDraft({ ...draft, fromName: event.target.value })}
              placeholder="Aether"
              disabled={!canManage}
              className={field}
            />
          </label>
        </div>

        <p className="mt-2 text-[12px] leading-[1.55] text-t4">
          {t(
            'QQ Mail, 163 and Gmail need an authorization code (16 characters) generated in the mailbox settings, not the login password.',
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            data-mail-save
            disabled={!canManage || busy === 'save'}
            onClick={() => void save()}
            className="gap-1.5"
          >
            {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('Save and use')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-mail-test
            disabled={!canManage || busy === 'test'}
            onClick={() => void test('test')}
            className="gap-1.5"
          >
            {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('Test connection')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-mail-send
            disabled={!canManage || busy === 'send'}
            onClick={() => void test('send')}
            className="gap-1.5"
          >
            {busy === 'send' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {t('Send test email')}
          </Button>
          {payload?.saved ? (
            <Button
              variant="ghost"
              size="sm"
              data-mail-reset
              disabled={!canManage || busy === 'reset'}
              onClick={() => void reset()}
              className="gap-1.5 text-t4 hover:text-[#f08080]"
            >
              <Trash2 size={12} />
              {t('Clear saved relay')}
            </Button>
          ) : null}
        </div>

        {payload?.env ? (
          <p data-mail-env className="mt-2 font-mono text-[11.5px] text-t4">
            {t('.env.local also has a relay ({host}); a saved entry outranks it.', { host: payload.env.host })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

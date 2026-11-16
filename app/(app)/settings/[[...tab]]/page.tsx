'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, LogOut, Moon, PanelLeft, RefreshCw, Search, Sun, Trash2, UserPlus } from 'lucide-react';
import { useUI } from '@/lib/store/ui';
import { useView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { useSession } from '@/lib/session';
import { useLocale, useT } from '@/lib/use-t';
import { inviteLink } from '@/lib/invite';
import { describeUserAgent } from '@/lib/ua';
import { cn, plural, relativeTime } from '@/lib/utils';
import { Avatar, Button, Kbd } from '@/components/ui/primitives';
import { AgentSettingsPanel } from '@/components/agent/agent-settings';
import { ConnectorsPanel } from '@/components/settings/connectors';
import { MailPanel } from '@/components/settings/mail';
import { SearchPanel } from '@/components/settings/search';
import { TemplatesPanel } from '@/components/settings/templates';
import { NotificationsPanel } from '@/components/settings/notifications';
import { SecurityPanel } from '@/components/settings/security-audit';
import { WorkspaceTransfer } from '@/components/settings/workspace-transfer';

const TABS = [
  { key: 'account', label: 'Account' },
  { key: 'security', label: 'Security' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'agents', label: 'Agents' },
  { key: 'connectors', label: 'Connectors' },
  { key: 'search', label: 'Web search' },
  { key: 'mail', label: 'Email' },
  { key: 'templates', label: 'Templates' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'members', label: 'Members' },
  { key: 'labels', label: 'Labels' },
  { key: 'about', label: 'About' },
] as const;

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-160 ease-out',
        on ? 'bg-accent' : 'bg-[var(--bg-selected)]',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.32)] transition-transform duration-160 ease-out',
          on ? 'translate-x-[14px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-[var(--line-subtle)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[14px] font-[510] text-t2">{title}</div>
        {description ? <div className="mt-0.5 text-[13px] leading-[1.5] text-t4">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const fieldClass =
  'h-[40px] w-full rounded-r6 bg-[var(--bg-hover)] px-2.5 text-[14px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]';

/** Account: profile, password, sign out. */
function AccountPanel() {
  const t = useT();
  const me = useSession((s) => s.user);
  const updateProfile = useSession((s) => s.updateProfile);
  const signOut = useSession((s) => s.signOut);

  const [name, setName] = React.useState(me?.name ?? '');
  const [handle, setHandle] = React.useState(me?.handle ?? '');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState('');

  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwNote, setPwNote] = React.useState('');
  const pushToast = useUI((s) => s.pushToast);

  type SessionRow = { id: string; createdAt: string; seenAt: string; ua: string; ip: string; current: boolean };
  const [sessions, setSessions] = React.useState<SessionRow[] | null>(null);
  const [localSessions, setLocalSessions] = React.useState(false);

  const loadSessions = React.useCallback(async () => {
    try {
      const response = await fetch('/api/accounts/sessions', { cache: 'no-store' });
      const json = (await response.json()) as { ok?: boolean; sessions?: SessionRow[]; local?: boolean };
      if (json.ok) {
        setSessions(json.sessions ?? []);
        setLocalSessions(Boolean(json.local));
      }
    } catch {
      setSessions([]);
    }
  }, []);

  React.useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const revokeSession = async (id: string) => {
    await fetch(`/api/accounts/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
    await loadSessions();
  };

  const revokeOthers = async () => {
    try {
      const response = await fetch('/api/accounts/sessions?others=1', { method: 'DELETE' });
      const json = (await response.json()) as { removed?: number };
      pushToast({ title: t('Signed out {n} other session(s)', { n: json.removed ?? 0 }), tone: 'success' });
      await loadSessions();
    } catch {
      pushToast({ title: t('Could not sign out other sessions.'), tone: 'danger' });
    }
  };

  React.useEffect(() => {
    setName(me?.name ?? '');
    setHandle(me?.handle ?? '');
  }, [me?.name, me?.handle]);

  if (!me) return null;

  const dirty = name.trim() !== me.name || handle.trim() !== me.handle;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    const problem = await updateProfile({ name: name.trim(), handle: handle.trim() });
    setSaving(false);
    if (problem) setError(t(problem));
    else {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    }
  };

  const changePassword = async () => {
    if (pwBusy || !next) return;
    setPwBusy(true);
    setPwNote('');
    const problem = await updateProfile({ currentPassword: current, newPassword: next });
    setPwBusy(false);
    if (problem) setPwNote(t(problem));
    else {
      setCurrent('');
      setNext('');
      setPwNote(t('Password updated.'));
    }
  };

  return (
    <div>
      <h1 className="text-title2 font-[590] text-t1">{t('Account')}</h1>
      <p className="mt-1 text-[14px] text-t4">{t('This profile is what your teammates see next to every issue.')}</p>

      <div className="mt-5 flex items-center gap-3 rounded-r8 px-4 py-4 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <Avatar name={me.name} color={me.color} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-[590] text-t1">{me.name}</span>
            <span className="rounded-full bg-[var(--bg-selected)] px-1.5 text-[10.5px] leading-[16px] text-t3">
              {me.role === 'owner' ? t('Owner') : t('Member')}
            </span>
          </div>
          <div className="truncate text-[13px] text-t4">{me.email}</div>
        </div>
      </div>

      <div className="mt-4 rounded-r8 px-4 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <div className="flex items-center justify-between gap-6 border-b border-[var(--line-subtle)] py-3">
          <div className="w-[120px] shrink-0 text-[14px] font-[510] text-t2">{t('Display name')}</div>
          <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </div>
        <div className="flex items-center justify-between gap-6 border-b border-[var(--line-subtle)] py-3">
          <div className="w-[120px] shrink-0 text-[14px] font-[510] text-t2">{t('Handle')}</div>
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
            spellCheck={false}
            className={cn(fieldClass, 'font-mono text-[13.5px]')}
          />
        </div>
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="text-[13px] text-t4">{error ? <span className="text-[#f08080]">{error}</span> : null}</div>
          <div className="flex items-center gap-2">
            {saved ? (
              <span className="flex items-center gap-1 text-[13px] text-[#7ac977]">
                <Check size={12} strokeWidth={2.4} /> {t('Saved')}
              </span>
            ) : null}
            <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={save}>
              {t('Save changes')}
            </Button>
          </div>
        </div>
      </div>

      <h2 className="mt-8 text-[14px] font-[590] text-t2">{t('Password')}</h2>
      <div className="mt-2 flex flex-col gap-2 rounded-r8 px-4 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)] sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[12.5px] text-t4">{t('Current password')}</span>
          <input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            className={fieldClass}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[12.5px] text-t4">{t('New password')}</span>
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            className={fieldClass}
          />
        </label>
        <Button variant="secondary" size="sm" disabled={pwBusy || !next} onClick={changePassword}>
          {t('Update password')}
        </Button>
      </div>
      {pwNote ? <div className="mt-1.5 text-[13px] text-t3">{pwNote}</div> : null}

      <h2 className="mt-8 text-[14px] font-[590] text-t2">{t('Sessions')}</h2>
      <div data-sessions className="mt-2 rounded-r8 px-4 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {localSessions ? (
          <p className="text-[13px] text-t4">{t('Local mode does not use sessions.')}</p>
        ) : sessions === null ? (
          <p className="text-[13px] text-t4">{t('Loading…')}</p>
        ) : sessions.length === 0 ? (
          <p className="text-[13px] text-t4">{t('No active sessions.')}</p>
        ) : (
          <ul className="flex flex-col">
            {sessions.map((session) => (
              <li key={session.id} data-session={session.id} className="flex items-center gap-2 border-b border-[var(--line-subtle)] py-1.5 last:border-0">
                <span className="flex-1 text-[12.5px] text-t2">
                  {describeUserAgent(session.ua)}
                  {session.current ? <span className="ml-1.5 text-[11px] text-[var(--accent)]">{t('This browser')}</span> : null}
                  {session.ip ? <span className="ml-1.5 font-mono text-[10.5px] text-t4">{session.ip}</span> : null}
                </span>
                <span className="text-[11.5px] text-t4">
                  {t('Signed in {when}', { when: relativeTime(session.createdAt) })}
                </span>
                <span className="text-[11.5px] text-t4">{t('Last active {when}', { when: relativeTime(session.seenAt) })}</span>
                {session.current ? null : (
                  <Button variant="ghost" size="sm" className="gap-1" onClick={() => void revokeSession(session.id)}>
                    {t('Revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!localSessions && sessions && sessions.length > 1 ? (
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => void revokeOthers()}>
              {t('Sign out other sessions')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-8 flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void signOut()}>
          <LogOut size={13} strokeWidth={1.9} />
          {t('Sign out')}
        </Button>
        <span className="text-[12.5px] text-t4">{t('Signing out clears this browser\'s copy of the workspace.')}</span>
      </div>
    </div>
  );
}

/** Members: who is in the workspace, and what an owner can do about it. */
function MembersPanel() {
  const t = useT();
  const users = useSession((s) => s.users);
  const me = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const pushToast = useUI((s) => s.pushToast);
  const issues = useData((s) => s.issues);
  const [busy, setBusy] = React.useState('');
  const [invite, setInvite] = React.useState<{ required: boolean; code: string | null }>({
    required: false,
    code: null,
  });
  const [inviteBusy, setInviteBusy] = React.useState(false);

  const loadInvite = React.useCallback(async () => {
    setInviteBusy(true);
    try {
      const response = await fetch('/api/auth', { cache: 'no-store' });
      if (!response.ok) return;
      const json = (await response.json()) as { signupCodeRequired?: boolean; inviteCode?: string | null };
      setInvite({ required: Boolean(json.signupCodeRequired), code: json.inviteCode ?? null });
    } catch {
      /* offline */
    } finally {
      setInviteBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void loadInvite();
  }, [loadInvite]);

  const setRole = async (id: string, role: 'owner' | 'member') => {
    if (busy) return;
    setBusy(id);
    try {
      const response = await fetch('/api/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, role }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        pushToast({ title: t(json.error ?? 'Could not change that role.'), tone: 'danger' });
        return;
      }
      await refresh();
      pushToast({ title: t('Role updated'), tone: 'success' });
    } finally {
      setBusy('');
    }
  };

  const remove = async (id: string, name: string) => {
    if (busy) return;
    if (!window.confirm(t('Remove {name} from this workspace?', { name }))) return;
    setBusy(id);
    try {
      const response = await fetch(`/api/members?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        pushToast({ title: t(json.error ?? 'Could not remove that member.'), tone: 'danger' });
        return;
      }
      await refresh();
      pushToast({ title: t('{name} removed', { name }) });
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <h1 className="text-title2 font-[590] text-t1">{t('Members')}</h1>
      <p className="mt-1 text-[14px] text-t4">
        {t('{n} in this workspace.', { n: plural(users.length, 'person', 'people') })}
      </p>

      <div className="mt-5 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {users.map((u, i) => {
          const open = issues.filter((issue) => issue.assigneeId === u.id && issue.status !== 'done' && issue.status !== 'canceled').length;
          const online = u.lastSeenAt ? Date.now() - +new Date(u.lastSeenAt) < 5 * 60 * 1000 : false;
          return (
            <div
              key={u.id}
              data-member={u.id}
              className={cn('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-[var(--line-subtle)]')}
            >
              <span className="relative">
                <Avatar name={u.name} color={u.color} size="lg" />
                <span
                  className={cn(
                    'absolute -bottom-px -right-px h-[8px] w-[8px] rounded-full shadow-[0_0_0_1.5px_var(--bg-panel)]',
                    online ? 'bg-[#27a644]' : 'bg-[var(--line-strong)]',
                  )}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-[510] text-t2">{u.name}</span>
                  {u.id === me?.id ? (
                    <span className="rounded-full bg-[rgba(94,106,210,.16)] px-1.5 text-[10.5px] text-[#9aa4ff]">
                      {t('you')}
                    </span>
                  ) : null}
                  {u.role === 'owner' ? (
                    <span className="rounded-full bg-[var(--bg-selected)] px-1.5 text-[10.5px] text-t3">{t('Owner')}</span>
                  ) : null}
                </div>
                <div className="truncate text-[13px] text-t4">
                  @{u.handle}
                  {u.email ? ` · ${u.email}` : ''}
                </div>
              </div>
              <span className="tnum hidden w-[64px] text-right text-[12.5px] text-t4 sm:inline">
                {open} {t('{n} open')}
              </span>
              <span className="hidden w-[72px] text-right text-[12.5px] text-t4 md:inline">
                {online ? t('Active') : u.lastSeenAt ? relativeTime(u.lastSeenAt) : '—'}
              </span>
              {me?.role === 'owner' && u.id !== me.id ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-member-role={u.id}
                    disabled={busy === u.id}
                    onClick={() => void setRole(u.id, u.role === 'owner' ? 'member' : 'owner')}
                    className="text-[12px] text-t3"
                  >
                    {u.role === 'owner' ? t('Make member') : t('Make owner')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('Remove')}
                    disabled={busy === u.id}
                    onClick={() => void remove(u.id, u.name)}
                    className="text-t4 hover:text-[#f08080]"
                  >
                    <Trash2 size={13} strokeWidth={1.9} />
                  </Button>
                </>
              ) : (
                <span className="w-[28px]" />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          data-copy-invite
          onClick={async () => {
            const link = inviteLink(window.location.origin, invite.required ? invite.code : null);
            await navigator.clipboard.writeText(link).catch(() => {});
            pushToast({ title: t('Invite link copied'), description: link });
          }}
        >
          <UserPlus size={13} strokeWidth={1.9} />
          {t('Copy invite link')}
        </Button>
        {invite.required && invite.code ? (
          <>
            <code data-invite-code className="rounded-r5 bg-[var(--bg-hover)] px-2 py-1 font-mono text-[12px] text-t2">
              {invite.code}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                await navigator.clipboard.writeText(invite.code ?? '').catch(() => {});
                pushToast({ title: t('Invite code copied'), tone: 'success' });
              }}
            >
              {t('Copy invite code')}
            </Button>
          </>
        ) : null}
        <span className="text-[12.5px] text-t4">
          {invite.required
            ? invite.code
              ? t('New accounts need this invite code.')
              : t('New accounts need an invite code. Only the workspace owner can see it.')
            : t('Signup is open — anyone who can reach this server can create an account.')}
        </span>
        <button
          type="button"
          data-invite-refresh
          aria-label={t('Refresh invite code')}
          onClick={() => {
            void loadInvite().then(() => pushToast({ title: t('Invite status refreshed'), tone: 'success' }));
          }}
          disabled={inviteBusy}
          className="grid h-[26px] w-[26px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1 disabled:opacity-50"
        >
          <RefreshCw size={11} className={inviteBusy ? 'animate-spin' : undefined} />
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const params = useParams<{ tab?: string[] }>();
  const router = useRouter();
  const requested = params?.tab?.[0] ?? 'preferences';
  const active = TABS.some((tab) => tab.key === requested) ? requested : 'preferences';
  const t = useT();
  const locale = useLocale();
  const setLocale = useUI((s) => s.setLocale);
  const [scheduler, setScheduler] = React.useState<{
    started: boolean;
    lastTickAt: number | null;
    running: number;
    disabled: boolean;
  } | null>(null);
  const [counts, setCounts] = React.useState<{
    providers: number;
    workflows: number;
    enabledWorkflows: number;
    knowledge: number;
    memory: number;
  } | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch('/api/agent/status', { cache: 'no-store' })
      .then((response) => response.json())
      .then(
        (json: {
          scheduler?: { started: boolean; lastTickAt: number | null; running: number; disabled: boolean };
          counts?: {
            providers: number;
            workflows: number;
            enabledWorkflows: number;
            knowledge: number;
            memory: number;
          };
        }) => {
          if (alive) {
            setScheduler(json.scheduler ?? null);
            setCounts(json.counts ?? null);
          }
        },
      )
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUI((s) => s.setSidebarCollapsed);
  const display = useView((s) => s.display);
  const toggleDisplay = useView((s) => s.toggleDisplay);
  const issues = useData((s) => s.issues);
  const resetWorkspace = useData((s) => s.resetWorkspace);
  const storageMode = useData((s) => s.storageMode);
  const labels = useData((s) => s.labels);
  const me = useSession((s) => s.user);
  const mode = useSession((s) => s.mode);
  const [tabQuery, setTabQuery] = React.useState('');
  const tabNeedle = tabQuery.trim().toLowerCase();
  const visibleTabs = TABS.filter(
    (tabItem) =>
      !tabNeedle ||
      t(tabItem.label).toLowerCase().includes(tabNeedle) ||
      tabItem.key.includes(tabNeedle),
  );

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-8 lg:px-8 lg:py-8">
      <nav className="w-full shrink-0 lg:w-[168px]">
        <div className="mb-2 hidden px-2 text-[12px] font-[510] uppercase tracking-[.06em] text-t4 lg:block">{t('Settings')}</div>
        <div className="mb-2 flex h-[28px] items-center gap-1.5 rounded-r6 bg-[var(--bg-hover)] px-2 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          <Search size={12} className="shrink-0 text-t4" />
          <input
            data-settings-search
            value={tabQuery}
            onChange={(event) => setTabQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setTabQuery('');
            }}
            placeholder={t('Find a setting…')}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-t1 outline-none placeholder:text-t4"
          />
        </div>
        <div className="flex flex-row gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:gap-0.5">
          {visibleTabs.map((tabItem) => (
            <button
              key={tabItem.key}
              data-mobile-hit
              data-settings-tab={tabItem.key}
              type="button"
              onClick={() => router.push(tabItem.key === 'preferences' ? '/settings' : `/settings/${tabItem.key}`)}
              className={cn(
                'flex h-[30px] shrink-0 items-center rounded-r6 px-2 text-left text-[14px] font-[510] transition-colors duration-100',
                active === tabItem.key ? 'bg-[var(--bg-active)] text-t1' : 'text-t3 hover:bg-[var(--bg-hover)] hover:text-t2',
              )}
            >
              {t(tabItem.label)}
            </button>
          ))}
          {!visibleTabs.length ? (
            <p className="px-2 py-1 text-[12.5px] text-t4">{t('No matching settings.')}</p>
          ) : null}
        </div>
        {me ? (
          <div className="mt-4 hidden items-center gap-2 rounded-r6 px-2 lg:flex">
            <Avatar name={me.name} color={me.color} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-[13px] text-t2">{me.name}</div>
              <div className="truncate text-[12px] text-t4">
                {mode === 'personal' ? t('Personal workspace') : t('Shared workspace')}
              </div>
            </div>
          </div>
        ) : null}
      </nav>

      <div className="min-w-0 flex-1">
        {active === 'account' ? <AccountPanel /> : null}
        {active === 'security' ? <SecurityPanel /> : null}
        {active === 'agents' ? <AgentSettingsPanel /> : null}
        {active === 'connectors' ? <ConnectorsPanel /> : null}
        {active === 'search' ? <SearchPanel /> : null}
        {active === 'mail' ? <MailPanel /> : null}
        {active === 'templates' ? <TemplatesPanel /> : null}
        {active === 'notifications' ? <NotificationsPanel /> : null}
        {active === 'members' ? <MembersPanel /> : null}

        {active === 'preferences' ? (
          <div>
            <h1 className="text-title2 font-[590] text-t1">{t('Preferences')}</h1>
            <p className="mt-1 text-[14px] text-t4">{t('Tune the interface to your taste. Changes apply instantly.')}</p>

            <div className="mt-5 overflow-hidden rounded-r8 px-4 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
              <SettingRow title={t('Language')} description={t('Choose the interface language.')}>
                <div className="flex items-center gap-0.5 rounded-full bg-[var(--bg-hover)] p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
                  {(
                    [
                      { key: 'en' as const, label: 'English' },
                      { key: 'zh' as const, label: '中文' }, // i18n-allow: language names stay in their own language
                    ]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setLocale(key)}
                      aria-pressed={locale === key}
                      className={cn(
                        'flex h-[24px] items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors duration-100',
                        locale === key ? 'bg-[var(--bg-selected)] text-t1' : 'text-t4 hover:text-t2',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow title={t('Theme')} description={t('Dark is the default. Light is tuned to the same token set.')}>
                <div className="flex items-center gap-0.5 rounded-full bg-[var(--bg-hover)] p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
                  {(
                    [
                      { key: 'dark', icon: Moon, label: 'Dark' },
                      { key: 'light', icon: Sun, label: 'Light' },
                    ] as const
                  ).map(({ key, icon: Icon, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTheme(key)}
                      className={cn(
                        'flex h-[24px] items-center gap-1.5 rounded-full px-2 text-[13px] transition-colors duration-100',
                        theme === key ? 'bg-[var(--bg-selected)] text-t1' : 'text-t4 hover:text-t2',
                      )}
                    >
                      <Icon size={12} strokeWidth={1.8} />
                      {t(label)}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow title={t('Sidebar')} description={t('Collapse the sidebar. You can also press ⌘\\ at any time.')}>
                <div className="flex items-center gap-2">
                  <Kbd>⌘</Kbd>
                  <Kbd>\</Kbd>
                  <Toggle on={!sidebarCollapsed} onChange={(v) => setSidebarCollapsed(!v)} />
                </div>
              </SettingRow>
              <SettingRow title={t('Show labels in list')} description={t('Hide label chips for a tighter list.')}>
                <Toggle on={display.showLabels} onChange={() => toggleDisplay('showLabels')} />
              </SettingRow>
              <SettingRow title={t('Show priority')} description={t('Display the priority icon on every row.')}>
                <Toggle on={display.showPriority} onChange={() => toggleDisplay('showPriority')} />
              </SettingRow>
              <SettingRow title={t('Show assignee')} description={t('Display avatars on list rows and board cards.')}>
                <Toggle on={display.showAssignee} onChange={() => toggleDisplay('showAssignee')} />
              </SettingRow>
              <SettingRow title={t('Show dates')} description={t('Show the last-updated date column.')}>
                <Toggle on={display.showDates} onChange={() => toggleDisplay('showDates')} />
              </SettingRow>
              <SettingRow
                title={t('Workspace storage')}
                description={
                  storageMode === 'server'
                    ? t('Synced with this server (.data/workspace.json).')
                    : t('Local to this browser — the server is unreachable.')
                }
              >
                <span className="rounded-full bg-[var(--bg-active)] px-2 py-[2px] text-[12.5px] text-t3">
                  {storageMode === 'server' ? t('Server') : t('This browser')}
                </span>
              </SettingRow>
              <WorkspaceTransfer description={t('Export or restore every issue, label, project and cycle as one JSON file.')} />
              <SettingRow
                title={t('Reset workspace')}
                description={t('Delete every issue, label and project stored in this browser. Cannot be undone.')}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(t('Delete all local workspace data?'))) {
                      resetWorkspace();
                      window.location.reload();
                    }
                  }}
                >
                  {t('Reset')}
                </Button>
              </SettingRow>
              <SettingRow title={t('Empty groups')} description={t('Keep status groups visible even when they have no issues.')}>
                <Toggle on={display.showEmptyGroups} onChange={() => toggleDisplay('showEmptyGroups')} />
              </SettingRow>
            </div>
          </div>
        ) : null}

        {active === 'labels' ? (
          <div>
            <h1 className="text-title2 font-[590] text-t1">{t('Labels')}</h1>
            <p className="mt-1 text-[14px] text-t4">{t('Workspace labels used across every team.')}</p>
            <div className="mt-5 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
              {labels.map((l, i) => {
                const count = issues.filter((x) => x.labelIds.includes(l.id)).length;
                return (
                  <div
                    key={l.id}
                    className={cn('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-[var(--line-subtle)]')}
                  >
                    <span className="h-[8px] w-[8px] rounded-full" style={{ background: l.color }} />
                    <span className="flex-1 text-[14px] font-[510] text-t2">{l.name}</span>
                    <span className="tnum text-[13px] text-t4">{plural(count, 'issue')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {active === 'about' ? (
          <div>
            <h1 className="text-title2 font-[590] text-t1">{t('About')}</h1>
            <p className="mt-1 max-w-[560px] text-[14px] leading-[1.6] text-t4">
              {t(
                'Aether is an agent-centric workspace: Linear-level issue tracking plus a bring-your-own-model agent. Workspace data lives in .data/ on this server, and every model call goes to a provider you configured.',
              )}
            </p>
            <div className="mt-5 overflow-hidden rounded-r8 px-4 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
              <SettingRow title={t('Stack')} description="Next.js 15 (App Router) · TypeScript · Tailwind · Framer Motion · Zustand · Lucide">
                <span className="text-[13px] text-t3">v0.3.0</span>
              </SettingRow>
              <SettingRow
                title={t('Data directory')}
                description={t(
                  'Defaults to .data/ next to the app; LAB_DATA_DIR moves it. Shared mode keeps one snapshot, personal mode gives each account its own.',
                )}
              >
                <span className="font-mono text-[12.5px] text-t3">.data/</span>
              </SettingRow>
              <SettingRow
                title={t('Workflow scheduler')}
                description={t('Runs every 60 seconds on the server. Set AETHER_SCHEDULER=0 to turn it off.')}
              >
                <span className="flex items-center gap-1.5 text-[13px] text-t3">
                  <span
                    className={cn(
                      'h-[6px] w-[6px] rounded-full',
                      scheduler?.disabled
                        ? 'bg-[var(--red)]'
                        : scheduler?.started
                          ? 'bg-[var(--green)]'
                          : 'bg-[var(--orange)]',
                    )}
                  />
                  {scheduler?.disabled ? t('Disabled') : scheduler?.started ? t('Running') : t('Waiting')}
                  {scheduler?.lastTickAt ? (
                    <span className="tnum text-t4">
                      · {new Date(scheduler.lastTickAt).toLocaleTimeString().slice(0, 5)}
                    </span>
                  ) : null}
                </span>
              </SettingRow>
              <SettingRow
                title={t('Models')}
                description={t('None ship with the app — every call goes to a provider you configured.')}
              >
                <span className="text-[13px] text-t3">BYOM</span>
              </SettingRow>
              <SettingRow
                title={t('Stored')}
                description={t('{p} providers · {w} workflows ({e} enabled) · {k} entries · {m} memories', {
                  p: counts?.providers ?? 0,
                  w: counts?.workflows ?? 0,
                  e: counts?.enabledWorkflows ?? 0,
                  k: counts?.knowledge ?? 0,
                  m: counts?.memory ?? 0,
                })}
              >
                <span className="tnum text-[13px] text-t3">{counts ? counts.providers : '—'}</span>
              </SettingRow>
              <SettingRow title={t('Design tokens')} description={t('Colour, type, radius, elevation and easing were measured from linear.app.')}>
                <span className="flex items-center gap-1 text-[13px] text-t3">
                  <Check size={13} /> 60+ tokens
                </span>
              </SettingRow>
              <SettingRow title={t('Shortcuts')} description={t('Press ? anywhere to see the full keyboard map.')}>
                <Kbd>?</Kbd>
              </SettingRow>
              <SettingRow title={t('Sidebar')} description={t('Toggle the sidebar from here or with the shortcut.')}>
                <PanelLeft size={14} className="text-t4" />
              </SettingRow>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

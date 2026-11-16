'use client';

import * as React from 'react';
import { AlertCircle, ArrowRight, Check, KeyRound, Loader2, Lock, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/session';
import { inviteCodeFromSearch } from '@/lib/invite';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';

type Mode = 'signin' | 'signup';

const inputClass =
  'h-[42px] w-full rounded-r8 bg-[var(--bg-elevated)] px-3 text-[14px] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line-strong)] transition-shadow placeholder:text-t4 focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_62%,transparent),0_0_0_3px_var(--focus)]';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-[510] text-t2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] leading-[1.5] text-t4">{hint}</span> : null}
    </label>
  );
}

/** Aether's mark: an orbit around a core, drawn flat so it holds up at 16px. */
function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[8px]"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(145deg, #7c86e8 0%, #5e6ad2 58%, #4c56b8 100%)',
        boxShadow: '0 1px 2px rgba(9,10,12,.18), inset 0 1px 0 rgba(255,255,255,.28)',
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 32 32" fill="none" aria-hidden>
        <ellipse cx="16" cy="16" rx="12" ry="5.4" stroke="white" strokeOpacity=".72" strokeWidth="1.6" transform="rotate(-28 16 16)" />
        <ellipse cx="16" cy="16" rx="12" ry="5.4" stroke="white" strokeOpacity=".34" strokeWidth="1.4" transform="rotate(32 16 16)" />
        <circle cx="16" cy="16" r="3" fill="white" />
      </svg>
    </span>
  );
}

function Wordmark({ subtle = false }: { subtle?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <BrandMark />
      <span className={cn('text-[15px] font-[590] tracking-[-0.015em]', subtle ? 'text-t2' : 'text-t1')}>Aether</span>
    </span>
  );
}

/** A miniature of the real product — same tokens, no screenshot to go stale. */
function ProductPreview() {
  return (
    <div
      aria-hidden
      className="select-none rounded-[14px] bg-[var(--bg-elevated)] p-2 shadow-[0_24px_60px_-28px_rgba(9,10,12,.32),0_2px_6px_rgba(9,10,12,.05),inset_0_0_0_1px_var(--line)]"
    >
      <div className="flex items-center gap-1.5 px-1 pb-2">
        <span className="h-[7px] w-[7px] rounded-full bg-[#e2605f]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#e5b45b]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#6fbf73]" />
        <span className="ml-2 flex h-[18px] flex-1 items-center rounded-[5px] bg-[var(--bg-base)] px-2 text-[8.5px] text-t4">
          aether.local
        </span>
      </div>
      <div className="grid grid-cols-[86px_1fr] gap-1.5">
        <div className="flex flex-col gap-1.5 rounded-[8px] bg-[var(--bg-base)] p-1.5">
          <div className="flex items-center gap-1">
            <span className="h-[10px] w-[10px] rounded-[3px] bg-[var(--accent)]" />
            <span className="h-[4px] w-[34px] rounded-full bg-[var(--line-strong)]" />
          </div>
          {[42, 30, 36, 26, 34].map((width, index) => (
            <span
              key={`nav-${width}`}
              className={cn('h-[5px] rounded-full', index === 2 ? 'bg-[var(--accent)] opacity-60' : 'bg-[var(--line)]')}
              style={{ width }}
            />
          ))}
          <span className="mt-1 h-[1px] w-full bg-[var(--line-subtle)]" />
          <span className="h-[5px] w-[28px] rounded-full bg-[var(--line)]" />
        </div>
        <div className="flex flex-col gap-1.5 rounded-[8px] bg-[var(--bg-panel)] p-2">
          <div className="flex items-center gap-1.5">
            <span className="h-[5px] w-[28px] rounded-full bg-[var(--line-strong)]" />
            <span className="h-[5px] w-[16px] rounded-full bg-[var(--line)]" />
            <span className="ml-auto h-[11px] w-[34px] rounded-full bg-[var(--bg-selected)]" />
          </div>
          {[
            { color: 'var(--status-progress)', key: 'ENG-42', width: 92 },
            { color: 'var(--status-review)', key: 'ENG-38', width: 74 },
            { color: 'var(--status-todo)', key: 'ENG-51', width: 104 },
          ].map((row) => (
            <div key={row.key} className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: row.color }} />
              <span className="h-[4px] rounded-full bg-[var(--line-strong)]" style={{ width: row.width }} />
              <span className="ml-auto font-mono text-[7.5px] text-t4">{row.key}</span>
              <span className="h-[9px] w-[9px] rounded-full bg-[var(--accent)] opacity-30" />
            </div>
          ))}
          <div className="mt-1 rounded-[6px] bg-[var(--bg-elevated)] p-1.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
            <div className="flex items-center gap-1 text-[7.5px] text-[var(--accent)]">
              <Sparkles size={7} strokeWidth={2.2} />
              <span className="font-[590]">Aether</span>
              <span className="ml-auto rounded-[3px] bg-[color-mix(in_srgb,var(--green)_12%,transparent)] px-1 text-[var(--green)]">
                approved
              </span>
            </div>
            <span className="mt-1 block h-[4px] w-[120px] rounded-full bg-[var(--line)]" />
            <span className="mt-1 block h-[4px] w-[78px] rounded-full bg-[var(--line-subtle)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthScreen() {
  const t = useT();
  const status = useSession((s) => s.status);
  const signupCodeRequired = useSession((s) => s.signupCodeRequired);
  const signIn = useSession((s) => s.signIn);
  const signUp = useSession((s) => s.signUp);
  const offline = useSession((s) => s.offline);

  const firstRun = status === 'setup';
  const [mode, setMode] = React.useState<Mode>(firstRun ? 'signup' : 'signin');
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState(() =>
    typeof window === 'undefined' ? '' : inviteCodeFromSearch(window.location.search),
  );
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result =
      mode === 'signup'
        ? await signUp({ name, email, password, code: code || undefined })
        : await signIn(email, password);
    if (result) setError(t(result));
    setBusy(false);
  };

  const heading = firstRun ? t('Create your workspace') : mode === 'signup' ? t('Create an account') : t('Welcome back');
  const sub = firstRun
    ? t('You are the first person here, so this account owns the workspace.')
    : mode === 'signup'
      ? t('Your account keeps its own model settings, preferences and inbox state.')
      : t('Sign in to continue to your workspace.');

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-base lg:grid-cols-[1.06fr_0.94fr]">
      {/* narrative side */}
      <section className="relative hidden flex-col justify-between overflow-hidden px-12 py-10 lg:flex xl:px-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            background:
              'radial-gradient(80% 60% at 8% 0%, rgba(94,106,210,.13), transparent 62%), radial-gradient(60% 50% at 100% 100%, rgba(94,106,210,.08), transparent 60%)',
          }}
        />
        <div className="relative">
          <Wordmark />
          <h1 className="mt-12 max-w-[430px] text-[34px] font-[590] leading-[1.14] tracking-[-0.028em] text-t1">
            {t('Think, plan and execute in one workspace.')}
          </h1>
          <p className="mt-3 max-w-[400px] text-[14.5px] leading-[1.6] text-t3">
            {t('Issue tracking with the craft of Linear. An agent that reads, plans and changes the work — on your own model.')}
          </p>
          <ul className="mt-6 flex flex-col gap-2.5">
            {[
              t('A workspace-level agent with tools and reviewable changes'),
              t('Issues, projects and cycles that stay in sync with the conversation'),
              t('Bring your own provider — nothing is baked in'),
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-[13px] leading-[1.55] text-t2">
                <span className="mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-[var(--bg-accent-subtle)] text-[var(--accent)]">
                  <Check size={9} strokeWidth={3} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-10 max-w-[460px]">
          <ProductPreview />
        </div>

        <div className="relative mt-8 flex items-center gap-4 text-[11.5px] text-t4">
          <span className="flex items-center gap-1.5">
            <KeyRound size={11} strokeWidth={1.9} />
            {t('No bundled model')}
          </span>
          <span className="h-[10px] w-px bg-[var(--line)]" />
          <span className="flex items-center gap-1.5">
            <Lock size={11} strokeWidth={1.9} />
            {t('Keys stay on this server')}
          </span>
          <span className="flex-1" />
          <span className="font-mono text-[10.5px]">v0.3</span>
        </div>
      </section>

      {/* form side */}
      <section className="flex flex-col justify-center border-l border-[var(--line-subtle)] bg-[var(--bg-elevated)] px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-[364px]">
          <div className="mb-9 lg:hidden">
            <Wordmark />
          </div>

          <h2 className="text-[26px] font-[590] leading-[1.2] tracking-[-0.022em] text-t1">{heading}</h2>
          <p className="mt-1.5 text-[13.5px] leading-[1.6] text-t3">{sub}</p>

          <form className="mt-7 flex flex-col gap-3.5" onSubmit={submit} data-auth-form>
            {mode === 'signup' ? (
              <Field label={t('Name')}>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('Your name')}
                  autoComplete="name"
                  className={inputClass}
                />
              </Field>
            ) : null}

            <Field label={t('Email')}>
              <input
                autoFocus={mode === 'signin'}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                type="email"
                autoComplete="email"
                spellCheck={false}
                className={inputClass}
              />
            </Field>

            <Field label={t('Password')}>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? t('At least 8 characters') : '••••••••'}
                className={inputClass}
              />
            </Field>

            {mode === 'signup' && signupCodeRequired && !firstRun ? (
              <Field label={t('Invite code')} hint={t('This workspace requires the code from whoever runs it.')}>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="••••••"
                  type="password"
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
            ) : null}

            {error ? (
              <div
                className="flex items-start gap-2 rounded-r8 bg-[color-mix(in_srgb,var(--red)_9%,transparent)] px-2.5 py-2 text-[12.5px] leading-[1.5] text-[var(--red)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--red)_20%,transparent)]"
                data-auth-error
              >
                <AlertCircle size={13} strokeWidth={2} className="mt-[1px] shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className={cn(
                'mt-1 flex h-[42px] w-full items-center justify-center gap-1.5 rounded-r8 bg-[var(--accent)] text-[14px] font-[510] text-[var(--accent-fg)]',
                'shadow-[0_1px_2px_rgba(9,10,12,.18),inset_0_1px_0_rgba(255,255,255,.16)] transition-colors duration-100',
                'hover:bg-[var(--accent-hover)] active:bg-[#4f5ac2] disabled:opacity-60',
              )}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {mode === 'signup' ? (firstRun ? t('Create workspace') : t('Create account')) : t('Sign in')}
              {!busy ? <ArrowRight size={14} strokeWidth={2.1} /> : null}
            </button>
          </form>

          {!firstRun ? (
            <div className="mt-5 flex items-center gap-1.5 text-[13px] text-t3">
              {mode === 'signup' ? t('Already have an account?') : t('New here?')}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signup' ? 'signin' : 'signup');
                  setError('');
                }}
                className="font-[510] text-t1 underline decoration-[var(--line-strong)] decoration-1 underline-offset-[3px] transition-colors hover:decoration-[var(--accent)]"
              >
                {mode === 'signup' ? t('Sign in') : t('Create an account')}
              </button>
            </div>
          ) : null}

          <div className="mt-9 border-t border-[var(--line-subtle)] pt-4">
            <p className="flex items-start gap-2 text-[11.5px] leading-[1.6] text-t4">
              <Lock size={11} strokeWidth={1.9} className="mt-[2px] shrink-0" />
              <span>
                {offline
                  ? t('The server did not answer — this build opened in local mode.')
                  : t('Accounts, sessions and model keys stay in .data/ on this server. Nothing is sent anywhere else.')}
              </span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Boot() {
  return (
    <div className="grid min-h-dvh place-items-center bg-base">
      <span className="grid h-9 w-9 place-items-center">
        <span className="h-[18px] w-[18px] animate-spin rounded-full border-[2px] border-[var(--line)] border-t-[var(--accent)]" />
      </span>
    </div>
  );
}

/** The auth endpoint did not answer: say so instead of opening a stale cache. */
function OfflineScreen() {
  const t = useT();
  const hydrate = useSession((s) => s.hydrate);
  const [busy, setBusy] = React.useState(false);

  return (
    <div className="grid min-h-dvh place-items-center bg-base px-6">
      <div className="w-full max-w-[392px] rounded-r12 bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-dialog)]">
        <Wordmark subtle />
        <p className="mt-5 text-[15px] font-[510] text-t1">{t('The server did not answer.')}</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.6] text-t3">
          {t('Check that the app server is running, then try again. Nothing was loaded from a previous session.')}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await hydrate();
            setBusy(false);
          }}
          className="mt-5 flex h-[40px] w-full items-center justify-center gap-1.5 rounded-r8 bg-[var(--accent)] text-[13.5px] font-[510] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {t('Try again')}
        </button>
      </div>
    </div>
  );
}

/** Renders the workspace only for a signed-in account. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (status === 'loading') return <Boot />;
  if (status === 'authed') return <>{children}</>;
  if (status === 'error') return <OfflineScreen />;
  return <AuthScreen />;
}

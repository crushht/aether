'use client';

import * as React from 'react';
import { AlertTriangle, Check, CloudOff, Loader2 } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';

/**
 * The only place that admits what the transport is doing. Silent failures are
 * how people lose work; this stays quiet while everything is healthy.
 */
export function SyncStatus() {
  const syncState = useData((s) => s.syncState);
  const remoteUpdatedAt = useData((s) => s.remoteUpdatedAt);
  const resolveConflict = useData((s) => s.resolveConflict);
  const mergeConflict = useData((s) => s.mergeConflict);
  const refresh = useData((s) => s.refresh);
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<'local' | 'remote' | 'merge' | null>(null);

  // A conflict is the strongest signal; otherwise a remote change deserves a
  // quieter but visible notice.
  const state = syncState === 'conflict' ? 'conflict' : remoteUpdatedAt ? 'remote' : syncState;
  if (state === 'idle' || state === 'saved') return null;

  const label =
    state === 'saving'
      ? t('Saving…')
      : state === 'offline'
        ? t('Saved in this browser only')
        : state === 'remote'
          ? t('Updated elsewhere')
          : t('Changed elsewhere');

  const icon =
    state === 'saving' ? (
      <Loader2 size={11} className="animate-spin" />
    ) : state === 'offline' ? (
      <CloudOff size={11} />
    ) : (
      <AlertTriangle size={11} />
    );

  return (
    <div className="relative">
      <button
        type="button"
        data-sync-status={state}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-[26px] items-center gap-1.5 rounded-r6 px-1.5 text-[12px] transition-colors',
          state === 'conflict' || state === 'remote'
            ? 'text-[var(--orange)] hover:bg-[var(--bg-hover)]'
            : state === 'offline'
              ? 'text-[var(--red)] hover:bg-[var(--bg-hover)]'
              : 'text-t4',
        )}
        aria-live="polite"
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-[690]" onMouseDown={() => setOpen(false)} />
          <div
            data-sync-panel
            className="absolute right-0 top-[32px] z-[700] w-[310px] rounded-r10 bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-pop)]"
          >
            {state === 'conflict' ? (
              <>
                <p className="text-[13px] font-[510] text-t1">{t('This workspace changed somewhere else')}</p>
                <p className="mt-1 text-[12px] leading-[1.55] text-t3">
                  {t('Nothing was overwritten. Merge both sides, keep what you have here, or load the newer server copy.')}
                </p>
                <div className="mt-2.5 flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy('merge');
                      await mergeConflict();
                      setBusy(null);
                      setOpen(false);
                    }}
                    className="flex h-[30px] items-center justify-center gap-1.5 rounded-r6 bg-[var(--accent)] text-[12.5px] font-[510] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    {busy === 'merge' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    {t('Merge both sides')}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy('local');
                      await resolveConflict('local');
                      setBusy(null);
                      setOpen(false);
                    }}
                    className="flex h-[30px] items-center justify-center rounded-r6 text-[12.5px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
                  >
                    {busy === 'local' ? <Loader2 size={11} className="animate-spin" /> : null}
                    {t('Keep my changes')}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy('remote');
                      await resolveConflict('remote');
                      setBusy(null);
                      setOpen(false);
                    }}
                    className="flex h-[30px] items-center justify-center rounded-r6 text-[12.5px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
                  >
                    {t('Load the server version')}
                  </button>
                </div>
              </>
            ) : state === 'remote' ? (
              <>
                <p className="text-[13px] font-[510] text-t1">{t('Another tab or device changed this workspace')}</p>
                <p className="mt-1 text-[12px] leading-[1.55] text-t3">
                  {t('You have local changes too. Merge both, or load the newer copy and drop yours.')}
                </p>
                <div className="mt-2.5 flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy('merge');
                      await mergeConflict();
                      setBusy(null);
                      setOpen(false);
                    }}
                    className="flex h-[30px] items-center justify-center gap-1.5 rounded-r6 bg-[var(--accent)] text-[12.5px] font-[510] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    {busy === 'merge' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    {t('Merge both sides')}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy('remote');
                      await refresh(true);
                      setBusy(null);
                      setOpen(false);
                    }}
                    className="flex h-[30px] items-center justify-center rounded-r6 text-[12.5px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
                  >
                    {t('Load the server version')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13px] font-[510] text-t1">
                  {state === 'offline' ? t('The server is unreachable') : t('Saving your changes')}
                </p>
                <p className="mt-1 text-[12px] leading-[1.55] text-t3">
                  {state === 'offline'
                    ? t('Your edits are kept in this browser and retried when the server answers.')
                    : t('They will be written to the workspace file in a moment.')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void refresh(true);
                    setOpen(false);
                  }}
                  className="mt-2.5 flex h-[28px] w-full items-center justify-center rounded-r6 text-[12.5px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  {t('Retry now')}
                </button>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

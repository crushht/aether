'use client';

import * as React from 'react';
import { Download, Eye, History, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { Button } from '@/components/ui/primitives';
import { diffBackup, diffSummary, type BackupDiff } from '@/lib/backup-diff';

interface Backup {
  version?: number;
  exportedAt?: string;
  issues?: unknown;
  labels?: unknown;
  projects?: unknown;
  cycles?: unknown;
  notifications?: unknown;
}

interface AutoBackup {
  id: string;
  at: string;
  bytes: number;
  issues?: number;
  projects?: number;
}

/**
 * JSON backup of the whole workspace. The server file is the source of truth,
 * but a file the user can hold makes migrations and "oops" moments survivable.
 */
export function WorkspaceTransfer({ description }: { description: string }) {
  const t = useT();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const pushToast = useUI((s) => s.pushToast);
  const [backups, setBackups] = React.useState<AutoBackup[]>([]);
  const [preview, setPreview] = React.useState<{
    id: string;
    diff: BackupDiff;
    counts: { issues: number; projects: number };
  } | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState('');
  const [restoring, setRestoring] = React.useState('');

  const loadBackups = React.useCallback(async () => {
    try {
      const response = await fetch('/api/workspace/backups', { cache: 'no-store' });
      const json = (await response.json()) as { ok?: boolean; backups?: AutoBackup[] };
      if (json.ok && Array.isArray(json.backups)) setBackups(json.backups);
    } catch {
      /* the list is optional */
    }
  }, []);

  React.useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const createBackup = async () => {
    try {
      const response = await fetch('/api/workspace/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      });
      if (!response.ok) {
        pushToast({ title: t('Could not create a backup.'), tone: 'danger' });
        return;
      }
      const json = (await response.json()) as { backups?: AutoBackup[] };
      if (Array.isArray(json.backups)) setBackups(json.backups);
      pushToast({ title: t('Backup created'), tone: 'success' });
    } catch {
      pushToast({ title: t('Could not create a backup.'), tone: 'danger' });
    }
  };

  const removeBackup = async (id: string) => {
    if (!window.confirm(t('Delete this backup?'))) return;
    try {
      const response = await fetch(`/api/workspace/backups?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        pushToast({ title: t('Could not delete that backup.'), tone: 'danger' });
        return;
      }
      await loadBackups();
      pushToast({ title: t('Backup deleted'), tone: 'success' });
    } catch {
      pushToast({ title: t('Could not delete that backup.'), tone: 'danger' });
    }
  };

  /** Show what restoring would add or drop, before anything is overwritten. */
  const previewBackup = async (id: string) => {
    if (preview?.id === id) {
      setPreview(null);
      return;
    }
    setPreviewBusy(id);
    try {
      const response = await fetch(`/api/workspace/backups?preview=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        preview?: { issues?: string[]; projects?: string[]; counts?: { issues: number; projects: number } };
      };
      if (!response.ok || !json.ok || !json.preview) {
        pushToast({ title: t(json.error ?? 'Could not read that backup.'), tone: 'danger' });
        return;
      }
      const live = useData.getState();
      const diff = diffBackup(
        {
          issues: (json.preview.issues ?? []).map((key) => ({ key })),
          projects: (json.preview.projects ?? []).map((name) => ({ name })),
        },
        { issues: live.issues, projects: live.projects },
      );
      setPreview({
        id,
        diff,
        counts: {
          issues: json.preview.counts?.issues ?? 0,
          projects: json.preview.counts?.projects ?? 0,
        },
      });
    } finally {
      setPreviewBusy('');
    }
  };

  const restore = async (id: string) => {    if (!window.confirm(t('Restore this backup? It replaces the current workspace.'))) return;
    setRestoring(id);
    try {
      const response = await fetch('/api/workspace/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        pushToast({ title: t(json.error ?? 'Could not restore that backup.'), tone: 'danger' });
        return;
      }
      await useData.getState().refresh();
      pushToast({ title: t('Backup restored'), tone: 'success' });
      await loadBackups();
    } finally {
      setRestoring('');
    }
  };

  const exportWorkspace = () => {
    const state = useData.getState();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      issues: state.issues,
      labels: state.labels,
      projects: state.projects,
      cycles: state.cycles,
      notifications: state.notifications,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aether-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    pushToast({ title: t('Workspace exported'), description: t('{n} issues in the file', { n: state.issues.length }) });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Backup;
      if (!Array.isArray(parsed.issues) || !Array.isArray(parsed.labels) || !Array.isArray(parsed.projects)) {
        throw new Error(t('That file is not a workspace backup.'));
      }
      useData.getState().replaceWorkspace({
        issues: parsed.issues as never,
        labels: parsed.labels as never,
        projects: parsed.projects as never,
        cycles: Array.isArray(parsed.cycles) ? (parsed.cycles as never) : [],
        notifications: Array.isArray(parsed.notifications) ? (parsed.notifications as never) : [],
      });
      pushToast({
        title: t('Workspace imported'),
        description: t('{n} issues restored', { n: (parsed.issues as unknown[]).length }),
      });
    } catch (error) {
      pushToast({
        title: t('Import failed'),
        description: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-6 border-b border-[var(--line-subtle)] py-3">
        <div className="min-w-0">
          <div className="text-[14px] font-[510] text-t2">{t('Backup')}</div>
          <div className="mt-0.5 text-[13px] leading-[1.5] text-t4">{description}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={exportWorkspace}>
            <Download size={12} strokeWidth={2} />
            {t('Export JSON')}
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => inputRef.current?.click()}>
            <Upload size={12} strokeWidth={2} />
            {t('Import')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-workspace-import
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <div data-workspace-backups className="border-b border-[var(--line-subtle)] py-3">
        <div className="flex items-center gap-2">
          <History size={13} strokeWidth={1.9} className="text-t4" />
          <div className="text-[14px] font-[510] text-t2">{t('Automatic backups')}</div>
          <span className="text-[11.5px] text-t4">{backups.length}</span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="gap-1.5" data-backup-now onClick={() => void createBackup()}>
            <History size={11} strokeWidth={2} />
            {t('Back up now')}
          </Button>
        </div>
        {backups.length ? (
          <ul className="mt-1.5 flex flex-col">
            {backups.slice(0, 6).map((backup) => (
              <li key={backup.id} data-auto-backup={backup.id} className="border-b border-[var(--line-subtle)] py-1.5 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[12.5px] text-t3">
                    {new Date(backup.at).toLocaleString()}
                    {typeof backup.issues === 'number' ? (
                      <span className="ml-1.5 text-[11px] text-t4">
                        · {t('{n} issues', { n: backup.issues })}
                        {typeof backup.projects === 'number' ? ` · ${t('{n} projects', { n: backup.projects })}` : ''}
                      </span>
                    ) : null}
                  </span>
                  <span className="tnum text-[11.5px] text-t4">{Math.max(1, Math.round(backup.bytes / 1024))} KB</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    data-preview-backup={backup.id}
                    disabled={previewBusy === backup.id}
                    onClick={() => void previewBackup(backup.id)}
                  >
                    <Eye size={11} strokeWidth={1.9} />
                    {t('Preview')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={restoring === backup.id}
                    onClick={() => void restore(backup.id)}
                  >
                    <RotateCcw size={11} strokeWidth={2} />
                    {t('Restore')}
                  </Button>
                <button
                  type="button"
                  data-delete-backup={backup.id}
                  aria-label={t('Delete backup')}
                  onClick={() => void removeBackup(backup.id)}
                  className="grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                >
                  <Trash2 size={11} />
                </button>
                </div>
                {preview?.id === backup.id ? (
                  <div
                    data-backup-diff={backup.id}
                    className="mt-1.5 rounded-r6 bg-[var(--bg-hover)] px-2 py-1.5 text-[11.5px] text-t3"
                  >
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>
                        {t('Issues')}: <span className="text-[var(--green)]">+{preview.diff.issues.added.length}</span>
                        {' / '}
                        <span className="text-[var(--red)]">-{preview.diff.issues.removed.length}</span>
                        {` / ${preview.diff.issues.common} ${t('shared')}`}
                      </span>
                      <span>
                        {t('Projects')}: <span className="text-[var(--green)]">+{preview.diff.projects.added.length}</span>
                        {' / '}
                        <span className="text-[var(--red)]">-{preview.diff.projects.removed.length}</span>
                        {` / ${preview.diff.projects.common} ${t('shared')}`}
                      </span>
                    </div>
                    {diffSummary(preview.diff).map((line) => (
                      <div key={line} className="mt-0.5 truncate font-mono text-[10.5px] text-t4">
                        {line}
                      </div>
                    ))}
                    {!preview.diff.issues.added.length && !preview.diff.issues.removed.length && !preview.diff.projects.added.length && !preview.diff.projects.removed.length ? (
                      <div className="text-[11px] text-t4">{t('Nothing would change.')}</div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-t4">{t('No automatic backups yet.')}</p>
        )}
      </div>
    </>
  );
}

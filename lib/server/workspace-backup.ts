import fs from 'node:fs/promises';
import path from 'node:path';
import { filePath } from './store';

const MAX_BACKUPS = 10;
const DIR = 'workspace-backups';

/** How often a snapshot is copied aside; a burst of edits keeps one copy. */
const intervalMs = () => {
  const raw = Number(process.env.AETHER_BACKUP_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
};

const lastBackup = new Map<string, number>();

const safeName = (name: string) => name.replace(/[\\/]/g, '_');

export interface BackupEntry {
  id: string;
  at: string;
  bytes: number;
  /** snapshot size, so a restore can be judged before it happens */
  issues?: number;
  projects?: number;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** Copy a snapshot aside, pruning to the newest MAX_BACKUPS for that file. */
export async function backupWorkspace(name: string, snapshot: unknown): Promise<void> {
  const dir = filePath(DIR);
  await fs.mkdir(dir, { recursive: true });
  const prefix = `${safeName(name)}.`;
  const file = path.join(dir, `${prefix}${stamp()}.json`);
  await fs.writeFile(file, JSON.stringify(snapshot), 'utf8');
  const files = (await fs.readdir(dir)).filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    await fs.unlink(path.join(dir, old)).catch(() => undefined);
  }
}

/** Back up at most once per interval; the first write after a restart counts. */
export async function maybeBackupWorkspace(name: string, snapshot: unknown): Promise<boolean> {
  const now = Date.now();
  if (now - (lastBackup.get(name) ?? 0) < intervalMs()) return false;
  lastBackup.set(name, now);
  await backupWorkspace(name, snapshot);
  return true;
}

export async function listWorkspaceBackups(name: string): Promise<BackupEntry[]> {
  const dir = filePath(DIR);
  const prefix = `${safeName(name)}.`;
  try {
    const files = (await fs.readdir(dir)).filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json')).sort().reverse();
    return Promise.all(
      files.map(async (entry) => {
        const full = path.join(dir, entry);
        const stat = await fs.stat(full);
        const id = entry.slice(prefix.length, -'.json'.length);
        let issues: number | undefined;
        let projects: number | undefined;
        try {
          const parsed = JSON.parse(await fs.readFile(full, 'utf8')) as { issues?: unknown; projects?: unknown };
          if (Array.isArray(parsed.issues)) issues = parsed.issues.length;
          if (Array.isArray(parsed.projects)) projects = parsed.projects.length;
        } catch {
          /* an unreadable backup still lists so it can be deleted */
        }
        return {
          id,
          at: id.replace(/-/g, (match, offset) => (offset === 4 || offset === 7 ? '-' : match)),
          bytes: stat.size,
          ...(issues === undefined ? {} : { issues }),
          ...(projects === undefined ? {} : { projects }),
        };
      }),
    );
  } catch {
    return [];
  }
}

/** Read one backup by id; null when it is missing or not a JSON object. */
export async function readWorkspaceBackup(name: string, id: string): Promise<unknown | null> {
  if (!/^[\dTZ-]+$/.test(id)) return null;
  try {
    const raw = await fs.readFile(filePath(DIR, `${safeName(name)}.${id}.json`), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function deleteWorkspaceBackup(name: string, id: string): Promise<boolean> {
  if (!/^[\dTZ-]+$/.test(id)) return false;
  try {
    await fs.unlink(filePath(DIR, `${safeName(name)}.${id}.json`));
    return true;
  } catch {
    return false;
  }
}

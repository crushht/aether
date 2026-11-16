import { NextResponse } from 'next/server';
import { readJson, withLock, writeJson } from '@/lib/server/store';
import { requireUser } from '@/lib/server-auth';
import { publishWorkspaceChange } from '@/lib/server/workspace-events';
import {
  backupWorkspace,
  deleteWorkspaceBackup,
  listWorkspaceBackups,
  readWorkspaceBackup,
} from '@/lib/server/workspace-backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERSONAL = process.env.WORKSPACE_MODE === 'personal';
const fileFor = (userId: string) => (PERSONAL ? `workspaces/${userId}.json` : 'workspace.json');

const EMPTY = {
  issues: [] as unknown[],
  labels: [] as unknown[],
  projects: [] as unknown[],
  cycles: [] as unknown[],
  notifications: [] as unknown[],
  updatedAt: 0,
};
type Snapshot = typeof EMPTY;

function sanitize(raw: Partial<Snapshot>): Snapshot {
  return {
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    cycles: Array.isArray(raw.cycles) ? raw.cycles : [],
    notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

/** Automatic workspace snapshots, newest first; `?preview=<id>` describes one. */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const name = fileFor(account.id);

  const previewId = new URL(request.url).searchParams.get('preview');
  if (previewId) {
    const backup = await readWorkspaceBackup(name, previewId);
    if (!backup) return NextResponse.json({ ok: false, error: 'Backup not found.' }, { status: 404 });
    const snapshot = sanitize(backup as Partial<Snapshot>);
    return NextResponse.json({
      ok: true,
      preview: {
        updatedAt: snapshot.updatedAt,
        issues: snapshot.issues.map((issue) => (issue as { key?: string }).key ?? '').filter(Boolean),
        projects: snapshot.projects.map((project) => (project as { name?: string }).name ?? '').filter(Boolean),
        counts: {
          issues: snapshot.issues.length,
          projects: snapshot.projects.length,
          labels: snapshot.labels.length,
          cycles: snapshot.cycles.length,
        },
      },
    });
  }

  return NextResponse.json({ ok: true, backups: await listWorkspaceBackups(name) });
}

/** Restore one backup. The current snapshot is copied aside first. */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!PERSONAL && account.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'Only the workspace owner can restore a backup.' }, { status: 403 });
  }

  let body: { id?: string; action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  const name = fileFor(account.id);

  // "create" keeps a copy of the current snapshot right now (no throttle).
  if (body.action === 'create') {
    return withLock(name, async () => {
      const current = await readJson<Snapshot>(name, EMPTY).then(sanitize);
      await backupWorkspace(name, current);
      return NextResponse.json({ ok: true, backups: await listWorkspaceBackups(name) });
    });
  }

  const id = String(body.id ?? '');
  const backup = await readWorkspaceBackup(name, id);
  if (!backup) return NextResponse.json({ ok: false, error: 'Backup not found.' }, { status: 404 });

  return withLock(name, async () => {
    const current = await readJson<Snapshot>(name, EMPTY).then(sanitize);
    await backupWorkspace(name, current).catch(() => undefined);
    const restored: Snapshot = { ...sanitize(backup as Partial<Snapshot>), updatedAt: Date.now() };
    await writeJson(name, restored);
    publishWorkspaceChange({ scope: PERSONAL ? account.id : 'shared', updatedAt: restored.updatedAt, actorId: account.id });
    return NextResponse.json({ ok: true, updatedAt: restored.updatedAt });
  });
}

/** Remove one automatic backup. */
export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!PERSONAL && account.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'Only the workspace owner can remove backups.' }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const removed = await deleteWorkspaceBackup(fileFor(account.id), id);
  if (!removed) return NextResponse.json({ ok: false, error: 'Backup not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

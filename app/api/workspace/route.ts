import { NextResponse } from 'next/server';
import { readJson, withLock, writeJson } from '@/lib/server/store';
import { requireUser } from '@/lib/server-auth';
import { publishWorkspaceChange } from '@/lib/server/workspace-events';
import { maybeBackupWorkspace } from '@/lib/server/workspace-backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The workspace snapshot.
 *
 * - `WORKSPACE_MODE=shared` (default): one team workspace, every account reads
 *   and writes the same file — what a Linear workspace actually is.
 * - `WORKSPACE_MODE=personal`: each account gets its own snapshot, so the
 *   install behaves like a private per-person tracker.
 *
 * Writes are whole-snapshot with a version check: a client that started from an
 * older `updatedAt` gets 409 instead of silently overwriting someone's work.
 */
const PERSONAL = process.env.WORKSPACE_MODE === 'personal';

const EMPTY = {
  issues: [] as unknown[],
  labels: [] as unknown[],
  projects: [] as unknown[],
  cycles: [] as unknown[],
  notifications: [] as unknown[],
  updatedAt: 0,
};

type Snapshot = typeof EMPTY;

const fileFor = (userId: string) => (PERSONAL ? `workspaces/${userId}.json` : 'workspace.json');

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

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const snapshot = await readJson<Snapshot>(fileFor(account.id), EMPTY).then(sanitize);
  const since = Number(new URL(request.url).searchParams.get('since') ?? 0);

  // cheap poll: the client already holds this version
  if (since && snapshot.updatedAt <= since) {
    return NextResponse.json({ ok: true, unchanged: true, updatedAt: snapshot.updatedAt, server: true });
  }

  return NextResponse.json({ ...snapshot, server: true, mode: PERSONAL ? 'personal' : 'shared' });
}

export async function PUT(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: Partial<Snapshot> & { baseVersion?: number };
  try {
    body = (await request.json()) as Partial<Snapshot> & { baseVersion?: number };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { issues, labels, projects, cycles, notifications } = body;
  if (!Array.isArray(issues) || !Array.isArray(labels) || !Array.isArray(projects) || !Array.isArray(cycles) || !Array.isArray(notifications)) {
    return NextResponse.json(
      { ok: false, error: 'issues, labels, projects, cycles and notifications must be arrays.' },
      { status: 400 },
    );
  }

  const name = fileFor(account.id);
  return withLock(name, async () => {
    const current = await readJson<Snapshot>(name, EMPTY).then(sanitize);
    // a stale write must not clobber; the client then refetches and retries
    if (typeof body.baseVersion === 'number' && current.updatedAt > body.baseVersion) {
      return NextResponse.json(
        { ok: false, conflict: true, updatedAt: current.updatedAt, error: 'Workspace changed on the server.' },
        { status: 409 },
      );
    }

    const snapshot: Snapshot = {
      issues,
      labels,
      projects,
      cycles,
      notifications,
      updatedAt: Date.now(),
    };

    try {
      // keep a periodic copy of what was there before overwriting it
      await maybeBackupWorkspace(name, current).catch(() => undefined);
      await writeJson(name, snapshot);
      publishWorkspaceChange({
        scope: PERSONAL ? account.id : 'shared',
        updatedAt: snapshot.updatedAt,
        actorId: account.id,
      });
      return NextResponse.json({ ok: true, updatedAt: snapshot.updatedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  });
}

/** `DELETE` wipes this account's workspace (personal mode) or the shared one. */
export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!PERSONAL && account.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'Only the workspace owner can reset it.' }, { status: 403 });
  }
  await writeJson(fileFor(account.id), EMPTY);
  publishWorkspaceChange({
    scope: PERSONAL ? account.id : 'shared',
    updatedAt: Date.now(),
    actorId: account.id,
  });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import {
  destroyOtherUserSessions,
  destroyUserSession,
  listUserSessions,
} from '@/lib/server/accounts';
import { requireUser, sessionTokenOf } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sessions signed in to this account. Tokens are never returned. */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const sessions = await listUserSessions(account.id, sessionTokenOf(request));
  return NextResponse.json({ ok: true, sessions, local: !sessionTokenOf(request) });
}

/** `?id=` revokes one session; `?others=1` signs out everywhere else. */
export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if (params.get('others') === '1') {
    const removed = await destroyOtherUserSessions(account.id, sessionTokenOf(request));
    return NextResponse.json({ ok: true, removed });
  }
  const id = params.get('id') ?? '';
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
  const removed = await destroyUserSession(account.id, id);
  if (!removed) return NextResponse.json({ ok: false, error: 'Session not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, removed: 1 });
}

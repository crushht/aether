import { NextResponse } from 'next/server';
import { publicUsers, removeAccount, updateAccount } from '@/lib/server/accounts';
import { requireUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who is in this workspace (public projection only). */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  return NextResponse.json({ ok: true, users: await publicUsers() });
}

/** Edit a member: yourself always, someone else only when you own the workspace. */
export async function PATCH(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { id?: string; name?: string; handle?: string; color?: string; role?: 'owner' | 'member' };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const targetId = body.id ?? account.id;
  if (targetId !== account.id && account.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'Only the workspace owner can edit other people.' }, { status: 403 });
  }

  // role changes stay owner-only even for yourself (no self-promotion)
  const patch =
    targetId === account.id && account.role !== 'owner'
      ? { name: body.name, handle: body.handle, color: body.color }
      : { name: body.name, handle: body.handle, color: body.color, role: body.role };

  // never leave the workspace without an owner
  if (body.role === 'member') {
    const users = await publicUsers();
    const target = users.find((user) => user.id === targetId);
    const owners = users.filter((user) => user.role === 'owner').length;
    if (target?.role === 'owner' && owners <= 1) {
      return NextResponse.json({ ok: false, error: 'Keep at least one owner.' }, { status: 403 });
    }
  }

  const updated = await updateAccount(targetId, patch);
  if (!updated) return NextResponse.json({ ok: false, error: 'Member not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, user: updated, users: await publicUsers() });
}

export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id') ?? '';
  const result = await removeAccount(account, id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, users: await publicUsers() });
}

import { NextResponse } from 'next/server';
import {
  changePassword,
  createSession,
  destroyOtherUserSessions,
  destroySession,
  login,
  updateAccount,
} from '@/lib/server/accounts';
import { authState, clearedCookie, requireUser, sessionCookie, sessionTokenOf } from '@/lib/server-auth';
import { clearRateLimit, rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isSecure = (request: Request) => new URL(request.url).protocol === 'https:';

/** `{ authenticated, user, users, needsSetup }` — the client gate asks this once. */
export async function GET(request: Request) {
  const account = await requireUser(request);
  return NextResponse.json(await authState(account));
}

/** Sign in with email + password. */
export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const limitKey = `login:${ip}`;
  const limit = rateLimit(limitKey);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many sign-in attempts. Try again in a minute.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }
  const result = await login({ email: body.email, password: body.password, ip });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  clearRateLimit(limitKey);

  const token = await createSession(result.account.id, {
    ua: request.headers.get('user-agent') ?? '',
    ip,
  });
  const response = NextResponse.json({ ok: true, ...(await authState(result.account)) });
  response.cookies.set(sessionCookie(token, isSecure(request)));
  return response;
}

/** Update the signed-in account (display name, handle, colour, password). */
export async function PATCH(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: {
    name?: string;
    handle?: string;
    color?: string;
    currentPassword?: string;
    newPassword?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body.newPassword) {
    const changed = await changePassword(account.id, body.currentPassword ?? '', body.newPassword);
    if (!changed.ok) return NextResponse.json({ ok: false, error: changed.error }, { status: 400 });
    // a new password invalidates every other browser; this one stays signed in
    await destroyOtherUserSessions(account.id, sessionTokenOf(request));
  }

  if (body.name !== undefined || body.handle !== undefined || body.color !== undefined) {
    await updateAccount(account.id, { name: body.name, handle: body.handle, color: body.color });
  }

  const next = await requireUser(request);
  return NextResponse.json({ ok: true, ...(await authState(next)) });
}

/** Sign out: revoke the session row and drop the cookie. */
export async function DELETE(request: Request) {
  await destroySession(sessionTokenOf(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearedCookie);
  return response;
}

import { NextResponse } from 'next/server';
import {
  accountByEmail,
  changePassword,
  createSession,
  destroyOtherUserSessions,
  destroySession,
  login,
  loginWithEmailCode,
  updateAccount,
} from '@/lib/server/accounts';
import { authState, clearedCookie, requireUser, sessionCookie, sessionTokenOf } from '@/lib/server-auth';
import { clearRateLimit, rateLimit } from '@/lib/server/rate-limit';
import { recordSecurityEvent } from '@/lib/server/security-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isSecure = (request: Request) => new URL(request.url).protocol === 'https:';

/** `{ authenticated, user, users, needsSetup }` — the client gate asks this once. */
export async function GET(request: Request) {
  const account = await requireUser(request);
  return NextResponse.json(await authState(account));
}

/**
 * Sign in. Two ways in, one route:
 *   `{ email, password }`       — the password
 *   `{ email, code }`           — the six digits mailed by /api/auth/email-code
 */
export async function POST(request: Request) {
  let body: { email?: string; password?: string; code?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string; code?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const ua = request.headers.get('user-agent') ?? '';
  const byCode = typeof body.code === 'string' && body.code.trim().length > 0 && !body.password;
  const method = byCode ? 'email code' : 'password';
  const limitKey = `login:${ip}`;
  const limit = rateLimit(limitKey);
  if (!limit.ok) {
    await recordSecurityEvent({
      kind: 'sign_in',
      ok: false,
      actorEmail: body.email,
      ip,
      ua,
      detail: `rate limited · ${method}`,
    });
    return NextResponse.json(
      { ok: false, error: 'Too many sign-in attempts. Try again in a minute.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }
  const result = byCode
    ? await loginWithEmailCode({ email: body.email, code: body.code, ip })
    : await login({ email: body.email, password: body.password, ip });
  if (!result.ok) {
    // the address may or may not exist here; attribute the refusal when it does
    const known = await accountByEmail(body.email ?? '').catch(() => null);
    await recordSecurityEvent({
      kind: 'sign_in',
      ok: false,
      actorId: known?.id,
      actorName: known?.name,
      actorEmail: body.email,
      ip,
      ua,
      detail: `${result.error} · ${method}`,
    });
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  clearRateLimit(limitKey);

  await recordSecurityEvent({
    kind: 'sign_in',
    ok: true,
    actorId: result.account.id,
    actorName: result.account.name,
    actorEmail: result.account.email,
    ip,
    ua,
    detail: method,
  });

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
    if (!changed.ok) {
      await recordSecurityEvent({
        kind: 'password_change',
        ok: false,
        actorId: account.id,
        actorName: account.name,
        actorEmail: account.email,
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local',
        ua: request.headers.get('user-agent') ?? '',
        detail: changed.error,
      });
      return NextResponse.json({ ok: false, error: changed.error }, { status: 400 });
    }
    // a new password invalidates every other browser; this one stays signed in
    await destroyOtherUserSessions(account.id, sessionTokenOf(request));
    await recordSecurityEvent({
      kind: 'password_change',
      ok: true,
      actorId: account.id,
      actorName: account.name,
      actorEmail: account.email,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local',
      ua: request.headers.get('user-agent') ?? '',
      detail: 'other sessions signed out',
    });
  }

  if (body.name !== undefined || body.handle !== undefined || body.color !== undefined) {
    await updateAccount(account.id, { name: body.name, handle: body.handle, color: body.color });
  }

  const next = await requireUser(request);
  return NextResponse.json({ ok: true, ...(await authState(next)) });
}

/** Sign out: revoke the session row and drop the cookie. */
export async function DELETE(request: Request) {
  const account = await requireUser(request);
  await destroySession(sessionTokenOf(request));
  if (account) {
    await recordSecurityEvent({
      kind: 'sign_out',
      ok: true,
      actorId: account.id,
      actorName: account.name,
      actorEmail: account.email,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local',
      ua: request.headers.get('user-agent') ?? '',
      detail: 'signed out this browser',
    });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearedCookie);
  return response;
}

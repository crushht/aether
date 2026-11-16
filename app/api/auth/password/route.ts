import { NextResponse } from 'next/server';
import { accountByEmail, createSession, resetPasswordWithCode } from '@/lib/server/accounts';
import { authState, sessionCookie } from '@/lib/server-auth';
import { rateLimit } from '@/lib/server/rate-limit';
import { recordSecurityEvent } from '@/lib/server/security-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Set a new password with a mailed code.
 *
 * Every other session is revoked first (a reset usually follows "I think
 * someone else got in"), then this browser gets a fresh one.
 */
export async function POST(request: Request) {
  let body: { email?: string; code?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const ua = request.headers.get('user-agent') ?? '';
  const limited = rateLimit(`password-reset:${ip}`, 10, 10 * 60_000);
  if (!limited.ok) {
    await recordSecurityEvent({
      kind: 'password_reset',
      ok: false,
      actorEmail: body.email,
      ip,
      ua,
      detail: 'rate limited',
    });
    return NextResponse.json(
      { ok: false, error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const result = await resetPasswordWithCode(body);
  if (!result.ok) {
    const known = await accountByEmail(body.email ?? '').catch(() => null);
    await recordSecurityEvent({
      kind: 'password_reset',
      ok: false,
      actorId: known?.id,
      actorName: known?.name,
      actorEmail: body.email,
      ip,
      ua,
      detail: result.error,
    });
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const account = await accountByEmail(body.email ?? '');
  if (!account) return NextResponse.json({ ok: true, authenticated: false });

  await recordSecurityEvent({
    kind: 'password_reset',
    ok: true,
    actorId: account.id,
    actorName: account.name,
    actorEmail: account.email,
    ip,
    ua,
    detail: 'all sessions revoked, new session issued',
  });

  const token = await createSession(account.id, { ua, ip });
  const response = NextResponse.json({ ok: true, ...(await authState(account)) });
  response.cookies.set(sessionCookie(token, new URL(request.url).protocol === 'https:'));
  return response;
}

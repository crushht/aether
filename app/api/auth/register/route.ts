import { NextResponse } from 'next/server';
import { accountByEmail, createSession, register } from '@/lib/server/accounts';
import { authState, sessionCookie } from '@/lib/server-auth';
import { recordSecurityEvent } from '@/lib/server/security-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Create an account. The first account becomes the workspace owner; later
 * ones need the instance invite code when SIGNUP_CODE (or the legacy
 * WORKSPACE_PASSWORD) is set.
 */
export async function POST(request: Request) {
  let body: { name?: string; email?: string; password?: string; code?: string; emailCode?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await register(body);
  if (!result.ok) {
    // the address may already belong to someone: attribute the refusal then
    const known = await accountByEmail(body.email ?? '').catch(() => null);
    await recordSecurityEvent({
      kind: 'register',
      ok: false,
      actorId: known?.id,
      actorName: known?.name,
      actorEmail: body.email,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local',
      ua: request.headers.get('user-agent') ?? '',
      detail: result.error,
    });
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  await recordSecurityEvent({
    kind: 'register',
    ok: true,
    actorId: result.account.id,
    actorName: result.account.name,
    actorEmail: result.account.email,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local',
    ua: request.headers.get('user-agent') ?? '',
    detail: `role=${result.account.role}`,
  });

  const token = await createSession(result.account.id, {
    ua: request.headers.get('user-agent') ?? '',
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local',
  });
  const response = NextResponse.json({ ok: true, ...(await authState(result.account)) });
  response.cookies.set(sessionCookie(token, new URL(request.url).protocol === 'https:'));
  return response;
}

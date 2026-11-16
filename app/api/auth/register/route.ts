import { NextResponse } from 'next/server';
import { createSession, register } from '@/lib/server/accounts';
import { authState, sessionCookie } from '@/lib/server-auth';

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
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

  const token = await createSession(result.account.id, {
    ua: request.headers.get('user-agent') ?? '',
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local',
  });
  const response = NextResponse.json({ ok: true, ...(await authState(result.account)) });
  response.cookies.set(sessionCookie(token, new URL(request.url).protocol === 'https:'));
  return response;
}

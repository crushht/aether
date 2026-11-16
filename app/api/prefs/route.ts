import { NextResponse } from 'next/server';
import { readPrefs, writePrefs } from '@/lib/server/accounts';
import { requireUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Per-account preferences. Keeping the inbox read state here (rather than in
 * the shared workspace snapshot) is what makes "读过了" mean *this* person.
 */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  return NextResponse.json({ ok: true, prefs: await readPrefs(account.id) });
}

export async function PATCH(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const prefs = await writePrefs(account.id, {
    theme: body.theme === 'light' || body.theme === 'dark' ? body.theme : undefined,
    locale: body.locale === 'en' || body.locale === 'zh' ? body.locale : undefined,
    sidebarCollapsed: typeof body.sidebarCollapsed === 'boolean' ? body.sidebarCollapsed : undefined,
    readNotifications: Array.isArray(body.readNotifications)
      ? (body.readNotifications.filter((id) => typeof id === 'string') as string[])
      : undefined,
    display:
      body.display && typeof body.display === 'object' ? (body.display as Record<string, boolean>) : undefined,
  });

  return NextResponse.json({ ok: true, prefs });
}

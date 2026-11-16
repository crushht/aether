import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/server/rate-limit';
import { requireUser } from '@/lib/server-auth';
import { effectiveSearchSettings } from '@/lib/server/search-settings';
import { searchWeb } from '@/lib/server/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Agent-side web search. The agent calls it as a tool; the endpoint is also
 * usable by hand. Rate limited per account because every call leaves the host.
 */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const limited = rateLimit(`web-search:${account.id}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many searches in a minute. Wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  let body: { query?: string; limit?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    // The source is a setting (settings page → Web search), not only an
    // environment variable: read it per request so saving applies immediately.
    const { settings, source } = await effectiveSearchSettings();
    const result = await searchWeb(body.query ?? '', Number(body.limit) || 6, settings);
    return NextResponse.json({ ok: true, source, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'The search failed.' },
      { status: 400 },
    );
  }
}

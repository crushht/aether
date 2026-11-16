import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';
import { rateLimit } from '@/lib/server/rate-limit';
import {
  clearSearchSettings,
  effectiveSearchSettings,
  saveSearchSettings,
  searchState,
} from '@/lib/server/search-settings';
import { validateSearchDraft } from '@/lib/search-settings';
import { searchWeb } from '@/lib/server/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where `web_search` is allowed to look, as a setting instead of `.env.local`.
 *
 * GET is readable by any signed-in member — it only names the endpoint and the
 * engine order, never a secret. Writing, and opening a connection to a
 * candidate endpoint, belongs to the workspace owner.
 *
 * Saving is enough: `/api/agent/web-search` reads the same file on its next
 * request, so the very next `web_search` uses the new source. No restart.
 */

const owner = (role: string) => role === 'owner';

async function payload(canManage: boolean) {
  return { ok: true, canManage, ...(await searchState()) };
}

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  return NextResponse.json(await payload(owner(account.role)));
}

export async function PUT(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!owner(account.role)) {
    return NextResponse.json({ ok: false, error: 'Only a workspace owner can change the search source.' }, { status: 403 });
  }

  let body: { url?: unknown; engines?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await saveSearchSettings({ url: body.url, engines: body.engines }, { updatedBy: account.email || account.name });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, errors: result.errors }, { status: 400 });
  }
  return NextResponse.json(await payload(true));
}

/** `{query}`: prove the endpoint answers before (or instead of) saving it. */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!owner(account.role)) {
    return NextResponse.json({ ok: false, error: 'Only a workspace owner can test the search source.' }, { status: 403 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const limited = rateLimit(`search-test:${ip}`, 12, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many search tests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  let body: { query?: unknown; url?: unknown; engines?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const query = (typeof body.query === 'string' ? body.query : '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'aether agent workspace';
  const draft = validateSearchDraft(
    { url: body.url, engines: body.engines },
    { base: (await effectiveSearchSettings()).settings },
  );
  if (!draft.ok) {
    return NextResponse.json({ ok: false, error: draft.errors.url ?? 'That search source is not usable.', errors: draft.errors }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await searchWeb(query, 5, draft.settings);
    return NextResponse.json({
      ok: true,
      query,
      provider: result.provider,
      elapsedMs: Date.now() - started,
      results: result.results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'The search failed.' },
      { status: 502 },
    );
  }
}

/** Back to `.env.local` (or the shipped chain). */
export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!owner(account.role)) {
    return NextResponse.json({ ok: false, error: 'Only a workspace owner can reset the search source.' }, { status: 403 });
  }
  await clearSearchSettings();
  return NextResponse.json(await payload(true));
}

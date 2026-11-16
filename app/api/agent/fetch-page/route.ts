import { NextResponse } from 'next/server';
import { readPage } from '@/lib/server/fetch-page';
import { requireUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read one public page into title + text, for attachments and the knowledge base. */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { url?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const page = await readPage(body.url ?? '');
    return NextResponse.json({ ok: true, page });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not read the page.' },
      { status: 400 },
    );
  }
}

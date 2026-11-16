import { NextResponse } from 'next/server';
import { publicAether, readAether, writeAether } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import type { ConnectorDraft } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The account's connectors. Tokens are write-only here, like provider keys. */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const store = await readAether(account.id);
  return NextResponse.json({ ok: true, connectors: publicAether(store).connectors });
}

export async function PUT(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { connectors?: ConnectorDraft[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!Array.isArray(body.connectors)) {
    return NextResponse.json({ ok: false, error: 'connectors must be an array.' }, { status: 400 });
  }

  try {
    const store = await writeAether(account.id, { connectors: body.connectors });
    return NextResponse.json({ ok: true, connectors: publicAether(store).connectors });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not save the connector.' },
      { status: 400 },
    );
  }
}

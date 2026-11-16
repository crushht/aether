import { NextResponse } from 'next/server';
import { readAether, updateAether } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import type { MemoryEntry, MemoryKind, MemoryScope } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: MemoryKind[] = ['fact', 'preference', 'decision', 'note'];
const SCOPES: MemoryScope[] = ['global', 'chat', 'issue'];

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const store = await readAether(account.id);
  return NextResponse.json({ ok: true, memory: store.memory, enabled: store.memoryEnabled });
}

/** Append one memory. Identical text is a no-op, not a duplicate row. */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: Partial<MemoryEntry> & { text?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const text = (body.text ?? '').trim().slice(0, 2_000);
  if (!text) return NextResponse.json({ ok: false, error: 'Memory text is required.' }, { status: 400 });

  const entry: MemoryEntry = {
    id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    kind: KINDS.includes(body.kind as MemoryKind) ? (body.kind as MemoryKind) : 'note',
    scope: SCOPES.includes(body.scope as MemoryScope) ? (body.scope as MemoryScope) : 'global',
    ref: typeof body.ref === 'string' ? body.ref.slice(0, 80) : undefined,
    at: Date.now(),
    source: body.source === 'agent' || body.source === 'workflow' ? body.source : 'user',
  };

  const next = await updateAether(account.id, (store) => ({
    memory: store.memory.some((item) => item.text === text) ? store.memory : [...store.memory, entry],
  }));
  return NextResponse.json({ ok: true, memory: next.memory, entry });
}

export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { id?: string; all?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* id may also come from the query string */
  }
  const url = new URL(request.url);
  const id = body.id ?? url.searchParams.get('id') ?? '';
  const next = await updateAether(account.id, (store) => ({
    memory: body.all ? [] : store.memory.filter((entry) => entry.id !== id),
  }));
  return NextResponse.json({ ok: true, memory: next.memory });
}

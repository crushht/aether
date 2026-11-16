import { NextResponse } from 'next/server';
import { readAether, updateAether } from '@/lib/server/aether';
import { readPage } from '@/lib/server/fetch-page';
import { requireUser } from '@/lib/server-auth';
import type { KnowledgeItem, KnowledgeKind } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: KnowledgeKind[] = ['note', 'web', 'file'];

const excerpt = (item: KnowledgeItem) => ({
  ...item,
  content: item.content.slice(0, 320),
  excerpt: true,
});

const newId = () => `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const cleanTags = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 8)
    : [];

/** The index travels without full bodies; `?id=` returns one entry in full. */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const store = await readAether(account.id);

  if (id) {
    const item = store.knowledge.find((entry) => entry.id === id) ?? null;
    return NextResponse.json({ ok: true, item });
  }

  let items = store.knowledge;
  if (query) {
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.content.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.includes(query)),
    );
  }

  return NextResponse.json({
    ok: true,
    total: store.knowledge.length,
    chars: store.knowledge.reduce((sum, item) => sum + item.chars, 0),
    knowledge: [...items].sort((a, b) => b.updatedAt - a.updatedAt).map(excerpt),
  });
}

export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { kind?: KnowledgeKind; title?: string; url?: string; content?: string; tags?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const kind = KINDS.includes(body.kind as KnowledgeKind) ? (body.kind as KnowledgeKind) : 'note';

  try {
    let title = (body.title ?? '').trim().slice(0, 160);
    let content = (body.content ?? '').trim();
    let sourceUrl: string | undefined;

    if (kind === 'web') {
      if (!body.url) return NextResponse.json({ ok: false, error: 'A page URL is required.' }, { status: 400 });
      const page = await readPage(body.url);
      title = title || page.title;
      content = page.text;
      sourceUrl = page.url;
    }

    if (!content) return NextResponse.json({ ok: false, error: 'The entry is empty.' }, { status: 400 });
    if (!title) {
      title = content
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean)
        ?.slice(0, 80) || 'Untitled';
    }

    const item: KnowledgeItem = {
      id: newId(),
      title,
      kind,
      url: sourceUrl,
      content,
      tags: cleanTags(body.tags),
      at: Date.now(),
      updatedAt: Date.now(),
      chars: content.length,
    };
    const next = await updateAether(account.id, (store) => ({ knowledge: [...store.knowledge, item] }));
    return NextResponse.json({ ok: true, item, total: next.knowledge.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not add the entry.' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { id?: string; title?: string; content?: string; tags?: unknown; pin?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const saved = await updateAether(account.id, (store) => {
    const existing = store.knowledge.find((item) => item.id === body.id);
    if (!existing) throw new Error('Entry not found.');
    const content = typeof body.content === 'string' ? body.content.trim() : existing.content;
    const next: KnowledgeItem = {
      ...existing,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 160) : existing.title,
      content,
      tags: body.tags !== undefined ? cleanTags(body.tags) : existing.tags,
      chars: content.length,
      updatedAt: Date.now(),
      ...(typeof body.pin === 'boolean' ? { pinnedAt: body.pin ? Date.now() : undefined } : {}),
    };
    return { knowledge: store.knowledge.map((item) => (item.id === next.id ? next : item)) };
  });
  const item = saved.knowledge.find((entry) => entry.id === body.id);
  return NextResponse.json({ ok: true, item, total: saved.knowledge.length });
}

export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id') ?? '';
  const next = await updateAether(account.id, (store) => ({
    knowledge: store.knowledge.filter((item) => item.id !== id),
  }));
  return NextResponse.json({ ok: true, total: next.knowledge.length });
}

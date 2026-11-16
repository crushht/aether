import { NextResponse } from 'next/server';
import { readJson, withLock, writeJson } from '@/lib/server/store';
import { requireUser } from '@/lib/server-auth';
import { compactMessages } from '@/lib/agent/compact';
import type { AgentLogEntry, AgentMessage, AgentUsage } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Conversation snapshots, per account. The browser still owns the live session
 * (localStorage paints instantly), but a finished turn is mirrored here so the
 * same person can continue on another machine.
 */

interface StoredChat {
  id: string;
  title: string;
  at: number;
  updatedAt: number;
  prompt?: string;
  projectId?: string | null;
  pinned?: boolean;
  log: AgentLogEntry[];
  usage?: AgentUsage;
  messages?: AgentMessage[];
  runs?: import('@/lib/agent/types').AgentRunRecord[];
  model?: string;
  provider?: string;
}

interface ChatFile {
  chats: StoredChat[];
}

const MAX_CHATS = 40;
const MAX_TEXT = 60_000;
const MAX_LOG = 400;

const chatFile = (accountId: string) => `agent-sessions/${accountId}.json`;

const trimText = (value: unknown, max = MAX_TEXT) => String(value ?? '').slice(0, max);

function cleanChat(input: StoredChat): StoredChat {
  return {
    id: String(input.id ?? '').slice(0, 80),
    title: trimText(input.title, 160),
    at: Number(input.at) || Date.now(),
    updatedAt: Date.now(),
    prompt: trimText(input.prompt, 4_000),
    projectId: typeof input.projectId === 'string' ? input.projectId.slice(0, 80) : null,
    pinned: Boolean(input.pinned),
    log: Array.isArray(input.log)
      ? input.log.slice(-MAX_LOG).map((entry) => ({
          ...entry,
          id: String(entry.id ?? '').slice(0, 80),
          text: trimText(entry.text),
          attachments: Array.isArray(entry.attachments)
            ? entry.attachments.slice(0, 6).map((file) => ({ ...file, text: trimText(file.text, 20_000), dataUrl: undefined }))
            : undefined,
        }))
      : [],
    usage: input.usage,
    runs: Array.isArray(input.runs) ? input.runs.slice(-20) : [],
    model: trimText(input.model, 160),
    provider: trimText(input.provider, 160),
    messages: Array.isArray(input.messages)
      ? compactMessages(input.messages, 60_000).map((message) => ({
          ...message,
          content: trimText(message.content, 20_000),
          images: undefined,
        }))
      : [],
  };
}

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const file = await readJson<ChatFile>(chatFile(account.id), { chats: [] });
  return NextResponse.json({ ok: true, chats: file.chats ?? [] });
}

export async function PUT(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { chat?: StoredChat };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.chat?.id) return NextResponse.json({ ok: false, error: 'A chat id is required.' }, { status: 400 });

  const saved = await withLock(chatFile(account.id), async () => {
    const file = await readJson<ChatFile>(chatFile(account.id), { chats: [] });
    const chat = cleanChat(body.chat as StoredChat);
    const chats = [chat, ...(file.chats ?? []).filter((item) => item.id !== chat.id)].slice(0, MAX_CHATS);
    await writeJson(chatFile(account.id), { chats });
    return chats;
  });

  return NextResponse.json({ ok: true, chats: saved.length });
}

export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const all = url.searchParams.get('all') === '1';
  const chats = await withLock(chatFile(account.id), async () => {
    const file = await readJson<ChatFile>(chatFile(account.id), { chats: [] });
    const next = all ? [] : (file.chats ?? []).filter((item) => item.id !== id);
    await writeJson(chatFile(account.id), { chats: next });
    return next;
  });
  return NextResponse.json({ ok: true, chats: chats.length });
}

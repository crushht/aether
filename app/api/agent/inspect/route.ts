import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { inspectArtifact } from '@/lib/agent/reverse';
import { rateLimit } from '@/lib/server/rate-limit';
import { requireUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Static triage of one artifact. The bytes arrive inline (an attachment or a
 * paste) and never leave the process; nothing is written to disk and nothing
 * is executed. Hashes come from Node, so the client only needs to send base64.
 */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const limited = rateLimit(`inspect:${account.id}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many analyses in a minute. Wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  let body: { name?: string; base64?: string; text?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    if (body.base64) {
      const payload = body.base64.replace(/^data:[^;]+;base64,/, '');
      bytes = Buffer.from(payload, 'base64');
    } else if (typeof body.text === 'string') {
      bytes = Buffer.from(body.text, 'utf8');
    } else {
      return NextResponse.json({ ok: false, error: 'Send base64 or text.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Those bytes could not be decoded.' }, { status: 400 });
  }

  if (!bytes.length) return NextResponse.json({ ok: false, error: 'The artifact is empty.' }, { status: 400 });
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'That artifact is larger than 4 MB.' }, { status: 413 });
  }

  const name = (body.name ?? 'artifact').toString().slice(0, 200);
  const report = inspectArtifact(new Uint8Array(bytes), name);
  const hashes = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sha1: createHash('sha1').update(bytes).digest('hex'),
    md5: createHash('md5').update(bytes).digest('hex'),
  };

  return NextResponse.json({ ok: true, hashes, report });
}

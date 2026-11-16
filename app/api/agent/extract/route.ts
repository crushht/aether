import { NextResponse } from 'next/server';
import { extractPdfText } from '@/lib/server/pdf';
import { requireUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Turn an uploaded attachment into text. PDFs go through the dependency-free
 * extractor; everything else is decoded as UTF-8.
 */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { name?: string; mime?: string; data?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const name = String(body.name ?? 'attachment');
  const isPdf = /pdf/i.test(String(body.mime ?? '')) || /\.pdf$/i.test(name);
  if (!isPdf) {
    return NextResponse.json({ ok: false, error: 'Only PDF extraction is handled here.' }, { status: 400 });
  }

  const base64 = String(body.data ?? '');
  if (!base64) return NextResponse.json({ ok: false, error: 'No data.' }, { status: 400 });
  if (base64.length > MAX_BYTES * 1.4) {
    return NextResponse.json({ ok: false, error: 'That PDF is too large.' }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ ok: false, error: 'That file is not a PDF.' }, { status: 400 });
    }
    const result = extractPdfText(buffer);
    return NextResponse.json({
      ok: true,
      text: result.text,
      chars: result.chars,
      truncated: result.truncated,
      streams: result.streams,
      note: result.text ? undefined : 'No selectable text found (a scan or a CID-keyed font).',
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not read the PDF.' },
      { status: 400 },
    );
  }
}

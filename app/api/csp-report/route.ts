import { NextResponse } from 'next/server';
import { appendFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { rateLimit } from '@/lib/server/rate-limit';
import { DATA_DIR } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOG = path.join(DATA_DIR, 'csp-reports.jsonl');
const MAX_LOG_BYTES = 2_000_000;

/**
 * CSP violation sink (Report-Only phase). Browsers POST here with a small JSON
 * body; the report is appended to a bounded jsonl file so `npm run csp:check`
 * can tell us whether enforcing the policy is safe yet. Rate-limited per IP.
 */
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`csp:${ip}`, 60).ok) return new NextResponse(null, { status: 429 });

  const raw = await request.text().catch(() => '');
  if (raw.length > 8_000) return new NextResponse(null, { status: 413 });

  try {
    const body = JSON.parse(raw) as {
      'csp-report'?: { 'document-uri'?: string; 'violated-directive'?: string; 'blocked-uri'?: string };
    };
    const report = body['csp-report'];
    if (report) {
      console.warn(
        '[csp] %s blocked by %s on %s',
        report['blocked-uri'] ?? '?',
        report['violated-directive'] ?? '?',
        report['document-uri'] ?? '?',
      );
      const size = await stat(LOG).then((info) => info.size).catch(() => 0);
      if (size < MAX_LOG_BYTES) {
        await appendFile(
          LOG,
          `${JSON.stringify({
            at: new Date().toISOString(),
            page: report['document-uri'] ?? '',
            directive: report['violated-directive'] ?? '',
            blocked: report['blocked-uri'] ?? '',
          })}\n`,
          'utf8',
        ).catch(() => undefined);
      }
    }
  } catch {
    /* a malformed report is not worth a response body */
  }
  return new NextResponse(null, { status: 204 });
}

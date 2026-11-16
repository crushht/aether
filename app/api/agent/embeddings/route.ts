import { NextResponse } from 'next/server';
import { safeBaseUrl } from '@/lib/agent/guard';
import { resolveTarget } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import type { ModelRouteKey } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Embeddings proxy for hybrid knowledge search. Uses the same stored provider
 * and key as chat, but a separate optional model id, so the browser never sees
 * a key. Anything that is not a clean upstream answer falls back on the client
 * to lexical search instead of failing the tool call.
 */

const MAX_TEXTS = 32;
const MAX_CHARS_EACH = 4_000;
const MAX_TOTAL_CHARS = 32_000;
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

const failure = (code: string, message: string, status: number) =>
  NextResponse.json({ ok: false, error: { code, message } }, { status });

export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return failure('unauthorized', 'Sign in to continue.', 401);

  let body: { texts?: unknown; model?: string; providerId?: string; route?: ModelRouteKey };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return failure('bad-request', 'Invalid JSON body.', 400);
  }

  const texts = Array.isArray(body.texts)
    ? body.texts.map((text) => String(text ?? '')).filter((text) => text.trim())
    : [];
  if (!texts.length) return failure('bad-request', 'texts must be a non-empty array.', 400);
  if (texts.length > MAX_TEXTS) return failure('bad-request', `At most ${MAX_TEXTS} texts per request.`, 400);
  if (texts.some((text) => text.length > MAX_CHARS_EACH)) {
    return failure('bad-request', `Each text must be at most ${MAX_CHARS_EACH} characters.`, 400);
  }
  if (texts.reduce((sum, text) => sum + text.length, 0) > MAX_TOTAL_CHARS) {
    return failure('bad-request', 'The batch is too large; send fewer or shorter texts.', 400);
  }

  try {
    const target = await resolveTarget(account.id, { route: body.route ?? 'knowledge', providerId: body.providerId });
    if (!target) return failure('no-provider', 'No model provider is configured.', 400);
    const model = (body.model || target.provider.embeddingModel || '').trim();
    if (!model) {
      return failure(
        'no-embedding-model',
        'No embedding model is set for this provider. Add one in Settings → Agents to enable semantic search.',
        400,
      );
    }
    const baseUrl = safeBaseUrl(target.provider.baseUrl);
    const local = (() => {
      try {
        return LOCAL_HOSTS.test(new URL(baseUrl).hostname);
      } catch {
        return false;
      }
    })();
    if (!target.apiKey && !local) return failure('no-key', 'This provider has no API key.', 400);

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);

    if (!response) return failure('timeout', 'The embedding endpoint did not answer.', 502);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const code =
        response.status === 401 || response.status === 403
          ? 'invalid-key'
          : response.status === 404
            ? 'not-found'
            : response.status === 429
              ? 'rate-limited'
              : 'request-failed';
      return failure(code, detail.slice(0, 400) || `Embedding endpoint returned ${response.status}.`, response.status);
    }

    const json = (await response.json().catch(() => null)) as
      | { data?: { embedding?: number[] }[] }
      | null;
    const vectors = (json?.data ?? [])
      .map((row) => (Array.isArray(row.embedding) ? row.embedding.map(Number) : []))
      .filter((vector) => vector.length > 0);
    if (vectors.length !== texts.length) {
      return failure('bad-response', 'The embedding endpoint returned an unexpected payload.', 502);
    }
    return NextResponse.json({ ok: true, model, vectors });
  } catch (error) {
    return failure('request-failed', error instanceof Error ? error.message : String(error), 502);
  }
}

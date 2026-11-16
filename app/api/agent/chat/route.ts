import { NextResponse } from 'next/server';
import { safeBaseUrl } from '@/lib/agent/guard';
import { resolveTarget } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import type { ModelRouteKey } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatProxyBody {
  /** which scene decides the model: chat | issue | workflow | knowledge */
  route?: ModelRouteKey;
  providerId?: string;
  model?: string;
  /** legacy: an explicit endpoint bypasses the stored providers */
  baseUrl?: string;
  apiKey?: string;
  body?: Record<string, unknown>;
}

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

const isLocal = (baseUrl: string) => {
  try {
    return LOCAL_HOSTS.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
};

const failure = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Forwards one OpenAI-compatible chat completion. The endpoint and the key are
 * resolved on the server from the account's providers, so the browser never
 * holds a key and a scene can switch models without a redeploy.
 */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return failure('unauthorized', 'Sign in to continue.', 401);

  let payload: ChatProxyBody;
  try {
    payload = (await request.json()) as ChatProxyBody;
  } catch {
    return failure('bad-request', 'Invalid JSON body.', 400);
  }

  try {
    const target = payload.baseUrl
      ? null
      : await resolveTarget(account.id, {
          route: payload.route,
          providerId: payload.providerId,
          model: payload.model,
        });

    const baseUrl = payload.baseUrl ? safeBaseUrl(payload.baseUrl) : target ? safeBaseUrl(target.provider.baseUrl) : '';
    const apiKey = (payload.apiKey ?? '').trim() || target?.apiKey || '';

    if (!baseUrl) {
      return failure(
        'no-provider',
        'No model provider is configured yet. Add one in Settings → Agents.',
        400,
      );
    }
    if (!apiKey && !isLocal(baseUrl)) {
      return failure('no-key', 'This provider has no API key. Add one in Settings → Agents.', 400);
    }

    const upstreamBody: Record<string, unknown> = {
      ...(payload.body ?? {}),
      model: payload.model || target?.model || (payload.body?.model as string) || '',
    };
    if (!upstreamBody.model) {
      return failure('no-model', 'No model id is set for this provider.', 400);
    }
    if (target) {
      upstreamBody.temperature = target.temperature;
    }

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(upstreamBody),
      signal: request.signal,
    });

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return new Response(text || JSON.stringify({ error: { message: `Upstream ${upstream.status}` } }), {
        status: upstream.status || 502,
        headers: { 'Content-Type': contentType, 'X-Aether-Code': upstreamCode(upstream.status) },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Aether-Provider': target?.provider.id ?? 'custom',
        'X-Aether-Model': String(upstreamBody.model),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = /timeout|aborted|fetch failed/i.test(message);
    return failure(timeout ? 'timeout' : 'upstream-error', message, 400);
  }
}

function upstreamCode(status: number) {
  if (status === 401 || status === 403) return 'invalid-key';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'upstream';
  return 'request-rejected';
}

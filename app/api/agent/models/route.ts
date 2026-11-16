import { NextResponse } from 'next/server';
import { safeBaseUrl } from '@/lib/agent/guard';
import { readAether, resolveTarget, writeAether } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import type { ModelRouteKey } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `Test connection`. Asks the provider for its model list with the stored key,
 * classifies the failure, and remembers the list so the model picker is useful
 * without another round-trip.
 */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let payload: { providerId?: string; route?: ModelRouteKey; baseUrl?: string; apiKey?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const target = payload.providerId || payload.route
      ? await resolveTarget(account.id, { providerId: payload.providerId, route: payload.route })
      : null;
    const baseUrl = safeBaseUrl(payload.baseUrl || target?.provider.baseUrl || '');
    const apiKey = (payload.apiKey ?? '').trim() || target?.apiKey || '';
    const started = Date.now();

    const upstream = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();

    if (!upstream.ok) {
      return NextResponse.json({
        ok: false,
        status: upstream.status,
        code: upstream.status === 401 || upstream.status === 403 ? 'invalid-key'
          : upstream.status === 404 ? 'not-found'
          : upstream.status === 429 ? 'rate-limited'
          : 'upstream',
        error: text.slice(0, 300) || `Upstream ${upstream.status}`,
      });
    }

    let models: string[] = [];
    try {
      const json = JSON.parse(text) as { data?: unknown; models?: unknown };
      const list = ((json.data ?? json.models ?? []) as { id?: string; name?: string }[]) ?? [];
      models = list.map((item) => item.id ?? item.name ?? '').filter(Boolean);
    } catch {
      /* the endpoint answered with something that is not a model list */
    }

    // remember the catalogue on the provider that was tested
    if (target && models.length) {
      const store = await readAether(account.id);
      const provider = store.providers.find((item) => item.id === target.provider.id);
      if (provider) {
        await writeAether(account.id, {
          providers: store.providers.map((item) =>
            item.id === provider.id
              ? { ...item, models, defaultModel: item.defaultModel || models[0] }
              : item,
          ),
        });
      }
    }

    return NextResponse.json({ ok: true, status: upstream.status, ms: Date.now() - started, models });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, code: /timeout|aborted/i.test(message) ? 'timeout' : 'network', error: message },
      { status: 400 },
    );
  }
}

import { NextResponse } from 'next/server';
import { safeBaseUrl } from '@/lib/agent/guard';
import { providerPublic, publicAether, readAether, writeAether, type AetherPatch } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import type { ModelRouteKey, ProviderDraft } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Aether profile: providers, scene routes, persona, memory, knowledge and
 * workflows. Provider keys are encrypted server-side and never returned; the
 * browser only learns `hasKey` and a short hint.
 */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const store = await readAether(account.id);
  return NextResponse.json({ ok: true, config: publicAether(store) });
}

interface ConfigBody extends AetherPatch {
  providers?: ProviderDraft[];
}

export async function PUT(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: ConfigBody;
  try {
    body = (await request.json()) as ConfigBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    if (Array.isArray(body.providers)) {
      for (const provider of body.providers) {
        safeBaseUrl(provider.baseUrl);
      }
    }
    if (body.routes) {
      for (const [key, binding] of Object.entries(body.routes) as [ModelRouteKey, { providerId?: string | null }][]) {
        if (binding && binding.providerId && typeof binding.providerId !== 'string') {
          return NextResponse.json({ ok: false, error: `Route ${key} is invalid.` }, { status: 400 });
        }
      }
    }
    const store = await writeAether(account.id, body);
    return NextResponse.json({ ok: true, config: publicAether(store), providers: store.providers.map(providerPublic) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Could not save the configuration.' },
      { status: 400 },
    );
  }
}

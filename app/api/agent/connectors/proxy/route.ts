import { NextResponse } from 'next/server';
import { decryptSecret } from '@/lib/server/accounts';
import { readAether } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import { connectorUrl, isConnectorMethod } from '@/lib/agent/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One request through a stored connector. The browser sends a connector id, a
 * method and a path; the server owns the base URL and the token, refuses
 * cross-origin paths and redirects, and returns a bounded text body.
 */

const MAX_BODY = 150_000;
const TIMEOUT_MS = 30_000;

const failure = (code: string, message: string, status: number) =>
  NextResponse.json({ ok: false, error: { code, message } }, { status });

export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return failure('unauthorized', 'Sign in to continue.', 401);

  let body: { connectorId?: string; method?: string; path?: string; body?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return failure('bad-request', 'Invalid JSON body.', 400);
  }

  const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';
  if (!isConnectorMethod(method)) return failure('bad-request', 'Unsupported HTTP method.', 400);
  if (!body.connectorId) return failure('bad-request', 'connectorId is required.', 400);

  const store = await readAether(account.id);
  const connector = store.connectors.find((item) => item.id === body.connectorId);
  if (!connector) return failure('not-found', 'Connector not found.', 404);

  const url = connectorUrl(connector.baseUrl, typeof body.path === 'string' ? body.path : '/');
  if (!url) return failure('bad-request', 'That path is outside this connector.', 400);

  const token = connector.tokenEnc ? await decryptSecret(connector.tokenEnc).catch(() => '') : '';
  const headers: Record<string, string> = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const hasBody = body.body !== undefined && body.body !== null && method !== 'GET' && method !== 'HEAD';
  if (hasBody) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body.body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await response.text().catch(() => '');
    const truncated = raw.slice(0, MAX_BODY);
    return NextResponse.json({
      ok: true,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      truncated: raw.length > MAX_BODY,
      body: truncated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /timeout|aborted/i.test(message) ? 'timeout' : 'request-failed';
    return failure(code, message.slice(0, 400), 502);
  }
}

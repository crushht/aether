import { NextResponse } from 'next/server';
import { cancelWorkflowRun } from '@/lib/server/agent-run';
import { requireUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ask a headless workflow run to stop after its current step. Cancellation is
 * cooperative: the run records a `canceled` result rather than being killed.
 */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { workflowId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  const workflowId = String(body.workflowId ?? '').trim();
  if (!workflowId) return NextResponse.json({ ok: false, error: 'workflowId is required.' }, { status: 400 });

  cancelWorkflowRun(account.id, workflowId);
  return NextResponse.json({ ok: true });
}

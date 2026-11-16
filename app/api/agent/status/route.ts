import { NextResponse } from 'next/server';
import { schedulerStatus } from '@/lib/server/scheduler';
import { readAether } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Runtime facts the settings page can show: is the scheduler alive, and what is stored. */
export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const store = await readAether(account.id);
  return NextResponse.json({
    ok: true,
    scheduler: schedulerStatus(),
    counts: {
      providers: store.providers.length,
      workflows: store.workflows.length,
      enabledWorkflows: store.workflows.filter((workflow) => workflow.enabled).length,
      knowledge: store.knowledge.length,
      memory: store.memory.length,
    },
  });
}

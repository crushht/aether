import { requireUser } from '@/lib/server-auth';
import { subscribeWorkspace, type WorkspaceChange } from '@/lib/server/workspace-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-sent events for workspace changes. The client uses this to pull a new
 * snapshot (or to show "changed elsewhere") instead of polling on focus only.
 */

const PERSONAL = process.env.WORKSPACE_MODE === 'personal';

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return new Response('Unauthorized', { status: 401 });
  const scope = PERSONAL ? account.id : 'shared';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send('ready', { scope });
      const unsubscribe = subscribeWorkspace((change: WorkspaceChange) => {
        if (change.scope === scope) send('change', change);
      });
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          closed = true;
        }
      }, 25_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

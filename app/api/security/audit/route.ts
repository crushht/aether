import { NextResponse } from 'next/server';
import { requireUser, sessionTokenOf } from '@/lib/server-auth';
import { readSecurityAudit } from '@/lib/server/security-audit';
import {
  filterSecurityAudit,
  securityAuditSummary,
  visibleSecurityEvents,
  type SecurityEventFilter,
} from '@/lib/security-audit';
import type { AuditRange } from '@/lib/audit-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The workspace security trail: sign-ins, mailed codes, password changes and
 * resets, session revocations.
 *
 * Read-only by design — the only writer is the server itself, on the request
 * that performed the action. An owner sees the whole workspace; a member sees
 * the events attributed to their own account. A refused sign-in for an address
 * with no account here is attributed to nobody, so it stays with the owner.
 */

const GROUPS = new Set<SecurityEventFilter>(['all', 'sign_in', 'password', 'code', 'account']);
const RANGES = new Set<AuditRange>(['all', 'week', 'month']);

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const groupParam = (params.get('group') ?? 'all') as SecurityEventFilter;
  const rangeParam = (params.get('range') ?? 'all') as AuditRange;
  const limit = Number(params.get('limit') ?? 100);
  const canSeeAll = account.role === 'owner';

  const all = await readSecurityAudit();
  const visible = visibleSecurityEvents(all, { id: account.id, role: account.role });
  const summary = securityAuditSummary(visible);

  const actor = canSeeAll ? (params.get('actor') ?? '') : account.id;
  const events = filterSecurityAudit(
    visible,
    {
      group: GROUPS.has(groupParam) ? groupParam : 'all',
      range: RANGES.has(rangeParam) ? rangeParam : 'all',
      failuresOnly: params.get('failures') === '1',
      actorId: actor,
      needle: params.get('needle') ?? '',
      limit,
    },
    new Date(),
  );

  return NextResponse.json({
    ok: true,
    canSeeAll,
    scope: canSeeAll ? ('all' as const) : ('self' as const),
    /** no session cookie means the desktop/local user; nothing is hidden from them anyway */
    local: !sessionTokenOf(request),
    viewer: { id: account.id, name: account.name, role: account.role },
    stored: all.length,
    total: visible.length,
    matched: events.length,
    events,
    summary,
  });
}

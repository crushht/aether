import type { Cycle, Issue } from './types';

const DAY = 86_400_000;

export interface CycleStats {
  total: number;
  done: number;
  canceled: number;
  open: number;
  started: number;
  /** issues created after the cycle started — the part of the scope added mid-flight */
  added: number;
  percent: number;
}

export function cycleIssues(issues: Issue[], cycleId: string) {
  return issues.filter((issue) => issue.cycleId === cycleId);
}

export function cycleStats(issues: Issue[], cycle: Cycle): CycleStats {
  const scope = cycleIssues(issues, cycle.id);
  const done = scope.filter((issue) => issue.status === 'done').length;
  const canceled = scope.filter((issue) => issue.status === 'canceled' || issue.status === 'duplicate').length;
  const started = scope.filter((issue) => ['in_progress', 'in_review', 'done'].includes(issue.status)).length;
  const start = +new Date(cycle.startsAt);
  const added = scope.filter((issue) => +new Date(issue.createdAt) > start).length;
  const counted = scope.length - canceled;
  return {
    total: scope.length,
    done,
    canceled,
    open: scope.length - done - canceled,
    started,
    added,
    percent: counted > 0 ? Math.round((done / counted) * 100) : 0,
  };
}

export interface BurnUpPoint {
  at: number;
  scope: number;
  done: number;
}

/**
 * Daily scope / completion totals for a cycle. Everything is derived from the
 * mock timestamps, so the curve is reproducible (no randomness, no clock reads).
 */
export function burnUp(issues: Issue[], cycle: Cycle, now: number): BurnUpPoint[] {
  const start = +new Date(cycle.startsAt);
  const end = +new Date(cycle.endsAt);
  const scope = cycleIssues(issues, cycle.id);
  const last = Math.min(Math.max(now, start), end);
  const days = Math.max(1, Math.ceil((end - start) / DAY));
  const points: BurnUpPoint[] = [];

  for (let day = 0; day <= days; day += 1) {
    const at = start + day * DAY;
    if (at > last) break;
    const added = scope.filter((issue) => +new Date(issue.createdAt) <= at);
    const done = added.filter((issue) => issue.status === 'done' && +new Date(issue.updatedAt) <= at);
    points.push({ at, scope: added.length, done: done.length });
  }
  return points;
}

/** `Current` / `Upcoming` / `Completed` — derived from the window, not from a flag. */
export function cyclePhase(cycle: Cycle, now: number): 'current' | 'upcoming' | 'completed' {
  const start = +new Date(cycle.startsAt);
  const end = +new Date(cycle.endsAt);
  if (now < start) return 'upcoming';
  if (now > end) return 'completed';
  return 'current';
}

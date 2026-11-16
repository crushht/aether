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

/**
 * One issue's weight on a burndown: its estimate, or 1 point when nobody
 * estimated it. Unestimated work still takes a slot, and a chart that silently
 * dropped it would read "0 remaining" on a cycle full of open issues.
 */
export function issuePoints(issue: Issue): number {
  const estimate = issue.estimate;
  return typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0 ? estimate : 1;
}

export interface BurndownPoint {
  /** start of the day bucket (cycle start + n × 24h) */
  at: number;
  /** 0-based day index inside the cycle */
  day: number;
  /** points in the cycle whose issue existed by this day */
  scope: number;
  /** points finished (status `done`) by this day */
  done: number;
  /** points taken out of scope (canceled / duplicate) by this day */
  canceled: number;
  /** scope − done − canceled, never below zero */
  remaining: number;
}

/**
 * Remaining points per day, from the cycle start through `now`.
 *
 * Like `burnUp`, the buckets are anchored on the cycle start rather than on
 * local midnight: the same inputs always give the same curve, and a cycle that
 * starts at 14:30 does not get a half day at either end. `now` is clamped into
 * the window, so a finished cycle draws its whole history and an upcoming one
 * draws a single opening point.
 */
export function burndown(issues: Issue[], cycle: Cycle, now: number): BurndownPoint[] {
  const start = +new Date(cycle.startsAt);
  const end = +new Date(cycle.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

  const scope = cycleIssues(issues, cycle.id).map((issue) => {
    const closed =
      issue.status === 'done' ? 'done' : issue.status === 'canceled' || issue.status === 'duplicate' ? 'canceled' : null;
    return {
      createdAt: +new Date(issue.createdAt),
      closedAt: closed ? +new Date(issue.updatedAt) : Number.NaN,
      closed,
      points: issuePoints(issue),
    };
  });

  const days = Math.max(1, Math.ceil((end - start) / DAY));
  const last = Math.min(Math.max(Number.isFinite(now) ? now : start, start), end);
  const points: BurndownPoint[] = [];

  for (let day = 0; day <= days; day += 1) {
    const at = start + day * DAY;
    if (at > last) break;
    let total = 0;
    let done = 0;
    let canceled = 0;
    for (const item of scope) {
      if (item.createdAt <= at) total += item.points;
      if (!item.closed || !(item.closedAt <= at)) continue;
      if (item.closed === 'done') done += item.points;
      else canceled += item.points;
    }
    points.push({ at, day, scope: total, done, canceled, remaining: Math.max(0, total - done - canceled) });
  }
  return points;
}

/** Default SVG box for the burndown, shared by the page and the tests. */
export const BURNDOWN_SIZE = { width: 720, height: 176, top: 12, bottom: 24 } as const;

export interface BurndownGeometry {
  width: number;
  height: number;
  top: number;
  bottom: number;
  /** upper bound of the vertical scale (never 0, so the chart cannot divide by zero) */
  max: number;
  /** remaining-points polyline (`x,y x,y …`) */
  polyline: string;
  /** same line as a path, used for the fill */
  path: string;
  /** same line closed against the baseline, for the fill */
  area: string;
  /** the straight "ideal" line: scope at the last day → zero on the closing day */
  idealPath: string;
  /** x of the last computed day — where the real line stops and the guide takes over */
  cutoff: number;
  /** y for max / half / zero, so the caller can draw grid lines */
  grid: number[];
  zeroY: number;
}

/**
 * Turns burndown points into SVG path strings. Keeping the maths here (instead
 * of inside the component) is what makes the chart testable: the assertions can
 * check real coordinates for a synthetic cycle.
 */
export function burndownGeometry(
  cycle: Cycle,
  points: BurndownPoint[],
  size: { width?: number; height?: number; top?: number; bottom?: number } = {},
): BurndownGeometry {
  const width = size.width ?? BURNDOWN_SIZE.width;
  const height = size.height ?? BURNDOWN_SIZE.height;
  const top = size.top ?? BURNDOWN_SIZE.top;
  const bottom = size.bottom ?? BURNDOWN_SIZE.bottom;
  const start = +new Date(cycle.startsAt);
  const end = +new Date(cycle.endsAt);
  const span = Math.max(1, end - start);
  const max = Math.max(1, ...points.map((point) => Math.max(point.scope, point.remaining)));
  const plot = Math.max(1, height - top - bottom);
  const x = (at: number) => Math.min(1, Math.max(0, (at - start) / span)) * width;
  const y = (value: number) => top + (1 - Math.min(value, max) / max) * plot;
  const round = (value: number) => Number(value.toFixed(1));
  const zeroY = round(y(0));
  const last = points[points.length - 1];

  if (!last) {
    return {
      width,
      height,
      top,
      bottom,
      max,
      polyline: '',
      path: '',
      area: '',
      idealPath: '',
      cutoff: 0,
      grid: [],
      zeroY,
    };
  }

  const coordinates = points.map((point) => ({ x: round(x(point.at)), y: round(y(point.remaining)) }));
  const path = coordinates.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  // the ideal line starts from the scope the cycle actually carries today, so a
  // scope change mid-cycle does not leave the guide pointing at a stale total
  const baseline = last.scope;
  return {
    width,
    height,
    top,
    bottom,
    max,
    polyline: coordinates.map((point) => `${point.x},${point.y}`).join(' '),
    path,
    area: `${path} L${round(x(last.at))},${zeroY} L${round(x(start))},${zeroY} Z`,
    idealPath: `M${round(x(start))},${round(y(baseline))} L${round(x(end))},${round(y(0))}`,
    cutoff: round(x(last.at)),
    grid: [round(y(max)), round(y(max / 2)), zeroY],
    zeroY,
  };
}

/** `Current` / `Upcoming` / `Completed` — derived from the window, not from a flag. */
export function cyclePhase(cycle: Cycle, now: number): 'current' | 'upcoming' | 'completed' {
  const start = +new Date(cycle.startsAt);
  const end = +new Date(cycle.endsAt);
  if (now < start) return 'upcoming';
  if (now > end) return 'completed';
  return 'current';
}

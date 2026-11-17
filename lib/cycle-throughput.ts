/**
 * Throughput: how much work actually finishes each week, and how long it takes.
 *
 * A burndown says whether the cycle will land; this says whether the team is
 * getting faster or slower, which a burndown cannot show because it only looks
 * at one cycle. Points come from `issuePoints` so an unestimated issue counts as
 * one here exactly as it does on the chart.
 *
 * The completion moment is read from the issue's own history (the last
 * `status → done` activity). When an issue was imported already done there is no
 * such activity, and `updatedAt` is the only honest fallback — it is labelled as
 * a fallback in the returned report instead of being passed off as exact.
 */

import { issuePoints } from './cycles';
import type { Issue } from './types';

const DAY = 86_400_000;

export interface ThroughputWeek {
  /** local date of the Monday that opens the week, `YYYY-MM-DD` */
  key: string;
  start: number;
  end: number;
  points: number;
  issues: number;
}

export interface ThroughputReport {
  /** oldest first, including the current week */
  weeks: ThroughputWeek[];
  /** completed points per week, averaged over the window (1 decimal) */
  averagePoints: number;
  /** mean days from creation to completion, `null` when nothing completed */
  averageDays: number | null;
  /** issues that fed the numbers */
  completed: number;
  /** of those, how many had no estimate (and therefore counted as 1 point) */
  estimated: number;
  /** of those, how many fell back to `updatedAt` because history had no status change */
  approximated: number;
}

/** Local Monday 00:00 of the week that contains `ms`. */
export function weekStart(ms: number): number {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return Number.NaN;
  date.setHours(0, 0, 0, 0);
  const back = (date.getDay() + 6) % 7; // Monday = 0 … Sunday = 6
  date.setDate(date.getDate() - back);
  return date.getTime();
}

const dayKey = (ms: number) => {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/** Shift a local Monday by whole weeks, in local time (so DST cannot drift it). */
function addWeeks(start: number, weeks: number): number {
  const date = new Date(start);
  date.setDate(date.getDate() + weeks * 7);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export interface Completion {
  at: number;
  /** history had no `status → done` activity, so `updatedAt` was used */
  approximated: boolean;
}

/** When an issue reached `done`, and whether that moment is exact. */
export function completionMoment(
  issue: Pick<Issue, 'status' | 'updatedAt' | 'activities'>,
): Completion | null {
  if (issue.status !== 'done') return null;
  const marks = (issue.activities ?? [])
    .filter((activity) => activity.kind === 'status' && activity.to === 'done')
    .map((activity) => +new Date(activity.createdAt))
    .filter((at) => Number.isFinite(at));
  if (marks.length) return { at: Math.max(...marks), approximated: false };
  const fallback = +new Date(issue.updatedAt);
  if (!Number.isFinite(fallback)) return null;
  return { at: fallback, approximated: true };
}

/**
 * Completed work per week over the last `weeks` weeks (default 6, current week
 * last). Issues completed in the future are ignored rather than counted early.
 */
export function weeklyThroughput(
  issues: Issue[],
  now: number = Date.now(),
  weeks = 6,
): ThroughputReport {
  const span = Math.max(1, Math.min(52, Math.trunc(weeks)));
  const thisWeek = weekStart(Number.isFinite(now) ? now : Date.now());
  const firstWeek = addWeeks(thisWeek, -(span - 1));

  const buckets: ThroughputWeek[] = [];
  for (let index = 0; index < span; index += 1) {
    const start = addWeeks(firstWeek, index);
    const end = addWeeks(start, 1);
    buckets.push({ key: dayKey(start), start, end, points: 0, issues: 0 });
  }

  const durations: number[] = [];
  let estimated = 0;
  let approximated = 0;
  let completed = 0;

  for (const issue of issues) {
    const moment = completionMoment(issue);
    if (!moment) continue;
    if (moment.at > now || moment.at < firstWeek) continue;
    const start = weekStart(moment.at);
    const bucket = buckets.find((week) => week.start === start);
    if (!bucket) continue;
    completed += 1;
    if (moment.approximated) approximated += 1;
    const points = issuePoints(issue);
    if (!(typeof issue.estimate === 'number' && issue.estimate > 0)) estimated += 1;
    bucket.points += points;
    bucket.issues += 1;
    const created = +new Date(issue.createdAt);
    if (Number.isFinite(created) && moment.at >= created) durations.push((moment.at - created) / DAY);
  }

  const totalPoints = buckets.reduce((sum, week) => sum + week.points, 0);
  const averagePoints = Math.round((totalPoints / span) * 10) / 10;
  const averageDays = durations.length
    ? Math.round((durations.reduce((sum, days) => sum + days, 0) / durations.length) * 10) / 10
    : null;

  return { weeks: buckets, averagePoints, averageDays, completed, estimated, approximated };
}

/** The bar heights for a small chart: pixels out of `height`, zero stays flat. */
export function throughputBars(report: ThroughputReport, height = 44): number[] {
  const max = Math.max(1, ...report.weeks.map((week) => week.points));
  return report.weeks.map((week) => (week.points <= 0 ? 0 : Math.max(2, Math.round((week.points / max) * height))));
}

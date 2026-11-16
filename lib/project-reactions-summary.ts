import type { Project } from '@/lib/types';

export interface ReactionWeek {
  /** local Monday of the week, YYYY-MM-DD */
  weekStart: string;
  likes: number;
  acks: number;
  updates: number;
}

/** Local Monday 00:00 for the week containing `at`. */
export function startOfWeek(at: Date): Date {
  const date = new Date(at);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Reaction totals per week for the last `weeks` weeks (including the current
 * one). Weeks without updates or reactions are omitted.
 */
export function summarizeReactions(project: Project, at: Date = new Date(), weeks = 4): ReactionWeek[] {
  const currentWeek = startOfWeek(at);
  const earliest = new Date(currentWeek);
  earliest.setDate(earliest.getDate() - (weeks - 1) * 7);

  const buckets = new Map<string, ReactionWeek>();
  for (const update of project.updates ?? []) {
    const created = new Date(update.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const week = startOfWeek(created);
    if (week < earliest || week > currentWeek) continue;
    const key = dayKey(week);
    const bucket = buckets.get(key) ?? { weekStart: key, likes: 0, acks: 0, updates: 0 };
    bucket.updates += 1;
    bucket.likes += (update.likedBy ?? []).length;
    bucket.acks += (update.acknowledgedBy ?? []).length;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .filter((bucket) => bucket.updates > 0)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}

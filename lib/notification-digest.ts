import type { AppNotification } from '@/lib/types';

export type DigestKind = 'mention' | 'agent' | 'cycle' | 'project_update';

export interface DigestCounts {
  total: number;
  counts: Record<DigestKind, number>;
}

/** Local calendar day key, so "today" matches what the person sees. */
export function localDayKey(at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Count the day's notifications by kind. Digests are excluded so a summary
 * never counts itself (or an earlier summary) as activity.
 */
export function summarizeDay(notifications: AppNotification[], dayKey: string): DigestCounts {
  const counts: Record<DigestKind, number> = { mention: 0, agent: 0, cycle: 0, project_update: 0 };
  let total = 0;
  for (const notification of notifications) {
    if (notification.kind === 'digest') continue;
    const created = new Date(notification.createdAt);
    if (Number.isNaN(created.getTime()) || localDayKey(created) !== dayKey) continue;
    if (notification.kind in counts) {
      counts[notification.kind as DigestKind] += 1;
      total += 1;
    }
  }
  return { total, counts };
}

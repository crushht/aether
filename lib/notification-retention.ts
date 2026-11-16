import type { AppNotification } from '@/lib/types';

export const ARCHIVE_RETENTION_DAYS = 30;

/** An archived notification older than the retention window can go. */
export function isExpiredArchive(
  notification: AppNotification,
  now: number = Date.now(),
  days: number = ARCHIVE_RETENTION_DAYS,
): boolean {
  if (!notification.archivedAt) return false;
  const archived = +new Date(notification.archivedAt);
  if (!Number.isFinite(archived)) return false;
  return now - archived > days * 86_400_000;
}

export function pruneExpiredArchives(
  notifications: AppNotification[],
  now: number = Date.now(),
  days: number = ARCHIVE_RETENTION_DAYS,
): AppNotification[] {
  return notifications.filter((notification) => !isExpiredArchive(notification, now, days));
}

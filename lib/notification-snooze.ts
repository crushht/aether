/**
 * Snoozing an inbox item: "come back to me later".
 *
 * Two rules keep this from becoming a second archive:
 * - A snoozed item is hidden, but its time is a real moment on the clock, not a
 *   flag someone has to remember to clear.
 * - The badge agrees with the list. A snoozed item does not count as unread,
 *   otherwise the number in the sidebar sends you to an empty inbox.
 */

import type { AppNotification } from './types';

export type SnoozeChoice = 'hour' | 'tomorrow' | 'week';

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** the hour a "tomorrow" / "next week" nap wakes up at, local time */
const MORNING_HOUR = 9;

export const SNOOZE_CHOICES: Array<{ id: SnoozeChoice; label: string }> = [
  { id: 'hour', label: 'In 1 hour' },
  { id: 'tomorrow', label: 'Tomorrow morning' },
  { id: 'week', label: 'Next week' },
];

/** Local 09:00 on the day `now` falls on. */
function morningOf(now: number): number {
  const date = new Date(now);
  date.setHours(MORNING_HOUR, 0, 0, 0);
  return date.getTime();
}

/**
 * When a choice wakes up, in epoch ms.
 *
 * - `hour`: exactly one hour from now.
 * - `tomorrow`: the next 09:00, which is today's if it is still before 09:00.
 * - `week`: the next Monday 09:00, which is today's on a Monday before 09:00.
 *
 * An unreadable `now` is treated as the current time rather than producing NaN.
 */
export function snoozeUntil(choice: SnoozeChoice, now: number = Date.now()): number {
  const base = Number.isFinite(now) ? now : Date.now();
  if (choice === 'hour') return base + HOUR;
  const morning = morningOf(base);
  if (choice === 'tomorrow') return morning > base ? morning : morning + DAY;
  const weekday = new Date(base).getDay(); // 0 = Sunday … 6 = Saturday
  const daysToMonday = (8 - weekday) % 7; // 0 only on Monday
  const monday = morning + daysToMonday * DAY;
  return monday > base ? monday : monday + 7 * DAY;
}

const parse = (value: string | undefined): number => {
  if (!value) return Number.NaN;
  const at = +new Date(value);
  return Number.isFinite(at) ? at : Number.NaN;
};

/** Is this item still napping at `now`? An unreadable date never hides anything. */
export function isSnoozed(notification: Pick<AppNotification, 'snoozedUntil'>, now: number = Date.now()): boolean {
  const until = parse(notification.snoozedUntil);
  if (!Number.isFinite(until)) return false;
  return until > now;
}

/** What the list shows: archived items are filtered by the caller, naps are not. */
export function withoutSnoozed<T extends Pick<AppNotification, 'snoozedUntil'>>(notifications: T[], now: number = Date.now()): T[] {
  return notifications.filter((notification) => !isSnoozed(notification, now));
}

/** Only the items whose nap has not ended yet — the "Snoozed" view. */
export function onlySnoozed<T extends Pick<AppNotification, 'snoozedUntil'>>(notifications: T[], now: number = Date.now()): T[] {
  return notifications.filter((notification) => isSnoozed(notification, now));
}

/**
 * Unread count that matches the list: archived and napping items are not
 * waiting for you.
 */
export function actionableUnread(
  notifications: Array<Pick<AppNotification, 'id' | 'archivedAt' | 'snoozedUntil'>>,
  readIds: string[],
  now: number = Date.now(),
): number {
  const read = new Set(readIds);
  return notifications.filter(
    (notification) => !notification.archivedAt && !read.has(notification.id) && !isSnoozed(notification, now),
  ).length;
}

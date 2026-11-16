export type InboxDay = 'today' | 'yesterday' | 'earlier';

/** Local calendar bucket for an inbox row. */
export function inboxDay(createdAt: string | number, now: Date = new Date()): InboxDay {
  const time = typeof createdAt === 'number' ? createdAt : +new Date(createdAt);
  if (!Number.isFinite(time)) return 'earlier';
  const date = new Date(time);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return 'today';
  if (day === today - 86_400_000) return 'yesterday';
  return 'earlier';
}

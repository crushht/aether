export type AuditRange = 'all' | 'week' | 'month';

/** Local Monday 00:00 (week) or the 1st 00:00 (month); null for all time. */
export function auditRangeStart(range: AuditRange, now: Date = new Date()): number | null {
  if (range === 'all') return null;
  const start = new Date(now);
  if (range === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export function inAuditRange(at: string | number, range: AuditRange, now: Date = new Date()): boolean {
  const start = auditRangeStart(range, now);
  if (start === null) return true;
  const time = typeof at === 'number' ? at : +new Date(at);
  if (!Number.isFinite(time)) return false;
  return time >= start;
}

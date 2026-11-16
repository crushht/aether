export interface QuietHours {
  enabled: boolean;
  /** local hour 0–23 */
  start: number;
  /** local hour 0–23; equal to start means all day */
  end: number;
}

const clampHour = (value: unknown, fallback: number) => {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
};

export function normalizeQuiet(value: Partial<QuietHours> | undefined): QuietHours {
  return {
    enabled: Boolean(value?.enabled),
    start: clampHour(value?.start, 22),
    end: clampHour(value?.end, 8),
  };
}

/** Whether `at` falls inside the quiet window; handles windows across midnight. */
export function inQuietHours(quiet: QuietHours, at: Date = new Date()): boolean {
  if (!quiet.enabled) return false;
  const hour = at.getHours();
  const start = clampHour(quiet.start, 22);
  const end = clampHour(quiet.end, 8);
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Desktop delivery: the type toggle and the quiet window must both allow it. */
export function canNotifyDesktop(
  enabled: boolean,
  quiet: QuietHours,
  at: Date = new Date(),
): boolean {
  return enabled && !inQuietHours(quiet, at);
}

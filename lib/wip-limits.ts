/**
 * Work-in-progress limits for the board.
 *
 * A WIP limit is not a rule the app can enforce by refusing a drag — people
 * move work for good reasons. It is a number the column can be honest about:
 * `3 / 5` is fine, `6 / 5` is red. Everything here is the counting and the
 * cleaning; the column header is the only place that renders it.
 */

export const WIP_MIN = 1;
export const WIP_MAX = 99;
/** how many columns may carry a limit before the preference gets silly */
const MAX_ENTRIES = 12;

export type WipLimits = Record<string, number>;

const clean = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const whole = Math.round(numeric);
  if (whole < WIP_MIN || whole > WIP_MAX) return null;
  return whole;
};

/** Whatever was in storage, as a usable map: numbers in range, unknown shapes dropped. */
export function normalizeWipLimits(raw: unknown): WipLimits {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: WipLimits = {};
  for (const [status, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = status.trim();
    if (!key) continue;
    const limit = clean(value);
    if (limit === null) continue;
    out[key] = limit;
    if (Object.keys(out).length >= MAX_ENTRIES) break;
  }
  return out;
}

/** Set or clear one column's limit. Clearing deletes the key rather than storing 0. */
export function setWipLimit(limits: WipLimits, status: string, value: unknown): WipLimits {
  const key = status.trim();
  if (!key) return limits;
  const limit = clean(value);
  const next = { ...limits };
  if (limit === null) delete next[key];
  else next[key] = limit;
  return next;
}

export function wipLimitOf(limits: WipLimits | undefined, status: string): number | null {
  const value = limits?.[status];
  return typeof value === 'number' ? value : null;
}

export interface WipReadout {
  count: number;
  limit: number | null;
  /** more cards than the limit allows */
  over: boolean;
  /** exactly at the limit — the last comfortable card */
  at: boolean;
  /** `6 / 5` with a limit, `3` without */
  text: string;
}

export function wipReadout(count: number, limit: number | null | undefined): WipReadout {
  const cards = Number.isFinite(count) ? Math.max(0, Math.trunc(count as number)) : 0;
  const cap = typeof limit === 'number' && Number.isFinite(limit) ? clean(limit) : null;
  if (cap === null) return { count: cards, limit: null, over: false, at: false, text: `${cards}` };
  return {
    count: cards,
    limit: cap,
    over: cards > cap,
    at: cards === cap,
    text: `${cards} / ${cap}`,
  };
}

/** One line for the header tooltip: what the limit means, not just the number. */
export function wipHint(readout: WipReadout): string {
  if (readout.limit === null) return '';
  const room = readout.limit - readout.count;
  if (readout.over) return `over by ${-room}`;
  if (room === 0) return 'at the limit';
  return `${room} left`;
}

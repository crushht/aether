/**
 * In-process sliding-window limiter for the auth endpoints.
 *
 * Accounts live in one local JSON file, so a single process owns every write:
 * an in-memory window is enough, and it costs nothing on the happy path. The
 * keys are pruned as they expire so a busy server cannot grow the map forever.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit = 10, windowMs = 60_000, now = Date.now()): RateLimitResult {
  const hits = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1_000)),
    };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) {
    for (const [entry, times] of buckets) {
      if (!times.some((at) => now - at < windowMs)) buckets.delete(entry);
    }
  }
  return { ok: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

/** A successful sign-in clears the window, so a correct password is never penalised. */
export function clearRateLimit(key: string) {
  buckets.delete(key);
}

export function resetRateLimits() {
  buckets.clear();
}

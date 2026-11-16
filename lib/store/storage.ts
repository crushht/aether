/**
 * Small helpers for the per-account localStorage stores. Every store used to
 * repeat the same try/JSON.parse/filter/quota dance; keeping it in one place
 * makes the sanitising rules auditable and stops one malformed key from
 * breaking a whole feature.
 */

export function readStorage<T>(key: string, sanitize: (value: unknown) => T | null, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return sanitize(parsed) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // quota or private-mode failure: the in-memory state still works
    return false;
  }
}

export const isStringArray = (value: unknown, max: number): string[] | null =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, max) : null;

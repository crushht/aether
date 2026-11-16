import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { getLocale, localeTag, pluralize, translate } from './i18n';

/**
 * tailwind-merge needs to know our custom font-size names, otherwise
 * `text-title3` is treated as a colour and gets merged away by `text-t1`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['micro', 'tiny', 'mini', 'small', 'reg', 'title1', 'title2', 'title3', 'title4'] },
      ],
      rounded: [{ rounded: ['r4', 'r6', 'r8', 'r9', 'r12', 'r16', 'full'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * True while an IME is composing (Chinese/Japanese/Korean input). Enter that
 * confirms a candidate must never submit the surrounding form.
 */
export function isImeComposing(event: {
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  const native = event.nativeEvent ?? event;
  return Boolean(native.isComposing) || native.keyCode === 229;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now = Date.now()) {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  if (getLocale() === 'zh') {
    if (diff < MINUTE) return translate('zh', 'just now');
    if (diff < HOUR) return translate('zh', '{n} minutes ago', { n: Math.floor(diff / MINUTE) });
    if (diff < DAY) return translate('zh', '{n} hours ago', { n: Math.floor(diff / HOUR) });
    if (diff < 2 * DAY) return translate('zh', 'yesterday');
    if (diff < 7 * DAY) return translate('zh', '{n} days ago', { n: Math.floor(diff / DAY) });
    return shortDate(iso);
  }
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return shortDate(iso);
}

export function shortDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(localeTag(getLocale()), { month: 'short', day: 'numeric' });
}

export function dateRange(start: string, end: string) {
  const f = (d: string) => new Date(d).toLocaleDateString(localeTag(getLocale()), { month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function plural(n: number, word: string, suffix = 's') {
  return pluralize(getLocale(), n, word, suffix);
}

/** Tiny subsequence fuzzy matcher with contiguous-bonus ranking. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 1000 - t.indexOf(q) * 2 - (t.length - q.length) * 0.2;
  let qi = 0;
  let score = 0;
  let run = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      qi++;
      run++;
      score += 4 + run * 2 + (i === 0 || /[\s\-_/:]/.test(t[i - 1]) ? 6 : 0);
    } else {
      run = 0;
    }
  }
  return qi === q.length ? score : -1;
}

export function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K) {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

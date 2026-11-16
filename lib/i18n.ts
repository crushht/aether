/**
 * Two-locale UI dictionary.
 *
 * The keys are the English source strings, so a missing entry falls back to the
 * English wording instead of showing a raw key. Content (issue titles, people,
 * comments, project summaries) is mock data and stays as typed.
 */

import { zh } from './locales/zh';

export type Locale = 'en' | 'zh';

/** Units used by `plural()`; zh has no plural suffix. */
const zhUnits: Record<string, string> = {
  issue: '个议题',
  comment: '条评论',
  project: '个项目',
  person: '位成员',
  people: '位成员',
  point: '点',
  points: '点',
  notification: '条通知',
  'open issue': '个未关闭议题',
};

let active: Locale = 'zh';

export function getLocale(): Locale {
  return active;
}

export function setActiveLocale(locale: Locale) {
  active = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.dataset.locale = locale;
  }
}

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>) {
  const raw = locale === 'zh' ? (zh[key] ?? key) : key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] === undefined ? match : String(vars[name]),
  );
}

export function pluralize(locale: Locale, n: number, unit: string, suffix = 's') {
  if (locale === 'zh') return `${n} ${zhUnits[unit] ?? unit}`;
  return `${n} ${unit}${n === 1 ? '' : suffix}`;
}

export function localeTag(locale: Locale) {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

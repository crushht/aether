import type { ChatSource } from './types';
import { hostOf, oneLine, safeHttpUrl } from './tool-cards';

/**
 * Where an answer came from.
 *
 * The model is not asked to write citations: it forgets, invents ids and pads
 * answers with fake links. Instead every tool that touched an outside source
 * reports what it touched, the run collects those reports, and the bubble shows
 * the list under the answer. A source the tools never opened cannot appear.
 *
 * Pure: the store collects, the transcript renders, the regression harness
 * holds the de-duplication and the cap still.
 */

export const SOURCE_LIMIT = 5;

/** Stable identity for de-duplication: one entry per page or per knowledge chunk. */
export function sourceKey(source: ChatSource): string {
  if (source.kind === 'knowledge') return `k:${(source.ref ?? source.title).toLowerCase()}`;
  return `w:${(source.url ?? source.title).toLowerCase()}`;
}

/**
 * Append new sources, first-seen order, deduplicated, capped.
 * Anything malformed is dropped rather than repaired: a broken citation is
 * worse than no citation.
 */
export function addSources(current: ChatSource[], incoming: readonly ChatSource[] | undefined): ChatSource[] {
  if (!incoming?.length) return current;
  const seen = new Set(current.map(sourceKey));
  const next = [...current];
  for (const source of incoming) {
    if (!isChatSource(source)) continue;
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(source);
    if (next.length >= SOURCE_LIMIT) break;
  }
  return next;
}

export function isChatSource(value: unknown): value is ChatSource {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ChatSource>;
  if (row.kind !== 'web' && row.kind !== 'knowledge') return false;
  if (typeof row.title !== 'string' || !row.title.trim()) return false;
  if (row.url !== undefined && typeof row.url !== 'string') return false;
  if (row.ref !== undefined && typeof row.ref !== 'string') return false;
  if (row.kind === 'web' && !safeHttpUrl(row.url)) return false;
  if (row.kind === 'knowledge' && !row.ref && !row.title) return false;
  return true;
}

/** What the chip shows: the host for a page, the title for a knowledge entry. */
export function sourceLabel(source: ChatSource): string {
  if (source.kind === 'web') return hostOf(source.url) || oneLine(source.title, 60);
  return oneLine(source.title, 80);
}

/** Where a chip goes: the page itself, or the knowledge entry by id. */
export function sourceHref(source: ChatSource): string {
  if (source.kind === 'web') return safeHttpUrl(source.url) ?? '';
  const id = (source.ref ?? '').split('#')[0];
  return id ? `/knowledge?id=${encodeURIComponent(id)}` : '';
}

/** Markdown block for a chat comment or an export: the same list, as text. */
export function sourcesMarkdown(sources: readonly ChatSource[]): string {
  if (!sources.length) return '';
  const lines = sources.map((source) => {
    if (source.kind === 'web') {
      const url = safeHttpUrl(source.url);
      return url ? `- [${oneLine(source.title, 120)}](${url})` : '';
    }
    return `- Knowledge: ${oneLine(source.title, 120)}`;
  });
  return lines.filter(Boolean).join('\n');
}

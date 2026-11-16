/**
 * Structured tool receipts.
 *
 * A transcript row used to be one line of text, so a search or an artifact
 * report could only be read in the model's prose. These builders turn the raw
 * tool payload into a small, bounded, serialisable card the chat can expand:
 * a hit list for `web_search`, a triage report for `inspect_artifact`.
 *
 * Everything here is pure: no React, no fetch, no imports. The transcript
 * re-validates whatever comes back from localStorage or the server with
 * `isToolCard` before rendering it, so a stale or hand-edited session can only
 * lose the card, never break the row.
 */

/* ------------------------------------------------------------------ shared */

/** Cards are persisted with the session, so every list is clipped. */
export const CARD_LIMITS = {
  hits: 6,
  title: 140,
  url: 400,
  snippet: 180,
  structure: 12,
  indicators: 16,
  embedded: 8,
  strings: 10,
  notes: 3,
  hex: 6,
} as const;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Trim, drop control characters (except newlines) and clip to `max`. */
export function clipText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL, ' ').trim().slice(0, max);
}

/** Same, but collapsed to one line — for titles, hosts and snippets. */
export function oneLine(value: unknown, max: number): string {
  return clipText(value, max).replace(/\s+/g, ' ').trim();
}

/** Only http(s) survives; anything else renders as plain text, never a link. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().slice(0, CARD_LIMITS.url);
  } catch {
    return null;
  }
}

/** Host for display in a hit row (`www.` dropped, like every link list). */
export function hostOf(value: unknown): string {
  const url = safeHttpUrl(value);
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 1536 → "1.5 KB". Binary units; no locale formatting on purpose. */
export function formatBytes(bytes: unknown): string {
  const value = typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB'];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10} ${units[unit]}`;
}

/* ------------------------------------------------------------------ search */

export interface SearchHit {
  title: string;
  /** empty when the engine returned something unusable */
  url: string;
  snippet: string;
}

export interface SearchCard {
  kind: 'search';
  query: string;
  /** the engine that answered, e.g. "duckduckgo" */
  source: string;
  hits: SearchHit[];
}

export interface SearchCardInput {
  query?: unknown;
  provider?: unknown;
  results?: unknown;
}

function toHit(value: unknown): SearchHit | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { title?: unknown; url?: unknown; snippet?: unknown };
  const title = oneLine(row.title, CARD_LIMITS.title);
  const url = safeHttpUrl(row.url) ?? '';
  const snippet = oneLine(row.snippet, CARD_LIMITS.snippet);
  if (!title && !url) return null;
  return { title: title || url, url, snippet };
}

/** Build the card for a `web_search` receipt; null when nothing usable came back. */
export function buildSearchCard(input: SearchCardInput): SearchCard | null {
  const rows = Array.isArray(input.results) ? input.results : [];
  const hits: SearchHit[] = [];
  for (const row of rows) {
    const hit = toHit(row);
    if (hit) hits.push(hit);
    if (hits.length >= CARD_LIMITS.hits) break;
  }
  if (!hits.length) return null;
  return {
    kind: 'search',
    query: oneLine(input.query, 200),
    source: oneLine(input.provider, 60),
    hits,
  };
}

/* ----------------------------------------------------------------- inspect */

export interface InspectIndicator {
  kind: string;
  value: string;
}

export interface InspectBlob {
  kind: string;
  bytes: number;
  format: string;
}

export interface InspectCard {
  kind: 'inspect';
  name: string;
  size: number;
  /** human label from the format sniffer, e.g. "PE executable" */
  format: string;
  formatId: string;
  detail?: string;
  sha256?: string;
  md5?: string;
  entropy: number;
  packed: boolean;
  structure: string[];
  indicators: InspectIndicator[];
  embedded: InspectBlob[];
  notes: string[];
  strings: string[];
  /** how many strings the report actually carried, so the card can say "first 12 of N" */
  stringTotal: number;
  hex: string[];
}

export interface InspectCardInput {
  name?: unknown;
  size?: unknown;
  format?: { label?: unknown; id?: unknown; detail?: unknown };
  entropy?: unknown;
  packed?: unknown;
  hashes?: { sha256?: unknown; md5?: unknown };
  /** pre-formatted header/section/entry lines built by the tool layer */
  structure?: unknown;
  indicators?: unknown;
  embedded?: unknown;
  notes?: unknown;
  strings?: unknown;
  hex?: unknown;
}

const stringList = (value: unknown, max: number, each = 200): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clipText(item, each);
    if (text) out.push(text);
    if (out.length >= max) break;
  }
  return out;
};

/**
 * Build the card for an `inspect_artifact` receipt. The report never carries
 * the sample's bytes, so this stays small enough to live in a session.
 */
export function buildInspectCard(input: InspectCardInput): InspectCard {
  const hashes = input.hashes ?? {};
  const indicators: InspectIndicator[] = [];
  for (const item of Array.isArray(input.indicators) ? input.indicators : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { kind?: unknown; value?: unknown };
    const kind = oneLine(row.kind, 24);
    const value = oneLine(row.value, 300);
    if (kind && value) indicators.push({ kind, value });
    if (indicators.length >= CARD_LIMITS.indicators) break;
  }
  const embedded: InspectBlob[] = [];
  for (const item of Array.isArray(input.embedded) ? input.embedded : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { kind?: unknown; bytes?: unknown; format?: unknown };
    embedded.push({
      kind: oneLine(row.kind, 24),
      bytes: typeof row.bytes === 'number' && Number.isFinite(row.bytes) ? row.bytes : 0,
      format: oneLine(row.format, 80),
    });
    if (embedded.length >= CARD_LIMITS.embedded) break;
  }
  const strings = stringList(input.strings, CARD_LIMITS.strings);
  const stringTotal = Array.isArray(input.strings) ? input.strings.length : strings.length;
  const entropy = typeof input.entropy === 'number' && Number.isFinite(input.entropy) ? Math.round(input.entropy * 100) / 100 : 0;
  return {
    kind: 'inspect',
    name: oneLine(input.name, 200) || 'artifact',
    size: typeof input.size === 'number' && Number.isFinite(input.size) ? input.size : 0,
    format: oneLine(input.format?.label, 60) || 'unknown',
    formatId: oneLine(input.format?.id, 40),
    detail: oneLine(input.format?.detail, 120) || undefined,
    sha256: /^[0-9a-f]{64}$/i.test(String(hashes.sha256 ?? '')) ? String(hashes.sha256).toLowerCase() : undefined,
    md5: /^[0-9a-f]{32}$/i.test(String(hashes.md5 ?? '')) ? String(hashes.md5).toLowerCase() : undefined,
    entropy,
    packed: Boolean(input.packed),
    structure: stringList(input.structure, CARD_LIMITS.structure),
    indicators,
    embedded,
    notes: stringList(input.notes, CARD_LIMITS.notes),
    strings,
    stringTotal,
    hex: stringList(input.hex, CARD_LIMITS.hex),
  };
}

/* -------------------------------------------------------------------- union */

export type ToolCard = SearchCard | InspectCard;

/**
 * Guard for anything read back from storage or another device: a card that
 * fails here is simply not rendered (the one-line receipt still is).
 */
export function isToolCard(value: unknown): value is ToolCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as { kind?: unknown };
  if (card.kind === 'search') {
    const row = value as Partial<SearchCard>;
    return (
      typeof row.query === 'string' &&
      typeof row.source === 'string' &&
      Array.isArray(row.hits) &&
      row.hits.every(
        (hit) =>
          Boolean(hit) &&
          typeof hit.title === 'string' &&
          typeof hit.url === 'string' &&
          typeof hit.snippet === 'string',
      )
    );
  }
  if (card.kind === 'inspect') {
    const row = value as Partial<InspectCard>;
    return (
      typeof row.name === 'string' &&
      typeof row.format === 'string' &&
      typeof row.entropy === 'number' &&
      typeof row.packed === 'boolean' &&
      Array.isArray(row.structure) &&
      Array.isArray(row.indicators) &&
      Array.isArray(row.embedded) &&
      Array.isArray(row.notes) &&
      Array.isArray(row.strings) &&
      Array.isArray(row.hex) &&
      typeof row.stringTotal === 'number'
    );
  }
  return false;
}

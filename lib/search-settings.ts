/**
 * Where `web_search` is allowed to look, as data.
 *
 * Two modes, and only two:
 *
 *   - the built-in chain (DuckDuckGo → Bing → 搜狗 → 百度 → 360), tried in the
 *     order the operator picked, stopping at the first engine that answers;
 *   - one pinned endpoint — normally a self-hosted SearXNG — which wins over
 *     the chain entirely because an operator who runs their own metasearch does
 *     not want traffic leaking back to the public engines.
 *
 * Nothing here touches the disk, a socket or the clock: the endpoint rules, the
 * SearXNG JSON shape, the engine order and the precedence between "saved in this
 * workspace" and "read-only .env.local" are all testable in regression.
 * `lib/server/search-settings.ts` owns the file, `lib/server/web-search.ts`
 * owns the fetching.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchEngine {
  id: string;
  label: string;
  url: (query: string) => string;
}

/**
 * The chain that works without any configuration. Every entry is an HTML
 * endpoint, because that is what answers without an API key.
 */
export const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: 'duckduckgo',
    label: 'duckduckgo.com',
    url: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'bing',
    label: 'cn.bing.com',
    url: (query) => `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`,
  },
  {
    id: 'sogou',
    label: 'sogou.com',
    url: (query) => `https://www.sogou.com/web?query=${encodeURIComponent(query)}`,
  },
  {
    id: 'baidu',
    label: 'baidu.com',
    url: (query) => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
  },
  {
    id: '360',
    label: 'so.com',
    url: (query) => `https://www.so.com/s?q=${encodeURIComponent(query)}`,
  },
];

const ENGINE_IDS = SEARCH_ENGINES.map((engine) => engine.id);

/** All engine ids, in the shipped order. */
export function engineIds(): string[] {
  return [...ENGINE_IDS];
}

export function engineById(id: unknown): SearchEngine | null {
  const key = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (!key) return null;
  return SEARCH_ENGINES.find((engine) => engine.id === key) ?? null;
}

export function engineLabel(id: unknown): string {
  return engineById(id)?.label ?? '';
}

export interface SearchSettings {
  /** '' means "run the built-in chain"; anything else is one endpoint. */
  url: string;
  /** Enabled engines, highest priority first. */
  engines: string[];
}

export type SearchSource = 'settings' | 'env' | 'default';
export type SearchKind = 'builtin' | 'searxng' | 'custom';

export function defaultSearchSettings(): SearchSettings {
  return { url: '', engines: engineIds() };
}

/* ------------------------------------------------------------------ endpoint */

/**
 * A search endpoint may live on this machine (Docker SearXNG on 127.0.0.1 is
 * the common case), so the private-range check here is a *licence* to use plain
 * http, not a block — the opposite of `safePageUrl`, which must not become a
 * probe into the host's network. Same line the connectors and the mail relay
 * draw.
 */
const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^\[?::1\]?$/i,
  /^\[?(fc|fd|fe80)/i,
  /\.local$/i,
  /\.internal$/i,
  /^[a-z0-9-]+$/i,
];

export function isLocalSearchHost(host: unknown): boolean {
  const value = typeof host === 'string' ? host.trim().toLowerCase() : '';
  if (!value) return false;
  return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(value));
}

export interface SearchEndpoint {
  ok: boolean;
  /** Normalised endpoint when pinned; '' when the built-in chain should run. */
  url: string;
  host: string;
  kind: SearchKind;
  error?: string;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function endpointFailure(error: string): SearchEndpoint {
  return { ok: false, url: '', host: '', kind: 'custom', error };
}

/**
 * Accept what people actually paste — `searx.example.com`, `127.0.0.1:8888`,
 * `https://searx.example.com/search?language=zh` — and hand back one URL the
 * fetcher can append `q` to.
 */
export function checkSearchEndpoint(raw: unknown): SearchEndpoint {
  if (typeof raw !== 'string') return { ok: true, url: '', host: '', kind: 'builtin' };
  let value = raw.trim();
  if (!value) return { ok: true, url: '', host: '', kind: 'builtin' };
  if (value.length > 400) return endpointFailure('That endpoint is too long.');

  if (!SCHEME_RE.test(value)) {
    const guess = value.replace(/^\/+/, '').split(/[/:?#]/)[0] ?? '';
    value = `${isLocalSearchHost(guess) ? 'http' : 'https'}://${value.replace(/^\/+/, '')}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return endpointFailure('That does not parse as a URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return endpointFailure('Only http(s) endpoints can answer a search.');
  }
  if (parsed.username || parsed.password) {
    return endpointFailure('Keep credentials out of the URL — use the network layer for that.');
  }
  if (parsed.protocol === 'http:' && !isLocalSearchHost(parsed.hostname)) {
    return endpointFailure('Use https for a public endpoint — plain http would leak every query.');
  }

  parsed.hash = '';
  parsed.searchParams.delete('q');
  const path = parsed.pathname.replace(/\/+$/, '');
  const kind: SearchKind = /searx/i.test(parsed.hostname) || /searx/i.test(path) || /\/search$/i.test(path) ? 'searxng' : 'custom';
  return { ok: true, url: parsed.toString(), host: parsed.host, kind };
}

/** The endpoint with `q` filled in, keeping any other parameters. */
export function buildSearchUrl(endpoint: string, query: string): string {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  return url.toString();
}

/**
 * SearXNG answers `format=json` on the same path it answers HTML on, but JSON
 * must be enabled in its `settings.yml`; the fetcher therefore probes this URL
 * first and falls back to the HTML layout when it gets a page back.
 */
export function searxngJsonUrl(endpoint: string): string {
  const url = new URL(endpoint);
  url.searchParams.set('format', 'json');
  return url.toString();
}

/** A body that is JSON, whatever the upstream claimed in content-type. */
export function looksLikeJsonBody(body: string): boolean {
  const head = body.trimStart().slice(0, 1);
  return head === '{' || head === '[';
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * `{ results: [{ title, url, content }] }` → hits. Anything without an http(s)
 * URL is dropped, duplicates collapse, and both the count and each field are
 * capped: the model reads this, so it should not be able to swallow a session.
 */
export function parseSearxngPayload(payload: unknown, limit = 8): SearchHit[] {
  let data: unknown = payload;
  if (typeof payload === 'string') {
    if (!looksLikeJsonBody(payload)) return [];
    try {
      data = JSON.parse(payload);
    } catch {
      return [];
    }
  }
  if (!data || typeof data !== 'object') return [];
  const rows = (data as { results?: unknown }).results;
  if (!Array.isArray(rows)) return [];

  const want = Math.max(1, Math.min(Number(limit) || 8, 20));
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (hits.length >= want) break;
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const title = clip(typeof record.title === 'string' ? record.title : '', 200) || url;
    const body =
      typeof record.content === 'string'
        ? record.content
        : typeof record.snippet === 'string'
          ? record.snippet
          : typeof record.description === 'string'
            ? record.description
            : '';
    hits.push({ title, url, snippet: clip(body, 260) });
  }
  return hits;
}

/* ------------------------------------------------------------------ priority */

/** The order as written, unknown ids and repeats dropped, no fallback. */
function cleanEngineOrder(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const item of source) {
    const id = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!id || !ENGINE_IDS.includes(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * A chain with zero engines would leave the agent blind, so an empty list means
 * "every engine, shipped order" rather than "nothing".
 */
export function normalizeEngineOrder(raw: unknown): string[] {
  const order = cleanEngineOrder(raw);
  return order.length ? order : engineIds();
}

/** One step up (`-1`) or down (`+1`); out-of-range moves are a no-op. */
export function moveEngine(order: unknown, id: unknown, delta: number): string[] {
  const list = normalizeEngineOrder(order);
  const key = typeof id === 'string' ? id.trim().toLowerCase() : '';
  const index = list.indexOf(key);
  const target = index + (Number.isFinite(delta) ? Math.trunc(delta) : 0);
  if (index < 0 || target < 0 || target >= list.length) return list;
  list.splice(index, 1);
  list.splice(target, 0, key);
  return list;
}

/** Turn one engine off, or back on at the end of the chain. */
export function toggleEngine(order: unknown, id: unknown): string[] {
  const key = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (!ENGINE_IDS.includes(key)) return normalizeEngineOrder(order);
  const list = cleanEngineOrder(order);
  if (list.includes(key)) {
    const without = list.filter((engine) => engine !== key);
    return without.length ? without : normalizeEngineOrder(order);
  }
  return normalizeEngineOrder([...list, key]);
}

/* -------------------------------------------------------------------- config */

export interface SearchDraft {
  url?: unknown;
  engines?: unknown;
}

export function normalizeSearchSettings(draft: SearchDraft = {}, base: SearchSettings | null = null): SearchSettings {
  const rawUrl = draft.url === undefined ? (base?.url ?? '') : draft.url;
  const checked = checkSearchEndpoint(rawUrl);
  const enginesRaw = draft.engines === undefined ? (base?.engines ?? []) : draft.engines;
  return {
    url: checked.ok ? checked.url : typeof rawUrl === 'string' ? rawUrl.trim() : '',
    engines: normalizeEngineOrder(enginesRaw),
  };
}

export interface SearchValidation {
  ok: boolean;
  settings: SearchSettings;
  endpoint: SearchEndpoint;
  errors: { url?: string };
}

export function validateSearchDraft(draft: SearchDraft = {}, options: { base?: SearchSettings | null } = {}): SearchValidation {
  const settings = normalizeSearchSettings(draft, options.base ?? null);
  const endpoint = checkSearchEndpoint(draft.url === undefined ? (options.base?.url ?? '') : draft.url);
  const errors: { url?: string } = {};
  if (!endpoint.ok && endpoint.error) errors.url = endpoint.error;
  return { ok: Object.keys(errors).length === 0, settings, endpoint, errors };
}

/** `.env.local` still configures a container without a UI. */
export function envSearchSettings(env: Record<string, string | undefined>): SearchSettings | null {
  const rawUrl = (env.AETHER_SEARCH_URL ?? '').trim();
  const rawEngines = (env.AETHER_SEARCH_ENGINES ?? '').trim();
  if (!rawUrl && !rawEngines) return null;
  const url = rawUrl && checkSearchEndpoint(rawUrl).ok ? checkSearchEndpoint(rawUrl).url : '';
  return { url, engines: normalizeEngineOrder(rawEngines) };
}

/**
 * A saved entry is the operator's explicit choice, so it outranks the
 * environment; the environment outranks the shipped chain.
 */
export function resolveSearchSettings(
  saved: SearchSettings | null,
  env: SearchSettings | null,
): { settings: SearchSettings; source: SearchSource } {
  if (saved) return { settings: normalizeSearchSettings(saved), source: 'settings' };
  if (env) return { settings: normalizeSearchSettings(env), source: 'env' };
  return { settings: defaultSearchSettings(), source: 'default' };
}

export interface SearchSourceDescription {
  kind: SearchKind;
  host: string;
  endpoint: string;
  source: SearchSource;
}

/** What the settings page and the API report, in one shape. */
export function describeSearchSource(settings: SearchSettings, source: SearchSource = 'default'): SearchSourceDescription {
  const checked = checkSearchEndpoint(settings.url);
  if (!checked.ok || checked.kind === 'builtin') {
    return { kind: 'builtin', host: '', endpoint: '', source };
  }
  return { kind: checked.kind, host: checked.host, endpoint: checked.url, source };
}

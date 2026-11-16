import {
  buildSearchUrl,
  checkSearchEndpoint,
  engineById,
  looksLikeJsonBody,
  parseSearxngPayload,
  searxngJsonUrl,
  SEARCH_ENGINES,
  type SearchSettings,
} from '@/lib/search-settings';

/**
 * Web search without an API key.
 *
 * Aether runs on private machines, and which engine answers depends on the
 * network: DuckDuckGo and Bing in some places, Baidu/Sogou/360 in others. So
 * this tries a short chain of HTML endpoints and parses the first one that
 * returns results. Three parsers cover the layouts in use:
 *
 *   - DuckDuckGo's `result__a` / `result__snippet` markup
 *   - a generic `<h2|h3><a href>title</a></h3>` + following text, which is what
 *     Baidu, Sogou, 360 and Bing all emit
 *   - SearXNG's `{ results: [...] }` JSON, which needs no layout guessing at all
 *
 * Which source runs is a setting now, not only an environment variable: the
 * chosen endpoint and the engine order arrive as `SearchSettings` from
 * `lib/server/search-settings.ts`. A pinned endpoint replaces the chain (a
 * self-hosted SearXNG should not leak queries back to the public engines);
 * otherwise the configured engines are tried in order.
 *
 * Everything except `fetch` is a pure function with its own tests.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResult {
  query: string;
  provider: string;
  results: SearchHit[];
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
};

export function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED[name.toLowerCase()] ?? match);
}

export function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** DDG wraps every hit in `/l/?uddg=<encoded>`; unwrap it back to the real page. */
export function duckDuckGoHref(raw: string): string {
  const value = decodeHtml(raw.trim());
  if (!value) return '';
  try {
    const url = new URL(value, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return target;
    if (/^https?:$/i.test(url.protocol)) return url.toString();
    if (value.startsWith('//')) return `https:${value}`;
    if (/^https?:\/\//i.test(value)) return value;
    return '';
  } catch {
    return /^https?:\/\//i.test(value) ? value : '';
  }
}

/** The classic `html.duckduckgo.com/html/` layout. */
export function parseDuckDuckGo(html: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult__body\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    if (hits.length >= limit) break;
    const link = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = duckDuckGoHref(link[1]);
    if (!url) continue;
    const snippet = /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    hits.push({ title: stripTags(link[2]), url, snippet: snippet ? stripTags(snippet[1]) : '' });
  }
  if (hits.length) return hits;

  // lite layout: a table of anchors, snippet beside them
  const anchors = [...html.matchAll(/<a[^>]+class=['"][^'"]*result-link[^'"]*['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const anchor of anchors) {
    if (hits.length >= limit) break;
    const url = duckDuckGoHref(anchor[1]);
    if (!url) continue;
    hits.push({ title: stripTags(anchor[2]), url, snippet: '' });
  }
  if (hits.length) {
    const snippets = [...html.matchAll(/class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      stripTags(match[1]),
    );
    hits.forEach((hit, index) => {
      hit.snippet = snippets[index] ?? '';
    });
  }
  return hits;
}

function resolveHref(raw: string, baseUrl: string): string {
  const value = decodeHtml(raw.trim());
  if (!value || /^(?:javascript|mailto|tel|data):/i.test(value)) return '';
  try {
    const url = new URL(value, baseUrl);
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

/** Engines append the next result's breadcrumb to a summary; cut before it. */
export function trimSnippet(value: string): string {
  const cut = value.search(/\s(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|co|me)\b/i);
  const body = cut > 40 ? value.slice(0, cut) : value;
  return body.replace(/\s*[›»]\s*$/, '').trim().slice(0, 260);
}

/**
 * Baidu / Sogou / 360 / Bing all put the title in an `<h2>` or `<h3>` with one
 * anchor, and the summary in the text right after it.
 */
export function parseHeadingResults(html: string, baseUrl: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const headings = /<h([23])[^>]*>([\s\S]{0,800}?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = headings.exec(html)) && hits.length < limit) {
    const link = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(match[2]);
    if (!link) continue;
    const url = resolveHref(link[1], baseUrl);
    const title = stripTags(link[2]);
    if (!url || !title || title.length < 2) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 1_600);
    const snippet = trimSnippet(stripTags(after.split(/<h[23][^>]*>/i)[0]));
    hits.push({ title, url, snippet });
  }
  return hits;
}

interface Provider {
  id: string;
  label: string;
  url: (query: string) => string;
  /** A SearXNG instance also answers `format=json` on the same path. */
  jsonUrl?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * The chain to try, in the order the operator picked. A pinned endpoint wins
 * over the chain entirely; an unparsable endpoint falls back to the chain
 * instead of failing the search.
 */
export function buildProviders(settings: Partial<SearchSettings> = {}): Provider[] {
  const endpoint = checkSearchEndpoint(settings.url ?? '');
  if (endpoint.ok && endpoint.url) {
    return [
      {
        id: endpoint.kind === 'searxng' ? 'searxng' : 'custom',
        label: endpoint.host || endpoint.url,
        url: (query) => buildSearchUrl(endpoint.url, query),
        jsonUrl: searxngJsonUrl(endpoint.url),
      },
    ];
  }

  const order = Array.isArray(settings.engines) && settings.engines.length ? settings.engines : SEARCH_ENGINES.map((engine) => engine.id);
  const chain: Provider[] = [];
  for (const id of order) {
    const engine = engineById(id);
    if (engine) chain.push({ id: engine.id, label: engine.label, url: engine.url });
  }
  if (chain.length) return chain;
  return SEARCH_ENGINES.map((engine) => ({ id: engine.id, label: engine.label, url: engine.url }));
}

async function readBody(provider: Provider, url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${provider.label} answered ${response.status}.`);
  return response.text();
}

function parseBody(body: string, baseUrl: string, limit: number): SearchHit[] {
  if (looksLikeJsonBody(body)) {
    const fromJson = parseSearxngPayload(body, limit);
    if (fromJson.length) return fromJson;
  }
  const fromDdg = parseDuckDuckGo(body, limit);
  if (fromDdg.length) return fromDdg;
  return parseHeadingResults(body, baseUrl, limit);
}

async function askOne(provider: Provider, query: string, limit: number): Promise<SearchHit[]> {
  if (provider.jsonUrl) {
    // Ask for JSON first: it is the only format with no layout to guess at.
    // A SearXNG with `format=json` disabled answers 403 (or HTML), so the HTML
    // probe below is the normal second attempt, not an error path.
    try {
      const jsonHits = parseSearxngPayload(await readBody(provider, provider.jsonUrl, 'application/json'), limit);
      if (jsonHits.length) return jsonHits;
    } catch {
      /* fall through to HTML */
    }
    const htmlUrl = provider.url(query);
    return parseBody(await readBody(provider, htmlUrl, 'text/html,application/xhtml+xml'), htmlUrl, limit);
  }
  const url = provider.url(query);
  return parseBody(await readBody(provider, url, 'text/html,application/xhtml+xml'), url, limit);
}

export async function searchWeb(query: string, limit = 6, settings: Partial<SearchSettings> = {}): Promise<SearchResult> {
  const clean = query.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) throw new Error('A search needs a query.');
  const want = Math.min(Math.max(limit, 1), 10);

  const failures: string[] = [];
  for (const provider of buildProviders(settings)) {
    try {
      const results = await askOne(provider, clean, want);
      if (results.length) return { query: clean, provider: provider.label, results };
      failures.push(`${provider.label}: no results`);
    } catch (error) {
      failures.push(`${provider.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No search engine answered. ${failures.join(' · ')}`);
}

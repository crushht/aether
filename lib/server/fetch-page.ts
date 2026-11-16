import { safePageUrl } from '@/lib/agent/guard';

export interface PageLink {
  text: string;
  href: string;
}

export interface PageResult {
  url: string;
  title: string;
  text: string;
  chars: number;
  truncated: boolean;
  /** Outbound links the agent can follow, resolved against the page URL. */
  links: PageLink[];
}

const MAX_CHARS = 120_000;

const ENTITIES: Record<string, string> = {
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

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

/** HTML → readable text. Deliberately dependency-free: titles and paragraphs are enough for context. */
export function htmlToText(html: string) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

/**
 * Outbound links with readable labels, in page order. Enough for an agent to
 * choose the next page; anchors, mail links and duplicates are dropped.
 */
export function extractLinks(html: string, baseUrl: string, limit = 40): PageLink[] {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && out.length < limit) {
    const raw = decodeEntities(match[1]).trim();
    if (!raw || /^(?:javascript|mailto|tel|data):/i.test(raw)) continue;
    let href: string;
    try {
      href = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href) || seen.has(href)) continue;
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) continue;
    seen.add(href);
    out.push({ text, href });
  }
  return out;
}

const UA = 'Mozilla/5.0 (compatible; Aether/0.3; +https://example.invalid)';

/**
 * Fetch with redirects followed by hand, so every hop passes `safePageUrl`.
 * A public URL that redirects to 127.0.0.1 must not become a host probe.
 */
async function fetchFollowing(rawUrl: string, hops = 4): Promise<{ response: Response; finalUrl: string }> {
  let current = safePageUrl(rawUrl);
  for (let hop = 0; hop < hops; hop += 1) {
    const response = await fetch(current, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: current };
      const next = new URL(location, current).toString();
      current = safePageUrl(next);
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error('That link redirected too many times.');
}

/**
 * Fetch one public page and reduce it to title + text + links. Private and
 * link-local addresses are refused by `safePageUrl`, so a pasted URL cannot
 * probe the host.
 */
export async function readPage(rawUrl: string): Promise<PageResult> {
  const { response, finalUrl: url } = await fetchFollowing(rawUrl);

  if (!response.ok) throw new Error(`The page answered ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/|html|json|xml/i.test(contentType)) {
    throw new Error(`That link is ${contentType.split(';')[0] || 'not a document'} — only pages and text can be read.`);
  }

  const raw = await response.text();
  const isHtml = /html|xml/i.test(contentType) || /^\s*<!doctype html|<html/i.test(raw);
  const { title, text } = isHtml ? htmlToText(raw) : { title: '', text: raw };
  const clean = text || raw;
  const truncated = clean.length > MAX_CHARS;
  const sliced = truncated ? clean.slice(0, MAX_CHARS) : clean;

  return {
    url,
    title: title || new URL(url).hostname,
    text: sliced,
    chars: sliced.length,
    truncated,
    links: isHtml ? extractLinks(raw, url) : [],
  };
}

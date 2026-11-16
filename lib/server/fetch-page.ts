import { safePageUrl } from '@/lib/agent/guard';

export interface PageResult {
  url: string;
  title: string;
  text: string;
  chars: number;
  truncated: boolean;
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
 * Fetch one public page and reduce it to title + text. Private and link-local
 * addresses are refused by `safePageUrl`, so a pasted URL cannot probe the host.
 */
export async function readPage(rawUrl: string): Promise<PageResult> {
  const url = safePageUrl(rawUrl);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Aether/0.3; +https://example.invalid)',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });

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
  };
}

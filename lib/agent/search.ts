import type { KnowledgeItem } from './types';

/**
 * Query → terms. Latin words split on whitespace; CJK is indexed as bigrams so
 * "发布节奏" still hits a title that only contains "发布" and "节奏" separately.
 */
export function searchTokens(query: string): string[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [];
  const latin = lower.match(/[a-z0-9_][a-z0-9_-]*/g) ?? [];
  const cjk = lower.replace(/[^\u4e00-\u9fa5]/g, '');
  const grams = new Set<string>();
  if (cjk.length === 1) grams.add(cjk);
  for (let i = 0; i < cjk.length - 1; i += 1) grams.add(cjk.slice(i, i + 2));
  return [...new Set([...latin, ...grams])];
}

const hits = (text: string, tokens: string[]) => {
  const lower = text.toLowerCase();
  let count = 0;
  for (const token of tokens) if (lower.includes(token)) count += 1;
  return count;
};

export interface KnowledgeChunk {
  /** stable within one entry: "0", "1", … */
  chunkId: string;
  text: string;
  /** character offset of the chunk in the full body */
  start: number;
}

/**
 * Split a body into overlapping chunks, preferring paragraph boundaries.
 * This is a lexical index, not embeddings: it narrows the text a person (or
 * the model) has to read and gives every hit a citable position.
 */
export function chunkText(content: string, size = 800, overlap = 100): KnowledgeChunk[] {
  const text = content.replace(/\r\n/g, '\n');
  if (!text.trim()) return [];
  const chunks: KnowledgeChunk[] = [];
  let offset = 0;
  let index = 0;
  while (offset < text.length) {
    const hardEnd = Math.min(text.length, offset + size);
    let cut = hardEnd;
    if (hardEnd < text.length) {
      const from = offset + Math.floor(size * 0.6);
      const window = text.slice(from, hardEnd);
      const paragraph = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
      if (paragraph > 0) cut = from + paragraph;
    }
    const slice = text.slice(offset, cut).trim();
    if (slice) {
      chunks.push({ chunkId: String(index), text: slice, start: offset + (text.slice(offset, cut).length - text.slice(offset, cut).trimStart().length) });
      index += 1;
    }
    if (cut >= text.length) break;
    offset = Math.max(cut - overlap, offset + 1);
  }
  return chunks;
}

export interface RankedChunk {
  item: KnowledgeItem;
  chunk: KnowledgeChunk | null;
  score: number;
}

/** Title and tags weigh more than the body; the best-matching chunk is cited. */
export function rankKnowledgeChunks(items: KnowledgeItem[], query: string, limit?: number): RankedChunk[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return items.map((item) => ({ item, chunk: null, score: 0 }));
  const ranked: RankedChunk[] = [];
  for (const item of items) {
    const title = hits(item.title, tokens) * 3;
    const tags = hits(item.tags.join(' '), tokens) * 2;
    let best: KnowledgeChunk | null = null;
    let bestHits = 0;
    for (const chunk of chunkText(item.content)) {
      const count = hits(chunk.text, tokens);
      if (count > bestHits) {
        bestHits = count;
        best = chunk;
      }
    }
    const score = title + tags + bestHits;
    if (score > 0) ranked.push({ item, chunk: best, score: score + tokens.length / 10 });
  }
  ranked.sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt);
  return limit ? ranked.slice(0, limit) : ranked;
}

/** Entry-level ranking kept for callers that only need the items. */
export function rankKnowledge(items: KnowledgeItem[], query: string, limit?: number) {
  return rankKnowledgeChunks(items, query, limit).map((row) => row.item);
}

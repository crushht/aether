import type { KnowledgeItem } from './types';
import { rankKnowledgeChunks, type RankedChunk } from './search';

/**
 * Hybrid knowledge search: lexical candidates first (cheap, always available),
 * then an optional embedding re-rank through the account's own provider.
 * Nothing leaves the machine unless an embedding model is configured.
 */

export function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const cache = new Map<string, number[]>();
const CACHE_LIMIT = 300;

const cacheKey = (text: string) => {
  let hash = 5381;
  const sample = text.length > 2_000 ? `${text.slice(0, 1_200)}|${text.slice(-800)}` : text;
  for (let i = 0; i < sample.length; i += 1) hash = ((hash << 5) + hash + sample.charCodeAt(i)) | 0;
  return `${hash}:${text.length}`;
};

const cached = (text: string) => cache.get(cacheKey(text));

async function embed(texts: string[]): Promise<number[][] | null> {
  const missing = texts.filter((text) => !cached(text));
  if (missing.length) {
    try {
      const response = await fetch('/api/agent/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: missing, route: 'knowledge' }),
      });
      if (!response.ok) return null;
      const json = (await response.json()) as { ok?: boolean; vectors?: number[][] };
      if (!json.ok || !Array.isArray(json.vectors) || json.vectors.length !== missing.length) return null;
      missing.forEach((text, index) => {
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
        cache.set(cacheKey(text), json.vectors![index]);
      });
    } catch {
      return null;
    }
  }
  return texts.map((text) => cached(text)!).filter(Boolean);
}

export interface HybridResult {
  rows: RankedChunk[];
  /** hybrid = embedding re-rank succeeded; lexical = fallback only */
  mode: 'hybrid' | 'lexical';
}

export async function hybridRankKnowledge(
  items: KnowledgeItem[],
  query: string,
  limit = 5,
): Promise<HybridResult> {
  const lexical = rankKnowledgeChunks(items, query, Math.max(limit, 12));
  if (!query.trim() || !lexical.length) return { rows: lexical.slice(0, limit), mode: 'lexical' };

  const candidates = lexical.slice(0, 12);
  const texts = [query, ...candidates.map((row) => (row.chunk?.text ?? row.item.content).slice(0, 2_000))];
  const vectors = await embed(texts);
  if (!vectors || vectors.length !== texts.length) return { rows: lexical.slice(0, limit), mode: 'lexical' };

  const queryVector = vectors[0];
  const maxLexical = Math.max(...candidates.map((row) => row.score), 1);
  const fused = candidates
    .map((row, index) => ({
      ...row,
      score: cosine(queryVector, vectors[index + 1]) * 0.6 + (row.score / maxLexical) * 0.4,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { rows: fused, mode: 'hybrid' };
}

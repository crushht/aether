import type { AgentRunRecord } from './types';

/** Token/spend roll-up for a window of finished runs. */
export interface UsageSummary {
  runs: number;
  ok: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  steps: number;
  tools: number;
}

const empty = (): UsageSummary => ({
  runs: 0,
  ok: 0,
  failed: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  steps: 0,
  tools: 0,
});

export function summarizeUsage(runs: AgentRunRecord[], since: number): UsageSummary {
  const out = empty();
  for (const run of runs) {
    if (!Number.isFinite(run.at) || run.at < since) continue;
    out.runs += 1;
    if (run.status === 'ok') out.ok += 1;
    else out.failed += 1;
    out.promptTokens += run.promptTokens || 0;
    out.completionTokens += run.completionTokens || 0;
    out.steps += run.steps || 0;
    out.tools += run.tools || 0;
  }
  out.totalTokens = out.promptTokens + out.completionTokens;
  return out;
}

export function usageByModel(
  runs: AgentRunRecord[],
  since: number,
  limit = 3,
): Array<{ model: string; runs: number; tokens: number }> {
  const map = new Map<string, { runs: number; tokens: number }>();
  for (const run of runs) {
    if (!Number.isFinite(run.at) || run.at < since) continue;
    const key = run.model || 'unknown';
    const entry = map.get(key) ?? { runs: 0, tokens: 0 };
    entry.runs += 1;
    entry.tokens += (run.promptTokens || 0) + (run.completionTokens || 0);
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([model, value]) => ({ model, ...value }))
    .sort((a, b) => b.tokens - a.tokens || b.runs - a.runs)
    .slice(0, limit);
}

/** Start of the local day, so "today" matches the person's clock. */
export function startOfLocalDay(now = Date.now()): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export const usageSinceDays = (days: number, now = Date.now()) => now - days * 86_400_000;

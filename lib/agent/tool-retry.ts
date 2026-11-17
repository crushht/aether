/**
 * Retrying one tool call, in place.
 *
 * A failed tool row is a state, not a verdict: the same args can be replayed
 * without asking the model to plan the whole turn again. The rules live here so
 * the transcript, the store and the regression suite agree on what "can be
 * retried" means and on what a retried row looks like afterwards.
 *
 * The other half of a retry is honesty about the model's context: the `tool`
 * message that carried the failure is what the model remembers, so replaying a
 * call must also rewrite that message — otherwise the transcript shows success
 * while the next turn still believes the tool failed.
 */

import type { AgentLogEntry, AgentMessage } from './types';

/** Mirrors `AgentSession['status']` so this module stays free of the store. */
export type RetryStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error';

/** Why a row cannot be replayed. */
export type RetryBlock = 'not-a-tool' | 'not-failed' | 'busy' | 'rejected' | 'unnamed';

export interface RetryPlan {
  retryable: boolean;
  blocked?: RetryBlock;
  name?: string;
  /** the args the original call used; `{}` is a legitimate set of args */
  args?: Record<string, unknown>;
  /** attempts already made, so the retry becomes `attempts + 1` */
  attempts: number;
}

/** What the store needs to replay a call. */
export function retryPlan(entry: AgentLogEntry | undefined, status: RetryStatus): RetryPlan {
  const attempts = Math.max(1, Math.trunc(entry?.attempts ?? 1));
  if (!entry || entry.kind !== 'tool') return { retryable: false, blocked: 'not-a-tool', attempts };
  if (status === 'running' || status === 'waiting') return { retryable: false, blocked: 'busy', attempts };
  // A rejected write is a decision the person made; replaying it would ignore it.
  if (isRejectedRow(entry)) return { retryable: false, blocked: 'rejected', attempts };
  if (entry.ok !== false) return { retryable: false, blocked: 'not-failed', attempts };
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) return { retryable: false, blocked: 'unnamed', attempts };
  return {
    retryable: true,
    name,
    args: entry.args && typeof entry.args === 'object' ? { ...entry.args } : {},
    attempts,
  };
}

/** A row the person rejected from the approval card, not a tool failure. */
export function isRejectedRow(entry: AgentLogEntry) {
  return entry.kind === 'tool' && /^rejected by you\b/i.test(entry.text.trim());
}

export interface RetryOutcome {
  ok: boolean;
  summary: string;
  /** a fresh receipt; absent means the old one no longer describes the result */
  card?: AgentLogEntry['card'];
}

/**
 * The row after a replay: same place in the transcript, same identity, new
 * receipt. `at` is deliberately kept — the row belongs where it happened, and
 * sorting transcripts by a retry would rewrite history.
 */
export function retriedEntry(
  entry: AgentLogEntry,
  outcome: RetryOutcome,
  ms: number,
  at = Date.now(),
): AgentLogEntry {
  return {
    ...entry,
    text: outcome.summary || entry.text,
    ok: outcome.ok,
    ...(outcome.card ? { card: outcome.card } : { card: undefined }),
    ms: Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : undefined,
    attempts: Math.max(1, Math.trunc(entry.attempts ?? 1)) + 1,
    retriedAt: at,
  };
}

/**
 * Keep the model's copy of the result in step with the transcript. When the
 * call is not in the history (an old transcript, a branch that dropped it) the
 * result is appended instead, so the next turn still sees the truth.
 */
export function reconcileToolMessage(
  messages: AgentMessage[],
  toolCallId: string | undefined,
  content: string,
): { messages: AgentMessage[]; patched: boolean } {
  if (!toolCallId) return { messages, patched: false };
  let index = -1;
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message.role === 'tool' && message.toolCallId === toolCallId) {
      index = cursor;
      break;
    }
  }
  if (index < 0) {
    return { messages: [...messages, { role: 'tool', toolCallId, content }], patched: false };
  }
  const next = [...messages];
  next[index] = { ...next[index], content };
  return { messages: next, patched: true };
}

/**
 * `820 ms` · `2.4 s` · `48 s` · `2m 05s`. Values that are not a measurement
 * (missing, negative, NaN) render as an empty string rather than `NaN ms`.
 */
export function formatDuration(ms: number | undefined | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 60_000) {
    const seconds = Math.round(ms / 1000);
    // 59_700 ms rounds to 60 s; carry it into the minute instead of printing "60 s"
    return seconds >= 60 ? '1m 00s' : `${seconds} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  // 59_700 ms rounds to 60 s; carry it into the minute instead of printing 1m 60s
  return seconds === 60 ? `${minutes + 1}m 00s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** The one-line meta a tool row shows: duration, and the attempt if it is not the first. */
export function toolMeta(entry: AgentLogEntry): string {
  const parts: string[] = [];
  const duration = formatDuration(entry.ms);
  if (duration) parts.push(duration);
  if ((entry.attempts ?? 1) > 1) parts.push(`#${entry.attempts}`);
  return parts.join(' · ');
}

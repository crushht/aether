import type { AgentMessage } from './types';

export const estimateTokens = (text: string) => Math.max(1, Math.round(text.length / 3.6));

export function contextTokens(messages: AgentMessage[]) {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

const NOTE = '\n\n(Some earlier turns were removed to fit the model context window.)';

/**
 * Drop the oldest complete user turns until the transcript fits the budget.
 *
 * A turn is `user → assistant/tool …` up to the next user message, so a cut
 * never leaves an orphan `tool` message without its `assistant.tool_calls`.
 * The last turn is always kept, and the system message survives untouched so
 * the agent never forgets who it is.
 */
function trimTurns(messages: AgentMessage[], budget: number): AgentMessage[] {
  if (messages.length <= 3 || contextTokens(messages) <= budget) return messages;

  let kept = messages;
  while (kept.length > 4 && contextTokens(kept) > budget) {
    const start = kept.findIndex((message, index) => index > 0 && message.role === 'user');
    if (start < 0) break;
    const next = kept.findIndex((message, index) => index > start && message.role === 'user');
    // nothing after the last user turn can be dropped safely
    if (next < 0) break;
    kept = [kept[0], ...kept.slice(next)];
  }
  return kept;
}

export function compactMessages(messages: AgentMessage[], budget: number): AgentMessage[] {
  const kept = trimTurns(messages, budget);
  if (kept === messages) return messages;
  return kept.map((message, index) =>
    index === 0 && message.role === 'system' && !message.content.endsWith(NOTE)
      ? { ...message, content: `${message.content}${NOTE}` }
      : message,
  );
}

/** One dropped message, described the way a person would explain it. */
export interface DroppedMessage {
  role: AgentMessage['role'];
  /** first line, clipped — enough to recognise the turn */
  preview: string;
  tokens: number;
}

export interface CompactionReport {
  /** true when the budget actually forced a cut */
  applied: boolean;
  /** the budget the run asked for */
  budget: number;
  beforeTokens: number;
  afterTokens: number;
  totalMessages: number;
  keptMessages: number;
  /** total messages removed — `dropped` is only the tail of them */
  droppedCount: number;
  /** user turns removed */
  droppedTurns: number;
  /** tokens carried by the removed messages (the note added to the system turn is not subtracted) */
  droppedTokens: number;
  /** the most recent dropped messages, oldest first, capped for storage */
  dropped: DroppedMessage[];
  /** what the surviving window opens with, so the cut is not anonymous */
  keptFrom: string;
}

const DROPPED_KEPT = 8;

const oneLine = (text: string, limit = 140) =>
  text.replace(/\s+/g, ' ').trim().slice(0, limit);

const describe = (message: AgentMessage): DroppedMessage => ({
  role: message.role,
  preview: oneLine(message.content),
  tokens: estimateTokens(message.content),
});

/**
 * The same decision `compactMessages` makes, described instead of performed.
 *
 * This exists because a silently shorter transcript is indistinguishable from a
 * model that forgot: the run says "earlier turns were removed", and this says
 * how many, how heavy, and where the window now starts.
 */
export function compactionReport(messages: AgentMessage[], budget: number): CompactionReport {
  const before = contextTokens(messages);
  const kept = trimTurns(messages, budget);
  const opening = messages.find((message) => message.role === 'user') ?? messages[0];
  if (kept === messages) {
    return {
      applied: false,
      budget,
      beforeTokens: before,
      afterTokens: before,
      totalMessages: messages.length,
      keptMessages: messages.length,
      droppedCount: 0,
      droppedTurns: 0,
      droppedTokens: 0,
      dropped: [],
      keptFrom: opening ? oneLine(opening.content) : '',
    };
  }
  // `trimTurns` keeps the head plus a tail slice of the very same objects, so
  // the first surviving non-system message marks where the cut happened.
  const anchor = kept.length > 1 ? messages.indexOf(kept[1]) : messages.length;
  const cut = anchor > 0 ? anchor : 1;
  const removed = messages.slice(1, cut);
  const firstKept = messages[cut];
  // what the model is actually sent, including the note added to the system turn
  const sent = compactMessages(messages, budget);
  return {
    applied: true,
    budget,
    beforeTokens: before,
    afterTokens: contextTokens(sent),
    totalMessages: messages.length,
    keptMessages: sent.length,
    droppedCount: removed.length,
    droppedTurns: removed.filter((message) => message.role === 'user').length,
    droppedTokens: removed.reduce((sum, message) => sum + estimateTokens(message.content), 0),
    dropped: removed.slice(-DROPPED_KEPT).map(describe),
    keptFrom: firstKept ? oneLine(firstKept.content) : '',
  };
}

/** The one-line form for a transcript row: what was cut, in numbers. */
export function compactionSummary(report: CompactionReport): string {
  if (!report.applied) return '';
  const tokens = report.droppedTokens;
  return `${report.droppedTurns} turn(s) · ${report.droppedCount} message(s) · ${tokens} token(s)`;
}

/**
 * The newest cut a transcript knows about. Structural on purpose: the log entry
 * lives in `types.ts`, which already imports this module for the report type.
 */
export function lastCompaction(
  log: { kind: string; compaction?: CompactionReport }[] | undefined,
): CompactionReport | undefined {
  if (!log?.length) return undefined;
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const item = log[index];
    if (item.kind === 'note' && item.compaction) return item.compaction;
  }
  return undefined;
}

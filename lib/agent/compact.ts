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
 * The last turn is always kept.
 */
export function compactMessages(messages: AgentMessage[], budget: number): AgentMessage[] {
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

  if (kept === messages) return messages;
  return kept.map((message, index) =>
    index === 0 && message.role === 'system' && !message.content.endsWith(NOTE)
      ? { ...message, content: `${message.content}${NOTE}` }
      : message,
  );
}

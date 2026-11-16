import type { AgentMessage, AgentToolCall, ModelTarget } from './types';

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  content: string;
  toolCalls: AgentToolCall[];
  finishReason: string;
  /** reported by the provider when it chooses to; otherwise estimated */
  usage?: ChatUsage;
}

export class ProviderError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

interface ChatOptions {
  /** the resolved provider + model for this turn (scene route already applied) */
  target: ModelTarget;
  messages: AgentMessage[];
  tools: unknown[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

type WireContent =
  | string
  | null
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

interface WireMessage {
  role: string;
  content: WireContent;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

function toWire(messages: AgentMessage[]): WireMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      };
    }
    if (message.role === 'user' && message.images?.length) {
      return {
        role: 'user',
        content: [
          { type: 'text' as const, text: message.content },
          ...message.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ],
      };
    }
    return { role: message.role, content: message.content };
  });
}

/** Accumulates OpenAI-style streaming deltas, including indexed tool calls. */
class StreamAccumulator {
  content = '';
  reasoning = '';
  finish = '';
  usage?: ChatUsage;
  private calls = new Map<number, { id: string; name: string; args: string }>();

  push(delta: Record<string, unknown> | undefined) {
    if (!delta) return;
    if (typeof delta.content === 'string') this.content += delta.content;
    if (typeof delta.reasoning_content === 'string') this.reasoning += delta.reasoning_content;
    const calls = delta.tool_calls as
      | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
      | undefined;
    for (const call of calls ?? []) {
      const index = call.index ?? 0;
      const entry = this.calls.get(index) ?? { id: '', name: '', args: '' };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.args += call.function.arguments;
      this.calls.set(index, entry);
    }
    if (typeof delta.finish_reason === 'string') this.finish = delta.finish_reason;
  }

  readUsage(raw: unknown) {
    const usage = raw as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (!usage || typeof usage.prompt_tokens !== 'number') return;
    this.usage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens ?? 0 };
  }

  result(): ChatResult {
    const toolCalls: AgentToolCall[] = [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, entry]) => ({
        id: entry.id || `call_${index}`,
        name: entry.name,
        args: safeParse(entry.args),
      }))
      .filter((call) => !!call.name);
    return {
      content: this.content,
      toolCalls,
      finishReason: this.finish || (toolCalls.length ? 'tool_calls' : 'stop'),
      usage: this.usage,
    };
  }
}

export function safeParse(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One chat completion through the local proxy. The browser sends which scene
 * (or provider) this turn belongs to; the server resolves the endpoint and the
 * key, so no key is ever held client-side.
 */
export async function chat({ target, messages, tools, signal, onDelta }: ChatOptions): Promise<ChatResult> {
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      providerId: target.providerId || undefined,
      model: target.model || undefined,
      body: {
        messages: toWire(messages),
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        stream: true,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const code = response.headers.get('x-aether-code') ?? '';
    const parsed = parseErrorBody(detail);
    throw new ProviderError(parsed.code || code || 'request-failed', parsed.message, response.status);
  }

  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream') || !response.body) {
    // provider ignored `stream` — treat the payload as one message
    const json = (await response.json()) as {
      choices?: {
        message?: {
          content?: string;
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (content) onDelta?.(content);
    return {
      content,
      finishReason: choice?.finish_reason ?? 'stop',
      usage: json.usage
        ? { promptTokens: json.usage.prompt_tokens ?? 0, completionTokens: json.usage.completion_tokens ?? 0 }
        : undefined,
      toolCalls: (choice?.message?.tool_calls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function?.name ?? '',
        args: safeParse(call.function?.arguments ?? '{}'),
      })),
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const acc = new StreamAccumulator();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: Record<string, unknown>; finish_reason?: string }[];
          usage?: unknown;
        };
        const choice = json.choices?.[0];
        if (!choice) continue;
        const before = acc.content.length;
        acc.readUsage(json.usage);
        acc.push({ ...choice.delta, finish_reason: choice.finish_reason });
        if (acc.content.length > before) onDelta?.(acc.content.slice(before));
      } catch {
        /* keep-alive or partial frame */
      }
    }
  }

  return acc.result();
}

function parseErrorBody(detail: string): { code?: string; message: string } {
  const trimmed = detail.trim().slice(0, 600);
  try {
    const json = JSON.parse(detail) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
      code?: string;
    };
    const message = typeof json.error === 'string' ? json.error : json.error?.message ?? json.message;
    const code = (typeof json.error === 'object' ? json.error?.code : undefined) ?? json.code;
    return { code, message: message || trimmed || 'The provider rejected the request.' };
  } catch {
    return { message: trimmed || 'The provider rejected the request.' };
  }
}

/** One sentence a person can act on, for the codes the proxy returns. */
export function errorHint(code: string) {
  switch (code) {
    case 'no-provider':
      return 'Add a model provider in Settings → Agents.';
    case 'no-key':
      return 'This provider has no API key yet.';
    case 'invalid-key':
      return 'The API key was rejected (401/403).';
    case 'not-found':
      return 'The endpoint or model id does not exist (404).';
    case 'rate-limited':
      return 'The provider is rate limiting (429). Wait a moment.';
    case 'timeout':
      return 'The provider did not answer in time.';
    case 'no-model':
      return 'Set a model id for this provider.';
    default:
      return 'The provider returned an error.';
  }
}

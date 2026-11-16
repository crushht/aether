import type { AgentAttachment } from './types';
import { currentUserId } from '@/lib/session';

const PREFIX = `aether:draft:${currentUserId()}:`;

export function readDraft(id: string | null): { text: string; attachments: AgentAttachment[] } {
  if (!id || typeof window === 'undefined') return { text: '', attachments: [] };
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${id}`);
    if (!raw) return { text: '', attachments: [] };
    const saved = JSON.parse(raw) as { text?: unknown; attachments?: unknown };
    return {
      text: typeof saved.text === 'string' ? saved.text : '',
      attachments: Array.isArray(saved.attachments)
        ? saved.attachments.filter((file) => file && typeof file.id === 'string' && typeof file.name === 'string').slice(0, 6)
        : [],
    };
  } catch {
    return { text: '', attachments: [] };
  }
}

export function writeDraft(id: string, text: string, attachments: AgentAttachment[]) {
  if (typeof window === 'undefined') return;
  try {
    const key = `${PREFIX}${id}`;
    if (!text && !attachments.length) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ text, attachments, updatedAt: Date.now() }));
  } catch {
    // Large images can exceed quota: retain the text and non-image attachments.
    try {
      window.localStorage.setItem(`${PREFIX}${id}`, JSON.stringify({
        text, attachments: attachments.filter((file) => file.kind !== 'image'), updatedAt: Date.now(),
      }));
    } catch { /* private storage can reject every write */ }
  }
}

export function removeDraft(id: string) {
  try { window.localStorage.removeItem(`${PREFIX}${id}`); } catch { /* storage unavailable */ }
}

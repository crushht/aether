'use client';

const PREFIX = 'aether:comment-draft:';

/** Comment drafts survive a reload and never bleed across issues. */
export function readCommentDraft(issueId: string): string {
  if (typeof window === 'undefined' || !issueId) return '';
  try {
    return window.localStorage.getItem(`${PREFIX}${issueId}`) ?? '';
  } catch {
    return '';
  }
}

export function writeCommentDraft(issueId: string, text: string) {
  if (typeof window === 'undefined' || !issueId) return;
  try {
    const key = `${PREFIX}${issueId}`;
    if (text.trim()) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    /* quota / private mode */
  }
}

export function clearCommentDraft(issueId: string) {
  try {
    window.localStorage.removeItem(`${PREFIX}${issueId}`);
  } catch {
    /* ignore */
  }
}

/** The link a person shares so a new account can sign up with the code filled in. */
export function inviteLink(origin: string, code?: string | null): string {
  const base = origin.replace(/\/+$/, '');
  const trimmed = typeof code === 'string' ? code.trim() : '';
  return trimmed ? `${base}/?invite=${encodeURIComponent(trimmed)}` : `${base}/`;
}

/** Read the invite code a shared link carries, empty when absent. */
export function inviteCodeFromSearch(search: string): string {
  try {
    return new URLSearchParams(search).get('invite')?.trim() ?? '';
  } catch {
    return '';
  }
}

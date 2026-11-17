/**
 * Who may receive a mailed sign-in code.
 *
 * A workspace with a relay configured would otherwise mail any address on the
 * internet from the owner's mailbox: an open signup form is an open sender.
 * The default is therefore private — only an address that already has an
 * account here, the very first account (bootstrap), or one the owner put on the
 * allowlist gets mail. `AETHER_MAIL_OPEN=1` restores open signup on purpose.
 *
 * Pure functions: the route decides, the regression harness checks.
 */

export interface MailPolicy {
  /** Anyone may ask for a signup code. */
  open: boolean;
  /** `you@example.com`, `@example.com` or `example.com` entries, lowercased. */
  allowlist: string[];
}

export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of String(raw).split(/[,\s;]+/)) {
    const entry = part.trim().toLowerCase().replace(/^@/, '');
    if (!entry) continue;
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(entry) && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(entry)) continue;
    seen.add(entry);
  }
  return [...seen];
}

/** Exact address, or any address on an allowlisted domain. */
export function allowlistMatches(email: string, allowlist: string[]): boolean {
  const address = email.trim().toLowerCase();
  if (!address.includes('@')) return false;
  const domain = address.split('@')[1] ?? '';
  return allowlist.some((entry) => entry === address || entry === domain);
}

export function mailPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): MailPolicy {
  return {
    open: (env.AETHER_MAIL_OPEN ?? '').trim() === '1',
    allowlist: parseAllowlist(env.AETHER_MAIL_ALLOWLIST),
  };
}

export function recipientAllowed(
  email: string,
  policy: MailPolicy,
  context: { knownAccount: boolean; firstAccount: boolean },
): boolean {
  if (policy.open) return true;
  if (context.knownAccount) return true;
  // nobody has registered yet: the person setting the workspace up must be able
  // to receive the code that creates the owner account
  if (context.firstAccount) return true;
  return allowlistMatches(email, policy.allowlist);
}

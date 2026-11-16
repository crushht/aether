import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  accountForToken,
  authDisabled,
  publicUsers,
  signupCode,
  type Account,
} from './server/accounts';
import { emailVerificationRequired } from './server/email-codes';
import { mailerStatus } from './server/mailer';

/**
 * Session helpers shared by every route handler.
 *
 * Accounts are the only auth model: a request carries an opaque session
 * cookie, the server resolves it to an account in `.data/sessions.json`.
 * `AUTH_DISABLED=1` keeps a single local user (handy for tests and the
 * desktop build's "skip sign-in" mode).
 */

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionTokenOf(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), SESSION_COOKIE);
}

export async function requireUser(request: Request): Promise<Account | null> {
  return accountForToken(sessionTokenOf(request));
}

export const unauthorized = (message = 'Sign in to continue.') =>
  Response.json({ ok: false, error: message }, { status: 401 });

export function sessionCookie(value: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    maxAge: SESSION_MAX_AGE,
  };
}

export const clearedCookie = { name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 };

/** The shape `GET /api/auth` answers with — the client gate boots from this. */
export async function authState(account: Account | null) {
  const users = await publicUsers();
  const mail = mailerStatus();
  return {
    mode: authDisabled() ? 'local' : 'accounts',
    authenticated: Boolean(account),
    user: account
      ? users.find((row) => row.id === account.id) ?? {
          id: account.id,
          name: account.name,
          handle: account.handle,
          role: account.role,
          color: account.color,
          email: account.email,
          createdAt: account.createdAt,
          lastSeenAt: account.lastSeenAt,
        }
      : null,
    users,
    needsSetup: !authDisabled() && users.length === 0,
    signupCodeRequired: Boolean(signupCode()),
    // only an owner/admin may see the code; everyone else just learns it is required
    inviteCode: account && account.role === 'owner' ? signupCode() || null : null,
    /** Whether the sign-in screen may offer "email me a code". */
    emailCode: {
      available: mail.ready,
      signupRequired: emailVerificationRequired(),
      host: mail.host,
      from: mail.from,
    },
  };
}

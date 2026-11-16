'use client';

import { create } from 'zustand';
import type { PublicUser } from './types';

export type SessionStatus = 'loading' | 'setup' | 'anon' | 'authed' | 'error';

export interface SessionPayload {
  mode?: 'accounts' | 'local';
  authenticated?: boolean;
  user?: PublicUser | null;
  users?: PublicUser[];
  needsSetup?: boolean;
  signupCodeRequired?: boolean;
  emailCode?: { available?: boolean; signupRequired?: boolean; host?: string; from?: string };
}

export interface EmailCodeState {
  available: boolean;
  signupRequired: boolean;
  host: string;
  from: string;
}

export interface CodeSendResult {
  error?: string;
  /** present when no relay is configured (or a test asked for the echo) */
  devCode?: string;
  delivered?: boolean;
}

interface SessionState {
  status: SessionStatus;
  /** the signed-in account */
  user: PublicUser | null;
  /** everyone in the workspace (public projection) */
  users: PublicUser[];
  signupCodeRequired: boolean;
  /** whether the sign-in screen can offer "email me a code" */
  emailCode: EmailCodeState;
  mode: 'shared' | 'personal';
  /** set when the auth endpoint is unreachable — the app still opens locally */
  offline: boolean;
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signInWithCode: (email: string, code: string) => Promise<string | null>;
  signUp: (input: {
    name: string;
    email: string;
    password: string;
    code?: string;
    emailCode?: string;
  }) => Promise<string | null>;
  requestEmailCode: (email: string, purpose: 'signin' | 'signup' | 'reset') => Promise<CodeSendResult>;
  resetPassword: (input: { email: string; code: string; password: string }) => Promise<string | null>;
  signOut: () => Promise<void>;
  updateProfile: (patch: {
    name?: string;
    handle?: string;
    color?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<string | null>;
  refresh: () => Promise<void>;
}

/** Everything a second account on the same machine must not inherit. */
const LOCAL_KEYS = [
  'linear-lab:data:v1',
  'linear-lab:agent',
  'linear-lab:agent:sessions',
  'linear-lab:view',
  'linear-lab:search:recent',
  'linear-lab:recent',
];
const accountPrefix = (key: string, accountId = currentUserId()) => `${key}:${accountId}`;
function accountStorage(accountId: string) {
  try {
    for (const key of LOCAL_KEYS) {
      const legacy = window.localStorage.getItem(key);
      if (legacy && !window.localStorage.getItem(accountPrefix(key, accountId))) window.localStorage.setItem(accountPrefix(key, accountId), legacy);
      if (legacy) window.localStorage.removeItem(key);
    }
  } catch { /* storage may be blocked */ }
}

function apply(payload: SessionPayload) {
  const users = Array.isArray(payload.users) ? payload.users : [];
  const user = payload.user ?? null;
  return {
    status: (user ? 'authed' : payload.needsSetup ? 'setup' : 'anon') as SessionStatus,
    user,
    users,
    mode: (payload.mode === 'local' ? 'personal' : 'shared') as 'shared' | 'personal',
    signupCodeRequired: Boolean(payload.signupCodeRequired),
    emailCode: {
      available: Boolean(payload.emailCode?.available),
      signupRequired: Boolean(payload.emailCode?.signupRequired),
      host: payload.emailCode?.host ?? '',
      from: payload.emailCode?.from ?? '',
    } satisfies EmailCodeState,
    offline: false,
  };
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  users: [],
  signupCodeRequired: false,
  emailCode: { available: false, signupRequired: false, host: '', from: '' },
  mode: 'shared',
  offline: false,

  hydrate: async () => {
    try {
      const response = await fetch('/api/auth', { cache: 'no-store' });
      if (!response.ok) throw new Error(`auth ${response.status}`);
      const payload = (await response.json()) as SessionPayload;
      set(apply(payload));
    } catch {
      // never fail open: "the server did not answer" is not "nobody is signed
      // in". The gate shows a retry instead of opening someone else's cache.
      set({ status: 'error', user: null, users: [], offline: true });
    }
  },

  refresh: async () => {
    try {
      const response = await fetch('/api/auth', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as SessionPayload;
      if (payload.user) {
        accountStorage(payload.user.id);
        set(apply(payload));
      }
      else if (get().status === 'authed') set({ status: 'anon', user: null });
    } catch {
      /* keep the current view */
    }
  },

  signIn: async (email, password) => {
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as SessionPayload & { error?: string };
      if (!response.ok) return payload.error ?? `Sign in failed (${response.status}).`;
      if (payload.user) accountStorage(payload.user.id);
      set(apply(payload));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },

  signInWithCode: async (email, code) => {
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const payload = (await response.json().catch(() => ({}))) as SessionPayload & { error?: string };
      if (!response.ok) return payload.error ?? `Sign in failed (${response.status}).`;
      if (payload.user) accountStorage(payload.user.id);
      set(apply(payload));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },

  requestEmailCode: async (email, purpose) => {
    try {
      const response = await fetch('/api/auth/email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        devCode?: string;
        delivered?: boolean;
      };
      if (!response.ok || !payload.ok) {
        return { error: payload.error ?? `Could not send the code (${response.status}).` };
      }
      return { devCode: payload.devCode, delivered: Boolean(payload.delivered) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },

  resetPassword: async (input) => {
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const payload = (await response.json().catch(() => ({}))) as SessionPayload & { error?: string };
      if (!response.ok) return payload.error ?? `Could not reset the password (${response.status}).`;
      if (payload.user) accountStorage(payload.user.id);
      set(apply(payload));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },

  signUp: async (input) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const payload = (await response.json().catch(() => ({}))) as SessionPayload & { error?: string };
      if (!response.ok) return payload.error ?? `Sign up failed (${response.status}).`;
      if (payload.user) accountStorage(payload.user.id);
      set(apply(payload));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },

  signOut: async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
    } catch {
      /* revoke locally regardless */
    }
    try {
      for (const key of LOCAL_KEYS) window.localStorage.removeItem(key);
      const accountId = get().user?.id;
      if (accountId) for (const key of LOCAL_KEYS) window.localStorage.removeItem(accountPrefix(key, accountId));
    } catch {
      /* private mode */
    }
    set({ status: 'anon', user: null, users: [], offline: false });
    window.location.reload();
  },

  updateProfile: async (patch) => {
    try {
      const response = await fetch('/api/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json().catch(() => ({}))) as SessionPayload & { error?: string };
      if (!response.ok) return payload.error ?? `Update failed (${response.status}).`;
      set(apply(payload));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
}));

/** The signed-in account id, or the legacy placeholder when nobody is (yet). */
export function currentUserId(): string {
  return useSession.getState().user?.id ?? 'me';
}

export function currentUserName(): string {
  return useSession.getState().user?.name ?? '我';
}

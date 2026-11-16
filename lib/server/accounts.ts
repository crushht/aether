import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { PublicUser } from '@/lib/types';
import { DATA_DIR, filePath, readJson, withLock, writeJson } from './store';

export interface Account {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: 'owner' | 'member';
  color: string;
  /** `scrypt$N$r$p$salt$hash` — never leaves the server */
  password: string;
  createdAt: string;
  lastSeenAt: string | null;
}

interface SessionRecord {
  userId: string;
  createdAt: string;
  seenAt: string;
  ua?: string;
  ip?: string;
}

type Sessions = Record<string, SessionRecord>;

const USERS_FILE = 'users.json';
const SESSIONS_FILE = 'sessions.json';
const SECRET_FILE = 'secret.key';

export const SESSION_COOKIE = 'lab_session';
export const SESSION_MAX_AGE = 30 * 86_400;

const COLORS = [
  '#5E6AD2',
  '#B87CF0',
  '#00B8CC',
  '#27A644',
  '#FC7840',
  '#F79CE0',
  '#F0BF00',
  '#EB5757',
  '#5AC8FA',
  '#A8B1FF',
  '#4EC9B0',
  '#E0654F',
];

/* ------------------------------------------------------------------ secret */

let secretPromise: Promise<string> | null = null;

/** One random secret per data directory; used to encrypt stored provider keys. */
function secret(): Promise<string> {
  if (!secretPromise) {
    secretPromise = (async () => {
      try {
        const raw = (await fs.readFile(filePath(SECRET_FILE), 'utf8')).trim();
        if (raw.length >= 32) return raw;
      } catch {
        /* first run */
      }
      const created = randomBytes(32).toString('hex');
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(filePath(SECRET_FILE), created, { encoding: 'utf8', mode: 0o600 });
      return created;
    })();
  }
  return secretPromise;
}

function key(): Promise<Buffer> {
  return secret().then((value) => createHash('sha256').update(value).digest());
}

/** AES-256-GCM, output `v1.iv.tag.ciphertext` (base64url parts). */
export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join(
    '.',
  );
}

export async function decryptSecret(blob: string): Promise<string> {
  if (!blob) return '';
  const [version, ivPart, tagPart, bodyPart] = blob.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !bodyPart) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', await key(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(bodyPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/* ---------------------------------------------------------------- password */

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltPart, hashPart] = parts;
  try {
    const expected = Buffer.from(hashPart, 'base64url');
    const derived = scryptSync(password, Buffer.from(saltPart, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- accounts */

export async function listAccounts(): Promise<Account[]> {
  const rows = await readJson<Account[]>(USERS_FILE, []);
  return Array.isArray(rows) ? rows.filter((row) => row && row.id && row.email) : [];
}

function toPublic(account: Account): PublicUser {
  return {
    id: account.id,
    name: account.name,
    handle: account.handle,
    role: account.role,
    color: account.color,
    email: account.email,
    createdAt: account.createdAt,
    lastSeenAt: account.lastSeenAt,
  };
}

export async function publicUsers(): Promise<PublicUser[]> {
  const accounts = await listAccounts();
  return accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(toPublic);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 24);
}

function uniqueHandle(base: string, taken: Set<string>): string {
  const seed = normalizeHandle(base) || 'user';
  if (!taken.has(seed)) return seed;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${seed}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${seed}${randomBytes(2).toString('hex')}`;
}

export type Failure = { ok: false; status: number; error: string };
export type Success = { ok: true; account: Account };

export interface RegisterInput {
  name?: string;
  email?: string;
  password?: string;
  code?: string;
}

/** The instance invite code: either SIGNUP_CODE or the legacy WORKSPACE_PASSWORD. */
export const signupCode = () => process.env.SIGNUP_CODE ?? process.env.WORKSPACE_PASSWORD ?? '';

export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === '1' || process.env.AUTH_DISABLED === 'true';
}

/** A stand-in account used when AUTH_DISABLED=1 (single-user local mode). */
export function localAccount(): Account {
  return {
    id: 'local',
    name: process.env.LOCAL_USER_NAME ?? '本地用户',
    handle: 'local',
    email: 'local@workspace',
    role: 'owner',
    color: COLORS[0],
    password: '',
    createdAt: new Date(0).toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

const attempts = new Map<string, { count: number; at: number }>();
const ATTEMPT_WINDOW = 10 * 60 * 1000;
const ATTEMPT_LIMIT = 10;

function tooManyAttempts(scope: string): boolean {
  const row = attempts.get(scope);
  if (!row) return false;
  if (Date.now() - row.at > ATTEMPT_WINDOW) {
    attempts.delete(scope);
    return false;
  }
  return row.count >= ATTEMPT_LIMIT;
}

function countAttempt(scope: string) {
  const row = attempts.get(scope);
  if (!row || Date.now() - row.at > ATTEMPT_WINDOW) attempts.set(scope, { count: 1, at: Date.now() });
  else row.count += 1;
}

export async function register(input: RegisterInput): Promise<Success | Failure> {
  const name = (input.name ?? '').trim().slice(0, 60);
  const email = normalizeEmail(input.email ?? '');
  const password = input.password ?? '';

  if (name.length < 1) return { ok: false, status: 400, error: 'Tell us your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: 'That email is not valid.' };
  if (password.length < 8) return { ok: false, status: 400, error: 'Use at least 8 characters.' };

  const code = signupCode();
  const accounts = await listAccounts();
  if (accounts.length > 0 && code && (input.code ?? '') !== code) {
    return { ok: false, status: 403, error: 'Wrong invite code.' };
  }

  return withLock(USERS_FILE, async () => {
    const current = await listAccounts();
    if (current.some((account) => account.email === email)) {
      return { ok: false, status: 409, error: 'That email already has an account.' } as Failure;
    }
    const taken = new Set(current.map((account) => account.handle));
    const account: Account = {
      id: `u_${randomBytes(6).toString('hex')}`,
      name,
      handle: uniqueHandle(normalizeHandle(email.split('@')[0] ?? name), taken),
      email,
      role: current.length === 0 ? 'owner' : 'member',
      color: COLORS[current.length % COLORS.length],
      password: hashPassword(password),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    await writeJson(USERS_FILE, [...current, account]);
    return { ok: true, account } as Success;
  });
}

export async function login(input: { email?: string; password?: string; ip?: string }): Promise<Success | Failure> {
  const email = normalizeEmail(input.email ?? '');
  const password = input.password ?? '';
  const scope = `${email}|${input.ip ?? 'local'}`;
  if (tooManyAttempts(scope)) {
    return { ok: false, status: 429, error: 'Too many attempts. Wait a few minutes.' };
  }

  const accounts = await listAccounts();
  const account = accounts.find((row) => row.email === email);
  if (!account || !verifyPassword(password, account.password)) {
    countAttempt(scope);
    return { ok: false, status: 401, error: 'Wrong email or password.' };
  }

  attempts.delete(scope);
  return { ok: true, account };
}

/* ---------------------------------------------------------------- sessions */

function prune(sessions: Sessions): Sessions {
  const cutoff = Date.now() - SESSION_MAX_AGE * 1000;
  const next: Sessions = {};
  for (const [token, record] of Object.entries(sessions)) {
    if (record && +new Date(record.seenAt) > cutoff) next[token] = record;
  }
  return next;
}

export async function createSession(
  accountId: string,
  meta: { ua?: string; ip?: string } = {},
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await withLock(SESSIONS_FILE, async () => {
    const sessions = prune(await readJson<Sessions>(SESSIONS_FILE, {}));
    sessions[token] = {
      userId: accountId,
      createdAt: new Date().toISOString(),
      seenAt: new Date().toISOString(),
      ...(meta.ua ? { ua: meta.ua.slice(0, 300) } : {}),
      ...(meta.ip ? { ip: meta.ip.slice(0, 80) } : {}),
    };
    await writeJson(SESSIONS_FILE, sessions);
  });
  return token;
}

export interface PublicSession {
  id: string;
  createdAt: string;
  seenAt: string;
  ua: string;
  ip: string;
  current: boolean;
}

const publicSessionId = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);

/** Sessions for one account; tokens are never returned, only stable hashes. */
export async function listUserSessions(accountId: string, currentToken: string | null): Promise<PublicSession[]> {
  const sessions = prune(await readJson<Sessions>(SESSIONS_FILE, {}));
  const currentId = currentToken ? publicSessionId(currentToken) : '';
  return Object.entries(sessions)
    .filter(([, record]) => record.userId === accountId)
    .map(([token, record]) => ({
      id: publicSessionId(token),
      createdAt: record.createdAt,
      seenAt: record.seenAt,
      ua: record.ua ?? '',
      ip: record.ip ?? '',
      current: publicSessionId(token) === currentId,
    }))
    .sort((a, b) => +new Date(b.seenAt) - +new Date(a.seenAt));
}

export async function destroyUserSession(accountId: string, publicId: string): Promise<boolean> {
  let removed = false;
  await withLock(SESSIONS_FILE, async () => {
    const sessions = await readJson<Sessions>(SESSIONS_FILE, {});
    for (const [token, record] of Object.entries(sessions)) {
      if (record.userId === accountId && publicSessionId(token) === publicId) {
        delete sessions[token];
        removed = true;
      }
    }
    if (removed) await writeJson(SESSIONS_FILE, sessions);
  });
  return removed;
}

export async function destroyOtherUserSessions(accountId: string, currentToken: string | null): Promise<number> {
  let removed = 0;
  await withLock(SESSIONS_FILE, async () => {
    const sessions = await readJson<Sessions>(SESSIONS_FILE, {});
    for (const [token, record] of Object.entries(sessions)) {
      if (record.userId === accountId && token !== currentToken) {
        delete sessions[token];
        removed += 1;
      }
    }
    if (removed) await writeJson(SESSIONS_FILE, sessions);
  });
  return removed;
}

export async function destroySession(token: string | null): Promise<void> {
  if (!token) return;
  await withLock(SESSIONS_FILE, async () => {
    const sessions = await readJson<Sessions>(SESSIONS_FILE, {});
    if (!sessions[token]) return;
    delete sessions[token];
    await writeJson(SESSIONS_FILE, sessions);
  });
}

export async function destroyUserSessions(accountId: string): Promise<void> {
  await withLock(SESSIONS_FILE, async () => {
    const sessions = await readJson<Sessions>(SESSIONS_FILE, {});
    for (const [token, record] of Object.entries(sessions)) {
      if (record.userId === accountId) delete sessions[token];
    }
    await writeJson(SESSIONS_FILE, sessions);
  });
}

/** Resolve a cookie token to an account and refresh its "last seen" stamp. */
export async function accountForToken(token: string | null): Promise<Account | null> {
  // single-user local mode needs no cookie at all: the desktop build and the
  // "skip sign-in" tests both rely on that
  if (authDisabled()) return localAccount();
  if (!token) return null;
  const sessions = await readJson<Sessions>(SESSIONS_FILE, {});
  const record = sessions[token];
  if (!record) return null;
  if (+new Date(record.seenAt) < Date.now() - SESSION_MAX_AGE * 1000) return null;

  const accounts = await listAccounts();
  const account = accounts.find((row) => row.id === record.userId);
  if (!account) return null;

  // one small write per five minutes, not per request
  if (Date.now() - +new Date(record.seenAt) > 5 * 60 * 1000) {
    void withLock(SESSIONS_FILE, async () => {
      const current = await readJson<Sessions>(SESSIONS_FILE, {});
      if (!current[token]) return;
      current[token] = { ...current[token], seenAt: new Date().toISOString() };
      await writeJson(SESSIONS_FILE, current);
    });
    void withLock(USERS_FILE, async () => {
      const current = await listAccounts();
      const next = current.map((row) =>
        row.id === account.id ? { ...row, lastSeenAt: new Date().toISOString() } : row,
      );
      await writeJson(USERS_FILE, next);
    });
  }

  return account;
}

/* ---------------------------------------------------------------- profiles */

export async function updateAccount(
  accountId: string,
  patch: { name?: string; handle?: string; color?: string; role?: 'owner' | 'member' },
): Promise<PublicUser | null> {
  return withLock(USERS_FILE, async () => {
    const accounts = await listAccounts();
    const index = accounts.findIndex((row) => row.id === accountId);
    if (index === -1) return null;

    const current = accounts[index];
    const taken = new Set(accounts.filter((row) => row.id !== accountId).map((row) => row.handle));
    const next: Account = { ...current };

    if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 60);
    if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) next.color = patch.color;
    if (typeof patch.handle === 'string') {
      const handle = normalizeHandle(patch.handle);
      if (handle.length >= 2 && !taken.has(handle)) next.handle = handle;
    }
    if (patch.role === 'owner' || patch.role === 'member') next.role = patch.role;

    accounts[index] = next;
    await writeJson(USERS_FILE, accounts);
    return toPublic(next);
  });
}

export async function changePassword(
  accountId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<{ ok: false; error: string } | { ok: true }> {
  if (nextPassword.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  const accounts = await listAccounts();
  const account = accounts.find((row) => row.id === accountId);
  if (!account) return { ok: false, error: 'Account not found.' };
  if (!verifyPassword(currentPassword, account.password)) return { ok: false, error: 'Current password is wrong.' };

  await withLock(USERS_FILE, async () => {
    const current = await listAccounts();
    const next = current.map((row) =>
      row.id === accountId ? { ...row, password: hashPassword(nextPassword) } : row,
    );
    await writeJson(USERS_FILE, next);
  });
  return { ok: true };
}

export async function removeAccount(
  actor: Account,
  accountId: string,
): Promise<{ ok: false; status: number; error: string } | { ok: true }> {
  if (actor.role !== 'owner') return { ok: false, status: 403, error: 'Only the workspace owner can remove people.' };
  if (actor.id === accountId) return { ok: false, status: 400, error: 'You cannot remove yourself.' };

  const accounts = await listAccounts();
  const target = accounts.find((row) => row.id === accountId);
  if (!target) return { ok: false, status: 404, error: 'Account not found.' };

  await withLock(USERS_FILE, async () => {
    const current = await listAccounts();
    await writeJson(
      USERS_FILE,
      current.filter((row) => row.id !== accountId),
    );
  });
  await destroyUserSessions(accountId);
  await fs.rm(filePath('agent', `${accountId}.json`), { force: true });
  await fs.rm(filePath('prefs', `${accountId}.json`), { force: true });
  return { ok: true };
}

export async function accountsExist(): Promise<boolean> {
  if (authDisabled()) return true;
  return (await listAccounts()).length > 0;
}

/* ------------------------------------------------------------ per account */

export interface UserPrefs {
  theme?: 'dark' | 'light';
  locale?: 'zh' | 'en';
  sidebarCollapsed?: boolean;
  readNotifications?: string[];
  display?: Record<string, boolean>;
}

const prefsFile = (accountId: string) => `prefs/${accountId}.json`;

export async function readPrefs(accountId: string): Promise<UserPrefs> {
  return readJson<UserPrefs>(prefsFile(accountId), {});
}

export async function writePrefs(accountId: string, patch: UserPrefs): Promise<UserPrefs> {
  return withLock(prefsFile(accountId), async () => {
    const current = await readJson<UserPrefs>(prefsFile(accountId), {});
    const next: UserPrefs = {
      ...current,
      ...patch,
      readNotifications: Array.isArray(patch.readNotifications)
        ? patch.readNotifications.slice(-500)
        : current.readNotifications,
    };
    await writeJson(prefsFile(accountId), next);
    return next;
  });
}

export interface StoredAgentConfig {
  baseUrl: string;
  model: string;
  maxSteps: number;
  requireApproval: boolean;
  temperature: number;
  systemPrompt: string;
  /** encrypted; never returned */
  apiKeyEnc?: string;
  /** `sk-…abcd`, so a person can recognise which key is stored */
  keyHint?: string;
  updatedAt: string;
}

export const defaultAgentConfig = (): StoredAgentConfig => ({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxSteps: 8,
  requireApproval: true,
  temperature: 0.3,
  systemPrompt: '',
  updatedAt: new Date(0).toISOString(),
});

const agentFile = (accountId: string) => `agent/${accountId}.json`;

export async function readAgentConfig(accountId: string): Promise<StoredAgentConfig> {
  const stored = await readJson<Partial<StoredAgentConfig>>(agentFile(accountId), {});
  return { ...defaultAgentConfig(), ...stored };
}

export async function writeAgentConfig(
  accountId: string,
  patch: Partial<StoredAgentConfig> & { apiKey?: string | null },
): Promise<StoredAgentConfig> {
  return withLock(agentFile(accountId), async () => {
    const current = await readAgentConfig(accountId);
    const next: StoredAgentConfig = { ...current, ...patch, updatedAt: new Date().toISOString() };
    if (typeof patch.apiKey === 'string') {
      const trimmed = patch.apiKey.trim();
      next.apiKeyEnc = trimmed ? await encryptSecret(trimmed) : '';
      next.keyHint = trimmed
        ? `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`
        : '';
    }
    delete (next as { apiKey?: unknown }).apiKey;
    await writeJson(agentFile(accountId), next);
    return next;
  });
}

/** The key the browser must never see: decrypted server-side for proxying only. */
export async function agentApiKey(accountId: string): Promise<string> {
  const config = await readAgentConfig(accountId);
  return config.apiKeyEnc ? decryptSecret(config.apiKeyEnc) : '';
}

export function publicUserOf(account: Account): PublicUser {
  return toPublic(account);
}

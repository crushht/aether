import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_MAX_PER_WINDOW,
  EMAIL_CODE_TTL_MS,
  EMAIL_CODE_WINDOW_MS,
  isCodeShape,
  isEmailAddress,
  isEmailPurpose,
  normalizeEmail,
  resendInSeconds,
  type EmailPurpose,
} from '@/lib/email-rules';
import { mailerReady } from './mailer';
import { readJson, withLock, writeJson } from './store';

/**
 * One-time sign-in codes.
 *
 * The plain code never touches disk: `email-codes.json` keeps a salted
 * SHA-256 digest, an expiry and an attempt counter, so a stale backup cannot
 * be replayed and guessing dies after five tries. Records are keyed by
 * purpose + address, which is why a "reset" code cannot sign anyone in.
 */

interface CodeRecord {
  email: string;
  purpose: EmailPurpose;
  digest: string;
  salt: string;
  issuedAt: number;
  expiresAt: number;
  sentAt: number;
  windowStart: number;
  windowCount: number;
  attempts: number;
  usedAt: number | null;
  ip?: string;
}

type Codes = Record<string, CodeRecord>;

const FILE = 'email-codes.json';
const KEEP_MS = 24 * 60 * 60_000;

const keyOf = (email: string, purpose: EmailPurpose) => `${purpose}|${email}`;
const digestOf = (code: string, salt: string) => createHash('sha256').update(`${salt}:${code}`).digest('hex');

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function prune(codes: Codes, now = Date.now()): Codes {
  const next: Codes = {};
  for (const [key, record] of Object.entries(codes)) {
    if (record && record.issuedAt + KEEP_MS > now) next[key] = record;
  }
  return next;
}

export type IssueResult =
  | { ok: true; code: string; email: string; expiresAt: number }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number };

export type ConsumeResult = { ok: true } | { ok: false; status: number; error: string };

/** A mailbox can only be proven when a mailer is configured; local mode is exempt. */
export function emailVerificationRequired(): boolean {
  const forced = (process.env.AETHER_REQUIRE_EMAIL_VERIFICATION ?? '').toLowerCase();
  if (forced === '0' || forced === 'false') return false;
  if (forced === '1' || forced === 'true') return true;
  return mailerReady();
}

/**
 * Mint a code for one address. Sending is the caller's job so this stays a
 * store: the route decides what a failed delivery should look like.
 */
export async function issueEmailCode(input: {
  email: string;
  purpose: EmailPurpose;
  ip?: string;
}): Promise<IssueResult> {
  const email = normalizeEmail(input.email);
  if (!isEmailAddress(email)) return { ok: false, status: 400, error: 'That email is not valid.' };
  if (!isEmailPurpose(input.purpose)) return { ok: false, status: 400, error: 'Unknown purpose.' };
  const purpose = input.purpose;

  return withLock(FILE, async () => {
    const now = Date.now();
    const codes = prune(await readJson<Codes>(FILE, {}), now);
    const key = keyOf(email, purpose);
    const previous = codes[key];

    if (previous) {
      const wait = resendInSeconds(previous.sentAt, now);
      if (wait > 0) {
        return { ok: false, status: 429, error: `Ask again in ${wait}s.`, retryAfterSeconds: wait };
      }
      const freshWindow = now - previous.windowStart >= EMAIL_CODE_WINDOW_MS;
      const windowStart = freshWindow ? now : previous.windowStart;
      const windowCount = freshWindow ? 0 : previous.windowCount;
      if (windowCount >= EMAIL_CODE_MAX_PER_WINDOW) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + EMAIL_CODE_WINDOW_MS - now) / 1000));
        return { ok: false, status: 429, error: 'Too many codes for this address. Try again later.', retryAfterSeconds };
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const salt = randomBytes(9).toString('base64url');
      const expiresAt = now + EMAIL_CODE_TTL_MS;
      codes[key] = {
        email,
        purpose,
        digest: digestOf(code, salt),
        salt,
        issuedAt: now,
        expiresAt,
        sentAt: now,
        windowStart,
        windowCount: windowCount + 1,
        attempts: 0,
        usedAt: null,
        ...(input.ip ? { ip: input.ip.slice(0, 80) } : {}),
      };
      await writeJson(FILE, codes);
      return { ok: true, code, email, expiresAt };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(9).toString('base64url');
    const expiresAt = now + EMAIL_CODE_TTL_MS;
    codes[key] = {
      email,
      purpose,
      digest: digestOf(code, salt),
      salt,
      issuedAt: now,
      expiresAt,
      sentAt: now,
      windowStart: now,
      windowCount: 1,
      attempts: 0,
      usedAt: null,
      ...(input.ip ? { ip: input.ip.slice(0, 80) } : {}),
    };
    await writeJson(FILE, codes);
    return { ok: true, code, email, expiresAt };
  });
}

/** Spend a code. One success per code, and five wrong tries retire it. */
export async function consumeEmailCode(input: {
  email: string;
  purpose: EmailPurpose;
  code: string;
}): Promise<ConsumeResult> {
  const email = normalizeEmail(input.email);
  if (!isEmailAddress(email)) return { ok: false, status: 400, error: 'That email is not valid.' };
  const code = String(input.code ?? '').trim();

  return withLock(FILE, async () => {
    const now = Date.now();
    const codes = prune(await readJson<Codes>(FILE, {}), now);
    const key = keyOf(email, input.purpose);
    const record = codes[key];

    if (!record) return { ok: false, status: 400, error: 'Ask for a code first.' };
    if (record.usedAt) return { ok: false, status: 400, error: 'That code was already used. Ask for a new one.' };
    if (record.expiresAt <= now) return { ok: false, status: 400, error: 'That code expired. Ask for a new one.' };
    if (record.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      return { ok: false, status: 429, error: 'Too many wrong codes. Ask for a new one.' };
    }
    if (!isCodeShape(code) || !sameDigest(digestOf(code, record.salt), record.digest)) {
      record.attempts += 1;
      codes[key] = record;
      await writeJson(FILE, codes);
      const left = EMAIL_CODE_MAX_ATTEMPTS - record.attempts;
      return {
        ok: false,
        status: 401,
        error: left > 0 ? `That code is not right — ${left} left.` : 'Too many wrong codes. Ask for a new one.',
      };
    }

    record.usedAt = now;
    record.attempts = 0;
    codes[key] = record;
    await writeJson(FILE, codes);
    return { ok: true };
  });
}

/** Cooldown the form should honour, without exposing the code. */
export async function emailCodeStatus(
  email: string,
  purpose: EmailPurpose,
): Promise<{ sentAt: number | null; expiresAt: number | null; resendIn: number }> {
  const codes = prune(await readJson<Codes>(FILE, {}));
  const record = codes[keyOf(normalizeEmail(email), purpose)];
  if (!record) return { sentAt: null, expiresAt: null, resendIn: 0 };
  return { sentAt: record.sentAt, expiresAt: record.expiresAt, resendIn: resendInSeconds(record.sentAt) };
}

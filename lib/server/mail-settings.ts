import {
  envMailConfig,
  mailConfigFrom,
  mailPassHint,
  normalizeMailSettings,
  resolveMailConfig,
  validateMailDraft,
  type MailConfig,
  type MailDraft,
  type MailErrors,
  type MailNotice,
  type MailSettings,
  type MailSource,
} from '@/lib/mail-settings';
import { decryptSecret, encryptSecret } from './secrets';
import { readJson, removeFile, withLock, writeJson } from './store';

/**
 * The mail relay, saved in this data directory.
 *
 * `mail.json` keeps everything except the password: that one field goes through
 * `encryptSecret` (AES-256-GCM, one key per data directory) and is never handed
 * back to a browser — the UI only learns that it exists and its last two
 * characters.
 *
 * The file is read on every lookup instead of cached, because Next serves each
 * route from its own module instance: a cache in `/api/settings/mail` would not
 * be the cache `/api/auth` sees, and "save then it works" would become "save
 * then restart". Reading a ~300-byte JSON is the cheaper trade.
 *
 * A saved entry outranks `.env.local`, and an explicitly disabled entry means
 * "no mail" even when the environment still holds old credentials.
 */

const FILE = 'mail.json';
const VERSION = 1;

export interface StoredMail extends MailSettings {
  version: number;
  passEnc: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface PublicMailSettings extends MailSettings {
  hasPass: boolean;
  passHint: string;
  updatedAt: string;
  updatedBy?: string;
}

export type SaveMailResult =
  | { ok: true; settings: PublicMailSettings; notices: MailNotice[] }
  | { ok: false; error: string; errors: MailErrors };

export interface MailState {
  /** What the settings page edits; null when nothing was ever saved. */
  saved: PublicMailSettings | null;
  /** What the app would use right now. */
  effective: { ready: boolean; host: string; from: string; source: MailSource };
  /** `.env.local` still works; show it so the UI can explain the fallback. */
  env: { host: string; user: string; from: string } | null;
}

function publicOf(stored: StoredMail, pass: string): PublicMailSettings {
  const settings = normalizeMailSettings(stored, null);
  return {
    ...settings,
    enabled: stored.enabled !== false,
    hasPass: Boolean(pass),
    passHint: mailPassHint(pass),
    updatedAt: stored.updatedAt,
    ...(stored.updatedBy ? { updatedBy: stored.updatedBy } : {}),
  };
}

export async function readStoredMail(): Promise<StoredMail | null> {
  const stored = await readJson<StoredMail | null>(FILE, null);
  if (!stored || typeof stored !== 'object' || typeof stored.host !== 'string') return null;
  return stored;
}

/** The saved relay with its password decrypted, or null when unusable. */
export async function savedMailConfig(): Promise<MailConfig | null> {
  const stored = await readStoredMail();
  if (!stored) return null;
  const pass = await decryptSecret(stored.passEnc ?? '');
  return mailConfigFrom(normalizeMailSettings(stored, null), pass);
}

export async function publicMailSettings(): Promise<PublicMailSettings | null> {
  const stored = await readStoredMail();
  if (!stored) return null;
  return publicOf(stored, await decryptSecret(stored.passEnc ?? ''));
}

export function mailConfigFromEnv(): MailConfig | null {
  return envMailConfig(process.env);
}

/** Saved settings first, then `.env.local`, then nothing. */
export async function effectiveMailConfig(): Promise<{ config: MailConfig | null; source: MailSource }> {
  return resolveMailConfig(await savedMailConfig(), mailConfigFromEnv());
}

export async function mailState(): Promise<MailState> {
  const saved = await publicMailSettings();
  const { config, source } = await effectiveMailConfig();
  const env = mailConfigFromEnv();
  return {
    saved,
    effective: config
      ? { ready: true, host: config.host, from: config.from, source }
      : { ready: false, host: '', from: '', source: 'none' },
    env: env ? { host: env.host, user: env.user, from: env.from } : null,
  };
}

/**
 * Validate and store. An empty `pass` keeps the stored one, which is what makes
 * "change the port and save" not require typing the authorization code again.
 */
export async function saveMailSettings(
  draft: MailDraft,
  options: { updatedBy?: string } = {},
): Promise<SaveMailResult> {
  return withLock(FILE, async () => {
    const stored = await readStoredMail();
    const existingPass = stored ? await decryptSecret(stored.passEnc ?? '') : '';
    const base = stored ? normalizeMailSettings(stored, null) : null;
    const checked = validateMailDraft(draft, { hasStoredPass: Boolean(existingPass), base });
    if (!checked.ok) {
      const first = Object.values(checked.errors)[0] ?? 'Those mail settings are not usable.';
      return { ok: false, error: first, errors: checked.errors } as SaveMailResult;
    }

    const pass = (draft.pass ?? '').trim() || existingPass;
    if (!pass) {
      return {
        ok: false,
        error: 'Enter the password or the authorization code.',
        errors: { pass: 'Enter the password or the authorization code.' },
      } as SaveMailResult;
    }

    const record: StoredMail = {
      version: VERSION,
      ...checked.settings,
      passEnc: await encryptSecret(pass),
      updatedAt: new Date().toISOString(),
      ...(options.updatedBy ? { updatedBy: options.updatedBy } : {}),
    };
    await writeJson(FILE, record);
    return { ok: true, settings: publicOf(record, pass), notices: checked.notices } as SaveMailResult;
  });
}

/** Forget the saved entry: the environment (if any) takes over again. */
export async function clearMailSettings(): Promise<void> {
  await withLock(FILE, () => removeFile(FILE));
}

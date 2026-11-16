import { isEmailAddress, normalizeEmail } from '@/lib/email-rules';

/**
 * Mail relay settings: the shape, the presets, the validation and the
 * precedence between "saved in this workspace" and "read-only .env.local".
 *
 * Nothing here touches the disk or a socket, so the whole decision — which host
 * a QQ address should default to, when a port is out of range, whether a saved
 * setting outranks the environment — is testable in regression.
 * `lib/server/mail-settings.ts` owns the file and the encryption.
 */

export type MailSource = 'settings' | 'env' | 'none';

export interface MailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  starttls: boolean;
  user: string;
  from: string;
  fromName: string;
}

/** A usable relay: what the SMTP dialogue actually needs. */
export interface MailConfig extends MailSettings {
  pass: string;
}

export type MailField = 'host' | 'port' | 'user' | 'pass' | 'from' | 'fromName' | 'starttls';
export type MailErrors = Partial<Record<MailField, string>>;
export type MailNotice = 'qqAuthCode' | 'plaintext';

export interface MailDraft {
  enabled?: boolean;
  host?: string;
  port?: number | string | null;
  secure?: boolean;
  starttls?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  fromName?: string;
}

export interface MailValidation {
  ok: boolean;
  settings: MailSettings;
  errors: MailErrors;
  notices: MailNotice[];
}

export interface MailPreset {
  id: 'qq' | '163' | '126' | 'gmail' | 'outlook';
  host: string;
  port: number;
  secure: boolean;
  starttls: boolean;
  pattern: RegExp;
}

/**
 * The relays people actually use here. A preset only fills defaults — every
 * field stays editable, because self-hosted postfix and corporate relays are
 * first-class too.
 */
export const MAIL_PRESETS: MailPreset[] = [
  { id: 'qq', host: 'smtp.qq.com', port: 465, secure: true, starttls: false, pattern: /@qq\.com$/i },
  { id: '163', host: 'smtp.163.com', port: 465, secure: true, starttls: false, pattern: /@163\.com$/i },
  { id: '126', host: 'smtp.126.com', port: 465, secure: true, starttls: false, pattern: /@126\.com$/i },
  { id: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, starttls: false, pattern: /@gmail\.com$/i },
  {
    id: 'outlook',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    starttls: true,
    pattern: /@(outlook|hotmail|live)\.(com|cn)$/i,
  },
];

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ON = /^(1|true|yes|on)$/i;

/**
 * A relay on this machine or the LAN: plaintext SMTP is a normal thing there
 * (postfix on 127.0.0.1, an intranet relay), and the same rule the connectors
 * use — plain http only for localhost — keeps it predictable.
 */
export function isLocalHost(host: unknown): boolean {
  const value = normalizeHost(host);
  if (!value) return false;
  if (value === 'localhost' || value === '::1' || value === '[::1]' || value.endsWith('.local')) return true;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}


/** `smtp://smtp.qq.com:465/` → `smtp.qq.com`. Users paste all three. */
export function normalizeHost(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .trim();
}

/** `Sender <a@b>` or `a@b` → `a@b`; anything unusable → ''. */
export function normalizeAddress(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const angled = raw.match(/<([^<>]+)>/);
  const address = normalizeEmail(angled ? angled[1] : raw);
  return isEmailAddress(address) ? address : '';
}

export function parsePort(value: unknown, fallback = 465): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/** The relay an address usually belongs to, or null for everything else. */
export function mailPresetFor(user: unknown): MailPreset | null {
  const address = normalizeEmail(user);
  if (!address) return null;
  return MAIL_PRESETS.find((preset) => preset.pattern.test(address)) ?? null;
}

/** Fill every gap a draft leaves, defaulting from the preset, then the base. */
export function normalizeMailSettings(draft: MailDraft = {}, base: MailSettings | null = null): MailSettings {
  const user = normalizeEmail(draft.user ?? base?.user ?? '');
  const preset = mailPresetFor(user);
  const port = parsePort(draft.port ?? base?.port ?? preset?.port ?? 465, preset?.port ?? 465);
  const secure =
    typeof draft.secure === 'boolean' ? draft.secure : base?.secure ?? (preset ? preset.secure : port === 465);
  const starttls =
    typeof draft.starttls === 'boolean'
      ? draft.starttls
      : base?.starttls ?? (preset ? preset.starttls : !secure && port === 587);
  return {
    enabled: typeof draft.enabled === 'boolean' ? draft.enabled : base?.enabled ?? true,
    host: normalizeHost(draft.host ?? base?.host ?? preset?.host ?? ''),
    port,
    secure,
    starttls,
    user,
    from: normalizeAddress(draft.from ?? base?.from ?? '') || user,
    fromName: (draft.fromName ?? base?.fromName ?? 'Aether').trim().slice(0, 60) || 'Aether',
  };
}

/**
 * Check a draft the way the server will use it. A disabled entry only has to be
 * well formed; an enabled one has to be complete, because the sign-in screen
 * will start offering "email me a code" the moment it saves.
 */
export function validateMailDraft(
  draft: MailDraft = {},
  options: { hasStoredPass?: boolean; base?: MailSettings | null } = {},
): MailValidation {
  const settings = normalizeMailSettings(draft, options.base ?? null);
  const errors: MailErrors = {};
  const notices: MailNotice[] = [];
  const pass = (draft.pass ?? '').trim();
  const hasPass = Boolean(pass) || Boolean(options.hasStoredPass);

  if (settings.enabled) {
    if (!settings.host) errors.host = 'Enter the SMTP host, for example smtp.qq.com.';
    else if (!HOST_RE.test(settings.host)) errors.host = 'That host name is not valid.';
    if (!settings.user) errors.user = 'Enter the SMTP account.';
    else if (!isEmailAddress(settings.user)) errors.user = 'The SMTP account looks like an email address.';
    if (!hasPass) errors.pass = 'Enter the password or the authorization code.';
  } else {
    if (settings.host && !HOST_RE.test(settings.host)) errors.host = 'That host name is not valid.';
    if (settings.user && !isEmailAddress(settings.user)) errors.user = 'The SMTP account looks like an email address.';
  }

  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) {
    errors.port = 'Use a port between 1 and 65535.';
  }
  if (settings.secure && settings.starttls) {
    errors.starttls = 'Pick either implicit TLS (465) or STARTTLS (587), not both.';
  }
  if (settings.host && !settings.secure && !settings.starttls) {
    if (isLocalHost(settings.host)) notices.push('plaintext');
    else errors.starttls = 'Turn on TLS — plaintext SMTP is only allowed for a relay on this machine or the LAN.';
  }
  if ((draft.from ?? '').trim() && !normalizeAddress(draft.from)) {
    errors.from = 'The sender address is not valid.';
  }

  if (pass && /qq\.com$/i.test(settings.host) && pass.length !== 16) notices.push('qqAuthCode');
  return { ok: Object.keys(errors).length === 0, settings, errors, notices };
}

/** Show that a password exists without ever sending it back over the wire. */
export function mailPassHint(pass: string): string {
  const value = (pass ?? '').trim();
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-2)}`;
}

/** Settings record + the decrypted password → something the SMTP client can use. */
export function mailConfigFrom(settings: MailSettings, pass: string): MailConfig | null {
  const value = (pass ?? '').trim();
  if (!settings.enabled || !settings.host || !settings.user || !value) return null;
  return { ...settings, pass: value };
}

/**
 * `.env.local` is still supported — it is how a container is configured without
 * a UI — so the variables are parsed here, in pure code, with the same aliases
 * the app always accepted.
 */
export function envMailConfig(env: Record<string, string | undefined>): MailConfig | null {
  const read = (name: string) => (env[name] ?? '').trim();
  const pick = (...names: string[]) => names.map(read).find((value) => value.length > 0) ?? '';

  const user = normalizeEmail(pick('AETHER_SMTP_USER', 'SMTP_USER', 'MAIL_USER'));
  const pass = pick('AETHER_SMTP_PASS', 'SMTP_PASS', 'MAIL_PASS');
  const preset = mailPresetFor(user);
  const host = normalizeHost(pick('AETHER_SMTP_HOST', 'SMTP_HOST') || preset?.host || '');
  if (!host || !user || !pass) return null;

  const port = parsePort(pick('AETHER_SMTP_PORT', 'SMTP_PORT') || preset?.port || 465, preset?.port ?? 465);
  const secureRaw = pick('AETHER_SMTP_SECURE', 'SMTP_SECURE');
  const secure = secureRaw ? ON.test(secureRaw) : port === 465;
  const starttls = ON.test(pick('AETHER_SMTP_STARTTLS')) || (!secure && port === 587);
  const from = normalizeAddress(pick('AETHER_SMTP_FROM', 'SMTP_FROM')) || user;
  const fromName = (pick('AETHER_SMTP_FROM_NAME', 'MAIL_FROM_NAME') || 'Aether').slice(0, 60);

  return { enabled: true, host, port, secure, starttls, user, from, fromName, pass };
}

/**
 * Which relay wins. A saved entry is the operator's explicit choice, so it
 * outranks the environment; when it is disabled or incomplete the environment
 * still works, and with neither there is simply no mail.
 */
export function resolveMailConfig(
  saved: MailConfig | null,
  env: MailConfig | null,
): { config: MailConfig | null; source: MailSource } {
  if (saved && saved.enabled && saved.host && saved.user && saved.pass) {
    return { config: saved, source: 'settings' };
  }
  if (env && env.host && env.user && env.pass) return { config: env, source: 'env' };
  return { config: null, source: 'none' };
}

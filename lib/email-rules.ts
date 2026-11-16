/**
 * Email sign-in rules shared by the server routes and the sign-in form.
 *
 * No imports on purpose: the browser needs exactly the validation and timing
 * the server enforces, and the regression harness can load this file directly.
 */

export type EmailPurpose = 'signin' | 'signup' | 'reset';

export const EMAIL_CODE_LENGTH = 6;
/** A code is good for ten minutes from the moment it was sent. */
export const EMAIL_CODE_TTL_MS = 10 * 60_000;
/** One send per minute per address; the button counts this down. */
export const EMAIL_CODE_COOLDOWN_MS = 60_000;
/** And no more than this many sends inside the window. */
export const EMAIL_CODE_WINDOW_MS = 60 * 60_000;
export const EMAIL_CODE_MAX_PER_WINDOW = 6;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isEmailAddress(value: string): boolean {
  return value.length > 3 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function isEmailPurpose(value: unknown): value is EmailPurpose {
  return value === 'signin' || value === 'signup' || value === 'reset';
}

/** Six digits, nothing else — the form and the server agree on the shape. */
export function isCodeShape(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`).test(value.trim());
}

/** `a***@qq.com` — enough to recognise the address, not enough to leak it. */
export function maskEmail(email: string): string {
  const [local, domain] = normalizeEmail(email).split('@');
  if (!local || !domain) return '';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

export interface CodeTiming {
  issuedAt: number;
  expiresAt: number;
  attempts: number;
  usedAt?: number | null;
}

/** Live = not used, not expired, and still has attempts left. */
export function codeIsLive(record: Pick<CodeTiming, 'expiresAt' | 'attempts' | 'usedAt'>, now = Date.now()): boolean {
  if (record.usedAt) return false;
  if (record.expiresAt <= now) return false;
  return record.attempts < EMAIL_CODE_MAX_ATTEMPTS;
}

export function secondsLeft(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/** Whole seconds the form must keep the resend button disabled. */
export function resendInSeconds(sentAt: number | undefined, now = Date.now()): number {
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + EMAIL_CODE_COOLDOWN_MS - now) / 1000));
}

/** UTF-8 length, so a 60 000 character limit cannot become 240 000 bytes. */
export function byteLength(value: string): number {
  return typeof TextEncoder === 'undefined' ? value.length : new TextEncoder().encode(value).length;
}

export function purposeLabel(purpose: EmailPurpose): string {
  if (purpose === 'signup') return '注册';
  if (purpose === 'reset') return '重置密码';
  return '登录';
}

export function codeMailSubject(purpose: EmailPurpose): string {
  return `Aether ${purposeLabel(purpose)}验证码`;
}

export interface CodeMailCopy {
  subject: string;
  text: string;
  html: string;
}

/**
 * The message body. Bilingual on purpose: the workspace ships zh + en, and a
 * person who reads only one of them still knows what the six digits are for.
 */
export function codeMailCopy(input: {
  code: string;
  purpose: EmailPurpose;
  minutes?: number;
  workspace?: string;
}): CodeMailCopy {
  const minutes = input.minutes ?? Math.round(EMAIL_CODE_TTL_MS / 60_000);
  const action = purposeLabel(input.purpose);
  const workspace = input.workspace?.trim() || 'Aether';
  const subject = codeMailSubject(input.purpose);
  const text = [
    `${workspace} ${action}验证码：${input.code}`,
    '',
    `验证码 ${minutes} 分钟内有效，最多尝试 ${EMAIL_CODE_MAX_ATTEMPTS} 次。`,
    '如果不是你本人操作，忽略这封邮件即可，账号不会被改动。',
    '',
    `Your ${workspace} ${input.purpose} code is ${input.code}. It expires in ${minutes} minutes.`,
    'If you did not ask for it, ignore this message — nothing has changed.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#16181d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px 26px;box-shadow:0 1px 2px rgba(9,10,12,.08)">
    <tr><td>
      <div style="font-size:13px;letter-spacing:.02em;color:#6b7280">${escapeHtml(workspace)}</div>
      <h1 style="margin:6px 0 18px;font-size:19px;line-height:1.35;font-weight:600">${escapeHtml(action)}验证码</h1>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;letter-spacing:.32em;font-weight:600;padding:14px 0 16px">${escapeHtml(input.code)}</div>
      <p style="margin:0 0 8px;font-size:13.5px;line-height:1.65;color:#3f4550">${minutes} 分钟内有效，最多尝试 ${EMAIL_CODE_MAX_ATTEMPTS} 次。如果不是你本人操作，忽略这封邮件即可。</p>
      <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#8a909a">Your code expires in ${minutes} minutes. If you did not ask for it, ignore this message.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

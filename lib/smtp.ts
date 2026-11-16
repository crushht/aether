/**
 * The small, testable half of the SMTP client: MIME headers, base64 transfer
 * encoding and reply parsing. No imports, so the regression harness can load
 * this file and exercise it without a socket.
 */

export interface MailAddress {
  name?: string;
  email: string;
}

export interface MailMessageInput {
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Caller-supplied; the mailer adds a random one when omitted. */
  messageId?: string;
  date?: Date;
}

export interface SmtpReply {
  code: number;
  lines: string[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Tue, 03 Jun 2025 09:41:02 +0800` — what a mail client expects for Date. */
export function rfc2822(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  return `${WEEKDAYS[date.getDay()]}, ${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`;
}

const isAscii = (value: string) => /^[\x20-\x7e]*$/.test(value);

/** RFC 2047 base64 for anything with a non-ASCII character (a Chinese subject). */
export function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  if (isAscii(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

export function formatAddress(address: MailAddress): string {
  const email = address.email.trim();
  const name = (address.name ?? '').trim();
  if (!name) return `<${email}>`;
  const encoded = isAscii(name) ? `"${name.replace(/"/g, "'")}"` : encodeHeaderValue(name);
  return `${encoded} <${email}>`;
}

export function wrapBase64(value: string, width = 76): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += width) lines.push(encoded.slice(index, index + width));
  return lines.join('\r\n');
}

/** A line that starts with a dot would end DATA early — double it. */
export function dotStuff(value: string): string {
  return value.replace(/\r\n/g, '\n').split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

function boundaryFor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 0xffffffff;
  return `aether-${hash.toString(16)}-${seed.length}`;
}

/**
 * Headers plus a body. Text is always base64 encoded: it survives 8-bit
 * subjects, long lines and dot-stuffing without a second thought.
 */
export function buildMimeMessage(input: MailMessageInput): string {
  const date = input.date ?? new Date();
  const messageId = input.messageId ?? `aether.${date.getTime()}@localhost`;
  const headers = [
    `From: ${formatAddress(input.from)}`,
    `To: ${input.to.map(formatAddress).join(', ')}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `Date: ${rfc2822(date)}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
  ];
  if (input.replyTo) headers.push(`Reply-To: ${encodeHeaderValue(input.replyTo)}`);

  if (input.html) {
    const boundary = boundaryFor(messageId);
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(input.text),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(input.html),
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(input.text)}\r\n`;
}

/**
 * Pull one complete SMTP reply off the front of the buffer.
 *
 * A reply is `250-first`, `250-second`, `250 last`: every line but the last
 * carries a hyphen after the code. Returns null while the reply is incomplete,
 * and ignores stray banner lines the server may print on connect.
 */
export function takeReply(buffer: string): { reply: SmtpReply; rest: string } | null {
  const lines: string[] = [];
  let cursor = 0;
  let code = -1;
  for (;;) {
    const end = buffer.indexOf('\r\n', cursor);
    if (end === -1) {
      if (cursor === 0) return null;
      // partial last line: no complete reply yet
      return null;
    }
    const line = buffer.slice(cursor, end);
    cursor = end + 2;
    const match = /^(\d{3})([ -])([\s\S]*)$/.exec(line);
    if (!match) continue;
    const [, digits, separator, text] = match;
    if (code === -1) code = Number(digits);
    lines.push(text);
    if (separator === ' ') return { reply: { code, lines }, rest: buffer.slice(cursor) };
  }
}

/** `250` and `2xx` both read as success; the greeting is `220`. */
export function replyOk(reply: SmtpReply | null, expected: number[] = []): boolean {
  if (!reply) return false;
  if (expected.length) return expected.includes(reply.code);
  return reply.code >= 200 && reply.code < 400;
}

/** One readable sentence for the UI, without dumping the whole dialogue. */
export function describeReply(reply: SmtpReply | null): string {
  if (!reply) return 'The mail server said nothing.';
  const text = reply.lines.filter(Boolean).join(' ').slice(0, 220);
  return `${reply.code} ${text}`.trim();
}

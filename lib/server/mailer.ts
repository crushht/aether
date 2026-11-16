import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { buildMimeMessage, describeReply, dotStuff, replyOk, takeReply, type SmtpReply } from '@/lib/smtp';
import { isEmailAddress, normalizeEmail } from '@/lib/email-rules';

/**
 * A minimal SMTP sender.
 *
 * Aether is dependency-free by design, and "send one six-digit code" does not
 * justify a mail library: this speaks just enough SMTP (EHLO, AUTH LOGIN or
 * PLAIN, optional STARTTLS, MAIL/RCPT/DATA) to talk to a normal relay such as
 * QQ Mail, Gmail or a local postfix. TLS certificates are always verified.
 */

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  starttls: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

const env = (name: string) => (process.env[name] ?? '').trim();

function flag(value: string): boolean {
  return /^(1|true|yes|on)$/i.test(value.trim());
}

/** QQ Mail is the common case here, so its host is the fallback for a QQ user. */
function defaultsFor(user: string): { host: string; port: number; secure: boolean } {
  if (/@qq\.com$/i.test(user)) return { host: 'smtp.qq.com', port: 465, secure: true };
  if (/@163\.com$/i.test(user)) return { host: 'smtp.163.com', port: 465, secure: true };
  if (/@gmail\.com$/i.test(user)) return { host: 'smtp.gmail.com', port: 465, secure: true };
  return { host: '', port: 465, secure: true };
}

/** Read the relay settings from the environment, or return null when unset. */
export function mailConfig(): MailConfig | null {
  const user = env('AETHER_SMTP_USER') || env('SMTP_USER') || env('MAIL_USER');
  const pass = env('AETHER_SMTP_PASS') || env('SMTP_PASS') || env('MAIL_PASS');
  const preset = defaultsFor(user);
  const host = env('AETHER_SMTP_HOST') || env('SMTP_HOST') || preset.host;
  if (!host || !user || !pass) return null;
  const port = Number(env('AETHER_SMTP_PORT') || env('SMTP_PORT') || preset.port) || preset.port;
  const secureEnv = env('AETHER_SMTP_SECURE') || env('SMTP_SECURE');
  const secure = secureEnv ? flag(secureEnv) : port === 465;
  const starttls = flag(env('AETHER_SMTP_STARTTLS')) || (!secure && port === 587);
  const from = env('AETHER_SMTP_FROM') || env('SMTP_FROM') || user;
  const fromName = env('AETHER_SMTP_FROM_NAME') || env('MAIL_FROM_NAME') || 'Aether';
  return { host, port, secure, starttls, user, pass, from, fromName };
}

export function mailerReady(): boolean {
  return mailConfig() !== null;
}

/** Never includes the password. Safe to hand to the sign-in screen. */
export function mailerStatus(): { ready: boolean; host: string; from: string } {
  const config = mailConfig();
  if (!config) return { ready: false, host: '', from: '' };
  return { ready: true, host: config.host, from: config.from };
}

/* ------------------------------------------------------------------ channel */

class Channel {
  private buffer = '';
  private waiter: { resolve: (reply: SmtpReply) => void; reject: (error: Error) => void } | null = null;

  constructor(private socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.abort(error));
    socket.on('close', () => this.abort(new Error('The mail server closed the connection.')));
  }

  write(line: string) {
    this.socket.write(`${line}\r\n`);
  }

  next(timeoutMs = 20_000): Promise<SmtpReply> {
    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('The mail server did not answer in time.'));
      }, timeoutMs);
      this.waiter = {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.drain();
    });
  }

  private abort(error: Error) {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
  }

  private drain() {
    if (!this.waiter) return;
    const parsed = takeReply(this.buffer);
    if (!parsed) return;
    this.buffer = parsed.rest;
    const waiter = this.waiter;
    this.waiter = null;
    waiter.resolve(parsed.reply);
  }
}

/* ------------------------------------------------------------------ dialogue */

async function openSocket(config: MailConfig): Promise<net.Socket> {
  const socket = config.secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port });
  socket.setNoDelay(true);
  await new Promise<void>((resolve, reject) => {
    const event = config.secure ? 'secureConnect' : 'connect';
    const cleanup = () => {
      socket.off(event, onReady);
      socket.off('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once(event, onReady);
    socket.once('error', onError);
  });
  return socket;
}

async function expect(channel: Channel, codes: number[], what: string): Promise<SmtpReply> {
  const reply = await channel.next();
  if (!replyOk(reply, codes)) throw new Error(`${what}: ${describeReply(reply)}`);
  return reply;
}

async function deliver(config: MailConfig, to: string[], message: string): Promise<void> {
  let socket = await openSocket(config);
  let channel = new Channel(socket);
  try {
    await expect(channel, [220], 'The server refused the connection');
    channel.write('EHLO aether.local');
    const ehlo = await expect(channel, [250], 'EHLO was refused');

    if (config.starttls) {
      channel.write('STARTTLS');
      await expect(channel, [220], 'STARTTLS was refused');
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
      const secured = tls.connect({ socket, servername: config.host });
      await new Promise<void>((resolve, reject) => {
        secured.once('secureConnect', resolve);
        secured.once('error', reject);
      });
      socket = secured;
      channel = new Channel(socket);
      channel.write('EHLO aether.local');
      await expect(channel, [250], 'EHLO after STARTTLS was refused');
    }

    const mechanisms = (ehlo.lines.join(' ').match(/AUTH[ =]([A-Z0-9 -]+)/i)?.[1] ?? '').toUpperCase();
    if (!mechanisms.includes('LOGIN') && mechanisms.includes('PLAIN')) {
      const token = Buffer.from(`\0${config.user}\0${config.pass}`, 'utf8').toString('base64');
      channel.write(`AUTH PLAIN ${token}`);
      await expect(channel, [235], 'Sign-in to the mail server failed');
    } else {
      channel.write('AUTH LOGIN');
      await expect(channel, [334], 'The mail server refused the login method');
      channel.write(Buffer.from(config.user, 'utf8').toString('base64'));
      await expect(channel, [334], 'The mail server rejected the username');
      channel.write(Buffer.from(config.pass, 'utf8').toString('base64'));
      await expect(channel, [235], 'Sign-in to the mail server failed');
    }

    const envelopeFrom = config.from.replace(/^.*<|>.*$/g, '') || config.user;
    channel.write(`MAIL FROM:<${envelopeFrom}>`);
    await expect(channel, [250], 'The sender was refused');
    for (const recipient of to) {
      channel.write(`RCPT TO:<${recipient}>`);
      await expect(channel, [250, 251], 'The recipient was refused');
    }
    channel.write('DATA');
    await expect(channel, [354], 'DATA was refused');
    socket.write(`${dotStuff(message)}\r\n.\r\n`);
    await expect(channel, [250], 'The message was refused');
    channel.write('QUIT');
    await channel.next(5_000).catch(() => null);
  } finally {
    socket.destroy();
  }
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<SendResult> {
  const config = mailConfig();
  if (!config) return { ok: false, error: 'The mail service is not configured.' };
  const to = normalizeEmail(input.to);
  if (!isEmailAddress(to)) return { ok: false, error: 'That recipient is not a valid address.' };
  if (!input.subject.trim()) return { ok: false, error: 'A subject is required.' };

  const message = buildMimeMessage({
    from: { name: config.fromName, email: config.from },
    to: [{ email: to }],
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: `${Date.now()}.${randomBytes(8).toString('hex')}@aether.local`,
  });

  try {
    await deliver(config, [to], message);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

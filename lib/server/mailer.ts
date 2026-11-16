import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { buildMimeMessage, describeReply, dotStuff, replyOk, takeReply, type SmtpReply } from '@/lib/smtp';
import { isEmailAddress, normalizeEmail } from '@/lib/email-rules';
import type { MailConfig } from '@/lib/mail-settings';
import { effectiveMailConfig } from './mail-settings';

/**
 * A minimal SMTP sender.
 *
 * Aether is dependency-free by design, and "send one six-digit code" does not
 * justify a mail library: this speaks just enough SMTP (EHLO, AUTH LOGIN or
 * PLAIN, optional STARTTLS, MAIL/RCPT/DATA) to talk to a normal relay such as
 * QQ Mail, Gmail or a local postfix. TLS certificates are always verified.
 *
 * Where the relay settings come from — the settings page (`mail.json`) or
 * `.env.local` — is decided in `./mail-settings`; this file only speaks SMTP.
 */

export type { MailConfig };

/** Never includes the password. Safe to hand to the sign-in screen. */
export async function mailConfig(): Promise<MailConfig | null> {
  return (await effectiveMailConfig()).config;
}

export async function mailerReady(): Promise<boolean> {
  return (await mailConfig()) !== null;
}

export async function mailerStatus(): Promise<{
  ready: boolean;
  host: string;
  from: string;
  source: 'settings' | 'env' | 'none';
}> {
  const { config, source } = await effectiveMailConfig();
  if (!config) return { ready: false, host: '', from: '', source: 'none' };
  return { ready: true, host: config.host, from: config.from, source };
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

interface Session {
  socket: net.Socket;
  channel: Channel;
}

/** Connect, greet and sign in — the part a "test connection" also needs. */
async function open(config: MailConfig): Promise<Session> {
  let socket = await openSocket(config);
  let channel = new Channel(socket);
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

  return { socket, channel };
}

async function goodbye(session: Session): Promise<void> {
  try {
    session.channel.write('QUIT');
    await session.channel.next(5_000).catch(() => null);
  } finally {
    session.socket.destroy();
  }
}

async function deliver(config: MailConfig, to: string[], message: string): Promise<void> {
  const session = await open(config);
  try {
    const envelopeFrom = config.from.replace(/^.*<|>.*$/g, '') || config.user;
    session.channel.write(`MAIL FROM:<${envelopeFrom}>`);
    await expect(session.channel, [250], 'The sender was refused');
    for (const recipient of to) {
      session.channel.write(`RCPT TO:<${recipient}>`);
      await expect(session.channel, [250, 251], 'The recipient was refused');
    }
    session.channel.write('DATA');
    await expect(session.channel, [354], 'DATA was refused');
    session.socket.write(`${dotStuff(message)}\r\n.\r\n`);
    await expect(session.channel, [250], 'The message was refused');
  } finally {
    await goodbye(session);
  }
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Prove the relay works without sending anything: TCP, TLS, EHLO and AUTH.
 * The settings page calls this before saving, so a typo shows up there instead
 * of at the next sign-in attempt.
 */
export async function verifyMail(config: MailConfig): Promise<SendResult> {
  let session: Session | null = null;
  try {
    session = await open(config);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: reason(error) };
  } finally {
    if (session) await goodbye(session);
  }
}

export async function sendMail(
  input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  },
  /** Test sends use the draft that is not saved yet. */
  override?: MailConfig | null,
): Promise<SendResult> {
  const config = override ?? (await mailConfig());
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
    return { ok: false, error: reason(error) };
  }
}

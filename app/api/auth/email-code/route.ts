import { NextResponse } from 'next/server';
import { accountByEmail } from '@/lib/server/accounts';
import { issueEmailCode } from '@/lib/server/email-codes';
import { mailerReady, mailerStatus, sendMail } from '@/lib/server/mailer';
import { codeMailCopy, isEmailAddress, isEmailPurpose, normalizeEmail } from '@/lib/email-rules';
import { rateLimit } from '@/lib/server/rate-limit';
import { recordSecurityEvent } from '@/lib/server/security-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mail one six-digit code.
 *
 * `purpose` decides which store and which message: signup proves the mailbox,
 * signin replaces a password, reset allows setting a new one. A code for one
 * purpose is never accepted for another.
 */
export async function POST(request: Request) {
  let body: { email?: string; purpose?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const ua = request.headers.get('user-agent') ?? '';
  const requested = typeof body.purpose === 'string' ? body.purpose : 'signin';
  const limited = rateLimit(`email-code:${ip}`, 12, 10 * 60_000);
  if (!limited.ok) {
    await recordSecurityEvent({
      kind: 'code',
      ok: false,
      actorEmail: body.email,
      ip,
      ua,
      detail: `rate limited · purpose=${requested}`,
    });
    return NextResponse.json(
      { ok: false, error: 'Too many codes requested. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const email = normalizeEmail(body.email);
  const purpose = body.purpose ?? 'signin';
  if (!isEmailAddress(email)) return NextResponse.json({ ok: false, error: 'That email is not valid.' }, { status: 400 });
  if (!isEmailPurpose(purpose)) return NextResponse.json({ ok: false, error: 'Unknown purpose.' }, { status: 400 });

  const account = await accountByEmail(email);
  if (purpose === 'signup' && account) {
    await recordSecurityEvent({
      kind: 'code',
      ok: false,
      actorId: account.id,
      actorName: account.name,
      actorEmail: email,
      ip,
      ua,
      detail: 'purpose=signup · address already registered',
    });
    return NextResponse.json({ ok: false, error: 'That email already has an account.' }, { status: 409 });
  }
  if (purpose !== 'signup' && !account) {
    await recordSecurityEvent({
      kind: 'code',
      ok: false,
      actorEmail: email,
      ip,
      ua,
      detail: `purpose=${purpose} · no account here`,
    });
    return NextResponse.json({ ok: false, error: 'That email has no account here.' }, { status: 404 });
  }

  const issued = await issueEmailCode({ email, purpose, ip });
  if (!issued.ok) {
    await recordSecurityEvent({
      kind: 'code',
      ok: false,
      actorId: account?.id,
      actorName: account?.name,
      actorEmail: email,
      ip,
      ua,
      detail: `purpose=${purpose} · ${issued.error}`,
    });
    return NextResponse.json(
      { ok: false, error: issued.error },
      {
        status: issued.status,
        ...(issued.retryAfterSeconds ? { headers: { 'Retry-After': String(issued.retryAfterSeconds) } } : {}),
      },
    );
  }

  const copy = codeMailCopy({ code: issued.code, purpose });
  // Echo mode is for tests and local smoke runs: hand the code back and do not
  // put mail on the wire at all.
  const echo = process.env.AETHER_EMAIL_ECHO === '1';
  const ready = await mailerReady();
  const delivered =
    !echo && ready
      ? await sendMail({ to: email, subject: copy.subject, text: copy.text, html: copy.html })
      : { ok: false as const, error: echo ? 'Echo mode: nothing was sent.' : 'The mail service is not configured.' };

  await recordSecurityEvent({
    kind: 'code',
    ok: !echo && ready ? delivered.ok : true,
    actorId: account?.id,
    actorName: account?.name,
    actorEmail: email,
    ip,
    ua,
    detail: `purpose=${purpose} · ${echo ? 'echo (local)' : ready ? (delivered.ok ? 'delivered' : 'delivery failed') : 'no relay'}`,
  });

  if (!delivered.ok && !echo && ready) {
    return NextResponse.json({ ok: false, error: delivered.error ?? 'The mail could not be sent.' }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    email,
    purpose,
    expiresAt: issued.expiresAt,
    delivered: delivered.ok,
    mailer: await mailerStatus(),
    // with no relay, or in echo mode, the code comes back so a local workspace
    // (and the browser suite) can still sign in
    ...(echo || !delivered.ok ? { devCode: issued.code } : {}),
  });
}

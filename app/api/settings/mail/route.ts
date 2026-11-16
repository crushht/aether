import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';
import { rateLimit } from '@/lib/server/rate-limit';
import { decryptSecret } from '@/lib/server/secrets';
import {
  clearMailSettings,
  effectiveMailConfig,
  mailState,
  readStoredMail,
  saveMailSettings,
} from '@/lib/server/mail-settings';
import { sendMail, verifyMail } from '@/lib/server/mailer';
import { mailConfigFrom, normalizeMailSettings, validateMailDraft, type MailConfig, type MailDraft } from '@/lib/mail-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The mail relay, as a setting instead of `.env.local`.
 *
 * GET is readable by any signed-in member (they only learn the host and whether
 * a password exists). Everything that writes — or that opens a socket to the
 * relay — belongs to the workspace owner.
 *
 * Saving is enough: `/api/auth` reads the same file on the next request, so the
 * sign-in screen offers "email me a code" immediately, no restart.
 */

const owner = (role: string) => role === 'owner';

async function payload(canManage: boolean) {
  const state = await mailState();
  return { ok: true, canManage, ...state };
}

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  return NextResponse.json(await payload(owner(account.role)));
}

type Body = MailDraft & { action?: 'test' | 'send'; to?: string };

/** The config a test/send should use: the draft on screen, else what is saved. */
async function candidateConfig(draft: MailDraft | undefined): Promise<MailConfig | null> {
  const stored = await readStoredMail();
  const existingPass = stored ? await decryptSecret(stored.passEnc ?? '') : '';
  const base = stored ? normalizeMailSettings(stored, null) : null;
  const hasDraft = Boolean(draft && (draft.host || draft.user || draft.pass || draft.port));
  if (!hasDraft) return (await effectiveMailConfig()).config;
  const checked = validateMailDraft(draft, { hasStoredPass: Boolean(existingPass), base });
  const pass = (draft?.pass ?? '').trim() || existingPass;
  return mailConfigFrom(checked.settings, pass);
}

export async function PUT(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!owner(account.role)) {
    return NextResponse.json({ ok: false, error: 'Only a workspace owner can change the mail service.' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await saveMailSettings(body, { updatedBy: account.email || account.name });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, errors: result.errors }, { status: 400 });
  }
  return NextResponse.json({ ...(await payload(true)), notices: result.notices });
}

/** `{action:'test'}` proves host/TLS/AUTH; `{action:'send'}` also mails `to`. */
export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!owner(account.role)) {
    return NextResponse.json({ ok: false, error: 'Only a workspace owner can test the mail service.' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const limited = rateLimit(`mail-test:${ip}`, 20, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many mail tests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const config = await candidateConfig(body);
  if (!config) {
    return NextResponse.json({ ok: false, error: 'Fill in the relay first, then test it.' }, { status: 400 });
  }

  const checked = await verifyMail(config);
  if (!checked.ok) {
    return NextResponse.json({ ok: false, error: checked.error ?? 'The mail server refused the connection.' }, { status: 502 });
  }

  if (body.action !== 'send') {
    return NextResponse.json({ ok: true, tested: true, host: config.host });
  }

  const to = (body.to ?? '').trim() || config.from || config.user;
  const sent = await sendMail(
    {
      to,
      subject: 'Aether mail test',
      text: [
        'This message proves the mail relay configured in Aether works.',
        '',
        `Host: ${config.host}:${config.port} (${config.secure ? 'implicit TLS' : 'STARTTLS'})`,
        `From: ${config.fromName} <${config.from}>`,
        `Sent: ${new Date().toISOString()}`,
      ].join('\n'),
    },
    config,
  );

  if (!sent.ok) {
    return NextResponse.json({ ok: false, error: sent.error ?? 'The test message could not be sent.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, to });
}

/** Back to `.env.local` only. */
export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  if (!owner(account.role)) {
    return NextResponse.json({ ok: false, error: 'Only a workspace owner can reset the mail service.' }, { status: 403 });
  }
  await clearMailSettings();
  return NextResponse.json(await payload(true));
}

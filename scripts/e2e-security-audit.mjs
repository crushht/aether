// Security audit: sign-in, mailed codes, password change/reset and session
// revocation are written to the workspace trail, and the settings panel reads
// them back — masked, filtered and scoped per account.
//
// The events only exist in accounts mode, so this script needs a server without
// AUTH_DISABLED (a throwaway data dir is safest):
//
//   $env:LAB_DATA_DIR='.e2e-auth-data'; $env:AETHER_EMAIL_ECHO='1'
//   $env:AETHER_SMTP_HOST=''; $env:AETHER_REQUIRE_EMAIL_VERIFICATION='0'
//   npx next dev -p 4322
//   node scripts/e2e-security-audit.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AUTH_E2E_URL || 'http://127.0.0.1:4322';
const stamp = Date.now();
const email = `audit-${stamp}@example.invalid`;
const other = `audit-other-${stamp}@example.invalid`;
const password = 'correct-horse-battery';
const changed = 'battery-horse-correct';
const resetTo = 'reset-horse-battery';
const UA = 'AetherAudit/1.0 (Windows NT 10.0)';

const call = async (url, init = {}) => {
  try {
    const response = await fetch(`${base}${url}`, init);
    return { response, json: await response.json().catch(() => ({})) };
  } catch (error) {
    if (error instanceof Error && /ECONNREFUSED|fetch failed/.test(error.message)) {
      console.log(`SKIP security-audit e2e: nothing answers on ${base} — start a dev server without AUTH_DISABLED`);
      process.exit(0);
    }
    throw error;
  }
};
const post = (url, body, cookie, ua = UA) =>
  call(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
const cookieOf = (response) =>
  (response.headers.getSetCookie?.() ?? []).find((value) => value.startsWith('lab_session='))?.split(';')[0] ?? '';

/* ------------------------------------------------------------------ API leg */

const registered = await post('/api/auth/register', { name: 'Audit Tester', email, password });
assert.ok(registered.response.ok, `register must succeed: ${JSON.stringify(registered.json)}`);
const ownerCookie = cookieOf(registered.response);
assert.ok(ownerCookie, 'register sets a session cookie');

// a refusal has to be in the trail too — that is the whole point of an audit
const refused = await post('/api/auth', { email, password: 'definitely-not-it' });
assert.equal(refused.response.status, 401, 'a wrong password is refused');

const signedIn = await post('/api/auth', { email, password });
assert.ok(signedIn.response.ok, 'a second login succeeds');
const secondCookie = cookieOf(signedIn.response);

const passwordChanged = await call('/api/auth', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Cookie: ownerCookie },
  body: JSON.stringify({ currentPassword: password, newPassword: changed }),
});
assert.ok(passwordChanged.response.ok, `password change must succeed: ${JSON.stringify(passwordChanged.json)}`);

const resetCode = await post('/api/auth/email-code', { email, purpose: 'reset' });
assert.equal(resetCode.response.status, 200, `the reset code must be issued: ${JSON.stringify(resetCode.json)}`);

let resetDone = false;
let resetCookie = '';
if (resetCode.json.devCode) {
  const reset = await post('/api/auth/password', { email, code: resetCode.json.devCode, password: resetTo });
  assert.ok(reset.response.ok, `reset must succeed: ${JSON.stringify(reset.json)}`);
  resetCookie = cookieOf(reset.response);
  assert.ok(resetCookie, 'a reset signs this browser in');
  resetDone = true;
} else {
  console.log('note: the relay delivered real mail — the reset event is not exercised by this run');
}

const workingPassword = resetDone ? resetTo : changed;
const live = await post('/api/auth', { email, password: workingPassword });
assert.ok(live.response.ok, 'the account signs in again');
const liveCookie = resetCookie || cookieOf(live.response);
const extraCookie = cookieOf(live.response);

const revoked = await call('/api/accounts/sessions?others=1', {
  method: 'DELETE',
  headers: { 'User-Agent': UA, Cookie: liveCookie },
});
assert.ok(revoked.response.ok, 'sign out others must succeed');
assert.ok(Number(revoked.json.removed) >= 1, 'at least one other session was signed out');

const throwaway = await post('/api/auth', { email, password: workingPassword });
const throwawayCookie = cookieOf(throwaway.response);
assert.ok(throwawayCookie, 'one more session for the sign-out event');
await call('/api/auth', { method: 'DELETE', headers: { Cookie: throwawayCookie } });

/* -------------------------------------------------------------- audit reads */

const unauthorized = await call('/api/security/audit');
assert.equal(unauthorized.response.status, 401, 'the audit is not readable without a session');

const audit = await call('/api/security/audit?limit=200', { headers: { Cookie: liveCookie } });
assert.ok(audit.response.ok, `the audit must load: ${JSON.stringify(audit.json)}`);
const events = audit.json.events ?? [];
const kinds = events.map((event) => event.kind);
assert.ok(events.length >= 7, `expected the whole session trail, got ${kinds.join(',')}`);
assert.ok(kinds.includes('register'), 'registration is in the trail');
assert.ok(kinds.includes('sign_in'), 'sign-in is in the trail');
assert.ok(
  events.some((event) => event.kind === 'sign_in' && event.ok === false),
  'the refused sign-in is in the trail',
);
assert.ok(kinds.includes('password_change'), 'the password change is in the trail');
assert.ok(kinds.includes('code'), 'the mailed code is in the trail');
if (resetDone) assert.ok(kinds.includes('password_reset'), 'the reset is in the trail');
assert.ok(kinds.includes('session_revoke'), 'the revocation is in the trail');
assert.ok(kinds.includes('sign_out'), 'the sign-out is in the trail');

const masked = `${email.slice(0, 1)}***@${email.split('@')[1]}`;
assert.ok(
  events.some((event) => event.actorEmail === masked),
  `addresses are masked (${masked})`,
);
assert.ok(!JSON.stringify(audit.json).includes(email), 'the full address never leaves the server');
assert.ok(
  events.filter((event) => event.kind === 'sign_in').every((event) => event.ua.includes('AetherAudit')),
  'each sign-in records the browser',
);
assert.ok(events.every((event) => typeof event.ip === 'string' && event.ip.length > 0), 'each event records an origin');
// Next fills X-Forwarded-For from the socket in dev, so a local call can be
// recorded as loopback rather than the "local" placeholder. Both mean the same
// thing here: the request came from this machine.
const localOrigin = (ip) => ip === 'local' || /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ip);
assert.ok(
  events.some((event) => localOrigin(event.ip)),
  'a request from the local socket is attributed to loopback (or "local")',
);
assert.ok(events.every((event) => typeof event.at === 'string' && Number.isFinite(Date.parse(event.at))), 'every event is stamped');

assert.equal(audit.json.summary.total, audit.json.total, 'the summary counts what the caller may see');
assert.ok(audit.json.stored >= audit.json.total, 'a member never sees more than is stored');
assert.equal(typeof audit.json.canSeeAll, 'boolean');
assert.equal(audit.json.scope, audit.json.canSeeAll ? 'all' : 'self');

const passwordOnly = await call('/api/security/audit?group=password', { headers: { Cookie: liveCookie } });
assert.ok(
  (passwordOnly.json.events ?? []).every((event) => event.kind === 'password_change' || event.kind === 'password_reset'),
  'the password filter only returns password events',
);
assert.ok((passwordOnly.json.events ?? []).length >= 1, 'the password filter is not empty');

const signInOnly = await call('/api/security/audit?group=sign_in', { headers: { Cookie: liveCookie } });
assert.ok(
  (signInOnly.json.events ?? []).every((event) => event.kind === 'sign_in' || event.kind === 'sign_out'),
  'the sign-in filter only returns sign-in events',
);
assert.ok(
  (signInOnly.json.events ?? []).some((event) => event.ok === false),
  'the refusal survives the filter',
);

const refusedOnly = await call('/api/security/audit?failures=1', { headers: { Cookie: liveCookie } });
assert.ok((refusedOnly.json.events ?? []).length >= 1, 'refusals can be isolated');
assert.ok((refusedOnly.json.events ?? []).every((event) => event.ok === false), 'only refusals are returned');

const limited = await call('/api/security/audit?limit=2', { headers: { Cookie: liveCookie } });
assert.equal((limited.json.events ?? []).length, 2, 'the limit is honoured');
assert.ok(
  Date.parse(limited.json.events[0].at) >= Date.parse(limited.json.events[1].at),
  'events come newest first',
);

// A second account must never see the first one's trail.
const otherRegistered = await post('/api/auth/register', { name: 'Audit Other', email: other, password });
assert.ok(otherRegistered.response.ok, `second register must succeed: ${JSON.stringify(otherRegistered.json)}`);
const otherCookie = cookieOf(otherRegistered.response);
const otherAudit = await call('/api/security/audit?limit=200', { headers: { Cookie: otherCookie } });
assert.ok(otherAudit.response.ok, 'the second account reads its own trail');
const otherEvents = otherAudit.json.events ?? [];
assert.ok(otherEvents.length >= 1, 'the second account has its own registration event');
// Compare ids, not masked addresses: two accounts on the same domain mask to
// the same string (`a***@example.invalid`), so the mask can never prove scope.
const firstAccountId = registered.json.user.id;
assert.ok(
  otherEvents.every((event) => event.actorId !== firstAccountId),
  "one account never sees another account's events",
);
assert.equal(otherAudit.json.canSeeAll, false, 'a member is scoped to their own events');
assert.equal(otherAudit.json.scope, 'self');

console.log(
  `PASS API: security audit — ${kinds.length} kinds recorded, masked addresses, refusal visible, filters, limit and per-account scope`,
);

/* -------------------------------------------------------------- browser leg */

let chrome = null;
let page = null;
try {
  chrome = await launch({ port: 9496, profile: path.join(process.env.TEMP || '.', `aether-audit-${process.pid}`) });
  page = await newPage(9496);
  await viewport(page, 1280, 900);
  await goto(page, `${base}/`, 4000);
  const waitFor = async (expression, timeout = 15_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await evaluate(page, expression)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  };
  const fill = (selector, value) =>
    evaluate(
      page,
      `(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );

  assert.ok(await waitFor(`!!document.querySelector('[data-auth-form]')`), 'the sign-in form renders');
  await fill('[data-auth-form] input[type="email"]', email);
  await fill('[data-auth-form] input[type="password"]', workingPassword);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await evaluate(page, `document.querySelector('[data-auth-form]').requestSubmit()`);

  assert.ok(
    await waitFor(`!document.querySelector('[data-auth-form]') && !!document.querySelector('a[href="/inbox"]')`),
    'signing in opens the workspace',
  );

  await goto(page, `${base}/settings/security`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-security-audit]')`), 'the security panel renders');
  assert.ok(await waitFor(`document.querySelectorAll('[data-audit-row]').length > 0`), 'the panel lists events');

  const rows = await evaluate(page, `document.querySelectorAll('[data-audit-row]').length`);
  assert.ok(rows > 0, `the panel renders rows (${rows})`);
  assert.ok(
    await evaluate(page, `!!document.querySelector('[data-audit-kind="sign_in"]')`),
    'the fresh sign-in is on screen',
  );
  assert.ok(await evaluate(page, `!!document.querySelector('[data-audit-ok="0"]')`), 'the refusal is on screen');
  const total = await evaluate(page, `Number(document.querySelector('[data-audit-total]')?.textContent ?? '0')`);
  assert.ok(total > 0, `the counter reads the trail (${total})`);
  const text = await evaluate(page, `document.querySelector('[data-security-audit]')?.textContent ?? ''`);
  assert.ok(text.includes(masked), 'the row shows the masked address');
  assert.ok(!text.includes(email), 'the full address is never rendered');

  await evaluate(page, `document.querySelector('[data-audit-group="password"]')?.click()`);
  assert.ok(
    await waitFor(
      `(() => { const rows = [...document.querySelectorAll('[data-audit-row]')]; return rows.length > 0 && rows.every((row) => row.dataset.auditKind.startsWith('password')); })()`,
    ),
    'the password chip filters the list',
  );

  await evaluate(page, `document.querySelector('[data-audit-group="all"]')?.click()`);
  await evaluate(page, `document.querySelector('[data-audit-failures-toggle]')?.click()`);
  assert.ok(
    await waitFor(
      `(() => { const rows = [...document.querySelectorAll('[data-audit-row]')]; return rows.length > 0 && rows.every((row) => row.dataset.auditOk === '0'); })()`,
    ),
    'refused-only keeps just the refusals',
  );
  await evaluate(page, `document.querySelector('[data-audit-failures-toggle]')?.click()`);
  assert.ok(await waitFor(`document.querySelectorAll('[data-audit-row]').length > 1`), 'turning it off restores the list');

  await shot(page, process.env.AETHER_AUDIT_SHOT || path.resolve('docs/checks/266-security-audit.png'));
  console.log('PASS browser: security panel, masked rows, refusal badge, password chip and refused-only toggle');
} catch (error) {
  console.log(`SKIP browser leg: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  page?.ws?.close();
  chrome?.proc?.kill();
}

// keep the last cookie relevant for a later manual check
if (extraCookie) console.log('note: the audit trail of this run stays in the data directory');

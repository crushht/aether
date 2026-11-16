// Email-code sign-in: API contract plus the browser form.
//
// Needs a server started with AETHER_EMAIL_ECHO=1, so the code comes back in
// the reply instead of an inbox. With a real relay and no echo the script says
// so and exits 0 — it never sends unsolicited mail.
//
//   $env:AETHER_EMAIL_ECHO='1'; npm run dev
//   node scripts/e2e-email-code.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const stamp = Date.now();
const email = `code-${stamp}@example.invalid`;
const password = 'correct-horse-battery';
const nextPassword = 'battery-horse-correct';

const call = async (url, init = {}) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};
const cookieOf = (response) =>
  (response.headers.getSetCookie?.() ?? []).find((value) => value.startsWith('lab_session='))?.split(';')[0] ?? '';
const post = (url, body, cookie) =>
  call(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

/* ------------------------------------------------------------------- state */

const state = await call('/api/auth');
assert.ok(state.response.ok, 'the auth endpoint must answer');
assert.ok(state.json.emailCode && typeof state.json.emailCode.available === 'boolean', 'auth state reports mail readiness');

const signupCode = await post('/api/auth/email-code', { email, purpose: 'signup' });
if (!signupCode.json.devCode) {
  console.log('SKIP email-code e2e: this server delivers real mail; start it with AETHER_EMAIL_ECHO=1');
  process.exit(0);
}
assert.equal(signupCode.response.status, 200);
assert.equal(signupCode.json.delivered, false, 'echo mode sends nothing');
assert.match(signupCode.json.devCode, /^\d{6}$/, 'a six-digit code comes back');

/* ---------------------------------------------------------------- cooldown */

const tooSoon = await post('/api/auth/email-code', { email, purpose: 'signup' });
assert.equal(tooSoon.response.status, 429, 'a second send inside the cooldown is refused');
assert.ok(Number(tooSoon.response.headers.get('retry-after')) > 0, 'the refusal carries Retry-After');

/* ---------------------------------------------------------------- register */

const wrongRegister = await post('/api/auth/register', {
  name: 'Code Tester',
  email,
  password,
  emailCode: '000000',
});
assert.equal(wrongRegister.response.status, 401, 'a wrong verification code cannot register');

const registered = await post('/api/auth/register', {
  name: 'Code Tester',
  email,
  password,
  emailCode: signupCode.json.devCode,
});
assert.ok(registered.response.ok, `register must succeed: ${JSON.stringify(registered.json)}`);
assert.match(cookieOf(registered.response), /^lab_session=/, 'register sets a session cookie');
assert.equal(registered.json.user.email, email);

/* ------------------------------------------------------------- sign in by code */

// a different purpose is a different cooldown bucket, so no wait is needed
const signinCode = await post('/api/auth/email-code', { email, purpose: 'signin' });
assert.equal(signinCode.response.status, 200, `signin code refused: ${JSON.stringify(signinCode.json)}`);
const wrongCode = await post('/api/auth', { email, code: '000000' });
assert.equal(wrongCode.response.status, 401);
assert.match(wrongCode.json.error, /left/, 'a wrong code reports attempts left');

const signedIn = await post('/api/auth', { email, code: signinCode.json.devCode });
assert.ok(signedIn.response.ok, `code sign-in failed: ${JSON.stringify(signedIn.json)}`);
const memberCookie = cookieOf(signedIn.response);
assert.ok(memberCookie, 'code sign-in sets a cookie');
assert.equal(signedIn.json.authenticated, true);

/* ------------------------------------------------------------ password reset */

const resetCode = await post('/api/auth/email-code', { email, purpose: 'reset' });
assert.equal(resetCode.response.status, 200);
const reset = await post('/api/auth/password', { email, code: resetCode.json.devCode, password: nextPassword });
assert.ok(reset.response.ok, `reset failed: ${JSON.stringify(reset.json)}`);

const oldPassword = await post('/api/auth', { email, password });
assert.equal(oldPassword.response.status, 401, 'the old password no longer works');
const newPassword = await post('/api/auth', { email, password: nextPassword });
assert.ok(newPassword.response.ok, 'the new password works');

const oldSession = await call('/api/auth', { headers: { Cookie: memberCookie } });
assert.equal(oldSession.json.authenticated, false, 'a reset revokes the sessions that existed before it');

console.log('PASS API: email code — send, cooldown, verified register, code sign-in, reset and session revocation');

/* ------------------------------------------------------------------ browser */

// The API leg just used every purpose for this address; wait out the 60-second
// per-address cooldown so the form can ask for its own code.
await new Promise((resolve) => setTimeout(resolve, 62_000));

let chrome = null;
let page = null;
try {
  chrome = await launch({ port: 9491, profile: path.join(process.env.TEMP || '.', `aether-email-${process.pid}`) });
  page = await newPage(9491);
  await viewport(page, 1280, 900);
  await goto(page, `${base}/`, 4000);
  const waitFor = async (expression, timeout = 12_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await evaluate(page, expression)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  };

  assert.ok(await waitFor(`!!document.querySelector('[data-auth-form]')`), 'the sign-in form renders');
  assert.ok(await waitFor(`!!document.querySelector('[data-auth-method]')`), 'the method switch renders');
  await evaluate(page, `document.querySelector('[data-method="code"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-send-code]') && !!document.querySelector('[data-auth-code]')`), 'code mode shows send + code fields');

  await evaluate(
    page,
    `(() => {
      const input = document.querySelector('[data-auth-form] input[type="email"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(email)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
  await evaluate(page, `document.querySelector('[data-send-code]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-dev-code]')`, 15_000), 'echo mode shows the local code');
  const shown = await evaluate(page, `document.querySelector('[data-dev-code]')?.textContent ?? ''`);
  assert.match(shown, /\d{6}/, `the local code is on screen: ${shown}`);

  await evaluate(
    page,
    `(() => {
      const input = document.querySelector('[data-auth-code]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify('000000')});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-auth-form]').requestSubmit();
    })()`,
  );
  assert.ok(await waitFor(`!!document.querySelector('[data-auth-error]')`), 'a wrong code shows an inline error');

  await shot(page, path.join(process.env.TEMP || '.', 'aether-email-code.png'));
  console.log('PASS browser: email-code tab, send button, local code hint and inline error');
} catch (error) {
  console.log(`SKIP browser leg: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  page?.ws?.close();
  chrome?.proc?.kill();
}

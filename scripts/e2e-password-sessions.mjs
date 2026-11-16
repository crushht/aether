// Changing the password signs out other browsers but keeps this one.
import assert from 'node:assert/strict';

const base = process.env.AUTH_E2E_URL || 'http://127.0.0.1:4322';
const email = `password-${Date.now()}@example.com`;
const oldPassword = 'correct-horse-battery';
const newPassword = 'a-new-correct-horse';

const cookieOf = (response) => {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return (cookies.find((value) => value.startsWith('lab_session=')) ?? '').split(';')[0];
};
const call = async (url, init = {}) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};

const registered = await call('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Password Tester', email, password: oldPassword }),
});
assert.ok(registered.response.ok, 'register must succeed');
const first = cookieOf(registered.response);

const logged = await call('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: oldPassword }),
});
assert.ok(logged.response.ok, 'second login must succeed');
const second = cookieOf(logged.response);

const changed = await call('/api/auth', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Cookie: first },
  body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
});
assert.ok(changed.response.ok, `password change must succeed: ${JSON.stringify(changed.json)}`);

const other = await call('/api/auth', { headers: { Cookie: second } });
assert.equal(other.json.authenticated, false, 'the other browser must be signed out');

const current = await call('/api/auth', { headers: { Cookie: first } });
assert.equal(current.json.authenticated, true, 'the browser that changed the password stays signed in');

const oldLogin = await call('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: oldPassword }),
});
assert.equal(oldLogin.response.status, 401, 'the old password no longer works');

const newLogin = await call('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: newPassword }),
});
assert.ok(newLogin.response.ok, 'the new password works');

console.log('PASS API: a password change revokes other sessions and keeps the current one');

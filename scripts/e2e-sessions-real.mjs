// Real accounts mode: two sessions are listed with UA/IP and "others" revokes them.
import assert from 'node:assert/strict';

const base = process.env.AUTH_E2E_URL || 'http://127.0.0.1:4322';
const email = `sessions-${Date.now()}@example.com`;
const password = 'correct-horse-battery';

const cookieOf = (response) => {
  const cookies = response.headers.getSetCookie?.() ?? [];
  const raw = cookies.find((value) => value.startsWith('lab_session=')) ?? '';
  return raw.split(';')[0];
};

const call = async (url, init = {}) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};

const registered = await call('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'AetherTest/1.0 (Windows NT 10.0)' },
  body: JSON.stringify({ name: 'Session Tester', email, password }),
});
assert.ok(registered.response.ok, `register must succeed: ${JSON.stringify(registered.json)}`);
const first = cookieOf(registered.response);
assert.ok(first, 'register must set a session cookie');

const logged = await call('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'AetherTest/1.0 (Macintosh; Mac OS X)' },
  body: JSON.stringify({ email, password }),
});
assert.ok(logged.response.ok, 'second login must succeed');
const second = cookieOf(logged.response);
assert.ok(second && second !== first, 'second session must get its own cookie');

const listed = await call('/api/accounts/sessions', { headers: { Cookie: first } });
assert.equal(listed.json.sessions.length, 2, 'both sessions must be listed');
assert.equal(listed.json.sessions.filter((session) => session.current).length, 1, 'exactly one current session');
assert.ok(listed.json.sessions.every((session) => typeof session.ip === 'string'), 'each session reports its IP');
assert.ok(listed.json.sessions.some((session) => session.ua.includes('Windows')), 'UA is recorded');
assert.ok(listed.json.sessions.some((session) => session.ua.includes('Macintosh')), 'second UA is recorded');

const revoked = await call('/api/accounts/sessions?others=1', { method: 'DELETE', headers: { Cookie: first } });
assert.equal(revoked.json.removed, 1, 'one other session must be signed out');

const after = await call('/api/accounts/sessions', { headers: { Cookie: first } });
assert.equal(after.json.sessions.length, 1, 'only the current session remains');

const gone = await call('/api/auth', { headers: { Cookie: second } });
assert.equal(gone.json.authenticated, false, 'the revoked cookie no longer authenticates');

console.log('PASS API: sessions record UA/IP and "sign out others" revokes the rest');

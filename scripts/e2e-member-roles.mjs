// Roles: owners promote members, and the last owner cannot demote itself.
import assert from 'node:assert/strict';

const base = process.env.AUTH_E2E_URL || 'http://127.0.0.1:4322';
const cookieOf = (response) => {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return (cookies.find((value) => value.startsWith('lab_session=')) ?? '').split(';')[0];
};
const call = async (url, init = {}) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};
const register = async (name, email) => {
  const result = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'correct-horse-battery' }),
  });
  assert.ok(result.response.ok, `register ${name}: ${JSON.stringify(result.json)}`);
  return cookieOf(result.response);
};
const patchRole = (cookie, id, role) =>
  call('/api/members', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id, role }),
  });

const stamp = Date.now();
const ownerCookie = await register('Owner One', `owner-${stamp}@example.com`);
const memberCookie = await register('Member Two', `member-${stamp}@example.com`);

const me = await call('/api/auth', { headers: { Cookie: ownerCookie } });
const ownerId = me.json.user.id;
const users = await call('/api/members', { headers: { Cookie: ownerCookie } });
const member = users.json.users.find((user) => user.id !== ownerId);
assert.ok(member && member.role === 'member', 'the second account starts as a member');

const promoted = await patchRole(ownerCookie, member.id, 'owner');
assert.ok(promoted.response.ok, 'owner can promote a member');

const demotedSelf = await patchRole(ownerCookie, ownerId, 'member');
assert.ok(demotedSelf.response.ok, 'with two owners, one can step down');

const lastOwner = await patchRole(memberCookie, member.id, 'member');
assert.equal(lastOwner.response.status, 403, 'the last owner cannot be demoted');
assert.match(String(lastOwner.json.error), /owner/i);

console.log('PASS API: owners promote members and the last owner is protected');

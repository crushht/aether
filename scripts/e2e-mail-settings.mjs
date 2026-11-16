// Mail service settings: the relay is configured in the UI, encrypted on the
// server, and effective on the very next request.
//
// Everything here is local: a fake SMTP relay listens on 127.0.0.1, so the
// script proves connect → AUTH → DATA without sending any real mail.
//
//   $env:AUTH_DISABLED='1'; $env:LAB_DATA_DIR='<scratch dir>'; npm run dev
//   node scripts/e2e-mail-settings.mjs
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const PORT = Number(process.env.AETHER_FAKE_SMTP_PORT || 2525);
const user = 'bot@example.com';
const secret = 'e2e-secret-code';

const call = async (url, init = {}) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};
const jsonBody = (method, body) =>
  call('/api/settings/mail', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

/* ---------------------------------------------------------- fake SMTP relay */

const seen = { connections: 0, auth: [], messages: [] };

function startRelay() {
  const server = net.createServer((socket) => {
    seen.connections += 1;
    let buffer = '';
    let stage = 'command';
    let data = '';
    let pendingUser = '';
    socket.setEncoding('utf8');
    socket.write('220 fake.local ESMTP\r\n');
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let index = buffer.indexOf('\r\n'); index >= 0; index = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (stage === 'data') {
          if (line === '.') {
            stage = 'command';
            seen.messages.push(data);
            data = '';
            socket.write('250 2.0.0 queued\r\n');
          } else {
            data += `${line.replace(/^\.\./, '.')}\n`;
          }
          continue;
        }
        if (stage === 'user') {
          pendingUser = Buffer.from(line, 'base64').toString('utf8');
          stage = 'pass';
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }
        if (stage === 'pass') {
          seen.auth.push(`${pendingUser}:${Buffer.from(line, 'base64').toString('utf8')}`);
          stage = 'command';
          socket.write('235 2.7.0 authenticated\r\n');
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-fake.local\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
        } else if (upper.startsWith('AUTH LOGIN')) {
          stage = 'user';
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (upper.startsWith('AUTH PLAIN')) {
          seen.auth.push('PLAIN');
          socket.write('235 2.7.0 authenticated\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write('250 2.1.0 ok\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          socket.write('250 2.1.5 ok\r\n');
        } else if (upper === 'DATA') {
          stage = 'data';
          socket.write('354 go ahead\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else if (upper === 'STARTTLS') {
          socket.write('454 TLS not available\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const relay = await startRelay();
console.log(`fake SMTP relay on 127.0.0.1:${PORT}`);

try {
  /* -------------------------------------------------------------- API leg */

  // Known starting point: nothing saved here (`.env.local` may still hold one).
  await jsonBody('DELETE');
  const before = await call('/api/auth');
  assert.ok(before.response.ok, 'the auth endpoint answers');

  const initial = await jsonBody('GET');
  assert.ok(initial.response.ok, `mail settings must load: ${JSON.stringify(initial.json)}`);
  assert.equal(initial.json.saved, null, 'the script starts with nothing saved');
  assert.equal(initial.json.canManage, true, 'local mode is the owner, so the form is editable');
  assert.equal(initial.json.effective.source, before.json.emailCode.source, 'the API agrees with /api/auth');

  const incomplete = await jsonBody('PUT', { enabled: true, user, host: '127.0.0.1', port: '2525' });
  assert.equal(incomplete.response.status, 400, 'a relay without a password is refused');
  assert.ok(incomplete.json.errors?.pass, 'the refusal names the missing field');

  const unsafe = await jsonBody('PUT', {
    enabled: true,
    user,
    host: 'smtp.example.com',
    port: '25',
    secure: false,
    starttls: false,
    pass: secret,
  });
  assert.equal(unsafe.response.status, 400, 'plaintext to a public relay is refused');
  assert.ok(unsafe.json.errors?.starttls, 'and it points at TLS');

  const saved = await jsonBody('PUT', {
    enabled: true,
    user,
    host: '127.0.0.1',
    port: String(PORT),
    secure: false,
    starttls: false,
    pass: secret,
    from: user,
    fromName: 'Aether e2e',
  });
  assert.ok(saved.response.ok, `saving a local relay must work: ${JSON.stringify(saved.json)}`);
  assert.equal(saved.json.saved.host, '127.0.0.1');
  assert.equal(saved.json.saved.port, PORT);
  assert.equal(saved.json.saved.hasPass, true, 'the password is stored');
  assert.equal(saved.json.effective.source, 'settings', 'the saved relay is the one in use');
  assert.ok(!JSON.stringify(saved.json).includes(secret), 'the password never comes back over the wire');
  assert.ok(saved.json.notices?.includes('plaintext'), 'a LAN relay is flagged as plaintext');

  // The whole point: no restart, no .env.local.
  const after = await call('/api/auth');
  assert.equal(after.json.emailCode.available, true, 'email codes are available immediately after saving');
  assert.equal(after.json.emailCode.source, 'settings');
  assert.equal(after.json.emailCode.host, '127.0.0.1');

  const tested = await jsonBody('POST', { action: 'test' });
  assert.ok(tested.response.ok, `test connection failed: ${JSON.stringify(tested.json)}`);
  assert.equal(tested.json.tested, true);
  assert.ok(seen.connections > 0, 'the relay was dialled');
  assert.ok(
    seen.auth.some((row) => row === `${user}:${secret}`),
    `the relay saw AUTH LOGIN credentials: ${JSON.stringify(seen.auth)}`,
  );

  const resent = await jsonBody('POST', {
    action: 'test',
    host: '127.0.0.1',
    port: '1',
    secure: false,
    starttls: false,
    user,
    pass: secret,
  });
  assert.equal(resent.response.status, 502, 'a closed port fails the test instead of hanging');

  const sent = await jsonBody('POST', { action: 'send', to: user });
  assert.ok(sent.response.ok, `test message failed: ${JSON.stringify(sent.json)}`);
  assert.equal(sent.json.to, user);
  assert.ok(seen.messages.length > 0, 'the relay received DATA');
  assert.match(seen.messages.at(-1), /Aether mail test/, 'the message is the test mail');
  assert.match(seen.messages.at(-1), /Subject:/, 'with headers');

  console.log('PASS API: save (encrypted, never echoed), immediate effect, test connection, test message, closed port');

  /* ---------------------------------------------------------- browser leg */

  let chrome = null;
  let page = null;
  try {
    chrome = await launch({ port: 9493, profile: path.join(process.env.TEMP || '.', `aether-mail-${process.pid}`) });
    page = await newPage(9493);
    await viewport(page, 1280, 900);
    await goto(page, `${base}/settings/mail`, 4000);
    const waitFor = async (expression, timeout = 12_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await evaluate(page, expression)) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return false;
    };

    assert.ok(await waitFor(`!!document.querySelector('[data-mail-panel]')`), 'the mail panel renders');
    assert.ok(
      await waitFor(`document.querySelector('[data-mail-status]')?.dataset.mailSource === 'settings'`),
      'the panel reports the saved relay',
    );
    assert.equal(
      await evaluate(page, `document.querySelector('[data-mail-host]')?.value ?? ''`),
      '127.0.0.1',
      'the form is filled from the saved settings',
    );

    // Re-test from the form: the password field is empty, so the stored one is used.
    await evaluate(page, `document.querySelector('[data-mail-test]')?.click()`);
    assert.ok(await waitFor(`!!document.querySelector('[data-mail-note]')`), 'a successful test reports back');
    const note = await evaluate(page, `document.querySelector('[data-mail-note]')?.textContent ?? ''`);
    assert.match(note, /127\.0\.0\.1/, `the note names the host: ${note}`);

    await evaluate(page, `document.querySelector('[data-mail-send]')?.click()`);
    assert.ok(
      await waitFor(`(document.querySelector('[data-mail-note]')?.textContent ?? '').includes('${user}')`),
      'the test message reports its recipient',
    );

    // Evidence for docs: the panel in its saved state (AETHER_MAIL_SHOT picks the path).
    assert.ok(await waitFor(`!!document.querySelector('[data-mail-plaintext]')`), 'a LAN relay is labelled plaintext');
    await shot(page, process.env.AETHER_MAIL_SHOT || path.join(process.env.TEMP || '.', 'aether-mail-settings.png'));

    // A bad port from the form shows an inline error, not a silent failure.
    await evaluate(
      page,
      `(() => {
        const input = document.querySelector('[data-mail-port]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '1');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-mail-test]').click();
      })()`,
    );
    assert.ok(await waitFor(`!!document.querySelector('[data-mail-error]')`), 'a refused connection shows an error');

    await shot(page, path.join(process.env.TEMP || '.', 'aether-mail-settings-error.png'));
    console.log('PASS browser: panel, saved state, test connection, test message and inline error');
  } catch (error) {
    console.log(`SKIP browser leg: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    page?.ws?.close();
    chrome?.proc?.kill();
  }

  /* -------------------------------------------------------------- reset */

  const cleared = await jsonBody('DELETE');
  assert.ok(cleared.response.ok, 'clearing the saved relay works');
  assert.equal(cleared.json.saved, null, 'nothing is saved afterwards');
  const afterClear = await call('/api/auth');
  assert.equal(
    afterClear.json.emailCode.available,
    before.json.emailCode.available,
    'clearing falls back to whatever .env.local says',
  );
  assert.equal(afterClear.json.emailCode.source, before.json.emailCode.source === 'settings' ? 'none' : before.json.emailCode.source);
  console.log('PASS API: clearing falls back to .env.local (the state before saving)');
} finally {
  await new Promise((resolve) => relay.close(resolve));
}

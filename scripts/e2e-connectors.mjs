// Connector acceptance against the real API with a local echo service.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const echoPort = 9470;

const echo = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization ?? '', body }));
  });
});
await new Promise((resolve) => echo.listen(echoPort, '127.0.0.1', resolve));

// Ensure the app is up; failing here means the caller forgot the dev server.
const health = await fetch(`${base}/api/auth`).catch(() => null);
assert.ok(health?.ok, `dev server must answer at ${base}`);

const json = (response) => response.json().catch(() => ({}));
let connectorId;

try {
  // Clean slate, then add a connector with a token.
  let response = await fetch(`${base}/api/agent/connectors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectors: [] }),
  });
  assert.ok(response.ok, 'clearing connectors must succeed');

  response = await fetch(`${base}/api/agent/connectors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectors: [{ name: 'Echo', baseUrl: `http://127.0.0.1:${echoPort}`, token: 'test-token-123' }],
    }),
  });
  let body = await json(response);
  assert.ok(response.ok && body.ok, `connector save failed: ${JSON.stringify(body)}`);
  assert.equal(body.connectors.length, 1);
  connectorId = body.connectors[0].id;
  assert.equal(body.connectors[0].hasToken, true);
  assert.ok(!JSON.stringify(body).includes('test-token-123'), 'token must never be returned');

  // GET through the proxy works, carries the token, and keeps the path+query.
  response = await fetch(`${base}/api/agent/connectors/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorId, method: 'GET', path: '/hello?x=1' }),
  });
  body = await json(response);
  assert.ok(response.ok && body.ok, `proxy failed: ${JSON.stringify(body)}`);
  const echoed = JSON.parse(body.body);
  assert.equal(echoed.method, 'GET');
  assert.equal(echoed.url, '/hello?x=1');
  assert.equal(echoed.auth, 'Bearer test-token-123');

  // Write methods forward a JSON body.
  response = await fetch(`${base}/api/agent/connectors/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorId, method: 'POST', path: '/items', body: { hello: 'world' } }),
  });
  body = await json(response);
  assert.ok(response.ok && body.ok);
  const posted = JSON.parse(body.body);
  assert.equal(posted.method, 'POST');
  assert.equal(posted.body, JSON.stringify({ hello: 'world' }));

  // Paths cannot escape the connector; unknown ids are a 404.
  response = await fetch(`${base}/api/agent/connectors/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorId, method: 'GET', path: 'http://evil.example/x' }),
  });
  assert.equal(response.status, 400, 'absolute URLs must be refused');
  response = await fetch(`${base}/api/agent/connectors/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorId: 'missing', method: 'GET', path: '/' }),
  });
  assert.equal(response.status, 404);

  // Remote plain http is refused when saving.
  response = await fetch(`${base}/api/agent/connectors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectors: [{ name: 'Bad', baseUrl: 'http://example.com' }] }),
  });
  assert.equal(response.status, 400, 'plain http must be local-only');

  // The agent tool lists and calls connectors through the same API.
  await fetch(`${base}/api/agent/connectors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectors: [{ id: connectorId, name: 'Echo', baseUrl: `http://127.0.0.1:${echoPort}` }] }),
  });
  const listResponse = await fetch(`${base}/api/agent/connectors`);
  const listed = await json(listResponse);
  assert.equal(listed.connectors.length, 1);
  assert.equal(listed.connectors[0].name, 'Echo');

  console.log('PASS connectors: save/list without leaking tokens, proxy GET/POST, escape and http guards');
} finally {
  await fetch(`${base}/api/agent/connectors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectors: [] }),
  }).catch(() => undefined);
  echo.close();
}

// Session management: the account page shows the session section.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9488, profile: path.join(process.env.TEMP || '.', `aether-sessions-${process.pid}`) });
let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, timeout = 12000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expr)) return true;
    await wait(250);
  }
  return false;
};

try {
  page = await newPage(9488);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/account`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-sessions]')`), 'session section must render');
  const text = await evaluate(page, `document.querySelector('[data-sessions]').innerText`);
  assert.ok(text.length > 0, 'session section must say something');
  const api = await (await fetch(`${base}/api/accounts/sessions`)).json();
  assert.ok(api.ok && Array.isArray(api.sessions), 'sessions API must answer');

  console.log('PASS browser: account page renders the session section and API answers');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

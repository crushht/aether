// Invite management: open signup state and the copied link.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9486, profile: path.join(process.env.TEMP || '.', `aether-invite-${process.pid}`) });
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
  page = await newPage(9486);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/members`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-copy-invite]')`), 'invite controls must render');
  const text = await evaluate(page, `document.body.innerText`);
  assert.ok(text.includes('注册开放') || text.includes('Signup is open'), `open signup copy missing: ${text.slice(0, 400)}`);

  await evaluate(page, `Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value) => { window.__inviteCopied = value; } }, configurable: true })`);
  await evaluate(page, `document.querySelector('[data-copy-invite]')?.click()`);
  await wait(400);
  const copied = await evaluate(page, `window.__inviteCopied ?? ''`);
  assert.ok(copied === `${base}/` || copied === `${base}`, `link must be the workspace root: ${copied}`);
  assert.ok(!copied.includes('invite='), 'open signup links carry no code');

  console.log('PASS browser: invite management shows open signup and copies the root link');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

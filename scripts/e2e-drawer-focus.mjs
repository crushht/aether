// The issue drawer is modal: Tab cycles inside it and focus starts inside.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9515, profile: path.join(process.env.TEMP || '.', `aether-drawer-focus-${process.pid}`) });
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
  page = await newPage(9515);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const issueId = await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'Focus trap issue', status: 'todo' }).id`);
  await wait(500);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`), 'drawer must open');
  await wait(500);
  const active = await evaluate(page, `(() => {
    const el = document.activeElement;
    return el ? el.tagName + ':' + (el.getAttribute('data-drawer-focus') || el.getAttribute('aria-label') || el.className).toString().slice(0, 60) : 'none';
  })()`);
  assert.equal(
    await evaluate(page, `document.querySelector('[role="dialog"][aria-modal="true"]').contains(document.activeElement)`),
    true,
    `focus must start inside the drawer (active: ${active})`,
  );

  await evaluate(page, `document.querySelector('[role="dialog"][aria-modal="true"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))`);
  await wait(200);
  assert.equal(
    await evaluate(page, `document.querySelector('[role="dialog"][aria-modal="true"]').contains(document.activeElement)`),
    true,
    'Tab must stay inside the drawer',
  );

  console.log('PASS browser: issue drawer traps focus');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Settings search filters the tab list and navigates.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9496, profile: path.join(process.env.TEMP || '.', `aether-settings-search-${process.pid}`) });
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
const type = (text) => evaluate(page, `(() => {
  const el = document.querySelector('[data-settings-search]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

try {
  page = await newPage(9496);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/account`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-settings-search]')`), 'settings search must render');

  const total = await evaluate(page, `document.querySelectorAll('[data-settings-tab]').length`);
  assert.ok(total >= 6, `expected several settings tabs, got ${total}`);

  await type('通知');
  await wait(300);
  const visible = await evaluate(page, `[...document.querySelectorAll('[data-settings-tab]')].map((el) => el.getAttribute('data-settings-tab'))`);
  assert.deepEqual(visible, ['notifications'], 'search must narrow to the notifications tab');

  await evaluate(page, `document.querySelector('[data-settings-tab="notifications"]')?.click()`);
  assert.ok(await waitFor(`location.pathname === '/settings/notifications'`), 'clicking must open the tab');
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-prefs]')`), 'panel must render');

  await goto(page, `${base}/settings/account`, 2500);
  assert.ok(await waitFor(`!!document.querySelector('[data-settings-search]')`), 'search must reload');
  await type('zzz-no-match');
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-settings-tab]').length`), 0, 'no tabs for a miss');
  assert.ok((await evaluate(page, `document.body.innerText`)).includes('没有匹配的设置') || (await evaluate(page, `document.body.innerText`)).includes('No matching settings'));

  console.log('PASS browser: settings search narrows tabs, navigates and reports a miss');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

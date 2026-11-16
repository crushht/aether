// Quiet hours UI: enable, pick a cross-midnight window, persist.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9476, profile: path.join(process.env.TEMP || '.', `aether-quiet-${process.pid}`) });
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
  page = await newPage(9476);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/notifications`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-quiet-hours]')`), 'quiet hours section must render');
  assert.equal(await evaluate(page, `document.querySelector('[data-notify-pref="quiet-toggle"]').getAttribute('aria-checked')`), 'false', 'quiet hours start disabled');
  assert.equal(await evaluate(page, `document.querySelector('[data-quiet-start]').disabled`), true, 'time selects are disabled until enabled');

  await evaluate(page, `document.querySelector('[data-notify-pref="quiet-toggle"]')?.click()`);
  await wait(300);
  await evaluate(page, `(() => {
    const select = document.querySelector('[data-quiet-start]');
    select.value = '23';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const end = document.querySelector('[data-quiet-end]');
    end.value = '7';
    end.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(300);
  const quiet = await evaluate(page, `window.__AETHER_NOTIFICATION_PREFS__.getState().quiet`);
  assert.deepEqual(quiet, { enabled: true, start: 23, end: 7 });

  await goto(page, `${base}/settings/notifications`, 2500);
  assert.ok(await waitFor(`!!document.querySelector('[data-notify-pref="quiet-toggle"]')`), 'panel must reload');
  assert.equal(await evaluate(page, `document.querySelector('[data-notify-pref="quiet-toggle"]').getAttribute('aria-checked')`), 'true', 'quiet hours persist');
  assert.equal(await evaluate(page, `document.querySelector('[data-quiet-start]').value`), '23');
  assert.equal(await evaluate(page, `document.querySelector('[data-quiet-end]').value`), '7');

  console.log('PASS browser: quiet hours enable, cross-midnight window and persistence');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

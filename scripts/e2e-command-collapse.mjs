// Command palette section collapse survives closing and reloading.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9497, profile: path.join(process.env.TEMP || '.', `aether-cmd-collapse-${process.pid}`) });
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
const openPalette = () => evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);

try {
  page = await newPage(9497);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_VIEW__`), 'app must boot');

  await openPalette();
  assert.ok(await waitFor(`!!document.querySelector('#command-results button[aria-expanded]')`), 'palette sections must render');
  const title = await evaluate(page, `document.querySelector('#command-results button[aria-expanded]').innerText`);
  await evaluate(page, `document.querySelector('#command-results button[aria-expanded]')?.click()`);
  await wait(300);
  const saved = await evaluate(page, `(() => {
    const key = Object.keys(window.localStorage).find((item) => item.startsWith('linear-lab:command-collapsed'));
    return key ? window.localStorage.getItem(key) : null;
  })()`);
  assert.ok(saved && saved.length > 2, 'collapsed sections must be stored');

  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(300);
  await openPalette();
  assert.ok(await waitFor(`!!document.querySelector('#command-results button[aria-expanded]')`), 'palette must reopen');
  assert.equal(
    await evaluate(page, `document.querySelector('#command-results button[aria-expanded]').getAttribute('aria-expanded')`),
    'false',
    'the section must stay collapsed on reopen',
  );

  await goto(page, `${base}/team/ENG`, 3500);
  await openPalette();
  assert.ok(await waitFor(`!!document.querySelector('#command-results button[aria-expanded]')`), 'palette after reload');
  assert.equal(
    await evaluate(page, `document.querySelector('#command-results button[aria-expanded]').getAttribute('aria-expanded')`),
    'false',
    'the section must stay collapsed after a reload',
  );

  console.log('PASS browser: command palette section collapse persists');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Acceptance for saved views: save the current filters, reopen them, delete.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9447, profile: path.join(process.env.TEMP || '.', `aether-views-${process.pid}`) });
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
  page = await newPage(9447);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-sync-status], [data-issue-row], main')`), 'app must boot');

  // Apply a filter through the real filter menu, then save it via the toolbar UI.
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('筛选') || (b.textContent || '').includes('Filter'))?.click()`);
  await wait(300);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '紧急' || (b.textContent || '').trim() === 'Urgent')?.click()`);
  await evaluate(page, `document.body.click()`);
  await wait(400);

  // Open the Views menu, name the view, save it.
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes('视图') || (b.textContent || '').trim() === 'Views')?.click()`);
  await wait(300);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-saved-view], input[placeholder*="名字"], input[placeholder*="view"]')`), 'saved views menu must open');
  await evaluate(page, `(() => { const el = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('名字') || (i.placeholder || '').includes('view')); if (!el) throw new Error('name input missing'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'Urgent only'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '保存' || (b.textContent || '').trim() === 'Save')?.click()`);
  await wait(600);
  const urlHasView = await evaluate(page, `new URLSearchParams(location.search).has('view')`);
  assert.ok(urlHasView, 'saving a view must put ?view= in the URL');
  const stored = await evaluate(page, `Object.keys(localStorage).filter((k) => k.includes('saved-views')).map((k) => localStorage.getItem(k)).join('')`);
  assert.ok(stored.includes('Urgent only'), 'the view must be persisted');

  // Clear the filter, then reopen the view and confirm the Urgent filter returns.
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '清除' || (b.textContent || '').trim() === 'Clear')?.click()`);
  await wait(400);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes('视图') || (b.textContent || '').trim() === 'Views')?.click()`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-saved-view] button')?.click()`);
  await wait(600);
  const chips = await evaluate(page, `document.body.innerText`);
  assert.ok(chips.includes('紧急') || chips.includes('Urgent'), 'reopened view must restore its filter');

  // Delete it again.
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes('视图') || (b.textContent || '').trim() === 'Views')?.click()`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-saved-view] [aria-label="删除视图"], [data-saved-view] [aria-label="Delete view"]')?.click()`);
  await wait(300);
  const remaining = await evaluate(page, `!!document.querySelector('[data-saved-view]')`);
  assert.equal(remaining, false, 'deleting the last view must leave an empty state');

  console.log('PASS browser: saved view persists, restores filters, shareable via ?view=, and deletes');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

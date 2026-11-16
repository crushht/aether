// Mobile (375x812) smoke: no horizontal overflow, and the core surfaces stay usable.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9520, profile: path.join(process.env.TEMP || '.', `aether-mobile-${process.pid}`) });
let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, timeout = 15000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expr)) return true;
    await wait(250);
  }
  return false;
};
const overflow = () =>
  evaluate(page, `(() => {
    const doc = document.documentElement;
    return { scroll: doc.scrollWidth, client: doc.clientWidth, over: doc.scrollWidth - doc.clientWidth };
  })()`);
const checkWidth = async (label) => {
  const result = await overflow();
  assert.ok(result.over <= 2, `${label}: horizontal overflow ${result.over}px (scroll ${result.scroll}, client ${result.client})`);
};

try {
  page = await newPage(9520);
  await viewport(page, 375, 812);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  await wait(600);
  await checkWidth('team list');

  // rows are tappable and open the drawer full-width
  assert.ok(await waitFor(`!!document.querySelector('[data-issue-row]')`), 'rows must render on mobile');
  await evaluate(page, `document.querySelector('[data-issue-row]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`), 'drawer must open');
  await wait(400);
  await checkWidth('issue drawer');
  const drawer = await evaluate(page, `(() => {
    const el = document.querySelector('[role="dialog"][aria-modal="true"]');
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), left: Math.round(r.left), viewport: innerWidth };
  })()`);
  assert.ok(drawer.width <= drawer.viewport + 1, `drawer is wider than the screen: ${drawer.width} > ${drawer.viewport}`);
  await evaluate(page, `window.__AETHER_VIEW__.getState().closeIssue()`);
  await wait(400);

  await goto(page, `${base}/inbox`, 3000);
  await wait(500);
  await checkWidth('inbox');

  await goto(page, `${base}/search`, 3000);
  await wait(500);
  await checkWidth('search');
  await evaluate(page, `(() => {
    const el = document.querySelector('[data-global-search]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, 'a');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(600);
  await checkWidth('search results');

  await goto(page, `${base}/settings/preferences`, 3000);
  await wait(500);
  await checkWidth('settings');
  const tabs = await evaluate(page, `[...document.querySelectorAll('[data-settings-tab]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { key: el.getAttribute('data-settings-tab'), height: Math.round(r.height) };
  })`);
  assert.ok(tabs.length >= 4, 'settings tabs must exist on mobile');
  assert.ok(tabs.every((tab) => tab.height >= 24), 'tabs must keep a tappable height');

  // compact controls keep their look but get a wider invisible hit area
  const hit = await evaluate(page, `(() => {
    const el = document.querySelector('[data-mobile-hit]');
    if (!el) return null;
    const after = getComputedStyle(el, '::after');
    return { position: after.position, top: after.top, content: after.content };
  })()`);
  assert.ok(hit && hit.position === 'absolute', 'mobile hit area must be an absolutely positioned overlay');
  assert.ok(hit.top !== 'auto', 'the overlay must extend past the control');

  await goto(page, `${base}/projects`, 3000);
  await wait(500);
  await checkWidth('projects');

  // mobile navigation drawer: opens with the chord, closes with Escape
  await goto(page, `${base}/team/ENG`, 3000);
  await wait(500);
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\\\', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`document.querySelector('aside')?.getAttribute('data-open') === 'true'`), 'mobile nav must open');
  await wait(300);
  await checkWidth('mobile nav');
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.ok(await waitFor(`document.querySelector('aside')?.getAttribute('data-open') === 'false'`), 'Escape closes the drawer');

  // command palette fits the screen
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`!!document.querySelector('#command-results')`), 'palette must open');
  await wait(300);
  await checkWidth('command palette');
  const paletteWidth = await evaluate(page, `Math.round(document.querySelector('#command-results').closest('div.w-full').getBoundingClientRect().width)`);
  assert.ok(paletteWidth <= 375, `palette is wider than the screen: ${paletteWidth}`);
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(400);

  // board view scrolls inside itself, not the page
  await evaluate(page, `window.__AETHER_VIEW__.getState().setViewMode('board')`);
  await wait(700);
  await checkWidth('board');

  // agent chat overlays the app without widening it
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`document.body.innerText.includes('Agent') || !!document.querySelector('[data-agent-chat]')`), 'agent chat must open');
  await wait(600);
  await checkWidth('agent chat');

  console.log('PASS browser: 375px keeps the core surfaces usable');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

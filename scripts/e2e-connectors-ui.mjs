// UI check: the Connectors settings tab renders and reaches the API.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9453, profile: path.join(process.env.TEMP || '.', `aether-connectors-${process.pid}`) });
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
  page = await newPage(9453);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/connectors`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-connectors-panel]')`), 'connectors panel must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-connector-name]') && !!document.querySelector('[data-connector-url]')`), 'add form must render');

  // Add through the form; the list should refresh without a reload.
  await evaluate(page, `(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const name = document.querySelector('[data-connector-name]');
    const url = document.querySelector('[data-connector-url]');
    set.call(name, 'UI Echo'); name.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(url, 'http://127.0.0.1:9471'); url.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(300);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '添加' || b.textContent.trim() === 'Add connector')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-connector]')`), 'saved connector must appear in the list');
  assert.ok((await evaluate(page, `document.querySelector('[data-connectors-panel]').innerText`)).includes('UI Echo'));

  console.log('PASS browser: connectors settings tab renders, adds and lists a connector');
} finally {
  // leave the workspace clean for other suites
  await evaluate(page, `fetch('/api/agent/connectors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectors: [] }) })`).catch(() => undefined);
  page?.ws?.close();
  chrome.proc.kill();
}

// Always-allowed tools: the settings list reflects and clears the allowlist.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9490, profile: path.join(process.env.TEMP || '.', `aether-toolallow-${process.pid}`) });
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

try {
  page = await newPage(9490);
  await viewport(page, 1440, 960);
  await evaluate(page, `localStorage.removeItem('linear-lab:allowed-tools:' + (window.localStorage.getItem('linear-lab:account') ?? ''))`).catch(() => undefined);
  await goto(page, `${base}/settings/agents`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-allowed-tools]')`), 'allowlist section must render');
  assert.ok((await evaluate(page, `document.querySelector('[data-allowed-tools]').innerText`)).includes('还没有始终允许') ||
    (await evaluate(page, `document.querySelector('[data-allowed-tools]').innerText`)).includes('No tools are always allowed'), 'empty state must be explicit');

  await evaluate(page, `window.__AETHER_TOOL_APPROVALS__.getState().allow('update_issue')`);
  assert.ok(await waitFor(`document.querySelector('[data-allowed-tools]').innerText.includes('update_issue')`), 'allowed tool must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-clear-allowed-tools]')`), 'clear action must render');

  await evaluate(page, `document.querySelector('[data-clear-allowed-tools]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `window.__AETHER_TOOL_APPROVALS__.getState().allowed.length`), 0, 'clear must empty the allowlist');

  console.log('PASS browser: the allowed-tools list renders, revokes and clears');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

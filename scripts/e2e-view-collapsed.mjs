// Collapsed list groups survive a reload.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9494, profile: path.join(process.env.TEMP || '.', `aether-groups-${process.pid}`) });
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
  page = await newPage(9494);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_VIEW__`), 'app must boot');
  await evaluate(page, `window.__AETHER_VIEW__.setState({ collapsedGroups: ['todo'], viewMode: 'list' })`);
  await wait(500);

  const saved = await evaluate(page, `window.localStorage.getItem(Object.keys(window.localStorage).find((key) => key.startsWith('linear-lab:view')) ?? '')`);
  assert.ok(saved && saved.includes('todo'), 'collapsed group must be written to storage');

  await goto(page, `${base}/team/ENG`, 4000);
  assert.ok(await waitFor(`!!window.__AETHER_VIEW__`), 'app must reload');
  const after = await evaluate(page, `window.__AETHER_VIEW__.getState().collapsedGroups`);
  assert.deepEqual(after, ['todo'], 'collapsed group must survive a reload');

  await evaluate(page, `window.__AETHER_VIEW__.getState().toggleGroup('todo')`);
  await wait(300);
  assert.equal(await evaluate(page, `window.__AETHER_VIEW__.getState().collapsedGroups.length`), 0, 'toggling removes it');

  console.log('PASS browser: collapsed list groups persist across reloads');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// List rows are reachable by keyboard: Enter opens, Space selects.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9516, profile: path.join(process.env.TEMP || '.', `aether-row-keys-${process.pid}`) });
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
  page = await newPage(9516);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'Keyboard row', status: 'todo' })`);
  await wait(800);
  assert.ok(await waitFor(`!!document.querySelector('[data-issue-row]')`), 'row must render');

  await evaluate(page, `(() => {
    const row = document.querySelector('[data-issue-row]');
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  assert.ok(await waitFor(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`), 'Enter must open the issue');
  await evaluate(page, `window.__AETHER_VIEW__.getState().closeIssue()`);
  await wait(400);

  await evaluate(page, `(() => {
    const row = document.querySelector('[data-issue-row]');
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  })()`);
  await wait(300);
  assert.equal(
    await evaluate(page, `document.querySelector('[data-issue-row]').getAttribute('aria-selected')`),
    'true',
    'Space must select the row',
  );

  console.log('PASS browser: list rows respond to Enter and Space');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

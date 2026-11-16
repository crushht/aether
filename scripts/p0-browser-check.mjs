// Real browser acceptance for issue history and deep links; requires port 4321.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = 'http://127.0.0.1:4321';
const profile = path.join(process.env.TEMP || '.', `aether-p0-${process.pid}`);
const chrome = await launch({ port: 9444, profile });
let page;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (selector) => evaluate(page, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.click(); })()`);
const key = async (key, shiftKey = false) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, ctrlKey: true, shiftKey, windowsVirtualKeyCode: key.charCodeAt(0) }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, ctrlKey: true, shiftKey, windowsVirtualKeyCode: key.charCodeAt(0) }));

try {
  page = await newPage(9444);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 4500);
  assert.equal(await evaluate(page, `JSON.parse(localStorage.getItem('linear-lab:locale') || '"en"')`), 'en');

  // Create one issue through the actual composer, then open it from its row.
  await evaluate(page, `(() => { [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'New issue')?.click(); })()`);
  await wait(200);
  await evaluate(page, `(() => { const el = document.querySelector('[data-inline-composer]'); if (!el) throw new Error('composer missing'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'P0 browser acceptance'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(page, `document.querySelector('[data-inline-composer]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(350);
  const targetId = await evaluate(page, `[...document.querySelectorAll('[data-issue-row]')].find((el) => el.textContent.includes('P0 browser acceptance'))?.dataset.issueRow`);
  assert.ok(targetId);
  await click(`[data-issue-row="${targetId}"] > button`);
  await wait(300);
  const openedUrl = await evaluate(page, 'location.href');
  const keyValue = new URL(openedUrl).searchParams.get('issue');
  assert.match(keyValue, /^ENG-\d+$/);
  assert.ok(await evaluate(page, `!!document.querySelector('#issue-scroll')`));

  // Reopening the same issue must not add another entry.
  const beforeRepeat = await evaluate(page, 'history.length');
  await evaluate(page, `document.querySelector('[data-issue-row="${targetId}"] > button').click()`);
  await wait(200);
  assert.equal(await evaluate(page, 'history.length'), beforeRepeat);

  // Close uses back; forward reopens the drawer via popstate.
  await click('[aria-label="Close issue"]');
  await wait(350);
  assert.equal(new URL(await evaluate(page, 'location.href')).searchParams.has('issue'), false);
  await evaluate(page, 'history.forward()');
  await wait(400);
  assert.equal(new URL(await evaluate(page, 'location.href')).searchParams.get('issue'), keyValue);
  assert.ok(await evaluate(page, `!!document.querySelector('#issue-scroll')`));
  await click('[aria-label="Close issue"]');
  await wait(300);

  // Deletion and undo restore the actual row at its original position.
  const originalRows = await evaluate(page, `[...document.querySelectorAll('[data-issue-row]')].map((el) => el.dataset.issueRow)`);
  await click(`[aria-label="Actions for ${keyValue}"]`);
  await wait(150);
  await evaluate(page, `[...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Delete issue')?.click()`);
  await wait(250);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-issue-row="${targetId}"]')`), false);
  await key('z');
  await wait(300);
  assert.deepEqual(await evaluate(page, `[...document.querySelectorAll('[data-issue-row]')].map((el) => el.dataset.issueRow)`), originalRows);
  await key('z', true);
  await wait(250);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-issue-row="${targetId}"]')`), false);
  await key('z');
  await wait(250);

  // Select two real rows and change both statuses as one batch/history action.
  const pair = await evaluate(page, `[...document.querySelectorAll('[data-issue-row]')].filter((el) => !el.closest('section')?.querySelector('button')?.textContent?.includes('Done')).slice(0, 2).map((el) => el.dataset.issueRow)`);
  assert.equal(pair.length, 2);
  for (const id of pair) await click(`[data-issue-row="${id}"] [role="checkbox"]`);
  await wait(200);
  const initialStatus = await evaluate(page, `(${JSON.stringify(pair)}).map((id) => document.querySelector('[data-issue-row="' + id + '"]').closest('section').querySelector('.group\\/grp > div button')?.textContent)`);
  await evaluate(page, `[...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Status' && el.closest('.fixed'))?.click()`);
  await wait(150);
  await evaluate(page, `[...document.querySelectorAll('button')].filter((el) => el.textContent.trim() === 'Done').at(-1)?.click()`);
  await wait(300);
  for (const id of pair) assert.ok(await evaluate(page, `document.querySelector('[data-issue-row="${id}"]').closest('section').textContent.includes('Done')`));
  await key('z');
  await wait(300);
  for (const id of pair) assert.ok(await evaluate(page, `!!document.querySelector('[data-issue-row="${id}"]')`));
  await key('z', true);
  await wait(300);
  for (const id of pair) assert.ok(await evaluate(page, `document.querySelector('[data-issue-row="${id}"]').closest('section').textContent.includes('Done')`));
  await key('z');
  await wait(250);

  // Resolve an id deep link after hydration and canonicalize it without push.
  await goto(page, `${base}/projects`, 1500);
  const historyBeforeId = await evaluate(page, 'history.length');
  await evaluate(page, `history.pushState({ ...history.state }, '', '/team/ENG?issue=${targetId}'); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))`);
  await wait(300);
  assert.equal(new URL(await evaluate(page, 'location.href')).searchParams.get('issue'), keyValue);
  assert.ok(await evaluate(page, `!!document.querySelector('#issue-scroll')`));
  assert.equal(await evaluate(page, 'history.length'), historyBeforeId);

  // Direct links do not pretend an in-app history entry exists.
  await goto(page, `${base}/search?issue=${targetId}`, 2000);
  assert.ok(await evaluate(page, `!!document.querySelector('#issue-scroll')`));
  await click('[aria-label="Close issue"]');
  await wait(250);
  assert.equal(await evaluate(page, 'location.pathname'), '/search');
  assert.equal(new URL(await evaluate(page, 'location.href')).searchParams.has('issue'), false);
  console.log('PASS P0 browser: open/close/back/forward, id→key deep link, batch undo/redo, delete undo restores order');
  console.log(JSON.stringify({ initialStatus, targetId, keyValue }));
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

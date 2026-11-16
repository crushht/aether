// Inbox management: read/unread, archive/restore, delete.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9460, profile: path.join(process.env.TEMP || '.', `aether-inbox-${process.pid}`) });
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

const clickTab = (key) => evaluate(page, `document.querySelector('[data-inbox-tab="${key}"]')?.click()`);

try {
  page = await newPage(9460);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const ids = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const issue = data.createIssue({ title: 'Inbox fixture', status: 'todo' });
    data.pushNotification({ issueId: issue.id, kind: 'mention', count: 1 });
    data.pushNotification({ issueId: issue.id, kind: 'agent', count: 2 });
    return window.__AETHER_DATA__.getState().notifications.slice(0, 2).map((n) => n.id);
  })()`);
  assert.equal(ids.length, 2);
  // let the 500ms snapshot debounce land before navigating (a reload re-reads it)
  await wait(1200);

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`document.querySelectorAll('[data-notification]').length >= 2`, 12000), 'notifications must render');
  const baseline = await evaluate(page, `document.querySelectorAll('[data-notification]').length`);

  // Unread → read → unread.
  await evaluate(page, `document.querySelector('[data-notification-read="${ids[0]}"]')?.click()`);
  await wait(300);
  assert.ok(await evaluate(page, `document.querySelector('[data-notification-read="${ids[0]}"]')?.getAttribute('aria-label')?.includes('未读') || document.querySelector('[data-notification-read="${ids[0]}"]')?.getAttribute('aria-label')?.includes('unread')`), 'read notification offers mark-as-unread');
  await evaluate(page, `document.querySelector('[data-notification-read="${ids[0]}"]')?.click()`);
  await wait(300);
  assert.ok(await evaluate(page, `document.querySelector('[data-notification-read="${ids[0]}"]')?.getAttribute('aria-label')?.includes('已读') || document.querySelector('[data-notification-read="${ids[0]}"]')?.getAttribute('aria-label')?.includes('read')`), 'unread notification offers mark-as-read');

  // Archive → disappears from All, appears under Archived.
  await evaluate(page, `document.querySelector('[data-notification-archive="${ids[0]}"]')?.click()`);
  await wait(500);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-notification]').length`), baseline - 1, 'archived item leaves All');
  await clickTab('archived');
  await wait(300);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-notification="${ids[0]}"]')`), 'archived tab shows the item');
  await evaluate(page, `document.querySelector('[data-notification-archive="${ids[0]}"]')?.click()`);
  await wait(300);
  await clickTab('all');
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-notification]').length`), baseline, 'restored item returns to All');

  // Delete.
  await evaluate(page, `document.querySelector('[data-notification-delete="${ids[1]}"]')?.click()`);
  await wait(400);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-notification]').length`), baseline - 1, 'deleted item disappears');
  assert.ok(!(await evaluate(page, `window.__AETHER_DATA__.getState().notifications.some((n) => n.id === '${ids[1]}')`)));

  console.log('PASS browser: inbox read/unread, archive/restore and delete');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

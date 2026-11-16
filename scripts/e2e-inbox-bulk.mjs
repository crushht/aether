// Inbox bulk selection: select, archive, then delete.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9481, profile: path.join(process.env.TEMP || '.', `aether-bulk-${process.pid}`) });
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
  page = await newPage(9481);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const ids = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const issue = data.getState().createIssue({ title: 'Bulk fixture', status: 'todo' });
    data.getState().pushNotification({ issueId: issue.id, kind: 'mention', count: 1 });
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 1 });
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 1 });
    return data.getState().notifications.filter((n) => n.issueId === issue.id).slice(0, 3).map((n) => n.id);
  })()`);
  assert.equal(ids.length, 3);
  await wait(1200);

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-bulk-toolbar]') === false`), 'bulk toolbar hidden initially');
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '选择' || (b.getAttribute('aria-label') || '') === 'Select')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-bulk-toolbar]')`), 'selection mode must show the toolbar');

  for (const id of ids.slice(0, 2)) {
    await evaluate(page, `document.querySelector('[data-notification="${id}"] button')?.click()`);
  }
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-notification-select][aria-checked="true"]').length`), 2, 'two rows selected');

  await evaluate(page, `document.querySelector('[data-bulk-archive]')?.click()`);
  await wait(500);
  const archived = await evaluate(page, `window.__AETHER_DATA__.getState().notifications.filter((n) => ${JSON.stringify(ids.slice(0, 2))}.includes(n.id)).map((n) => Boolean(n.archivedAt))`);
  assert.deepEqual(archived, [true, true], 'selected rows must be archived');

  // Select all in the archive view and delete them.
  await evaluate(page, `document.querySelector('[data-inbox-tab="archived"]')?.click()`);
  await wait(300);
  await evaluate(page, `[...document.querySelectorAll('[data-bulk-toolbar] button')].find((b) => (b.textContent || '').includes('全选') || (b.textContent || '').includes('Select all'))?.click()`);
  await wait(300);
  await evaluate(page, `window.confirm = () => true`);
  await evaluate(page, `document.querySelector('[data-bulk-delete]')?.click()`);
  await wait(500);
  const remaining = await evaluate(page, `window.__AETHER_DATA__.getState().notifications.filter((n) => ${JSON.stringify(ids)}.includes(n.id)).map((n) => n.id)`);
  assert.deepEqual(remaining, [ids[2]], 'bulk delete must remove only the archived selection');

  console.log('PASS browser: inbox bulk selection archives and deletes notifications');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

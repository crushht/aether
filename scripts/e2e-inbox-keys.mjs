// Inbox keyboard navigation: J/K cursor, Enter opens, A archives.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9472, profile: path.join(process.env.TEMP || '.', `aether-inbox-keys-${process.pid}`) });
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
const press = (key) => evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);

try {
  page = await newPage(9472);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const fixture = await evaluate(page, `(() => {
    const tag = 'KBInbox' + Date.now();
    const data = window.__AETHER_DATA__;
    const issue = data.getState().createIssue({ title: tag, status: 'todo' });
    data.getState().pushNotification({ issueId: issue.id, kind: 'mention', count: 1 });
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 2 });
    const list = data.getState().notifications.filter((n) => n.issueId === issue.id);
    return { issueId: issue.id, ids: list.map((n) => n.id) };
  })()`);
  await wait(1200);

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`document.querySelectorAll('[data-notification]').length >= 2`), 'rows must render');
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-cursor="true"]')`), 'first row must be selected');

  const first = await evaluate(page, `document.querySelector('[data-notification-cursor="true"]').getAttribute('data-notification')`);
  await press('j');
  await wait(300);
  const second = await evaluate(page, `document.querySelector('[data-notification-cursor="true"]').getAttribute('data-notification')`);
  assert.notEqual(second, first, 'J must move the cursor');
  await press('k');
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelector('[data-notification-cursor="true"]').getAttribute('data-notification')`), first, 'K must move back');

  // Enter opens the issue behind the selected mention.
  await press('Enter');
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll')`, 6000), 'Enter must open the selected notification');

  // Back to the inbox: A archives the selected row.
  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-cursor="true"]')`), 'inbox must reload');
  const target = await evaluate(page, `document.querySelector('[data-notification-cursor="true"]').getAttribute('data-notification')`);
  await press('a');
  await wait(500);
  const archived = await evaluate(page, `window.__AETHER_DATA__.getState().notifications.find((n) => n.id === '${target}')?.archivedAt`);
  assert.ok(archived, 'A must archive the selected notification');

  console.log('PASS browser: inbox J/K cursor, Enter opens, A archives');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

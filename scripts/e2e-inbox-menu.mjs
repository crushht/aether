// Notification right-click menu: open, read, archive/restore, delete.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9499, profile: path.join(process.env.TEMP || '.', `aether-inbox-menu-${process.pid}`) });
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
const rightClick = (id) => evaluate(page, `(() => {
  const row = document.querySelector('[data-notification="${id}"]');
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
})()`);

try {
  page = await newPage(9499);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const id = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const issue = data.getState().createIssue({ title: 'Menu fixture', status: 'todo' });
    data.getState().pushNotification({ issueId: issue.id, kind: 'mention', count: 1 });
    return data.getState().notifications.find((n) => n.issueId === issue.id).id;
  })()`);
  await wait(1200);
  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${id}"]')`), 'row must render');

  await rightClick(id);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-menu]')`), 'context menu must open');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-menu-action="open"][data-menu-active="true"]')`), 'first item starts active');
  await evaluate(page, `document.querySelector('[data-notification-menu]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  await wait(150);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-menu-action="read"][data-menu-active="true"]')`), 'ArrowDown moves the highlight');
  // The menu grew three snooze entries; walk to Archive by its own action name
  // so the test never depends on how many items sit in front of it.
  const archiveIndex = await evaluate(
    page,
    `[...document.querySelectorAll('[data-notification-menu] [data-menu-action]')].findIndex((el) => el.getAttribute('data-menu-action') === 'archive')`,
  );
  assert.ok(archiveIndex > 1, `archive must sit after the snooze choices, got index ${archiveIndex}`);
  for (let step = 1; step < archiveIndex; step += 1) {
    await evaluate(page, `document.querySelector('[data-notification-menu]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  }
  await wait(150);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-menu-action="archive"][data-menu-active="true"]')`), 'ArrowDown walks the whole menu');
  await evaluate(page, `document.querySelector('[data-notification-menu]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(400);
  assert.ok(await evaluate(page, `window.__AETHER_DATA__.getState().notifications.find((n) => n.id === '${id}')?.archivedAt`), 'Enter must run the highlighted action');

  await evaluate(page, `document.querySelector('[data-inbox-tab="archived"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${id}"]')`), 'archived row must render');
  await rightClick(id);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-menu]')`), 'menu must open on archived');
  await evaluate(page, `document.querySelector('[data-notification-menu]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(200);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-notification-menu]')`), false, 'Escape closes the menu');
  await rightClick(id);
  await evaluate(page, `document.querySelector('[data-menu-action="delete"]')?.click()`);
  await wait(400);
  assert.equal(await evaluate(page, `window.__AETHER_DATA__.getState().notifications.some((n) => n.id === '${id}')`), false, 'delete must remove it');

  console.log('PASS browser: notification context menu works by mouse and keyboard');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

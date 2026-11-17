// Snoozing: an item leaves the list and the badge together, comes back on the
// Snoozed tab, and can be woken up without waiting.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9537, profile: path.join(process.env.TEMP || '.', `aether-snooze-${process.pid}`) });
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
const badge = () =>
  evaluate(page, `(() => {
    const el = document.querySelector('[data-inbox-badge]');
    return el ? Number(el.innerText.trim()) : 0;
  })()`);
const menuItems = () =>
  evaluate(page, `[...document.querySelectorAll('[data-notification-menu] [data-menu-action]')].map((el) => el.getAttribute('data-menu-action'))`);
const openMenu = (id) =>
  evaluate(page, `(() => {
    const row = document.querySelector('[data-notification="${id}"]');
    const box = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 20, clientY: box.top + 10 }));
  })()`);

try {
  page = await newPage(9537);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/inbox`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'the stores must be exposed in dev');
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().issues.length > 1`), 'the workspace must have issues');

  // Two unread notifications of our own, so the badge arithmetic is knowable.
  const ids = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const issues = data.issues.slice(0, 2);
    const before = data.notifications.map((row) => row.id);
    data.pushNotification({ issueId: issues[0].id, kind: 'agent', count: 3 });
    data.pushNotification({ issueId: issues[1].id, kind: 'mention' });
    return window.__AETHER_DATA__.getState().notifications.filter((row) => !before.includes(row.id)).map((row) => row.id);
  })()`);
  assert.equal(ids.length, 2, 'two notifications were pushed');
  const [first, second] = ids;
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${first}"]')`), 'the first row renders');
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${second}"]')`), 'the second row renders');

  const badgeBefore = await badge();
  assert.ok(badgeBefore >= 2, `the badge counts the new items, got ${badgeBefore}`);

  // --- the menu offers all three naps -------------------------------------
  await openMenu(first);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-menu]')`), 'the menu opens');
  const items = await menuItems();
  assert.deepEqual(items, ['open', 'read', 'snooze-hour', 'snooze-tomorrow', 'snooze-week', 'archive', 'delete']);

  // --- snooze for an hour -------------------------------------------------
  await evaluate(page, `document.querySelector('[data-menu-action="snooze-hour"]').click()`);
  assert.ok(await waitFor(`!document.querySelector('[data-notification="${first}"]')`), 'a snoozed row leaves the list');
  assert.equal(await badge(), badgeBefore - 1, 'and the badge drops with it');
  const stored = await evaluate(page, `(() => {
    const row = window.__AETHER_DATA__.getState().notifications.find((item) => item.id === ${JSON.stringify(first)});
    return { until: row?.snoozedUntil ?? null, delta: row?.snoozedUntil ? +new Date(row.snoozedUntil) - Date.now() : null };
  })()`);
  assert.ok(stored.until, 'the nap is a stored moment');
  assert.ok(stored.delta > 3_500_000 && stored.delta < 3_700_000, `one hour from now, got ${stored.delta} ms`);

  // --- it is still reachable ---------------------------------------------
  const snoozedTabCount = await evaluate(page, `Number(document.querySelector('[data-inbox-tab="snoozed"] span').innerText)`);
  assert.equal(snoozedTabCount, 1, 'the Snoozed tab counts it');
  await evaluate(page, `document.querySelector('[data-inbox-tab="snoozed"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${first}"]')`), 'the snoozed view still shows it');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-notification="${second}"]')`), false);

  // --- and can be woken up -----------------------------------------------
  await openMenu(first);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-menu]')`), 'the menu opens on the snoozed row');
  const wakeItems = await menuItems();
  assert.ok(wakeItems.includes('wake'), `a napping item offers a wake, got ${wakeItems.join(',')}`);
  assert.equal(wakeItems.includes('snooze-hour'), false, 'it does not offer to nap again while napping');
  await evaluate(page, `document.querySelector('[data-menu-action="wake"]').click()`);
  assert.ok(await waitFor(`!document.querySelector('[data-notification="${first}"]')`), 'the snoozed view empties');
  await evaluate(page, `document.querySelector('[data-inbox-tab="all"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${first}"]')`), 'the woken item is back in the list');
  assert.equal(await badge(), badgeBefore, 'and the badge is whole again');

  // A nap that ran out needs no action: it is simply there.
  await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    data.snoozeNotification(${JSON.stringify(second)}, Date.now() - 60_000);
  })()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${second}"]')`), 'an expired nap is visible without waking it');

  await shot(page, 'docs/checks/272-inbox-snooze.png', { width: 1440, height: 1000 });
  console.log('PASS browser: snoozing hides a notice from the list and the badge, and it comes back on its own');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

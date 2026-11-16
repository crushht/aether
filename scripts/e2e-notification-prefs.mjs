// Notification preferences: toggles gate inbox writes and persist.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9475, profile: path.join(process.env.TEMP || '.', `aether-notify-prefs-${process.pid}`) });
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
  page = await newPage(9475);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/notifications`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification-prefs]')`), 'preferences panel must render');

  const state = await evaluate(page, `({
    mentionInbox: document.querySelector('[data-notify-pref="inbox:mention"]')?.getAttribute('aria-checked'),
    mentionDesktop: document.querySelector('[data-notify-pref="desktop:mention"]')?.getAttribute('aria-checked'),
    agentDesktop: document.querySelector('[data-notify-pref="desktop:agent"]')?.getAttribute('aria-checked'),
    cycleInbox: document.querySelector('[data-notify-pref="inbox:cycle"]')?.getAttribute('aria-checked'),
  })`);
  assert.equal(state.mentionInbox, 'true');
  assert.equal(state.mentionDesktop, 'true');
  assert.equal(state.agentDesktop, 'false', 'desktop defaults to mentions only');
  assert.equal(state.cycleInbox, 'true');

  // Turning cycle inbox off must stop new cycle notifications.
  await evaluate(page, `document.querySelector('[data-notify-pref="inbox:cycle"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `window.__AETHER_NOTIFICATION_PREFS__.getState().inbox.cycle`), false);
  const before = await evaluate(page, `window.__AETHER_DATA__.getState().notifications.length`);
  await evaluate(page, `window.__AETHER_DATA__.getState().pushNotification({ issueId: '', kind: 'cycle', count: 1 })`);
  await wait(300);
  assert.equal(await evaluate(page, `window.__AETHER_DATA__.getState().notifications.length`), before, 'disabled kind must not enter the inbox');

  await evaluate(page, `document.querySelector('[data-notify-pref="inbox:cycle"]')?.click()`);
  await wait(300);
  await evaluate(page, `window.__AETHER_DATA__.getState().pushNotification({ issueId: '', kind: 'cycle', count: 1 })`);
  await wait(300);
  assert.equal(await evaluate(page, `window.__AETHER_DATA__.getState().notifications.length`), before + 1, 'enabled kind must enter the inbox');

  // Persist the desktop toggle across a reload.
  await evaluate(page, `document.querySelector('[data-notify-pref="desktop:agent"]')?.click()`);
  await wait(300);
  await goto(page, `${base}/settings/notifications`, 2500);
  assert.ok(await waitFor(`!!document.querySelector('[data-notify-pref="desktop:agent"]')`), 'panel must reload');
  assert.equal(await evaluate(page, `document.querySelector('[data-notify-pref="desktop:agent"]').getAttribute('aria-checked')`), 'true', 'desktop preference must persist');

  console.log('PASS browser: notification preferences gate the inbox and persist');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

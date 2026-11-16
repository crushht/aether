// Digest click: jump to today's unread activity and put the cursor on it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9479, profile: path.join(process.env.TEMP || '.', `aether-digest-focus-${process.pid}`) });
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
  page = await newPage(9479);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const fixture = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    for (const notification of data.getState().notifications.filter((n) => n.kind === 'digest')) {
      data.getState().deleteNotification(notification.id);
    }
    const issue = data.getState().createIssue({ title: 'Digest focus issue', status: 'todo' });
    data.getState().pushNotification({ issueId: issue.id, kind: 'mention', count: 1 });
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 1 });
    data.getState().ensureDailyDigest();
    const digest = data.getState().notifications.find((n) => n.kind === 'digest');
    return { digestId: digest.id, issueId: issue.id };
  })()`);
  await wait(1200);

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${fixture.digestId}"]')`), 'digest must render');
  await evaluate(page, `document.querySelector('[data-notification="${fixture.digestId}"] button')?.click()`);
  await wait(600);

  const state = await evaluate(page, `(() => {
    const cursor = document.querySelector('[data-notification-cursor="true"]');
    return {
      cursor: cursor?.getAttribute('data-notification') ?? null,
      digestStillListed: !!document.querySelector('[data-notification="${fixture.digestId}"]'),
      rows: document.querySelectorAll('[data-notification]').length,
    };
  })()`);
  assert.ok(state.cursor, 'a row must be selected');
  assert.notEqual(state.cursor, fixture.digestId, 'the cursor must leave the digest');
  assert.equal(state.digestStillListed, false, 'the unread view hides the now-read digest');
  assert.ok(state.rows >= 1, 'today\'s unread activity must be listed');

  console.log('PASS browser: clicking a digest opens the unread view and selects today\'s activity');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

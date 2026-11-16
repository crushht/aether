// Inbox rows are grouped by local day.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9505, profile: path.join(process.env.TEMP || '.', `aether-inbox-days-${process.pid}`) });
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
  page = await newPage(9505);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const issue = data.getState().createIssue({ title: 'Day groups fixture', status: 'todo' });
    const day = 86400000;
    const at = (offset) => new Date(Date.now() - offset).toISOString();
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 1 });
    const notifications = data.getState().notifications;
    notifications[0].createdAt = at(0);
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 1 });
    const after = data.getState().notifications;
    after[0].createdAt = at(day);
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 1 });
    const later = data.getState().notifications;
    later[0].createdAt = at(day * 5);
  })()`);
  await wait(1200);
  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-inbox-day]')`), 'day header must render');
  const days = await evaluate(page, `[...document.querySelectorAll('[data-inbox-day]')].map((el) => el.getAttribute('data-inbox-day'))`);
  assert.ok(days.includes('today') && days.includes('yesterday') && days.includes('earlier'), `missing day buckets: ${days}`);
  assert.equal(
    await evaluate(page, `getComputedStyle(document.querySelector('[data-inbox-day]')).position`),
    'sticky',
    'day headers must stick while scrolling',
  );

  console.log('PASS browser: inbox groups rows into today/yesterday/earlier');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

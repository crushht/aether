// aether:// deep links open the issue they point at.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9525, profile: path.join(process.env.TEMP || '.', `aether-deeplink-${process.pid}`) });
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

try {
  page = await newPage(9525);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const issue = await evaluate(page, `(() => {
    const created = window.__AETHER_DATA__.getState().createIssue({ title: 'Deep link target', status: 'todo' });
    window.__AETHER_VIEW__.getState().closeIssue();
    return { id: created.id, title: created.title };
  })()`);
  await wait(600);
  assert.equal(await evaluate(page, `!!document.querySelector('[role="dialog"][aria-modal="true"]')`), false, 'no drawer yet');

  await evaluate(page, `window.dispatchEvent(new CustomEvent('aether:deeplink', { detail: { issueId: ${JSON.stringify(issue.id)} } }))`);
  assert.ok(await waitFor(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`), 'deep link must open the drawer');
  const label = await evaluate(page, `document.querySelector('[role="dialog"][aria-modal="true"]').getAttribute('aria-label')`);
  assert.equal(label, issue.title, 'the drawer shows the linked issue');

  // a payload without an id is a no-op rather than an error
  await evaluate(page, `window.__AETHER_VIEW__.getState().closeIssue()`);
  await wait(300);
  await evaluate(page, `window.dispatchEvent(new CustomEvent('aether:deeplink', { detail: {} }))`);
  await wait(300);
  assert.equal(await evaluate(page, `!!document.querySelector('[role="dialog"][aria-modal="true"]')`), false, 'empty payload does nothing');

  console.log('PASS browser: aether:// deep links open the linked issue');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

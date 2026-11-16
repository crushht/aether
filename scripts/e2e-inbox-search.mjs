// Inbox search and bulk archive clearing.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9471, profile: path.join(process.env.TEMP || '.', `aether-inbox-search-${process.pid}`) });
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
  page = await newPage(9471);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const fixture = await evaluate(page, `(() => {
    const tag = 'Searchable' + Date.now();
    const data = window.__AETHER_DATA__;
    const issue = data.getState().createIssue({ title: tag + ' issue', status: 'todo' });
    data.getState().pushNotification({ issueId: issue.id, kind: 'mention', count: 1 });
    const project = data.getState().createProject({ name: tag + ' project' });
    data.getState().addProjectUpdate(project.id, 'progress', 'on_track');
    const list = data.getState().notifications;
    return {
      tag,
      mention: list.find((n) => n.kind === 'mention' && n.issueId === issue.id)?.id,
      update: list.find((n) => n.kind === 'project_update' && n.projectId === project.id)?.id,
      issueId: issue.id,
      projectId: project.id,
    };
  })()`);
  assert.ok(fixture.mention && fixture.update, 'both notifications must exist');
  await wait(1200);

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-inbox-search]')`), 'search box must render');

  const type = (text) => evaluate(page, `(() => {
    const el = document.querySelector('[data-inbox-search]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await type(fixture.tag + ' project');
  await wait(400);
  let rows = await evaluate(page, `[...document.querySelectorAll('[data-notification]')].map((el) => el.getAttribute('data-notification'))`);
  assert.deepEqual(rows, [fixture.update], 'project search must narrow to the project update');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-notification="${fixture.update}"] mark')`), 'the project name must be highlighted');

  await type(fixture.tag + ' issue');
  await wait(400);
  rows = await evaluate(page, `[...document.querySelectorAll('[data-notification]')].map((el) => el.getAttribute('data-notification'))`);
  assert.deepEqual(rows, [fixture.mention], 'issue search must narrow to the mention');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-notification="${fixture.mention}"] mark')`), 'the issue title must be highlighted');

  await type('');
  await wait(300);

  // Archive the mention and clear the archive in bulk.
  await evaluate(page, `document.querySelector('[data-notification-archive="${fixture.mention}"]')?.click()`);
  await wait(400);
  await evaluate(page, `document.querySelector('[data-inbox-tab="archived"]')?.click()`);
  await wait(300);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-clear-archived]')`), 'clear-archived must appear');
  await evaluate(page, `window.confirm = () => true`);
  await evaluate(page, `document.querySelector('[data-clear-archived]')?.click()`);
  await wait(500);
  assert.equal(await evaluate(page, `window.__AETHER_DATA__.getState().notifications.some((n) => n.id === '${fixture.mention}')`), false, 'archived notification must be deleted');
  assert.ok(await evaluate(page, `window.__AETHER_DATA__.getState().notifications.some((n) => n.id === '${fixture.update}')`), 'active notification must survive');

  console.log('PASS browser: inbox search narrows by project/issue and clears archived notifications');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

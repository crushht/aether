// Acceptance for issue efficiency: grouping, due-date filter, comment drafts/editing.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9449, profile: path.join(process.env.TEMP || '.', `aether-issues-${process.pid}`) });
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
const clickText = async (text) => evaluate(page, `(() => {
  const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(text)} || (b.textContent || '').includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`);

try {
  page = await newPage(9449);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  // Fixtures: one overdue issue and one without a due date, both in Todo.
  const fixtures = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const overdue = data.createIssue({ title: 'Overdue fixture', status: 'todo' });
    data.patchIssue(overdue.id, { dueDate: new Date(Date.now() - 86400000).toISOString() });
    const latter = data.createIssue({ title: 'No-date fixture', status: 'todo' });
    data.addComment(overdue.id, 'local', 'Original comment text');
    return { overdue: overdue.id, latter: latter.id };
  })()`);
  await wait(1200);

  // Grouping: assignee mode shows an unassigned bucket.
  await evaluate(page, `window.__AETHER_VIEW__.getState().setGroupBy('assignee')`);
  await wait(500);
  assert.ok(await evaluate(page, `document.body.innerText.includes('No assignee') || document.body.innerText.includes('无负责人')`), 'assignee grouping must show an unassigned bucket');
  await evaluate(page, `window.__AETHER_VIEW__.getState().setGroupBy('status')`);
  await wait(400);
  assert.ok(await evaluate(page, `document.body.innerText.includes('Todo') || document.body.innerText.includes('待办')`), 'status grouping must come back');

  // Due-date filter: Overdue keeps the overdue fixture and hides the no-date one.
  await evaluate(page, `window.__AETHER_VIEW__.getState().setFilter('due', 'overdue')`);
  await wait(500);
  assert.equal(await evaluate(page, `window.__AETHER_VIEW__.getState().filters.due`), 'overdue');
  const filtered = await evaluate(page, `document.body.innerText`);
  assert.ok(filtered.includes('Overdue fixture'), 'overdue issue must remain visible');
  assert.ok(!filtered.includes('No-date fixture'), 'no-date issue must be filtered out');
  await evaluate(page, `window.__AETHER_VIEW__.getState().setFilter('due', 'any')`);
  await wait(400);

  // Open the overdue issue from its row.
  await evaluate(page, `document.querySelector('[data-issue-row="${fixtures.overdue}"]')?.click()`);
  await assertOk(await waitFor(`!!document.querySelector('#issue-scroll')`), 'issue drawer must open');

  // Comment draft persists across close/reopen.
  await evaluate(page, `(() => {
    const area = [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('评论') || (t.placeholder || '').includes('comment'));
    if (!area) throw new Error('comment box missing');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(area, 'Draft that must survive');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(500);
  await evaluate(page, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(400);
  await evaluate(page, `document.querySelector('[data-issue-row="${fixtures.overdue}"]')?.click()`);
  await wait(500);
  const draftValue = await evaluate(page, `[...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('评论') || (t.placeholder || '').includes('comment'))?.value`);
  assert.equal(draftValue, 'Draft that must survive', 'comment draft must survive close/reopen');

  // Submit it, then edit the comment inline.
  await evaluate(page, `(() => {
    const area = [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('评论') || (t.placeholder || '').includes('comment'));
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(area, 'Posted comment');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  })()`);
  await wait(700);
  assert.ok(await evaluate(page, `document.body.innerText.includes('Posted comment')`), 'comment must be posted');
  const editClicked = await evaluate(page, `(() => { const btn = [...document.querySelectorAll('[data-comment-edit]')].at(-1); btn?.click(); return !!btn; })()`);
  assert.ok(editClicked, 'own comment must be editable');
  await wait(300);
  await evaluate(page, `(() => {
    const editor = document.querySelector('[data-comment-editor]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(editor, 'Edited comment text');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickText('保存');
  await wait(500);
  assert.ok(await evaluate(page, `document.body.innerText.includes('Edited comment text')`), 'edited text must render');
  assert.ok(!(await evaluate(page, `document.body.innerText.includes('Posted comment')`)), 'old text must be gone');

  console.log('PASS browser: assignee grouping, overdue filter, comment draft persistence and inline edit');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

async function assertOk(value, message) {
  if (!value) throw new Error(message);
}

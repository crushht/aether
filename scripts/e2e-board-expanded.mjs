// Board "show more" per column survives a reload.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9493, profile: path.join(process.env.TEMP || '.', `aether-boardexp-${process.pid}`) });
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
  page = await newPage(9493);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_VIEW__`), 'app must boot');
  await evaluate(page, `(() => {
    window.__AETHER_VIEW__.getState().setViewMode('board');
    window.__AETHER_VIEW__.setState({ filters: { status: [], priority: [], assigneeId: [], labelIds: [], due: 'any', query: '' }, tab: 'all' });
  })()`);

  // The column has to overflow the first page, and how many cards the fixture
  // data happens to hold is not something this test should depend on.
  await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const have = data.issues.filter((issue) => issue.status === 'todo').length;
    for (let index = have; index < 62; index += 1) {
      data.createIssue({ title: 'Overflow ' + index, status: 'todo' });
    }
  })()`);

  assert.ok(await waitFor(`!!document.querySelector('[data-board-more="todo"]')`, 15000), 'todo column must overflow the first page');
  const before = await evaluate(page, `document.querySelectorAll('[data-board-card]').length`);
  await evaluate(page, `document.querySelector('[data-board-more="todo"]')?.click()`);
  assert.ok(await waitFor(`document.querySelectorAll('[data-board-card]').length > ${before}`, 8000), 'expanding must add cards');
  const expandedCount = await evaluate(page, `document.querySelectorAll('[data-board-card]').length`);
  assert.ok(expandedCount > before);

  await goto(page, `${base}/team/ENG`, 4000);
  await evaluate(page, `window.__AETHER_VIEW__.getState().setViewMode('board')`);
  assert.ok(await waitFor(`document.querySelectorAll('[data-board-card]').length > 0`, 10000), 'board must render after reload');
  assert.equal(
    await evaluate(page, `!!document.querySelector('[data-board-more="todo"]')`),
    false,
    'the expanded column must stay expanded after a reload',
  );

  console.log('PASS browser: board column expansion persists across reloads');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Command palette context actions: selected issues can be acted on directly.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9457, profile: path.join(process.env.TEMP || '.', `aether-command-${process.pid}`) });
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
  page = await newPage(9457);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && !!window.__AETHER_VIEW__`), 'app must boot');

  const ids = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const a = data.createIssue({ title: 'Command fixture A', status: 'todo' });
    const b = data.createIssue({ title: 'Command fixture B', status: 'todo' });
    window.__AETHER_VIEW__.getState().selectMany([a.id, b.id]);
    return [a.id, b.id];
  })()`);
  await wait(300);
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`document.body.innerText.includes('已选议题') || document.body.innerText.includes('Selection')`), 'selection section must appear');
  assert.ok(await evaluate(page, `document.body.innerText.includes('标记为已完成') || document.body.innerText.includes('Mark 2 selected as Done')`), 'done action must be listed');

  await evaluate(page, `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('标记为已完成') || (b.textContent || '').includes('Mark 2 selected as Done'));
    btn?.click();
  })()`);
  await wait(700);
  const statuses = await evaluate(page, `window.__AETHER_DATA__.getState().issues.filter((i) => ${JSON.stringify(ids)}.includes(i.id)).map((i) => i.status)`);
  assert.deepEqual(statuses, ['done', 'done'], `selected issues must be marked done, got ${JSON.stringify(statuses)}`);
  assert.equal(await evaluate(page, `window.__AETHER_VIEW__.getState().selectedIds.length`), 0, 'selection clears after the action');

  console.log('PASS browser: command palette lists and applies selection actions');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

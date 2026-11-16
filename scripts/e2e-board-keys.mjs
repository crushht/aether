// Board keyboard movement: columns with Ctrl+←/→, order with Ctrl+↑/↓.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9461, profile: path.join(process.env.TEMP || '.', `aether-boardkeys-${process.pid}`) });
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
  page = await newPage(9461);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && !!window.__AETHER_VIEW__`), 'app must boot');

  const tag = `KB${Date.now()}`;
  const ids = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const a = data.createIssue({ title: '${tag} A', status: 'todo' });
    const b = data.createIssue({ title: '${tag} B', status: 'todo' });
    window.__AETHER_VIEW__.getState().setViewMode('board');
    window.__AETHER_VIEW__.setState({ filters: { status: [], priority: [], assigneeId: [], labelIds: [], due: 'any', query: '${tag}' }, tab: 'all' });
    return [a.id, b.id];
  })()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-board-card="${ids[0]}"]')`), 'board card must render');

  await evaluate(page, `document.querySelector('[data-board-card="${ids[0]}"]').focus()`);
  await evaluate(page, `document.querySelector('[data-board-card="${ids[0]}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }))`);
  await wait(600);
  assert.equal(await evaluate(page, `window.__AETHER_DATA__.getState().issues.find((i) => i.id === '${ids[0]}').status`), 'in_progress', 'Ctrl+Right must move the card one column');
  assert.ok(await waitFor(`!!document.querySelector('[data-board-card="${ids[0]}"]')`), 'moved card must re-render');

  await evaluate(page, `document.querySelector('[data-board-card="${ids[0]}"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true }))`);
  await wait(600);
  assert.equal(await evaluate(page, `window.__AETHER_DATA__.getState().issues.find((i) => i.id === '${ids[0]}').status`), 'todo', 'Ctrl+Left must move it back');

  // Reorder within the column.
  const cardBack = await waitFor(`!!document.querySelector('[data-board-card="${ids[0]}"]')`, 5000);
  if (!cardBack) {
    console.log('DEBUG', await evaluate(page, `({
      mode: window.__AETHER_VIEW__.getState().viewMode,
      cards: [...document.querySelectorAll('[data-card-id]')].map((el) => el.getAttribute('data-card-id')),
      statuses: window.__AETHER_DATA__.getState().issues.filter((i) => ['${ids[0]}', '${ids[1]}'].includes(i.id)).map((i) => [i.id, i.status]),
      text: document.body.innerText.slice(0, 300),
    })`));
  }
  assert.ok(cardBack, 'card must be back in its column');
  const before = await evaluate(page, `(() => {
    const issues = window.__AETHER_DATA__.getState().issues;
    return [issues.findIndex((i) => i.id === '${ids[0]}'), issues.findIndex((i) => i.id === '${ids[1]}')];
  })()`);
  await evaluate(page, `document.querySelector('[data-board-card="${ids[1]}"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true }))`);
  await wait(600);
  const after = await evaluate(page, `(() => {
    const issues = window.__AETHER_DATA__.getState().issues;
    return [issues.findIndex((i) => i.id === '${ids[0]}'), issues.findIndex((i) => i.id === '${ids[1]}')];
  })()`);
  assert.ok(after[1] > after[0], `Ctrl+Down must move the second card below the first (${before} -> ${after})`);

  // Enter opens the focused card.
  await evaluate(page, `document.querySelector('[data-board-card="${ids[0]}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(400);
  assert.ok(await evaluate(page, `!!document.querySelector('#issue-scroll')`), 'Enter must open the card');

  console.log('PASS browser: board cards move columns, reorder, and open from the keyboard');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

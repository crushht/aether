// WIP limits: a column header that can be a limit, turned red when the column is
// past it, remembered across reloads, and cleared without a menu.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9538, profile: path.join(process.env.TEMP || '.', `aether-wip-${process.pid}`) });
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
    const el = document.querySelector('[data-wip="todo"]');
    return el ? { text: el.innerText.trim(), over: el.getAttribute('data-wip-over'), color: getComputedStyle(el).color } : null;
  })()`);
const typeLimit = async (value) => {
  await evaluate(page, `document.querySelector('[data-wip="todo"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-wip-input="todo"]')`), 'the limit input opens');
  await evaluate(page, `(() => {
    const input = document.querySelector('[data-wip-input="todo"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await wait(300);
};

try {
  page = await newPage(9538);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && !!window.__AETHER_VIEW__`), 'the stores must be exposed in dev');
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().issues.length > 0`), 'the workspace must have issues');

  const todoCount = await evaluate(page, `window.__AETHER_DATA__.getState().issues.filter((issue) => issue.status === 'todo').length`);
  assert.ok(todoCount > 0, 'the board needs a todo column with cards');

  await evaluate(page, `window.__AETHER_VIEW__.getState().setViewMode('board')`);
  assert.ok(await waitFor(`!!document.querySelector('[data-wip="todo"]')`), 'the column header shows a counter');

  // --- no limit yet -------------------------------------------------------
  const plain = await badge();
  assert.equal(plain.text, String(todoCount), 'without a limit the header is just the count');
  assert.equal(plain.over, '0');

  // --- a limit the column is past ----------------------------------------
  await typeLimit('1');
  const tight = await badge();
  assert.equal(tight.text, `${todoCount} / 1`, 'the header reads count / limit');
  if (todoCount > 1) {
    assert.equal(tight.over, '1', 'a column past its limit is flagged');
    assert.ok(/rgb\(2\d\d, |#/.test(tight.color) || tight.color !== plain.color, `the overflow colour changes, got ${tight.color}`);
  }

  // --- a limit with room left --------------------------------------------
  await typeLimit(String(todoCount + 5));
  const roomy = await badge();
  assert.equal(roomy.text, `${todoCount} / ${todoCount + 5}`);
  assert.equal(roomy.over, '0', 'room left is not a problem');
  assert.equal(roomy.color, plain.color, 'and it keeps the quiet colour');

  // --- it survives a reload ----------------------------------------------
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-wip="todo"]')`), 'the board comes back');
  assert.equal((await badge()).text, `${todoCount} / ${todoCount + 5}`, 'the limit is remembered');
  const stored = await evaluate(page, `(() => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) || '';
      if (!key.startsWith('linear-lab:view:')) continue;
      const raw = window.localStorage.getItem(key) || '';
      if (raw.includes('"wipLimits"') && raw.includes('"todo"')) return raw;
    }
    return null;
  })()`);
  assert.ok(stored, 'the limit lives in the view preference');

  // --- and can be cleared -------------------------------------------------
  await typeLimit('');
  const cleared = await badge();
  assert.equal(cleared.text, String(todoCount), 'an empty value clears the limit');
  assert.equal(cleared.over, '0');

  // A card moved into the column moves the number with it.
  await typeLimit(String(todoCount));
  await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const other = data.issues.find((issue) => issue.status !== 'todo');
    if (other) data.setStatus(other.id, 'todo', 'agent');
  })()`);
  assert.ok(
    await waitFor(`document.querySelector('[data-wip="todo"]').innerText.trim() === ${JSON.stringify(`${todoCount + 1} / ${todoCount}`)}`),
    'adding a card past the limit shows up without a reload',
  );
  assert.equal((await badge()).over, '1', 'and the column is red again');

  await wait(300);
  await shot(page, 'docs/checks/273-board-wip.png', { width: 1440, height: 1000 });
  console.log('PASS browser: a WIP limit is set inline, turns red when exceeded, survives a reload and clears');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

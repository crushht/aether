// Mobile controls and command palette semantics.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9463, profile: path.join(process.env.TEMP || '.', `aether-a11y-${process.pid}`) });
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
  page = await newPage(9463);
  await viewport(page, 390, 844);
  await goto(page, `${base}/team/ENG`, 5500);
  assert.ok(await waitFor(`!!window.__AETHER_VIEW__`), 'app must boot');

  const visible = await evaluate(page, `(() => {
    const check = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    return { sort: check('[data-sort-menu]'), display: check('[data-display-menu]') };
  })()`);
  assert.ok(visible.sort, 'sort menu must be reachable on a phone');
  assert.ok(visible.display, 'display menu must be reachable on a phone');

  await evaluate(page, `document.querySelector('[data-display-menu]')?.click()`);
  await wait(300);
  assert.ok(await evaluate(page, `document.body.innerText.includes('分组') || document.body.innerText.includes('Group by')`), 'display menu must open on mobile');
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '负责人' || b.textContent.trim() === 'Assignee')?.click()`);
  await wait(400);
  assert.equal(await evaluate(page, `window.__AETHER_VIEW__.getState().groupBy`), 'assignee', 'grouping must be changeable on mobile');

  // Command palette semantics at desktop width.
  await viewport(page, 1440, 960);
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`!!document.querySelector('[role="dialog"] [role="combobox"]')`), 'palette must expose combobox');
  const semantics = await evaluate(page, `(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const input = dialog?.querySelector('[role="combobox"]');
    const list = document.getElementById('command-results');
    const options = list ? list.querySelectorAll('[role="option"]') : [];
    return {
      dialog: !!dialog,
      list: !!list,
      options: options.length,
      selected: [...options].some((option) => option.getAttribute('aria-selected') === 'true'),
      active: input?.getAttribute('aria-activedescendant') ?? null,
    };
  })()`);
  assert.ok(semantics.dialog && semantics.list, 'dialog and listbox must exist');
  assert.ok(semantics.options > 0, 'options must render');
  assert.ok(semantics.selected, 'one option must be selected');
  assert.ok(semantics.active && semantics.active.startsWith('command-option-'), 'combobox must point at the active option');

  console.log('PASS browser: mobile sort/display controls and accessible command palette');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

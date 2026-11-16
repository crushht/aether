// Command palette: "New project" opens the project composer.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9502, profile: path.join(process.env.TEMP || '.', `aether-cmd-project-${process.pid}`) });
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
  page = await newPage(9502);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_VIEW__`), 'app must boot');

  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`!!document.querySelector('#command-results')`), 'palette must open');
  await evaluate(page, `(() => {
    const input = document.querySelector('[role="combobox"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, '新建项目');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.ok(
    await waitFor(`[...document.querySelectorAll('#command-results [role="option"]')].some((el) => (el.textContent || '').includes('新建项目') || (el.textContent || '').includes('New project'))`),
    'the action must appear',
  );
  await evaluate(page, `[...document.querySelectorAll('#command-results [role="option"]')].find((el) => (el.textContent || '').includes('新建项目') || (el.textContent || '').includes('New project'))?.click()`);
  assert.ok(await waitFor(`location.pathname === '/projects'`), 'must navigate to projects');
  assert.ok(await waitFor(`!!document.querySelector('input[placeholder="项目名称"], input[placeholder="Project name"]')`), 'composer must open');

  console.log('PASS browser: command palette opens the new-project composer');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

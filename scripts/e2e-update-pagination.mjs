// Update pagination: 20 per page, load more, filters reset the page.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9484, profile: path.join(process.env.TEMP || '.', `aether-pagination-${process.pid}`) });
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
  page = await newPage(9484);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Pagination project' });
    for (let i = 0; i < 25; i += 1) {
      data.getState().addProjectUpdate(project.id, \`Update number \${i + 1}\`, 'on_track');
    }
    return project.id;
  })()`);
  await wait(1200);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`document.querySelectorAll('[data-project-update]').length === 20`), 'first page shows 20 updates');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-load-more]')`), 'load more must render');
  assert.ok((await evaluate(page, `document.querySelector('[data-load-more]').parentElement.innerText`)).includes('20 / 25'), 'page must report 20 of 25');

  await evaluate(page, `document.querySelector('[data-load-more]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 25, 'load more must reveal the rest');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-load-more]')`), false, 'button disappears at the end');

  // Filtering resets the page and can drop below the page size.
  await evaluate(page, `(() => {
    const el = document.querySelector('[data-update-search]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, 'number 2');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(400);
  const filtered = await evaluate(page, `document.querySelectorAll('[data-project-update]').length`);
  assert.ok(filtered > 0 && filtered < 20, `search must reset and narrow the page: ${filtered}`);

  await evaluate(page, `document.querySelector('[data-clear-update-search]')?.click()`);
  await wait(400);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 20, 'clearing must return to page one');

  console.log('PASS browser: update pagination loads more and resets on filtering');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

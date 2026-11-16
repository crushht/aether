// Project update search: narrow by body text, clear, and empty state.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9483, profile: path.join(process.env.TEMP || '.', `aether-upd-search-${process.pid}`) });
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

const typeSearch = (text) => evaluate(page, `(() => {
  const el = document.querySelector('[data-update-search]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

try {
  page = await newPage(9483);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Search updates project' });
    data.getState().addProjectUpdate(project.id, 'Alpha rollout is complete', 'on_track');
    data.getState().addProjectUpdate(project.id, 'Beta fix is in review', 'at_risk');
    return project.id;
  })()`);
  await wait(800);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`document.querySelectorAll('[data-project-update]').length === 2`), 'both updates must render');

  await typeSearch('alpha');
  await wait(400);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 1, 'search must narrow to one update');
  assert.ok((await evaluate(page, `document.querySelector('[data-project-update]').innerText`)).includes('Alpha'));
  assert.ok(await evaluate(page, `!!document.querySelector('[data-update-match] mark')`), 'the match must be highlighted');

  await evaluate(page, `document.querySelector('[data-clear-update-search]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 2, 'clearing must restore both');

  await typeSearch('zzz-no-match');
  await wait(400);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 0, 'no rows for a miss');
  assert.ok((await evaluate(page, `document.body.innerText`)).includes('没有匹配的更新') || (await evaluate(page, `document.body.innerText`)).includes('No matching updates'));

  console.log('PASS browser: project update search narrows, clears and reports a miss');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Global search page: issues and projects, click-through and empty state.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9506, profile: path.join(process.env.TEMP || '.', `aether-search-page-${process.pid}`) });
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
const type = (text) => evaluate(page, `(() => {
  const el = document.querySelector('[data-global-search]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

try {
  page = await newPage(9506);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const tag = `needle${Date.now()}`;
  const issueId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const issue = data.createIssue({ title: 'Search ${tag}', status: 'todo' });
    data.createProject({ name: 'Project ${tag}' });
    window.__AETHER_DOCUMENTS__.getState().create({ title: 'Doc ${tag}', content: 'document body mentions ${tag} in the middle' });
    return issue.id;
  })()`);
  await wait(700);

  await goto(page, `${base}/search`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-global-search]')`), 'search page must render');
  assert.ok(await waitFor(`document.querySelectorAll('[data-search-shortcut]').length === 4`), 'empty state must offer shortcuts');
  await evaluate(page, `document.querySelector('[data-search-shortcut="projects"]')?.click()`);
  assert.ok(await waitFor(`location.pathname === '/projects'`), 'shortcut must navigate');
  await goto(page, `${base}/search`, 2500);
  assert.ok(await waitFor(`!!document.querySelector('[data-global-search]')`), 'search must reload');
  await type(tag);
  assert.ok(await waitFor(`!!document.querySelector('[data-search-result="issue"]')`), 'issue hits must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-search-result="project"]')`), 'project hits must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-search-result] mark')`), 'hits must be highlighted');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-search-result="document"]')`), 'document hits must render');
  assert.ok(
    (await evaluate(page, `document.querySelector('[data-search-result="document"]').innerText`)).includes('mentions'),
    'document hits must show a content snippet',
  );

  // Keyboard: first hit is active, ArrowDown moves to the project, Enter opens it.
  assert.equal(await evaluate(page, `document.querySelector('[data-search-active="true"]')?.getAttribute('data-search-index')`), '0');
  await evaluate(page, `document.querySelector('[data-global-search]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  await wait(150);
  assert.equal(await evaluate(page, `document.querySelector('[data-search-active="true"]')?.getAttribute('data-search-index')`), '1');
  await evaluate(page, `document.querySelector('[data-global-search]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  assert.ok(await waitFor(`location.pathname.startsWith('/projects/')`), 'Enter must open the selected hit');

  await goto(page, `${base}/search`, 2500);
  await type(tag);
  await waitFor(`!!document.querySelector('[data-search-result="document"]')`);
  await evaluate(page, `document.querySelector('[data-search-result="document"]')?.click()`);
  assert.ok(await waitFor(`location.pathname === '/documents' && location.search.includes('id=')`), 'document hit must open the document');
  assert.ok(await waitFor(`document.body.innerText.includes('Doc ${tag}')`), 'the document must be selected');

  await goto(page, `${base}/search`, 2500);
  await type(tag);
  await waitFor(`!!document.querySelector('[data-search-result="issue"]')`);
  await evaluate(page, `document.querySelector('[data-search-result="issue"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll')`), 'clicking a hit opens the issue');

  await goto(page, `${base}/search`, 2500);
  await type(tag);
  await wait(1300);
  await evaluate(page, `(() => {
    const input = document.querySelector('[data-global-search]');
    const clear = input.parentElement.querySelector('button');
    clear?.click();
  })()`);
  await wait(300);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-search-recent-item="${tag}"]')`), 'recent search must be remembered');
  await evaluate(page, `document.querySelector('[data-search-recent-item="${tag}"]')?.click()`);
  await wait(200);
  assert.equal(await evaluate(page, `document.querySelector('[data-global-search]').value`), tag, 'clicking a recent search fills it');

  await goto(page, `${base}/search`, 2500);
  await type('zzz-no-such-thing');
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-search-result]').length`), 0, 'no results for a miss');

  console.log('PASS browser: global search finds issues/projects and opens them');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

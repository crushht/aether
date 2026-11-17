// Filter query language: `status:todo assignee:me` filters instead of searching.
//
//   $env:AUTH_DISABLED='1'; $env:LAB_DATA_DIR='.e2e-data'; npm run dev
//   node scripts/e2e-query-language.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';

const fill = (page, value) =>
  evaluate(
    page,
    `(() => {
      const input = document.querySelector('[data-global-search]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );

const chrome = await launch({ port: 9497, profile: path.join(process.env.TEMP || '.', `aether-query-${process.pid}`) });
let page = null;

const fillFilter = (target, value) =>
  evaluate(
    target,
    `(() => {
      const input = document.querySelector('[data-filter-query]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (expression, timeout = 10_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expression)) return true;
    await wait(200);
  }
  return false;
};

try {
  page = await newPage(9497);
  await viewport(page, 1280, 900);
  await goto(page, `${base}/search`, 3500);

  assert.ok(await waitFor(`!!document.querySelector('[data-global-search]')`), 'the search box renders');
  assert.ok(
    await waitFor(`!!document.querySelector('[data-query-syntax]')`),
    'the syntax hint is visible before typing',
  );

  assert.ok(await fill(page, 'status:todo'), 'the query can be typed');
  assert.ok(await waitFor(`!!document.querySelector('[data-query-chips]')`), 'a recognised filter becomes a chip');
  const chips = await evaluate(page, `document.querySelector('[data-query-chips]')?.textContent ?? ''`);
  assert.match(chips, /status:todo/, `the chip shows the parsed filter (${chips})`);
  assert.ok(
    await waitFor(`!!document.querySelector('[data-search-group="issues"]')`),
    'matching issues are listed for status:todo',
  );

  // Contradictory filters must return nothing, which is the proof that the
  // operator filtered instead of being searched for as text.
  assert.ok(await fill(page, 'status:todo status:done'), 'a second query can be typed');
  assert.ok(
    await waitFor(`!!document.querySelector('[data-search-empty]')`),
    'contradictory status filters yield no results',
  );

  // An unknown key is called out, not silently treated as text.
  assert.ok(await fill(page, 'owner:me'), 'an unknown key can be typed');
  assert.ok(await waitFor(`!!document.querySelector('[data-query-unknown]')`), 'an unknown filter is called out');

  await fill(page, 'assignee:me');
  await wait(600);
  await shot(page, process.env.AETHER_QUERY_SHOT || path.join(process.env.TEMP || '.', 'aether-query.png'));
  console.log('PASS browser: query chips, filtered results, contradiction and unknown-key hint');

  /* ------------------------------------------------------ list filter box */

  await goto(page, `${base}/team/ENG`, 3500);
  assert.ok(await waitFor(`!!document.querySelector('[data-filter-menu]')`), 'the filter button renders');
  await evaluate(page, `document.querySelector('[data-filter-menu]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-filter-query]')`), 'the filter menu has a query box');

  assert.ok(await fillFilter(page, 'status:todo'), 'the list query box accepts a filter');
  assert.ok(
    await waitFor(`!!document.querySelector('[data-filter-query-chips]')`),
    'the list shows the parsed filter chip',
  );
  await wait(400);

  // The contradiction must empty the list: the operator filtered, not searched.
  assert.ok(await fillFilter(page, 'status:todo status:done'), 'a contradictory filter can be typed');
  assert.ok(
    await waitFor(`document.querySelectorAll('[data-issue-row]').length === 0`, 10_000),
    'contradictory filters empty the list',
  );
  console.log('PASS browser: the issue list honours the same query language');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

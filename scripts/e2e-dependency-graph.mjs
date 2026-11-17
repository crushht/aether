// The dependency map: a chain of blockers drawn once from the pure layout, with
// nodes that open their issue instead of being a picture.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9536, profile: path.join(process.env.TEMP || '.', `aether-deps-${process.pid}`) });
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
  page = await newPage(9536);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && !!window.__AETHER_VIEW__`), 'the workspace stores must be exposed in dev');
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().issues.length > 3`), 'the workspace must have issues');

  // Three real issues, chained: a blocks b blocks c.
  const chain = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const picks = data.issues.slice(0, 3);
    const [a, b, c] = picks;
    window.__AETHER_DATA__.getState().addRelation(a.id, 'blocks', b.id);
    window.__AETHER_DATA__.getState().addRelation(b.id, 'blocks', c.id);
    window.__AETHER_VIEW__.getState().openIssue(a.id);
    return picks.map((issue) => ({ id: issue.id, key: issue.key }));
  })()`);
  assert.equal(chain.length, 3);
  assert.ok(await waitFor(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`), 'the drawer opens');
  assert.ok(await waitFor(`!!document.querySelector('[data-dep-toggle]')`), 'a blocking relation offers the map');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-dep-graph]')`), false, 'the map starts closed');

  await evaluate(page, `document.querySelector('[data-dep-toggle]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-dep-graph]')`), 'the map opens');

  // --- what is drawn ------------------------------------------------------
  const drawn = await evaluate(page, `(() => {
    const root = document.querySelector('[data-dep-graph]');
    return {
      nodes: [...root.querySelectorAll('[data-dep-node]')].map((el) => el.getAttribute('data-dep-node')),
      roots: [...root.querySelectorAll('[data-dep-root="1"]')].map((el) => el.getAttribute('data-dep-node')),
      edges: root.querySelectorAll('[data-dep-edge]').length,
      declared: root.getAttribute('data-dep-nodes'),
      cyclic: root.getAttribute('data-dep-cyclic'),
      focusable: [...root.querySelectorAll('[data-dep-node]')].every((el) => el.getAttribute('tabindex') === '0'),
      line: root.querySelector('[data-dep-edge]')?.getAttribute('d') ?? '',
    };
  })()`);
  assert.equal(drawn.declared, '3');
  assert.equal(drawn.nodes.length, 3, `three issues are reachable, got ${drawn.nodes.join(',')}`);
  assert.equal(drawn.edges, 2, 'one edge per relation');
  assert.deepEqual(drawn.roots, [chain[0].key], 'the drawer issue is the focus');
  assert.equal(drawn.cyclic, '0');
  assert.equal(drawn.focusable, true, 'every node is reachable by keyboard');
  assert.ok(drawn.line.startsWith('M') && !drawn.line.includes('NaN'), `the edge is a real path, got: ${drawn.line}`);

  // --- a node opens its issue --------------------------------------------
  await evaluate(page, `document.querySelector('[data-dep-node="${chain[2].key}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  assert.ok(
    await waitFor(`window.__AETHER_VIEW__.getState().activeIssueId === ${JSON.stringify(chain[2].id)}`),
    'clicking a node opens that issue',
  );
  // a new issue starts with the map closed, and re-centres when reopened
  assert.ok(await waitFor(`!document.querySelector('[data-dep-graph]')`), 'the map does not stay open across issues');
  await evaluate(page, `document.querySelector('[data-dep-toggle]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-dep-graph]')`), 'the map opens again');
  assert.equal(
    await evaluate(page, `document.querySelector('[data-dep-root="1"]')?.getAttribute('data-dep-node')`),
    chain[2].key,
    'and it is centred on the issue that is now open',
  );

  // --- an issue with nothing blocking it says so -------------------------
  await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const lonely = data.issues.find((issue) => issue.id !== ${JSON.stringify(chain[0].id)}
      && issue.id !== ${JSON.stringify(chain[1].id)} && issue.id !== ${JSON.stringify(chain[2].id)});
    window.__AETHER_VIEW__.getState().openIssue(lonely.id);
  })()`);
  assert.ok(
    await waitFor(`!document.querySelector('[data-dep-toggle]')`),
    'without a blocking relation there is no map button to offer',
  );

  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue(${JSON.stringify(chain[1].id)})`);
  assert.ok(await waitFor(`!!document.querySelector('[data-dep-toggle]')`), 'the middle issue has blockers again');
  await evaluate(page, `document.querySelector('[data-dep-toggle]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-dep-graph]')`), 'and its map opens');
  await wait(300);
  await shot(page, 'docs/checks/271-dependency-graph.png', { width: 1440, height: 1000 });
  console.log('PASS browser: the blocking chain is drawn, focused on the open issue, and its nodes navigate');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Acceptance for large-list windowing and basic accessibility affordances.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9452, profile: path.join(process.env.TEMP || '.', `aether-perf-${process.pid}`) });
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
  page = await newPage(9452);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && !!window.__AETHER_VIEW__`), 'stores must boot');

  // 300 issues in Todo; only a window may mount at once.
  await evaluate(page, `(() => {
    const now = Date.now();
    const issues = Array.from({ length: 300 }, (_, index) => ({
      id: 'perf-' + index, key: 'PERF-' + (index + 1), teamKey: 'ENG', title: 'Performance issue ' + (index + 1),
      description: '', status: 'todo', priority: 'medium', assigneeId: null, creatorId: 'local', labelIds: [],
      projectId: null, cycleId: null, estimate: null, dueDate: null,
      createdAt: new Date(now - index * 1000).toISOString(), updatedAt: new Date(now - index * 1000).toISOString(),
      comments: [], activities: [],
    }));
    window.__AETHER_DATA__.setState((state) => ({ issues: [...state.issues.filter((i) => !i.id.startsWith('perf-')), ...issues] }));
    window.__AETHER_VIEW__.setState({ viewMode: 'list', tab: 'all', filters: { status: [], priority: [], assigneeId: [], labelIds: [], due: 'any', query: '' }, groupBy: 'status' });
  })()`);
  await wait(900);

  const firstWindow = await evaluate(page, `document.querySelectorAll('[data-issue-row]').length`);
  assert.ok(firstWindow > 0 && firstWindow <= 120, `list must window rows, got ${firstWindow}`);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-load-more]')`), 'load-more affordance must exist');
  await evaluate(page, `document.querySelector('[data-load-more]').click()`);
  await wait(500);
  const secondWindow = await evaluate(page, `document.querySelectorAll('[data-issue-row]').length`);
  assert.ok(secondWindow > firstWindow && secondWindow <= 240, `load more must grow the window, got ${secondWindow}`);

  // Board columns cap at 60 cards until expanded.
  await evaluate(page, `window.__AETHER_VIEW__.getState().setViewMode('board')`);
  await wait(900);
  const boardCards = await evaluate(page, `document.querySelectorAll('[data-card-id]').length`);
  assert.ok(boardCards <= 60, `a board column must cap mounted cards, got ${boardCards}`);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-board-more]')`), 'board column needs a show-more affordance');
  await evaluate(page, `document.querySelector('[data-board-more]').click()`);
  await wait(500);
  const expandedCards = await evaluate(page, `document.querySelectorAll('[data-card-id]').length`);
  assert.ok(expandedCards > boardCards, `expanding a column must mount more cards, got ${expandedCards}`);

  // Accessibility: the issue drawer is a modal dialog.
  await evaluate(page, `window.__AETHER_DATA__.getState().openIssue?.('perf-0')`);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('perf-0')`);
  assert.ok(await waitFor(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`), 'issue drawer must expose a modal dialog');

  // Reduced motion is honoured by CSS.
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await wait(300);
  const duration = await evaluate(page, `(() => {
    const el = document.querySelector('[role="dialog"]');
    return el ? getComputedStyle(el).transitionDuration : null;
  })()`);
  assert.ok(duration === null || parseFloat(String(duration)) <= 0.0011, `reduced motion must collapse transitions, got ${duration}`);

  console.log('PASS browser: list/board windowing with load-more, modal semantics and reduced motion');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

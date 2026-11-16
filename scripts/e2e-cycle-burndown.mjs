// Cycle burndown chart: daily remaining points, rendered as an SVG polyline.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9571, profile: path.join(process.env.TEMP || '.', `aether-burndown-${process.pid}`) });
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
  page = await newPage(9571);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/cycles`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'the data store must be exposed in dev');
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().hydrated === true`), 'the store must hydrate');

  const injected = await evaluate(page, `(() => {
    const DAY = 86_400_000;
    const now = Date.now();
    const start = now - 6 * DAY - 3_600_000; // six full days plus an hour, so the bucket count is stable
    const iso = (ms) => new Date(ms).toISOString();
    const issue = (id, estimate, status, created, updated) => ({
      id: 'bd-' + id, key: 'BD-' + id, teamKey: 'ENG', title: 'Burndown issue ' + id, description: '',
      status, priority: 'medium', assigneeId: null, creatorId: 'me', labelIds: [],
      projectId: null, cycleId: 'cyc-bd-main', estimate, dueDate: null,
      createdAt: iso(created), updatedAt: iso(updated), comments: [], activities: [],
    });
    const main = {
      id: 'cyc-bd-main', name: 'Burndown test cycle', number: 871,
      startsAt: iso(start), endsAt: iso(start + 14 * DAY), progress: 0, current: true,
    };
    const empty = {
      id: 'cyc-bd-empty', name: 'Burndown empty cycle', number: 872,
      startsAt: iso(start), endsAt: iso(start + 14 * DAY), progress: 0,
    };
    const issues = [
      issue('a', 3, 'done', start - 2 * DAY, start + 5 * DAY),        // 3 points burned
      issue('b', 2, 'in_progress', start - 3_600_000, start - 3_600_000),
      issue('c', null, 'todo', start - 3_600_000, start - 3_600_000), // unestimated → 1 point
      issue('d', 4, 'canceled', start - 3_600_000, start + 2 * DAY),  // leaves the scope
    ];
    const data = window.__AETHER_DATA__;
    data.setState((state) => ({
      cycles: [main, empty, ...state.cycles.filter((c) => c.id !== main.id && c.id !== empty.id)],
      issues: [...state.issues.filter((i) => i.cycleId !== main.id && i.cycleId !== empty.id), ...issues],
    }));
    return { cycles: data.getState().cycles.length, issues: data.getState().issues.length };
  })()`);
  assert.ok(injected.cycles >= 2 && injected.issues >= 4, 'the fixture must land in the store');

  assert.ok(
    await waitFor(`!!document.querySelector('[data-cycle="cyc-bd-main"]')`),
    'the injected cycle must appear in the sidebar',
  );
  await evaluate(page, `document.querySelector('[data-cycle="cyc-bd-main"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-cycle-burndown="cyc-bd-main"]')`), 'the burndown card must render');

  const chart = await evaluate(page, `(() => {
    const root = document.querySelector('[data-cycle-burndown="cyc-bd-main"]');
    if (!root) return null;
    const line = root.querySelector('[data-burndown-line]');
    const ideal = root.querySelector('[data-burndown-ideal]');
    const remaining = root.querySelector('[data-burndown-remaining]');
    return {
      tag: line ? line.tagName.toLowerCase() : '',
      coords: (line?.getAttribute('points') || '').trim().split(/\\s+/).filter(Boolean),
      points: Number(root.querySelector('svg')?.getAttribute('data-burndown-points')),
      remaining: Number(remaining?.getAttribute('data-burndown-remaining')),
      label: (remaining?.textContent || '').trim(),
      ideal: ideal?.getAttribute('d') || '',
      idealDash: ideal?.getAttribute('stroke-dasharray') || '',
      area: root.querySelector('[data-burndown-area]')?.getAttribute('d') || '',
      text: root.innerText,
      aria: root.querySelector('svg')?.getAttribute('aria-label') || '',
      burnUp: /Burn-up|进度曲线/.test(document.body.innerText),
    };
  })()`);

  assert.ok(chart, 'the burndown card must be in the DOM');
  assert.equal(chart.tag, 'polyline', 'the remaining line is an SVG polyline');
  assert.equal(chart.points, 7, 'six days elapsed → seven daily points');
  assert.equal(chart.coords.length, 7);
  assert.equal(chart.remaining, 3, '10 points in scope − 3 done − 4 canceled = 3 left');
  assert.ok(chart.label.includes('3'), `the header must state the remaining points, got: ${chart.label}`);
  assert.ok(/未估|without an estimate/.test(chart.text), 'unestimated work must be explained');

  const yOf = (pair) => Number(pair.split(',')[1]);
  assert.ok(Number.isFinite(yOf(chart.coords[0])), 'coordinates must be numeric');
  assert.ok(yOf(chart.coords[0]) < yOf(chart.coords.at(-1)), 'remaining fell, so the line moves down the chart');
  assert.ok(chart.ideal.startsWith('M') && chart.ideal.includes(' L'), 'the ideal guide is a straight line');
  assert.ok(chart.idealDash.includes('4'), 'the ideal guide is dashed');
  assert.ok(chart.area.endsWith('Z'), 'the fill closes against the baseline');
  for (const value of [chart.coords.join(' '), chart.ideal, chart.area]) {
    assert.ok(!value.includes('NaN'), 'no NaN may reach the SVG');
  }
  assert.ok(chart.aria.includes('Burndown test cycle'), 'the chart is labelled with the cycle name');
  assert.ok(chart.burnUp, 'the existing burn-up chart must still render');

  assert.ok(
    await waitFor(`!!document.querySelector('[data-cycle="cyc-bd-empty"]')`),
    'the empty cycle must appear in the sidebar',
  );
  await evaluate(page, `document.querySelector('[data-cycle="cyc-bd-empty"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-cycle-burndown="cyc-bd-empty"]')`), 'the empty cycle must render too');
  const empty = await evaluate(page, `(() => {
    const root = document.querySelector('[data-cycle-burndown="cyc-bd-empty"]');
    const line = root?.querySelector('[data-burndown-line]');
    const remaining = root?.querySelector('[data-burndown-remaining]');
    return {
      points: Number(root?.querySelector('svg')?.getAttribute('data-burndown-points')),
      remaining: Number(remaining?.getAttribute('data-burndown-remaining')),
      coords: (line?.getAttribute('points') || '').trim().split(/\\s+/).filter(Boolean),
      text: root?.innerText || '',
    };
  })()`);
  assert.equal(empty.remaining, 0, 'a cycle with no issues has nothing left to burn');
  assert.equal(empty.coords.length, 7, 'an empty cycle still draws one bucket per elapsed day');
  assert.ok(!empty.coords.join(' ').includes('NaN'), 'an empty cycle must not produce NaN coordinates');
  assert.equal(new Set(empty.coords.map((pair) => pair.split(',')[1])).size, 1, 'nothing to burn → a flat line');
  assert.ok(/0/.test(empty.text));

  await evaluate(page, `document.querySelector('[data-cycle="cyc-bd-main"]')?.click()`);
  await wait(300);
  await shot(page, path.resolve('docs/checks/267-cycle-burndown.png'), { fullPage: false });

  console.log('PASS browser: cycle burndown renders daily remaining points as an SVG polyline and keeps the burn-up chart');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

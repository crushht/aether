// Throughput: completed points per week, an average that admits what it guessed,
// and bars that stay honest when a week is empty.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9539, profile: path.join(process.env.TEMP || '.', `aether-throughput-${process.pid}`) });
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
  page = await newPage(9539);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/cycles`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'the data store must be exposed in dev');
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().hydrated === true`), 'the store must hydrate');

  // A cycle with work closed this week, last week, and one with no history at all.
  const fixture = await evaluate(page, `(() => {
    const DAY = 86_400_000;
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const start = now - 6 * DAY - 3_600_000;
    const issue = (id, estimate, status, created, updated, activities = []) => ({
      id: 'tp-' + id, key: 'TP-' + id, teamKey: 'ENG', title: 'Throughput issue ' + id, description: '',
      status, priority: 'medium', assigneeId: null, creatorId: 'me', labelIds: [],
      projectId: null, cycleId: 'cyc-tp', estimate, dueDate: null,
      createdAt: iso(created), updatedAt: iso(updated), comments: [], activities,
    });
    const done = (at) => [{ id: 'act-' + at, actorId: 'me', kind: 'status', to: 'done', createdAt: iso(at) }];
    const cycle = { id: 'cyc-tp', name: 'Throughput cycle', number: 941, startsAt: iso(start), endsAt: iso(start + 14 * DAY), progress: 0, current: true };
    const issues = [
      issue('a', 3, 'done', now - 3 * DAY, now - DAY, done(now - DAY)),           // 3 points, exact
      issue('b', null, 'done', now - 9 * DAY, now - 3_600_000, []),            // 1 point, approximated
      issue('c', 5, 'done', now - 16 * DAY, now - 9 * DAY, done(now - 9 * DAY)),   // last week
      issue('d', 2, 'in_progress', now - 2 * DAY, now - 2 * DAY),                  // still open
    ];
    window.__AETHER_DATA__.setState((state) => ({
      cycles: [cycle, ...state.cycles.filter((item) => item.id !== cycle.id)],
      issues: [...state.issues.filter((item) => item.cycleId !== cycle.id), ...issues],
    }));
    return { issues: issues.length };
  })()`);
  assert.equal(fixture.issues, 4);

  assert.ok(await waitFor(`!!document.querySelector('[data-cycle="cyc-tp"]')`), 'the cycle appears in the sidebar');
  await evaluate(page, `document.querySelector('[data-cycle="cyc-tp"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-throughput]')`), 'the throughput card renders');

  const card = await evaluate(page, `(() => {
    const root = document.querySelector('[data-throughput]');
    const weeks = [...root.querySelectorAll('[data-throughput-week]')].map((el) => ({
      key: el.getAttribute('data-throughput-week'),
      points: Number(el.getAttribute('data-throughput-points')),
      barHeight: el.querySelector('[data-throughput-bar]')?.style.height || '',
      label: el.innerText.trim(),
    }));
    return {
      weeks,
      declared: Number(root.getAttribute('data-throughput-weeks')),
      average: Number(root.querySelector('[data-throughput-average]')?.getAttribute('data-throughput-average')),
      closed: Number(root.querySelector('[data-throughput-closed]')?.getAttribute('data-throughput-closed')),
      days: root.querySelector('[data-throughput-days]')?.getAttribute('data-throughput-days') || '',
      text: root.innerText,
      estimated: !!root.querySelector('[data-throughput-estimated]'),
      approximated: !!root.querySelector('[data-throughput-approximated]'),
      burndown: !!document.querySelector('[data-cycle-burndown="cyc-tp"]'),
    };
  })()`);

  assert.equal(card.declared, 6, 'six weeks by default');
  assert.equal(card.weeks.length, 6);
  assert.equal(card.closed, 3, 'three done issues fed the numbers');
  const points = card.weeks.map((week) => week.points);
  assert.equal(points.at(-1), 4, 'this week: 3 points + 1 for the unestimated issue');
  assert.ok(points.includes(5), `the issue closed last week belongs to another bucket, got ${points.join(',')}`);
  assert.equal(points.reduce((sum, value) => sum + value, 0), 9, 'every completed point is counted once');
  assert.equal(card.average, Math.round((9 / 6) * 10) / 10, 'the average is per week, not per active week');
  assert.ok(card.days && Number(card.days) > 0, `the close time is measured, got ${card.days}`);
  assert.equal(card.estimated, true, 'an unestimated issue is called out');
  assert.equal(card.approximated, true, 'the imported issue says its close time is a fallback');
  assert.ok(card.weeks.every((week) => week.barHeight.endsWith('px')), 'each week draws a bar');
  assert.ok(card.weeks.every((week) => /\d{2}-\d{2}/.test(week.label)), 'each bar is labelled with its week');
  assert.ok(card.burndown, 'the burndown card is still there');

  // An empty window says so instead of drawing a confident zero.
  await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    window.__AETHER_DATA__.setState({
      issues: data.issues.map((issue) => (issue.cycleId === 'cyc-tp' ? { ...issue, status: 'todo', activities: [] } : issue)),
    });
  })()`);
  assert.ok(
    await waitFor(`document.querySelector('[data-throughput-closed]')?.getAttribute('data-throughput-closed') === '0'`),
    'with nothing closed the card reports zero',
  );
  const idle = await evaluate(page, `({
    text: document.querySelector('[data-throughput]').innerText,
    days: document.querySelector('[data-throughput-days]')?.getAttribute('data-throughput-days') || '',
    bars: [...document.querySelectorAll('[data-throughput-week]')].map((el) => el.querySelector('[data-throughput-bar]')?.style.height || ''),
  })`);
  assert.ok(/没有完成项|Nothing completed/.test(idle.text), `an empty window says so, got: ${idle.text}`);
  assert.equal(idle.days, '', 'no average is invented');
  assert.ok(idle.bars.every((height) => height === '0px'), 'flat bars, not a fake spike');

  await wait(300);
  await shot(page, 'docs/checks/274-cycle-throughput.png', { width: 1440, height: 1000 });
  console.log('PASS browser: throughput counts completed points per week, admits its estimates, and stays flat when idle');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

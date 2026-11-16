// Week filter: clicking a week narrows the update list to that week.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9482, profile: path.join(process.env.TEMP || '.', `aether-week-${process.pid}`) });
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
  page = await newPage(9482);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Week filter project' });
    data.getState().addProjectUpdate(project.id, 'This week update', 'on_track');
    const older = new Date();
    older.setDate(older.getDate() - 8);
    data.setState((state) => ({
      projects: state.projects.map((p) => p.id === project.id ? {
        ...p,
        updates: p.updates.map((update, index) => index === 0 ? { ...update, createdAt: older.toISOString() } : update),
      } : p),
    }));
    data.getState().addProjectUpdate(project.id, 'Second this week', 'at_risk');
    return project.id;
  })()`);
  await wait(1200);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`document.querySelectorAll('[data-week-export]').length >= 2`), 'each week must expose an export action');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-week-export-all]')`), 'all-weeks export must render');

  const weeks = await evaluate(page, `[...document.querySelectorAll('[data-reaction-week]')].map((el) => el.getAttribute('data-reaction-week'))`);
  const currentWeek = weeks[0];
  await evaluate(page, `document.querySelector('[data-reaction-week="${currentWeek}"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 1, 'current week must show one update');
  assert.ok((await evaluate(page, `document.querySelector('[data-project-update]').innerText`)).includes('Second this week'));

  await evaluate(page, `document.querySelector('[data-clear-week]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 2, 'clearing must restore every update');

  const olderWeek = weeks[weeks.length - 1];
  await evaluate(page, `document.querySelector('[data-reaction-week="${olderWeek}"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 1, 'older week must show one update');
  assert.ok((await evaluate(page, `document.querySelector('[data-project-update]').innerText`)).includes('This week update'));

  console.log('PASS browser: reaction weeks filter the update list');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

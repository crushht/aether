// Audit pagination: 20 per page with load more.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9485, profile: path.join(process.env.TEMP || '.', `aether-audit-page-${process.pid}`) });
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
  page = await newPage(9485);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Audit pagination project' });
    for (let i = 0; i < 25; i += 1) {
      data.getState().addProjectUpdate(project.id, \`Audit entry \${i + 1}\`, 'on_track');
    }
    return project.id;
  })()`);
  await wait(1200);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-update-audit]')`), 'audit must render');
  await evaluate(page, `document.querySelector('[data-update-audit] summary')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-audit-action]').length`), 20, 'first page shows 20 audit rows');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-audit-more]')`), 'load more must render');
  const hint = await evaluate(page, `document.querySelector('[data-audit-more]').parentElement.innerText`);
  assert.ok(hint.includes('20 / 25'), `page must report 20 of 25: ${hint}`);

  await evaluate(page, `document.querySelector('[data-audit-more]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-audit-action]').length`), 25, 'load more must reveal the rest');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-audit-more]')`), false, 'button disappears at the end');

  // Range filters: 3 entries earlier this month, 5 last month, the rest this week.
  await evaluate(page, `window.__AETHER_DATA__.setState((state) => ({
    projects: state.projects.map((project) => project.id !== '${projectId}' ? project : {
      ...project,
      updateAudit: project.updateAudit.map((entry, index) => {
        if (index < 3) return { ...entry, at: new Date(new Date().getFullYear(), new Date().getMonth(), 3, 10).toISOString() };
        if (index < 8) return { ...entry, at: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15, 10).toISOString() };
        return entry;
      }),
    }),
  }))`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-audit-range="week"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-audit-action]').length`), 17, 'this week must exclude older entries');
  await evaluate(page, `document.querySelector('[data-audit-range="month"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-audit-action]').length`), 20, 'this month keeps entries from earlier weeks');
  await evaluate(page, `document.querySelector('[data-audit-range="all"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-audit-action]').length`), 20, 'all time returns to page one');

  console.log('PASS browser: audit history paginates 20 at a time');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Project update notification: enters the inbox and opens the project.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9470, profile: path.join(process.env.TEMP || '.', `aether-pupd-notify-${process.pid}`) });
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
  page = await newPage(9470);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const fixture = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Notify project' });
    data.getState().addProjectUpdate(project.id, 'Milestone reached: **beta** is live.', 'on_track');
    const notification = data.getState().notifications.find((n) => n.kind === 'project_update' && n.projectId === project.id);
    return { projectId: project.id, notification };
  })()`);
  assert.ok(fixture.notification, 'a project_update notification must be created');
  assert.equal(fixture.notification.projectName, 'Notify project');
  assert.equal(fixture.notification.kind, 'project_update');
  // let the workspace snapshot debounce land before navigating
  await wait(1200);

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${fixture.notification.id}"]')`), 'notification must render');
  const text = await evaluate(page, `document.querySelector('[data-notification="${fixture.notification.id}"]').innerText`);
  assert.ok(text.includes('项目更新') || text.includes('Project update'), `title missing: ${text}`);
  assert.ok(text.includes('Notify project'), 'project name must be visible');

  // The Updates tab only lists project updates.
  await evaluate(page, `document.querySelector('[data-inbox-tab="updates"]')?.click()`);
  await wait(300);
  const updateRows = await evaluate(page, `[...document.querySelectorAll('[data-notification]')].map((el) => el.innerText)`);
  assert.ok(updateRows.length >= 1, 'updates tab must list at least one item');
  assert.ok(updateRows.every((row) => row.includes('项目更新') || row.includes('Project update')), 'updates tab must only show project updates');

  await evaluate(page, `document.querySelector('[data-notification="${fixture.notification.id}"] button')?.click()`);
  assert.ok(await waitFor(`location.pathname === '/projects/${fixture.projectId}'`, 6000), 'clicking must open the project page');
  assert.ok(await waitFor(`!!document.querySelector('[data-project-updates]')`), 'project updates section must load');

  // Deleting the update also withdraws its notification.
  await evaluate(page, `(() => {
    const row = document.querySelector('[data-project-update]');
    const btn = row ? [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('删除更新') || (b.getAttribute('aria-label') || '').includes('Delete update')) : null;
    btn?.click();
  })()`);
  await wait(600);
  assert.equal(
    await evaluate(page, `window.__AETHER_DATA__.getState().notifications.some((n) => n.updateId === '${fixture.notification.updateId}')`),
    false,
    'deleting an update must withdraw its notification',
  );

  console.log('PASS browser: project updates notify the inbox and open the project');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

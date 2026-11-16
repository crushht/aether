// Project updates: post with health, persist across reload, delete.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9469, profile: path.join(process.env.TEMP || '.', `aether-pupdates-${process.pid}`) });
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
  page = await newPage(9469);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const projectId = await evaluate(page, `window.__AETHER_DATA__.getState().createProject({ name: 'Update fixture' }).id`);
  await wait(800);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-updates]')`), 'updates section must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-project-summary]')`), 'summary export must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-project-summary-json]')`), 'summary JSON export must render');

  await evaluate(page, `(() => {
    const el = document.querySelector('[data-project-update-input]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, 'First update: **scope** is stable.');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-project-health="at_risk"]')?.click();
  })()`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-project-update-submit]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-update]')`), 'update must appear');
  const text = await evaluate(page, `document.querySelector('[data-project-update]').innerText`);
  assert.ok(text.includes('scope'), 'post body must render');
  assert.ok(text.includes('有风险') || text.includes('At risk'), 'health label must render');

  const stored = await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}')?.updates?.[0]`);
  assert.equal(stored.health, 'at_risk');
  assert.equal(
    await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}')?.health`),
    'at_risk',
    'posting an update must also move the project health',
  );
  assert.ok((await evaluate(page, `document.querySelector('[data-project-health]')?.innerText ?? ''`)).includes('有风险') ||
    (await evaluate(page, `document.querySelector('[data-project-health]')?.innerText ?? ''`)).includes('At risk'), 'project health line must show the new state');

  // A second observation draws the health trend.
  await evaluate(page, `(() => {
    const el = document.querySelector('[data-project-update-input]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, 'Back on track after the fix.');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-project-health="on_track"]')?.click();
  })()`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-project-update-submit]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-health-trend]')`), 'health trend must appear with two observations');
  assert.ok((await evaluate(page, `document.querySelectorAll('[data-health-point]').length`)) >= 2, 'trend must plot both points');

  // Edit the newest update in place, including its health.
  await evaluate(page, `document.querySelector('[data-project-update] [aria-label="编辑更新"], [data-project-update] [aria-label="Edit update"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-update-edit]')`), 'editor must open');
  await evaluate(page, `(() => {
    const el = document.querySelector('[data-project-update-edit]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, 'Edited: **risk** accepted.');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-edit-health="off_track"]')?.click();
  })()`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-project-update-save]')?.click()`);
  await wait(500);
  const edited = await evaluate(page, `(() => {
    const project = window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}');
    return { update: project.updates[0], health: project.health };
  })()`);
  assert.ok(edited.update.body.includes('Edited:'), 'body must be updated');
  assert.equal(edited.update.health, 'off_track', 'update health must change');
  assert.equal(edited.health, 'off_track', 'editing the newest update moves the project health');
  const editedAudit = await evaluate(page, `(() => {
    const project = window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}');
    return project.updateAudit?.[0] ?? null;
  })()`);
  assert.equal(editedAudit.action, 'edited', 'editing must be recorded');
  assert.ok(await waitFor(`!!document.querySelector('[data-update-audit]')`), 'audit history must render');
  await evaluate(page, `document.querySelector('[data-update-audit] summary')?.click()`);
  await wait(200);
  assert.ok((await evaluate(page, `document.querySelector('[data-update-audit]').innerText`)).includes('编辑') || (await evaluate(page, `document.querySelector('[data-update-audit]').innerText`)).includes('edited'), 'audit entry must be readable');
  // let the snapshot debounce land before a reload
  await wait(1200);

  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-update]')`), 'update must persist across reload');

  await evaluate(page, `(() => {
    for (const row of [...document.querySelectorAll('[data-project-update]')]) {
      const btn = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('删除更新') || (b.getAttribute('aria-label') || '').includes('Delete update'));
      btn?.click();
    }
  })()`);
  await wait(500);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 0, 'updates must be deleted');
  const auditAfterDelete = await evaluate(page, `(() => {
    const project = window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}');
    return { actions: (project.updateAudit ?? []).map((entry) => entry.action), updates: project.updates ?? [] };
  })()`);
  assert.equal(auditAfterDelete.updates.length, 0);
  assert.ok(auditAfterDelete.actions.filter((action) => action === 'deleted').length >= 2, 'deletions must be recorded');
  assert.ok(auditAfterDelete.actions.includes('created') && auditAfterDelete.actions.includes('edited'), 'audit keeps creation and edits');

  // Audit filters narrow by action.
  await evaluate(page, `document.querySelector('[data-update-audit] summary')?.click()`);
  await wait(200);
  await evaluate(page, `document.querySelector('[data-audit-filter="deleted"]')?.click()`);
  await wait(200);
  let shownActions = await evaluate(page, `[...document.querySelectorAll('[data-audit-action]')].map((el) => el.getAttribute('data-audit-action'))`);
  assert.ok(shownActions.length >= 2 && shownActions.every((action) => action === 'deleted'), `deleted filter must narrow the list: ${shownActions}`);
  await evaluate(page, `document.querySelector('[data-audit-filter="created"]')?.click()`);
  await wait(200);
  shownActions = await evaluate(page, `[...document.querySelectorAll('[data-audit-action]')].map((el) => el.getAttribute('data-audit-action'))`);
  assert.ok(shownActions.length >= 1 && shownActions.every((action) => action === 'created'), 'created filter must narrow the list');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-audit-export="md"]') && !!document.querySelector('[data-audit-export="json"]')`), 'both audit export actions must render');

  // Copy the filtered audit to the clipboard.
  await evaluate(page, `Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__auditCopied = text; } }, configurable: true })`);
  await evaluate(page, `document.querySelector('[data-audit-copy]')?.click()`);
  await wait(400);
  const copied = await evaluate(page, `window.__auditCopied ?? ''`);
  assert.ok(copied.includes('update audit'), 'clipboard must receive the audit Markdown');
  assert.ok(copied.includes('**created**'), 'copied text must respect the active filter');

  console.log('PASS browser: project updates post with health, persist and delete');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

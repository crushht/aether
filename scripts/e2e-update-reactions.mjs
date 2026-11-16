// Update reactions: like/acknowledge toggle and persist.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9480, profile: path.join(process.env.TEMP || '.', `aether-reactions-${process.pid}`) });
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
  page = await newPage(9480);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Reaction fixture' });
    data.getState().addProjectUpdate(project.id, 'Reaction target', 'on_track');
    return project.id;
  })()`);
  await wait(700);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-update-react="like"]')`), 'reaction buttons must render');

  await evaluate(page, `document.querySelector('[data-update-react="like"]')?.click()`);
  await wait(300);
  let update = await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}').updates[0]`);
  assert.equal(update.likedBy.length, 1, 'like must be recorded');
  assert.equal(await evaluate(page, `document.querySelector('[data-update-react="like"]').getAttribute('aria-pressed')`), 'true');
  let audit = await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}').updateAudit[0]`);
  assert.equal(audit.action, 'liked', 'like must be audited');
  const likeTitle = await evaluate(page, `document.querySelector('[data-update-react="like"]').getAttribute('title')`);
  assert.ok(likeTitle && (likeTitle.includes('你') || likeTitle.includes('You')), `likers must be listed: ${likeTitle}`);
  assert.ok(await waitFor(`!!document.querySelector('[data-reaction-summary]')`), 'weekly reaction summary must render');
  assert.ok((await evaluate(page, `document.querySelectorAll('[data-reaction-week]').length`)) >= 1, 'summary must contain the current week');
  const ackTitle = await evaluate(page, `document.querySelector('[data-update-react="ack"]').getAttribute('title')`);
  assert.ok(ackTitle && (ackTitle.includes('还没有回应') || ackTitle.includes('No reactions')), 'empty reactions must say so');

  await evaluate(page, `document.querySelector('[data-update-react="ack"]')?.click()`);
  await wait(300);
  update = await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}').updates[0]`);
  assert.equal(update.acknowledgedBy.length, 1, 'acknowledge must be recorded');
  audit = await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}').updateAudit[0]`);
  assert.equal(audit.action, 'acknowledged', 'acknowledge must be audited');

  await evaluate(page, `document.querySelector('[data-update-react="like"]')?.click()`);
  await wait(300);
  update = await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}').updates[0]`);
  assert.equal(update.likedBy.length, 0, 'second click must remove the like');
  audit = await evaluate(page, `window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}').updateAudit[0]`);
  assert.equal(audit.action, 'unliked', 'removal must be audited');

  // Restore the like, then verify the reaction filter and persistence.
  await evaluate(page, `document.querySelector('[data-update-react="like"]')?.click()`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-update-audit] summary')?.click()`);
  await wait(200);
  await evaluate(page, `document.querySelector('[data-audit-filter="reactions"]')?.click()`);
  await wait(200);
  const reactions = await evaluate(page, `[...document.querySelectorAll('[data-audit-action]')].map((el) => el.getAttribute('data-audit-action'))`);
  assert.ok(reactions.length >= 2, 'reaction filter must show reaction entries');
  assert.ok(reactions.every((action) => ['liked', 'unliked', 'acknowledged', 'unacknowledged'].includes(action)), `only reactions: ${reactions}`);
  await evaluate(page, `document.querySelector('[data-audit-filter="created"]')?.click()`);
  await wait(200);
  const created = await evaluate(page, `[...document.querySelectorAll('[data-audit-action]')].map((el) => el.getAttribute('data-audit-action'))`);
  assert.ok(created.length >= 1 && created.every((action) => action === 'created'), 'created filter stays intact');
  const localized = await evaluate(page, `document.querySelector('[data-audit-action]').innerText`);
  assert.ok(localized.includes('创建了更新') || localized.includes('Created update'), `labels must be localised: ${localized}`);
  await wait(1000);
  await goto(page, `${base}/projects/${projectId}`, 2500);
  assert.ok(await waitFor(`!!document.querySelector('[data-update-react="like"]')`), 'buttons must reload');
  assert.equal(await evaluate(page, `document.querySelector('[data-update-react="like"]').getAttribute('aria-pressed')`), 'true', 'reactions must persist');

  console.log('PASS browser: update likes and acknowledgements toggle and persist');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Automatic backups appear in settings with a restore action.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const call = async (url, init) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};

const current = await call('/api/workspace');
const snapshot = {
  issues: current.json.issues,
  labels: current.json.labels,
  projects: current.json.projects,
  cycles: current.json.cycles,
  notifications: current.json.notifications,
  baseVersion: current.json.updatedAt,
};
const write = await call('/api/workspace', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(snapshot),
});
assert.ok(write.response.ok, 'write must succeed to create a backup');
const second = await call('/api/workspace', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...snapshot, baseVersion: write.json.updatedAt }),
});
assert.ok(second.response.ok, 'second write must succeed');
const list = await call('/api/workspace/backups');
assert.ok(list.json.backups.length >= 2, 'backups must exist');

const chrome = await launch({ port: 9487, profile: path.join(process.env.TEMP || '.', `aether-backup-ui-${process.pid}`) });
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
  page = await newPage(9487);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/preferences`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-workspace-backups]')`), 'backup section must render');
  assert.ok(await waitFor(`document.querySelectorAll('[data-auto-backup]').length >= 1`), 'at least one backup row must render');
  assert.ok(await evaluate(page, `[...document.querySelectorAll('[data-auto-backup] button')].some((b) => (b.textContent || '').includes('恢复') || (b.textContent || '').includes('Restore'))`), 'restore action must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-backup-now]')`), 'manual backup action must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-delete-backup]')`), 'delete action must render');
  const summary = await evaluate(page, `document.querySelector('[data-auto-backup]').innerText`);
  assert.ok(summary.includes('个议题') || summary.includes('issues'), `backups must show their size: ${summary}`);

  console.log('PASS browser: automatic workspace backups list with a restore action');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

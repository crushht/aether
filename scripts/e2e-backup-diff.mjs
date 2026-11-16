// Backup preview: shows what a restore would add or drop before overwriting.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9524, profile: path.join(process.env.TEMP || '.', `aether-backup-diff-${process.pid}`) });
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
  page = await newPage(9524);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/settings/data`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  assert.ok(await waitFor(`!!document.querySelector('[data-backup-now]')`), 'backup panel must render');

  // 1) snapshot now, 2) add an issue that the snapshot cannot know about
  await evaluate(page, `document.querySelector('[data-backup-now]')?.click()`);
  await wait(1200);
  const key = await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'After the backup', status: 'todo' }).key`);
  await wait(1200);

  const previews = await evaluate(page, `[...document.querySelectorAll('[data-preview-backup]')].map((el) => el.getAttribute('data-preview-backup'))`);
  assert.ok(previews.length >= 1, 'at least one backup must be listed');
  await evaluate(page, `document.querySelector('[data-preview-backup="${previews[0]}"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-backup-diff]')`), 'diff panel must open');

  const diffText = await evaluate(page, `document.querySelector('[data-backup-diff]').innerText`);
  assert.ok(diffText.includes('-1'), `restoring would drop the newer issue: ${diffText.replace(/\\n/g, ' | ')}`);
  assert.ok(diffText.includes(key), 'the dropped issue is named');
  assert.ok(/Issues|议题/.test(diffText) && /Projects|项目/.test(diffText), 'both sides are summarised');

  await evaluate(page, `document.querySelector('[data-preview-backup="${previews[0]}"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-backup-diff]')`), false, 'clicking again closes the diff');

  console.log('PASS browser: backup preview shows what a restore would change');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

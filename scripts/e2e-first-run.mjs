// First run: an empty workspace offers sample data and backup restore.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9518, profile: path.join(process.env.TEMP || '.', `aether-first-run-${process.pid}`) });
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
  page = await newPage(9518);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/my-issues`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  assert.ok(await waitFor(`!!document.querySelector('[data-seed-workspace]')`), 'first run must offer sample data');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-restore-backup]')`), 'first run must offer backup restore');

  await evaluate(page, `document.querySelector('[data-seed-workspace]')?.click()`);
  assert.ok(await waitFor(`document.querySelectorAll('[data-issue-row]').length >= 6`), 'seeded rows must render');

  const counts = await evaluate(page, `(() => {
    const s = window.__AETHER_DATA__.getState();
    return { issues: s.issues.length, projects: s.projects.length, cycles: s.cycles.length };
  })()`);
  assert.ok(counts.issues >= 8, `expected at least 8 issues, got ${counts.issues}`);
  assert.equal(counts.projects, 2, 'two sample projects');
  assert.ok(counts.cycles >= 1, 'one sample cycle');

  assert.equal(await evaluate(page, `!!document.querySelector('[data-seed-workspace]')`), false, 'first-run actions disappear');

  console.log('PASS browser: first run seeds a demo workspace');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

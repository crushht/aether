// Scheduler status: the API reports a live server scheduler and the page shows it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9467, profile: path.join(process.env.TEMP || '.', `aether-sched-${process.pid}`) });
let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, timeout = 20000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expr)) return true;
    await wait(250);
  }
  return false;
};

try {
  const status = await (await fetch(`${base}/api/agent/status`)).json();
  assert.ok(status.ok, 'status API must answer');
  assert.equal(status.scheduler.disabled, false, 'scheduler must be enabled in tests');
  assert.equal(status.scheduler.started, true, 'scheduler must have started');
  assert.equal(typeof status.counts.workflows, 'number');

  page = await newPage(9467);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/workflows`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-scheduler-status]')`), 'status line must render');
  assert.ok(await waitFor(`document.querySelector('[data-scheduler-status]').innerText.includes('运行中') || document.querySelector('[data-scheduler-status]').innerText.includes('running')`), 'status must say the scheduler is running');
  // The first tick happens 8s after boot; lastTickAt may be null briefly.
  assert.ok(await waitFor(`document.querySelector('[data-scheduler-status]').innerText.includes('最近扫描') || document.querySelector('[data-scheduler-status]').innerText.includes('last scan')`, 25000), 'status must show the last scan time');

  console.log('PASS browser: scheduler status API and workflow page indicator');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

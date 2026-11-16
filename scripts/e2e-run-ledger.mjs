// Run ledger: events are persisted through the API and expand in the UI.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9468, profile: path.join(process.env.TEMP || '.', `aether-ledger-${process.pid}`) });
let page;
let workflowId;
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
  const created = await fetch(`${base}/api/agent/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ledger fixture', prompt: 'noop' }),
  });
  const workflow = (await created.json()).workflow;
  assert.ok(workflow?.id, 'workflow must be created');
  workflowId = workflow.id;

  const patched = await fetch(`${base}/api/agent/workflows`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: workflow.id,
      appendRun: {
        status: 'ok',
        summary: 'ledger summary',
        steps: 2,
        tools: 1,
        events: [
          { kind: 'step', text: 'Step 1: 1 tool call(s)', at: Date.now() },
          { kind: 'tool', text: 'list_issues ok · 3 issues', at: Date.now(), ok: true },
          { kind: 'final', text: 'Report complete', at: Date.now(), ok: true },
        ],
      },
    }),
  });
  const body = await patched.json();
  assert.ok(patched.ok && body.ok, 'appendRun must succeed');
  assert.equal(body.workflow.runs[0].events.length, 3, 'events must survive the API');

  page = await newPage(9468);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/workflows`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_WORKSPACE__`), 'app must boot');
  await evaluate(page, `window.__AETHER_WORKSPACE__.getState().hydrate(true)`);
  assert.ok(await waitFor(`!!document.querySelector('[data-workflow="${workflow.id}"]')`, 12000), 'workflow must render');

  await evaluate(page, `document.querySelector('[data-workflow="${workflow.id}"] [aria-label="Run history"], [data-workflow="${workflow.id}"] [aria-label="运行历史"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-run-events]')`), 'run ledger must render');
  await evaluate(page, `document.querySelector('[data-run-events] summary')?.click()`);
  await wait(300);
  const events = await evaluate(page, `[...document.querySelectorAll('[data-run-event]')].map((el) => el.innerText)`);
  assert.equal(events.length, 3, 'all events must render');
  assert.ok(events.join(' ').includes('list_issues'), 'tool event must be visible');
  assert.ok(events.join(' ').includes('Report complete'), 'final event must be visible');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-run-export="md"]') && !!document.querySelector('[data-run-export="json"]')`), 'both export actions must render');

  console.log('PASS browser: run events persist through the API and expand in the workflow history');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
  await fetch(`${base}/api/agent/workflows?id=${encodeURIComponent(workflowId ?? '')}`, { method: 'DELETE' }).catch(() => undefined);
}

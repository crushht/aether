// Workflow cancellation: a hung upstream run can be stopped and records canceled.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const mockPort = 9472;
let sockets = [];
const mock = http.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    // keep the request open long enough to cancel it
    const timer = setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: [DONE]\n\n');
    }, 60_000);
    res.on('close', () => clearTimeout(timer));
  });
});
mock.on('connection', (socket) => sockets.push(socket));
await new Promise((resolve) => mock.listen(mockPort, '127.0.0.1', resolve));

const chrome = await launch({ port: 9464, profile: path.join(process.env.TEMP || '.', `aether-wfcancel-${process.pid}`) });
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
  // Configure a local provider (no key needed) that points at the hanging mock.
  const config = await fetch(`${base}/api/agent/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providers: [{
        name: 'Cancel Mock',
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        models: ['mock-model'],
        defaultModel: 'mock-model',
        temperature: 0.1,
        maxSteps: 3,
        contextWindow: 32_000,
      }],
    }),
  });
  assert.ok(config.ok, 'provider config must save');

  const created = await fetch(`${base}/api/agent/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cancel fixture', prompt: 'Do something slow', maxSteps: 3 }),
  });
  const workflow = (await created.json()).workflow;
  assert.ok(workflow?.id, 'workflow must be created');

  page = await newPage(9464);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/workflows`, 5000);
  console.log('page loaded');
  assert.ok(await waitFor(`!!window.__AETHER_WORKSPACE__`), 'app must boot');
  await evaluate(page, `window.__AETHER_WORKSPACE__.getState().hydrate(true)`);
  assert.ok(await waitFor(`!!document.querySelector('[data-workflow="${workflow.id}"]')`, 12000), 'workflow card must render');
  console.log('workflow card visible');

  // Run it, wait for the Stop state, then cancel.
  await evaluate(page, `(() => {
    const card = document.querySelector('[data-workflow="${workflow.id}"]');
    const buttons = [...card.querySelectorAll('button')];
    const run = buttons.find((b) => (b.textContent || '').trim() === '运行' || (b.textContent || '').trim() === 'Run');
    if (run) { run.click(); return true; }
    return false;
  })()`);
  console.log('run clicked');
  assert.ok(await waitFor(`[...document.querySelectorAll('[data-workflow="${workflow.id}"] button')].some((b) => (b.textContent || '').includes('停止') || (b.textContent || '').includes('Stop'))`, 15000), 'run must enter the running state');
  console.log('running state visible');
  assert.ok(await waitFor(`!!document.querySelector('[data-workflow-progress]')`, 8000), 'progress line must render');
  const progressText = await evaluate(page, `document.querySelector('[data-workflow-progress]').innerText`);
  assert.ok(progressText.includes('第 1/') || progressText.includes('Step 1/'), `progress must show the step, got ${progressText}`);
  await evaluate(page, `[...document.querySelectorAll('[data-workflow="${workflow.id}"] button')].find((b) => (b.textContent || '').includes('停止') || (b.textContent || '').includes('Stop'))?.click()`);
  console.log('stop clicked');
  const canceledOk = await waitFor(`window.__AETHER_WORKSPACE__.getState().workflows.find((w) => w.id === '${workflow.id}')?.runs?.[0]?.status === 'canceled'`, 15000);
  if (!canceledOk) {
    console.log('DEBUG', await evaluate(page, `(() => {
      const w = window.__AETHER_WORKSPACE__.getState().workflows.find((x) => x.id === '${workflow.id}');
      return { runs: w?.runs?.slice(0, 3), running: window.__AETHER_VIEW__ ? null : null };
    })()`));
    throw new Error('run must be recorded as canceled');
  }
  console.log('cancel recorded');
  const run = await evaluate(page, `window.__AETHER_WORKSPACE__.getState().workflows.find((w) => w.id === '${workflow.id}')?.runs?.[0]`);
  assert.ok(Array.isArray(run.events) && run.events.length > 0, 'a canceled run must keep a trace');
  assert.ok(run.events.some((event) => event.kind === 'error' && String(event.text).includes('Canceled')), 'trace must record the cancellation');

  console.log('PASS browser: a hung workflow run is canceled and recorded as canceled');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
  for (const socket of sockets) socket.destroy();
  mock.close();
}

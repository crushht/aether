// The shell surfaces a dropped workspace stream instead of staying silently stale.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9513, profile: path.join(process.env.TEMP || '.', `aether-realtime-${process.pid}`) });
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
  page = await newPage(9513);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_REALTIME__`), 'realtime store must be exposed in dev');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-realtime-offline]')`), false, 'no banner while connected');

  await evaluate(page, `window.__AETHER_REALTIME__.setState({ connected: false })`);
  assert.ok(await waitFor(`!!document.querySelector('[data-realtime-offline]')`), 'banner must appear when the stream drops');

  await evaluate(page, `window.__AETHER_REALTIME__.setState({ connected: true })`);
  await wait(300);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-realtime-offline]')`), false, 'banner clears on reconnect');

  console.log('PASS browser: dropped workspace stream is visible and clears on reconnect');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

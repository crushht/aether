// Composer history: ArrowUp recalls recent prompts, ArrowDown walks forward.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9498, profile: path.join(process.env.TEMP || '.', `aether-chathist-${process.pid}`) });
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
const press = (key) => evaluate(page, `(() => {
  const el = document.querySelector('[data-agent-chat-input]');
  el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
})()`);
const valueOf = () => evaluate(page, `document.querySelector('[data-agent-chat-input]').value`);

try {
  page = await newPage(9498);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_CHAT_HISTORY__`), 'history store must exist');
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`!!document.querySelector('[data-agent-chat-input]')`), 'composer must render');

  await evaluate(page, `(() => {
    window.__AETHER_CHAT_HISTORY__.getState().clear();
    window.__AETHER_CHAT_HISTORY__.getState().push('first prompt');
    window.__AETHER_CHAT_HISTORY__.getState().push('second prompt');
  })()`);
  await wait(200);

  await press('ArrowUp');
  await wait(150);
  assert.equal(await valueOf(), 'second prompt', 'first ArrowUp recalls the newest prompt');
  await press('ArrowUp');
  await wait(150);
  assert.equal(await valueOf(), 'first prompt', 'second ArrowUp goes further back');
  await press('ArrowDown');
  await wait(150);
  assert.equal(await valueOf(), 'second prompt', 'ArrowDown walks forward again');
  await press('ArrowDown');
  await wait(150);
  assert.equal(await valueOf(), '', 'ArrowDown past the newest clears the composer');

  console.log('PASS browser: composer ArrowUp/ArrowDown walks prompt history');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// IME acceptance: Enter that confirms a composition must not submit.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9456, profile: path.join(process.env.TEMP || '.', `aether-ime-${process.pid}`) });
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
  page = await newPage(9456);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && !!window.__AETHER_AGENT__`), 'app must boot');

  // Agent input: a composing Enter keeps the draft; a plain Enter sends it.
  await evaluate(page, `document.querySelector('[data-agent-chat-entry]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-agent-chat-input]')`), 'agent input must exist');
  const before = await evaluate(page, `(() => {
    const sessions = window.__AETHER_AGENT__.getState().sessions;
    return Object.values(sessions).reduce((sum, session) => sum + session.log.length, 0);
  })()`);
  await evaluate(page, `(() => {
    const el = document.querySelector('[data-agent-chat-input]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, '你好世界');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  })()`);
  await wait(400);
  assert.equal(await evaluate(page, `document.querySelector('[data-agent-chat-input]').value`), '你好世界', 'composing Enter must not clear the draft');
  const afterCompose = await evaluate(page, `(() => {
    const sessions = window.__AETHER_AGENT__.getState().sessions;
    return Object.values(sessions).reduce((sum, session) => sum + session.log.length, 0);
  })()`);
  assert.equal(afterCompose, before, 'composing Enter must not start a run');

  await evaluate(page, `document.querySelector('[data-agent-chat-input]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(600);
  assert.equal(await evaluate(page, `document.querySelector('[data-agent-chat-input]').value`), '', 'a plain Enter sends and clears');

  // Inline composer: composing Enter must not create an issue.
  await evaluate(page, `document.querySelector('[aria-label="Close"], [aria-label="关闭"]')?.click()`);
  await wait(300);
  const issueCount = await evaluate(page, `window.__AETHER_DATA__.getState().issues.length`);
  await evaluate(page, `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))`);
  assert.ok(await waitFor(`!!document.querySelector('[data-inline-composer]')`), 'inline composer must open');
  await evaluate(page, `(() => {
    const el = document.querySelector('[data-inline-composer]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '组合输入标题');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  })()`);
  await wait(400);
  assert.equal(await evaluate(page, `window.__AETHER_DATA__.getState().issues.length`), issueCount, 'composing Enter must not create an issue');

  console.log('PASS browser: IME composition Enter is ignored by agent and inline composer inputs');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

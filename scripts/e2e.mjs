// Browser acceptance against an isolated local Aether dev server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';
const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const profile = path.join(process.env.TEMP || '.', `aether-e2e-${process.pid}`);
const chrome = await launch({ port: 9443, profile });
let page;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (expr, timeout = 15000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expr)) return true;
    await wait(250);
  }
  return false;
};
const type = async (selector, text) => evaluate(page, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
try {
  page = await newPage(9443);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5500);
  // wait until the auth gate finishes and the workspace shell is rendered
  const ready = await waitFor(`document.body.innerText.length > 100 && !document.body.innerText.includes('loading')`, 20000);
  if (!ready) {
    const state = await evaluate(page, `({ text: document.body.innerText.slice(0, 500), loading: !!document.querySelector('[aria-busy], .animate-spin') })`);
    throw new Error(`App did not finish loading: ${JSON.stringify(state)}`);
  }
  assert.equal(await evaluate(page, `document.documentElement.dataset.theme`), 'dark', 'dark is the default theme');
  // clear any leftover data so the empty state is deterministic
  await evaluate(page, `localStorage.clear(); sessionStorage.clear();`);
  await goto(page, `${base}/team/ENG`, 5500);
  await waitFor(`document.body.innerText.includes('还没有议题') || document.body.innerText.includes('No issues') || document.body.innerText.includes('Create issue')`, 10000);
  // open the inline composer via the C shortcut or the empty-state button
  let composerFound = await evaluate(page, `!!document.querySelector('[data-inline-composer]')`);
  if (!composerFound) {
    const emptyBtn = await evaluate(page, `(() => { const btn = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('创建议题') || el.textContent.includes('Create issue')); if (btn) { btn.click(); return true; } return false; })()`);
    if (emptyBtn) await wait(300);
    composerFound = await evaluate(page, `!!document.querySelector('[data-inline-composer]')`);
  }
  if (!composerFound) {
    await evaluate(page, `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))`);
    await wait(300);
    composerFound = await evaluate(page, `!!document.querySelector('[data-inline-composer]')`);
  }
  if (!composerFound) {
    // Log the current page state to debug why the composer is missing
    const pageState = await evaluate(page, `({ text: document.body.innerText.slice(0, 2000), html: document.body.innerHTML.slice(0, 5000) })`);
    console.log('Page state:', pageState);
    throw new Error('inline composer not found after trying empty-state button and C shortcut');
  }
  await wait(350);
  await evaluate(page, `(() => { const el = document.querySelector('[data-inline-composer]'); if (!el) throw new Error('inline composer missing'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'E2E reliability issue'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(page, `document.querySelector('[data-inline-composer]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(1200);
  assert.ok((await evaluate(page, 'document.body.innerText')).includes('E2E reliability issue'));
  await evaluate(page, `document.querySelector('[data-issue-row]')?.querySelector('[data-open-issue]')?.click()`);
  await wait(350);
  // Any visible issue title is a valid deep-link target.
  const row = await evaluate(page, `(() => { const el = document.querySelector('[data-issue-row]'); return el?.dataset.issueRow; })()`);
  if (row) await evaluate(page, `document.querySelector('[data-issue-row="${row}"]').click()`);
  await wait(400);
  assert.ok(new URL(await evaluate(page, 'location.href')).searchParams.has('issue'));
  const deepLink = await evaluate(page, 'location.href');
  await goto(page, deepLink, 1800);
  assert.ok(await evaluate(page, `!!document.querySelector('#issue-scroll')`));

  await evaluate(page, `document.querySelector('[data-agent-chat-entry]').click()`);
  await wait(800);
  // Verify the chat panel opened and has an active conversation
  const chatState = await evaluate(page, `({ open: !!document.querySelector('[data-agent-chat]'), input: !!document.querySelector('[data-agent-chat-input]'), active: window.__AETHER_DEBUG__?.useChats?.getState().activeId })`);
  console.log('Chat state:', chatState);
  await type('[data-agent-chat-input]', 'draft survives switching');
  await wait(600);
  // Verify draft was written
  const draftKeys = await evaluate(page, `Object.keys(localStorage).filter(k => k.includes('draft'))`);
  console.log('Draft keys after typing:', draftKeys);
  assert.ok(draftKeys.length > 0, 'draft must be written to localStorage');
  const firstChatId = draftKeys[0].split(':').pop();
  console.log('First chat draft key:', draftKeys[0]);
  // Create a second conversation through the real UI, then switch back.
  const newChatClicked = await evaluate(page, `(() => { const btn = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'New conversation' || el.getAttribute('aria-label') === '新会话'); if (btn) { btn.click(); return true; } return false; })()`);
  assert.ok(newChatClicked, 'new conversation button must exist');
  await wait(500);
  const chatCount = await evaluate(page, `document.querySelectorAll('[data-chat-id]').length`);
  assert.ok(chatCount >= 2, `expected two conversations, got ${chatCount}`);
  await type('[data-agent-chat-input]', 'another conversation');
  await wait(500);
  await evaluate(page, `document.querySelector('[data-chat-id="${firstChatId}"]').click()`);
  await wait(500);
  const debug = await evaluate(page, `({ active: window.__AETHER_DEBUG__?.useChats?.getState().activeId, drafts: Object.fromEntries(Object.keys(localStorage).filter(k => k.includes('draft')).map(k => [k, localStorage.getItem(k)])), value: document.querySelector('[data-agent-chat-input]').value })`);
  assert.equal(debug.value, 'draft survives switching', `draft not restored, got ${JSON.stringify(debug.value)}`);

  // A full reload must restore the most recent conversation with its own draft,
  // and the older conversation's draft must still be there when selected.
  await goto(page, `${base}/team/ENG`, 1200);
  await evaluate(page, `document.querySelector('[data-agent-chat-entry]').click()`);
  await wait(800);
  const afterReload = await evaluate(page, `document.querySelector('[data-agent-chat-input]').value`);
  assert.ok(['draft survives switching', 'another conversation'].includes(afterReload), `unexpected draft after reload: ${JSON.stringify(afterReload)}`);
  await evaluate(page, `document.querySelector('[data-chat-id="${firstChatId}"]').click()`);
  await wait(400);
  assert.equal(await evaluate(page, `document.querySelector('[data-agent-chat-input]').value`), 'draft survives switching');
  await shot(page, path.resolve('docs/checks/230-reliability-chat.png'));
  console.log('PASS browser: issue creation, canonical deep link, drawer reload, per-conversation drafts and reload');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

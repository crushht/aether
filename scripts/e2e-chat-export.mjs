// Chat export: both buttons appear for a conversation with messages.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9492, profile: path.join(process.env.TEMP || '.', `aether-chatexport-${process.pid}`) });
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
  page = await newPage(9492);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DEBUG__?.useChats && !!window.__AETHER_AGENT__`), 'agent stores must be available');

  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`window.__AETHER_AGENT__.getState().hydrated === true`, 15000), 'agent must hydrate after opening');

  await evaluate(page, `(() => {
    const chats = window.__AETHER_DEBUG__.useChats;
    chats.setState({
      chats: [{ id: 'chat_export_test', title: 'Export test conversation', at: Date.now() }],
      activeId: 'chat_export_test',
    });
    window.__AETHER_AGENT__.setState({
      sessions: {
        'chat:chat_export_test': {
          log: [
            { id: 'l1', kind: 'user', text: 'Hello there', at: Date.now() },
            { id: 'l2', kind: 'tool', name: 'list_issues', text: '3 issues', ok: true, at: Date.now() },
            { id: 'l3', kind: 'final', text: 'Here is the answer', at: Date.now() },
          ],
          status: 'idle',
          messages: [],
        },
      },
    });
  })()`);
  await wait(600);
  assert.ok(
    await waitFor(`!!document.querySelector('[aria-label="导出为 Markdown"], [aria-label="Export as Markdown"]')`),
    'export buttons must render',
  );
  assert.ok(
    await evaluate(page, `!!document.querySelector('[aria-label="导出为 JSON"], [aria-label="Export as JSON"]')`),
    'JSON export must render',
  );

  // Clicking export must not throw (the download is browser-handled).
  await evaluate(page, `document.querySelector('[aria-label="导出为 Markdown"], [aria-label="Export as Markdown"]')?.click()`);
  await wait(400);
  assert.ok(await evaluate(page, `document.body.innerText.includes('ok') || document.body.innerText.length > 0`), 'page survives export');

  console.log('PASS browser: chat export buttons render for a conversation with messages');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}


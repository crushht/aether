// Acceptance for documents: save an agent answer, edit, preview, persist.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9451, profile: path.join(process.env.TEMP || '.', `aether-docs-${process.pid}`) });
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
  page = await newPage(9451);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_AGENT__ && !!window.__AETHER_DEBUG__`), 'stores must boot');

  const chatId = await evaluate(page, `(() => {
    const chats = window.__AETHER_DEBUG__.useChats;
    const agent = window.__AETHER_AGENT__;
    const chat = chats.getState().newChat();
    chats.getState().rename(chat.id, 'Document source');
    const key = 'chat:' + chat.id;
    agent.setState((state) => ({ hydrated: true, sessions: { ...state.sessions, [key]: {
      targetId: key, status: 'done', messages: [], prompt: 'summarise', at: Date.now(),
      log: [{ id: 'final-doc', kind: 'final', text: '## Release plan\\n\\nShip the workspace improvements in two batches.', at: Date.now() }],
    } } }));
    return chat.id;
  })()`);
  await wait(300);

  await evaluate(page, `document.querySelector('[data-agent-chat-entry]').click()`);
  await wait(600);
  await evaluate(page, `window.__AETHER_DEBUG__.useChats.getState().select('${chatId}')`);
  await wait(500);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-save-document]')`), 'save-as-document action must render');
  await evaluate(page, `document.querySelector('[data-save-document]').click()`);
  assert.ok(await waitFor(`(window.__AETHER_DOCUMENTS__?.getState().documents?.length ?? 0) > 0`), 'document must be created');
  const doc = await evaluate(page, `window.__AETHER_DOCUMENTS__.getState().documents[0]`);
  assert.ok(doc.content.includes('Release plan'), 'document must carry the answer body');

  // The documents page renders the saved document and its editor.
  await goto(page, `${base}/documents`, 4000);
  assert.ok(await waitFor(`!!document.querySelector('[data-document-editor]')`), 'documents page must open the editor');
  assert.equal(await evaluate(page, `document.querySelector('[data-document-title]').value`), doc.title);
  assert.ok((await evaluate(page, `document.querySelector('[data-document-editor]').value`)).includes('Release plan'));

  // Edit and preview.
  await evaluate(page, `(() => {
    const editor = document.querySelector('[data-document-editor]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(editor, '## Revised plan\\n\\nBatch one only.');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(400);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '预览' || b.textContent.trim() === 'Preview')?.click()`);
  await wait(300);
  assert.ok(await evaluate(page, `document.body.innerText.includes('Revised plan')`), 'preview must render the edited Markdown');
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑' || b.textContent.trim() === 'Edit')?.click()`);

  // Reload: the edit is stored.
  await goto(page, `${base}/documents`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-document-editor]')`), 'editor must return after reload');
  assert.ok((await evaluate(page, `document.querySelector('[data-document-editor]').value`)).includes('Batch one only.'), 'edits must persist across reload');

  console.log('PASS browser: agent answer saves as document, edits and preview persist');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

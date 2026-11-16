// Acceptance for answer feedback: rating persists with the conversation.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9448, profile: path.join(process.env.TEMP || '.', `aether-feedback-${process.pid}`) });
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
  page = await newPage(9448);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_AGENT__ && !!window.__AETHER_DEBUG__`), 'stores must be ready');

  const chatId = await evaluate(page, `(() => {
    const chats = window.__AETHER_DEBUG__.useChats;
    const agent = window.__AETHER_AGENT__;
    const chat = chats.getState().newChat();
    const key = 'chat:' + chat.id;
    agent.setState((state) => ({ hydrated: true, sessions: { ...state.sessions, [key]: {
      targetId: key, status: 'done', messages: [], prompt: 'test', at: Date.now(),
      log: [{ id: 'final-1', kind: 'final', text: '这是一个可评价的回答。', at: Date.now() }],
    } } }));
    chats.getState().rename(chat.id, 'Feedback fixture');
    return chat.id;
  })()`);
  assert.ok(chatId, 'fixture conversation must be created');

  await evaluate(page, `document.querySelector('[data-agent-chat-entry]').click()`);
  await wait(600);
  // The fixture is the most recent conversation; make sure it is selected.
  await evaluate(page, `window.__AETHER_DEBUG__.useChats.getState().select('${chatId}')`);
  await wait(500);
  if (!(await evaluate(page, `!!document.querySelector('[data-feedback="up"]')`))) {
    console.log('DEBUG', await evaluate(page, `({
      panel: !!document.querySelector('[data-agent-chat]'),
      active: window.__AETHER_DEBUG__.useChats.getState().activeId,
      log: (window.__AETHER_AGENT__.getState().sessions['chat:' + window.__AETHER_DEBUG__.useChats.getState().activeId] || {}).log?.map((e) => e.kind),
      text: document.querySelector('[data-agent-chat]')?.innerText?.slice(0, 400),
    })`));
    throw new Error('feedback buttons must render on a final answer');
  }

  await evaluate(page, `document.querySelector('[data-feedback="up"]').click()`);
  await wait(500);
  assert.equal(await evaluate(page, `document.querySelector('[data-feedback="up"]').getAttribute('aria-pressed')`), 'true');
  const persisted = await evaluate(page, `(() => {
    const raw = localStorage.getItem('linear-lab:agent:sessions:local') || localStorage.getItem('linear-lab:agent:sessions:me') || '';
    return raw.includes('"feedback":"up"');
  })()`);
  assert.ok(persisted, 'feedback must be persisted in the local session snapshot');

  await evaluate(page, `document.querySelector('[data-feedback="up"]').click()`);
  await wait(400);
  assert.equal(await evaluate(page, `document.querySelector('[data-feedback="up"]').getAttribute('aria-pressed')`), 'false');

  console.log('PASS browser: answer feedback toggles and persists');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

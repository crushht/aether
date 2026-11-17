// The context budget explains itself: a cut turn says how many turns went, how
// heavy they were, and where the surviving window now starts.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9534, profile: path.join(process.env.TEMP || '.', `aether-budget-${process.pid}`) });
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

const now = Date.now();
const report = {
  applied: true,
  budget: 79_360,
  beforeTokens: 91_400,
  afterTokens: 48_200,
  totalMessages: 41,
  keptMessages: 22,
  droppedCount: 19,
  droppedTurns: 6,
  droppedTokens: 43_200,
  dropped: [
    { role: 'user', preview: 'the release checklist', tokens: 12_000 },
    { role: 'tool', preview: 'list_issues · 20 matches', tokens: 9_400 },
  ],
  keptFrom: 'summarise the cycle',
};
const log = [
  { id: 'l1', kind: 'user', text: 'summarise the cycle', at: now },
  { id: 'l2', kind: 'note', text: '上下文已裁剪：6 turn(s) · 19 message(s) · 43200 token(s)', compaction: report, at: now },
  { id: 'l3', kind: 'final', text: 'Cycle 42 is on track.', at: now },
];
const messages = [
  { role: 'system', content: 'system' },
  { role: 'user', content: 'summarise the cycle' },
];

try {
  page = await newPage(9534);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_AGENT__ && !!window.__AETHER_DEBUG__`), 'the stores must be exposed in dev');

  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`!!document.querySelector('[data-agent-chat-input]')`), 'the chat panel opens');
  assert.ok(await waitFor(`!!window.__AETHER_DEBUG__.useChats.getState().activeId`), 'a conversation exists');

  await evaluate(page, `(() => {
    const id = window.__AETHER_DEBUG__.useChats.getState().activeId;
    const key = 'chat:' + id;
    window.__AETHER_AGENT__.setState((state) => ({
      sessions: {
        ...state.sessions,
        [key]: {
          targetId: key, status: 'done', messages: ${JSON.stringify(messages)}, log: ${JSON.stringify(log)},
          prompt: 'summarise the cycle', at: Date.now(), pending: null, model: 'test-model', provider: 'test',
          usage: { promptTokens: 48_200, completionTokens: 900, steps: 3, tools: 2 },
        },
      },
      hydrated: true,
    }));
    window.__budgetKey = key;
  })()`);

  // --- the row itself -----------------------------------------------------
  assert.ok(await waitFor(`!!document.querySelector('[data-agent-note]')`), 'the cut is a row of its own');
  const noteText = await evaluate(page, `document.querySelector('[data-agent-note]').innerText`);
  assert.ok(noteText.includes('6'), `the row counts the turns, got: ${noteText}`);
  assert.ok(noteText.includes('19'), `the row counts the messages, got: ${noteText}`);
  assert.ok(noteText.includes('43200'), `the row counts the tokens, got: ${noteText}`);
  assert.equal(
    await evaluate(page, `!!document.querySelector('[data-agent-note]')?.closest('[data-agent-tool]')`),
    false,
    'the note is not buried inside a tool step',
  );

  // --- the detail behind the row -----------------------------------------
  const detail = await evaluate(page, `document.querySelector('[data-agent-note]').getAttribute('title')`);
  assert.ok(detail.includes('summarise the cycle'), `hovering names the surviving window, got: ${detail}`);
  assert.ok(detail.includes('the release checklist'), `hovering lists a dropped turn, got: ${detail}`);
  assert.ok(detail.includes('list_issues'), `hovering lists a dropped tool result, got: ${detail}`);

  // --- the meter ----------------------------------------------------------
  assert.equal(
    await evaluate(page, `document.querySelector('[data-context-trimmed]')?.getAttribute('data-context-trimmed')`),
    '6',
    'the meter shows how many turns were trimmed',
  );
  const meterTitle = await evaluate(page, `document.querySelector('[data-context-meter]').getAttribute('title')`);
  assert.ok(meterTitle.includes('6'), `the meter explains the cut, got: ${meterTitle}`);
  assert.ok(meterTitle.includes('summarise the cycle'), 'the meter says where the window starts');
  assert.ok(meterTitle.includes('48,200') || meterTitle.includes('48200'), `the meter still reports the live usage, got: ${meterTitle}`);

  // A conversation that never had to cut shows no mark.
  await evaluate(page, `(() => {
    const key = window.__budgetKey;
    const session = window.__AETHER_AGENT__.getState().sessions[key];
    window.__AETHER_AGENT__.setState((state) => ({
      sessions: {
        ...state.sessions,
        [key]: { ...session, log: session.log.filter((item) => item.kind !== 'note') },
      },
    }));
  })()`);
  assert.ok(await waitFor(`!document.querySelector('[data-agent-note]')`), 'the row disappears with the note');
  assert.equal(
    await evaluate(page, `!!document.querySelector('[data-context-trimmed]')`),
    false,
    'an untrimmed conversation shows no scissors',
  );

  await shot(page, 'docs/checks/269-context-budget.png', { width: 1440, height: 1000 });
  console.log('PASS browser: a trimmed context is a row with numbers, a hover detail and a meter mark');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

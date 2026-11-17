// Retrying one tool call in place: the row keeps its place, records the duration
// and the attempt, and the model's copy of the result changes with it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9533, profile: path.join(process.env.TEMP || '.', `aether-retry-${process.pid}`) });
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
// call-A fails now but works on replay (no filters = a workspace always answers).
// call-B fails for a real reason, so a replay has to stay failed.
// call-C was rejected by the person, which is a decision, not a failure.
const log = [
  { id: 'l1', kind: 'user', text: 'check the queue', at: now },
  {
    id: 'l2', kind: 'tool', text: 'Transport error', name: 'list_issues', ok: false,
    args: { limit: 3 }, callId: 'call-A', ms: 12, attempts: 1, at: now,
  },
  {
    id: 'l3', kind: 'tool', text: 'Issue NOPE-1 not found.', name: 'get_issue', ok: false,
    args: { key: 'NOPE-1' }, callId: 'call-B', ms: 3, attempts: 1, at: now,
  },
  {
    id: 'l4', kind: 'tool', text: 'Rejected by you', name: 'update_issue', ok: false,
    args: { key: 'ENG-1', status: 'done' }, callId: 'call-C', ms: 0, attempts: 1, at: now,
  },
  { id: 'l5', kind: 'assistant', text: 'Two lookups failed.', at: now },
  { id: 'l6', kind: 'final', text: 'Two lookups failed.', at: now },
];
// The model remembers the first failure as a tool message; the other two never
// made it into the history (an old transcript), which is the append path.
const messages = [
  { role: 'user', content: 'check the queue' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'call-A', name: 'list_issues', args: { limit: 3 } }] },
  { role: 'tool', toolCallId: 'call-A', content: 'Transport error' },
];

try {
  page = await newPage(9533);
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
          prompt: 'check the queue', at: Date.now(), pending: null, model: 'test-model', provider: 'test',
          usage: { promptTokens: 10, completionTokens: 5, steps: 1, tools: 3 },
        },
      },
      hydrated: true,
    }));
    window.__retryKey = key;
  })()`);

  assert.ok(await waitFor(`document.querySelectorAll('[data-agent-tool]').length === 3`), 'three tool rows render');

  // --- what the row offers ------------------------------------------------
  assert.equal(
    await evaluate(page, `document.querySelectorAll('[data-tool-retry]').length`),
    2,
    'only the two real failures offer a replay; the rejected write does not',
  );
  assert.equal(
    await evaluate(page, `!!document.querySelector('[data-agent-tool="update_issue"] [data-tool-retry]')`),
    false,
    'a rejected write stays rejected',
  );
  assert.equal(
    await evaluate(page, `document.querySelector('[data-agent-tool-ms="12"]')?.getAttribute('data-agent-tool-attempts')`),
    '1',
    'the injected row is a first attempt',
  );
  const firstMeta = await evaluate(page, `document.querySelector('[data-agent-tool="list_issues"] [data-tool-meta]').innerText`);
  assert.ok(firstMeta.includes('12 ms'), `the row shows how long the call took, got: ${firstMeta}`);

  // --- replay that succeeds ----------------------------------------------
  await evaluate(page, `document.querySelector('[data-agent-tool="list_issues"] [data-tool-retry]').click()`);
  assert.ok(
    await waitFor(`document.querySelector('[data-agent-tool="list_issues"]').getAttribute('data-agent-tool-attempts') === '2'`),
    'a replay is recorded as the second attempt',
  );
  const secondMeta = await evaluate(page, `document.querySelector('[data-agent-tool="list_issues"] [data-tool-meta]').innerText`);
  assert.ok(secondMeta.includes('#2'), `the attempt count is visible, got: ${secondMeta}`);
  assert.ok(!/…/.test(secondMeta), 'the status row is cleared once the retry settles');
  assert.equal(
    await evaluate(page, `!!document.querySelector('[data-agent-tool="list_issues"] [data-tool-retry]')`),
    false,
    'a successful replay no longer offers a retry',
  );
  const retriedMs = await evaluate(page, `Number(document.querySelector('[data-agent-tool="list_issues"]').getAttribute('data-agent-tool-ms'))`);
  assert.ok(retriedMs >= 0, `the replay measured its own duration, got: ${retriedMs}`);
  const retriedText = await evaluate(page, `document.querySelector('[data-agent-tool="list_issues"]').innerText`);
  assert.ok(!retriedText.includes('Transport error'), `the old receipt is gone, got: ${retriedText}`);

  // the model's copy follows the transcript
  const patched = await evaluate(page, `(() => {
    const messages = window.__AETHER_AGENT__.getState().sessions[window.__retryKey].messages;
    const row = messages.find((message) => message.role === 'tool' && message.toolCallId === 'call-A');
    return { count: messages.filter((message) => message.toolCallId === 'call-A').length, content: row?.content ?? '' };
  })()`);
  assert.equal(patched.count, 1, 'the replay rewrites the remembered result instead of adding a second one');
  assert.ok(!patched.content.includes('Transport error'), `the model no longer believes the call failed, got: ${patched.content}`);

  // --- replay that fails again -------------------------------------------
  await evaluate(page, `document.querySelector('[data-agent-tool="get_issue"] [data-tool-retry]').click()`);
  assert.ok(
    await waitFor(`document.querySelector('[data-agent-tool="get_issue"]').getAttribute('data-agent-tool-attempts') === '2'`),
    'a failed replay still counts as an attempt',
  );
  assert.equal(
    await evaluate(page, `!!document.querySelector('[data-agent-tool="get_issue"] [data-tool-retry]')`),
    true,
    'the row keeps offering the replay after a second failure',
  );
  const appended = await evaluate(page, `(() => {
    const messages = window.__AETHER_AGENT__.getState().sessions[window.__retryKey].messages;
    const row = messages.find((message) => message.role === 'tool' && message.toolCallId === 'call-B');
    return row ? row.content : null;
  })()`);
  assert.ok(appended && appended.includes('NOPE-1'), `a call missing from history is appended, got: ${appended}`);

  // --- persistence -------------------------------------------------------
  assert.ok(
    await waitFor(`(() => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index) || '';
        if (!key.startsWith('linear-lab:agent:sessions:')) continue;
        const raw = window.localStorage.getItem(key) || '';
        if (raw.includes('"attempts":2') && raw.includes('"callId":"call-A"')) return true;
      }
      return false;
    })()`, 8000),
    'the retried row is written back with the session',
  );

  await shot(page, 'docs/checks/268-tool-retry.png', { width: 1440, height: 1000 });
  console.log('PASS browser: a failed tool call is replayed in place, records the attempt and rewrites the model copy');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

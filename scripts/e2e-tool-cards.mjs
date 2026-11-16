// Tool receipts: web_search hit cards and inspect_artifact reports expand inside
// the transcript, the hashes are copyable, and a malformed card degrades to the
// plain one-line row.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9531, profile: path.join(process.env.TEMP || '.', `aether-cards-${process.pid}`) });
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

const SHA = 'a'.repeat(64);
const MD5 = 'b'.repeat(32);
const searchCard = {
  kind: 'search',
  query: 'next.js streaming',
  source: 'duckduckgo',
  hits: [
    { title: 'Streaming docs', url: 'https://nextjs.org/docs/streaming', snippet: 'Server components stream.' },
    { title: 'Second hit', url: 'https://example.com/two', snippet: '' },
  ],
};
const inspectCard = {
  kind: 'inspect',
  name: 'sample.exe',
  size: 4096,
  format: 'PE executable',
  formatId: 'pe',
  detail: 'x64 · console',
  sha256: SHA,
  md5: MD5,
  entropy: 7.35,
  packed: true,
  structure: ['PE x64 · console · 1 section(s)'],
  indicators: [
    { kind: 'command', value: 'powershell -enc AAAA' },
    { kind: 'url', value: 'https://evil.example/x' },
  ],
  embedded: [{ kind: 'base64', bytes: 20, format: 'GZIP' }],
  notes: ['Command strings are present'],
  strings: ['powershell -enc AAAA', 'VirtualAlloc'],
  stringTotal: 42,
  hex: ['00000000  4d 5a'],
};
const now = Date.now();
const log = [
  { id: 'l1', kind: 'user', text: 'what does this sample do?', at: now },
  { id: 'l2', kind: 'tool', text: '2 条网页结果', name: 'web_search', ok: true, args: { query: 'next.js streaming' }, card: searchCard, at: now },
  { id: 'l3', kind: 'tool', text: 'PE executable · entropy 7.35', name: 'inspect_artifact', ok: true, args: { issue: 'ENG-1' }, card: inspectCard, at: now },
  { id: 'l4', kind: 'tool', text: 'ENG-1 [todo] Fix it', name: 'get_issue', ok: true, args: { key: 'ENG-1' }, at: now },
  { id: 'l5', kind: 'tool', text: '8 条网页结果', name: 'web_search', ok: true, args: { query: 'broken' }, card: { kind: 'search' }, at: now },
  { id: 'l6', kind: 'assistant', text: 'It is a packed sample.', at: now },
];

try {
  page = await newPage(9531);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_AGENT__ && !!window.__AETHER_DEBUG__`), 'agent store must be exposed in dev');

  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))`);
  assert.ok(await waitFor(`!!document.querySelector('[data-agent-chat-input]')`), 'the chat panel must open');
  assert.ok(await waitFor(`!!window.__AETHER_DEBUG__.useChats.getState().activeId`), 'a conversation must exist');

  // Inject a finished run carrying both cards, plus a row the guard must reject.
  await evaluate(page, `(() => {
    const chats = window.__AETHER_DEBUG__.useChats.getState();
    const id = chats.activeId;
    const key = 'chat:' + id;
    const log = ${JSON.stringify(log)};
    window.__AETHER_AGENT__.setState((state) => ({
      sessions: {
        ...state.sessions,
        [key]: {
          targetId: key, status: 'done', messages: [], log, prompt: 'what does this sample do?',
          at: Date.now(), pending: null, model: 'test-model', provider: 'test',
          usage: { promptTokens: 10, completionTokens: 5, steps: 2, tools: 3 },
        },
      },
      hydrated: true,
    }));
  })()`);

  assert.ok(await waitFor(`document.querySelectorAll('[data-agent-tool-card]').length === 2`), 'two rows must render as cards');
  assert.equal(
    await evaluate(page, `document.querySelectorAll('[data-agent-tool="web_search"][data-agent-tool-card]').length`),
    1,
    'a malformed card must fall back to the plain row',
  );
  assert.equal(
    await evaluate(page, `document.querySelectorAll('[data-agent-tool="get_issue"][data-agent-tool-card]').length`),
    0,
    'a card-less tool row must stay a plain row',
  );

  // --- search card -------------------------------------------------------
  const searchHead = await evaluate(page, `document.querySelector('[data-agent-tool-card="search"] > button').innerText`);
  assert.ok(searchHead.includes('next.js streaming'), `the header shows the query, got: ${searchHead}`);
  assert.ok(searchHead.includes('2'), 'the header shows the hit count');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-tool-card="search"]')`), false, 'cards start collapsed');

  await evaluate(page, `document.querySelector('[data-agent-tool-card="search"] > button').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-tool-card="search"]')`), 'the hit list expands');
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-tool-hit]').length`), 2);
  const firstHit = await evaluate(page, `(() => {
    const link = document.querySelector('[data-tool-hit="0"]');
    return { tag: link.tagName, href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel'), text: link.innerText };
  })()`);
  assert.equal(firstHit.tag, 'A', 'a hit with an http URL is a link');
  assert.equal(firstHit.href, 'https://nextjs.org/docs/streaming');
  assert.equal(firstHit.target, '_blank');
  assert.ok(firstHit.rel.includes('noopener'), 'outbound links must not hand over the opener');
  assert.ok(firstHit.text.includes('nextjs.org'), 'the host is shown under the title');
  assert.ok(firstHit.text.includes('Server components stream.'), 'the snippet is shown');

  await evaluate(page, `document.querySelector('[data-agent-tool-card="search"] > button').click()`);
  assert.ok(await waitFor(`!document.querySelector('[data-tool-card="search"]')`), 'the hit list collapses again');

  // --- inspect card ------------------------------------------------------
  await evaluate(page, `document.querySelector('[data-agent-tool-card="inspect"] > button').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-tool-card="inspect"]')`), 'the report panel expands');
  const report = await evaluate(page, `document.querySelector('[data-tool-card="inspect"]').innerText`);
  assert.ok(report.includes('PE executable'), `the format is shown, got: ${report}`);
  assert.ok(report.includes('7.35'), 'the entropy is shown');
  assert.ok(report.includes(SHA), 'the sha256 is shown');
  assert.ok(report.includes(MD5), 'the md5 is shown');
  assert.ok(report.includes('command'), 'indicators are listed with their kind');
  assert.ok(report.includes('GZIP'), 'embedded payloads are listed');
  assert.ok(report.includes('Command strings are present'), 'notes are listed');
  assert.ok(report.includes('VirtualAlloc'), 'strings are listed');
  assert.ok(report.includes('2 / 42'), 'the card says how many strings were clipped');

  // --- copy the hash -----------------------------------------------------
  await evaluate(page, `(() => {
    window.__copied = null;
    navigator.clipboard.writeText = (value) => { window.__copied = value; return Promise.resolve(); };
  })()`);
  await evaluate(page, `document.querySelector('[data-copy-value="sha256"]').click()`);
  assert.ok(await waitFor(`window.__copied === ${JSON.stringify(SHA)}`), 'the sha256 reaches the clipboard');
  const copyLabel = await evaluate(page, `document.querySelector('[data-copy-value="sha256"]').innerText`);
  assert.ok(copyLabel.includes('已复制'), `the button confirms the copy, got: ${copyLabel}`);

  // --- persistence -------------------------------------------------------
  // Any store action writes the transcript back; a thumb on the answer is the
  // cheapest real one. Injected state alone would never reach storage.
  await evaluate(page, `(() => {
    const id = window.__AETHER_DEBUG__.useChats.getState().activeId;
    window.__AETHER_AGENT__.getState().setFeedback('chat:' + id, 'l6', 'up');
  })()`);
  assert.ok(
    await waitFor(`(() => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index) || '';
        if (!key.startsWith('linear-lab:agent:sessions:')) continue;
        const raw = window.localStorage.getItem(key) || '';
        if (raw.includes('"kind":"inspect"') && raw.includes('"kind":"search"')) return true;
      }
      return false;
    })()`, 8000),
    'the cards are written back with the session',
  );

  // A screenshot with both bodies open, for the docs.
  await evaluate(page, `document.querySelector('[data-agent-tool-card="search"] > button').click()`);
  await wait(400);
  await shot(page, 'docs/checks/263-agent-tool-cards.png', { width: 1440, height: 1000 });

  console.log('PASS browser: search hits and artifact reports expand in the transcript, hashes copy, bad cards degrade');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

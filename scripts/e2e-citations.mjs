// Answer sources: the bubble cites what the tools actually opened.
//
// The model never writes these links; they come from the run's tool receipts.
// A fixture session is enough to prove the rendering: seed it into the agent
// store, open the issue, and check the chips (one page, one knowledge entry).
//
//   $env:AUTH_DISABLED='1'; $env:LAB_DATA_DIR='.e2e-data'; npm run dev
//   node scripts/e2e-citations.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';

const workspace = await (await fetch(`${base}/api/workspace`)).json();
const issue = (workspace.issues ?? []).find((row) => /^[A-Z]+-\d+$/.test(row.key ?? ''));
assert.ok(issue, 'the fixture workspace needs at least one issue');
const team = issue.key.split('-')[0];

const session = [
  {
    targetId: issue.id,
    status: 'done',
    messages: [],
    prompt: 'where is the checklist?',
    at: Date.now(),
    log: [
      {
        id: 'fixture-final',
        kind: 'final',
        text: 'The release checklist lives in the knowledge base; the docs page has the same steps.',
        sources: [
          { kind: 'knowledge', title: 'Release checklist', ref: 'k12#3' },
          { kind: 'web', title: 'Linear docs', url: 'https://linear.app/docs' },
        ],
        at: Date.now(),
      },
    ],
  },
];

const chrome = await launch({ port: 9501, profile: path.join(process.env.TEMP || '.', `aether-cite-${process.pid}`) });
let page = null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (expression, timeout = 12_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expression)) return true;
    await wait(200);
  }
  return false;
};

try {
  page = await newPage(9501);
  await viewport(page, 1280, 900);
  await goto(page, `${base}/team/${team}`, 3500);

  // Seed the agent store for both plausible account keys, then reload so the
  // panel hydrates from storage exactly as it does for a real session.
  const payload = JSON.stringify(JSON.stringify(session));
  await evaluate(
    page,
    `(() => {
      const value = ${payload};
      for (const key of ['me', 'local']) {
        window.localStorage.setItem('linear-lab:agent:sessions:' + key, value);
      }
      return true;
    })()`,
  );
  await goto(page, `${base}/team/${team}`, 4000);

  assert.ok(
    await waitFor(`!!document.querySelector('[data-issue-row="${issue.id}"]')`),
    'the issue row renders',
  );
  await evaluate(page, `document.querySelector('[data-issue-row="${issue.id}"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-agent-panel]')`), 'the agent panel opens');
  assert.ok(await waitFor(`!!document.querySelector('[data-citations]')`), 'the answer lists its sources');

  const web = await evaluate(
    page,
    `(() => {
      const link = document.querySelector('[data-citations] a[data-citation="web"]');
      return link ? { href: link.getAttribute('href'), target: link.getAttribute('target') } : null;
    })()`,
  );
  assert.deepEqual(web, { href: 'https://linear.app/docs', target: '_blank' }, 'the page is a real external link');

  const knowledge = await evaluate(
    page,
    `document.querySelector('[data-citations] a[data-citation="knowledge"]')?.getAttribute('href') ?? ''`,
  );
  assert.equal(knowledge, '/knowledge?id=k12', 'the knowledge chip deep-links to the entry');

  const count = await evaluate(page, `document.querySelectorAll('[data-citations] a').length`);
  assert.equal(count, 2, 'both sources are rendered once');

  await shot(page, process.env.AETHER_CITE_SHOT || path.join(process.env.TEMP || '.', 'aether-citations.png'));
  console.log('PASS browser: final answer cites the knowledge entry and the page it used');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

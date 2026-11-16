// Knowledge import: files become entries, oversized files are skipped.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9489, profile: path.join(process.env.TEMP || '.', `aether-kimport-${process.pid}`) });
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

try {
  page = await newPage(9489);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/knowledge`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_WORKSPACE__`), 'app must boot');
  assert.ok(await waitFor(`!!document.querySelector('input[type="file"][multiple]')`), 'import input must exist');

  const tag = `Import${Date.now()}`;
  const before = await evaluate(page, `window.__AETHER_WORKSPACE__.getState().knowledge.length`);
  await evaluate(page, `(() => {
    const input = document.querySelector('input[type="file"][multiple]');
    const dt = new DataTransfer();
    dt.items.add(new File(['# Notes\\n\\nRelease checklist'], '${tag}-notes.md', { type: 'text/markdown' }));
    dt.items.add(new File(['plain text body'], '${tag}-data.txt', { type: 'text/plain' }));
    dt.items.add(new File(['x'.repeat(600000)], '${tag}-huge.txt', { type: 'text/plain' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  assert.ok(
    await waitFor(`window.__AETHER_WORKSPACE__.getState().knowledge.filter((item) => item.title.startsWith('${tag}')).length >= 2`, 20000),
    'two files must be imported',
  );
  const items = await evaluate(page, `window.__AETHER_WORKSPACE__.getState().knowledge.filter((item) => item.title.startsWith('${tag}'))`);
  assert.equal(items.length, 2, 'oversized file must be skipped');
  const notes = items.find((item) => item.title.endsWith('notes'));
  assert.ok(notes && notes.kind === 'file', 'kind must be file');
  assert.ok(notes.content.includes('Release checklist'), 'content must be stored');
  assert.ok(notes.tags.includes('imported'), 'imported tag must be set');
  assert.equal(await evaluate(page, `window.__AETHER_WORKSPACE__.getState().knowledge.length`), before + 2);

  console.log('PASS browser: knowledge imports files and skips oversized ones');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

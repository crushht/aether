// Comment image attachments open the shared lightbox.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9511, profile: path.join(process.env.TEMP || '.', `aether-comment-lightbox-${process.pid}`) });
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
  page = await newPage(9511);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const issueId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const issue = data.getState().createIssue({ title: 'Comment lightbox issue', status: 'todo' });
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    data.getState().addComment(issue.id, 'me', 'Screenshot attached', [{ id: 'catt1', name: 'comment.png', mime: 'image/png', size: 100, dataUrl: png, uploaderId: 'me', createdAt: new Date().toISOString() }]);
    return issue.id;
  })()`);
  await wait(600);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('[data-comment-attachments] button')`), 'comment attachment must render');

  await evaluate(page, `document.querySelector('[data-comment-attachments] button')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-attachment-lightbox]')`), 'lightbox must open');
  await evaluate(page, `document.querySelector('[data-attachment-lightbox]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(200);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-attachment-lightbox]')`), false, 'Escape closes it');

  console.log('PASS browser: comment image attachments open the shared lightbox');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

// Paste an image into the description: it becomes an issue attachment.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9465, profile: path.join(process.env.TEMP || '.', `aether-paste-${process.pid}`) });
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
  page = await newPage(9465);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const issueId = await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'Paste fixture', status: 'todo' }).id`);
  await wait(600);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll')`), 'drawer must open');

  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('添加描述') || (b.textContent || '').includes('Add a description'))?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('#desc-editor')`), 'description editor must open');

  const result = await evaluate(page, `(async () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'pasted.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: dt });
    const editor = document.querySelector('#desc-editor');
    editor.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(result, true, 'the paste must be intercepted');

  assert.ok(await waitFor(`(window.__AETHER_DATA__.getState().issues.find((i) => i.id === '${issueId}')?.attachments?.length ?? 0) === 1`, 8000), 'pasted image must be added as an attachment');
  const attachment = await evaluate(page, `window.__AETHER_DATA__.getState().issues.find((i) => i.id === '${issueId}').attachments[0]`);
  assert.equal(attachment.name, 'pasted.png');
  assert.ok(attachment.dataUrl?.startsWith('data:image/png'), 'image bytes must be stored');
  assert.ok(await waitFor(`!!document.querySelector('[data-issue-attachments]')`), 'attachment section must render');
  const html = await evaluate(page, `document.querySelector('#desc-editor')?.innerHTML ?? ''`);
  assert.ok(!html.includes('base64'), 'image data must not be pasted into the description text');

  console.log('PASS browser: pasting an image into the description stores it as an attachment');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

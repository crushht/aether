// Comment composer: pasting an image adds a draft attachment.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9500, profile: path.join(process.env.TEMP || '.', `aether-comment-paste-${process.pid}`) });
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
  page = await newPage(9500);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const issueId = await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'Comment paste fixture', status: 'todo' }).id`);
  await wait(600);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll textarea')`), 'comment box must render');

  const prevented = await evaluate(page, `(() => {
    const areas = [...document.querySelectorAll('#issue-scroll textarea')];
    const area = areas[areas.length - 1];
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'comment-paste.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: dt });
    area.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(prevented, true, 'the image paste must be intercepted');

  assert.ok(await waitFor(`!!document.querySelector('[data-comment-attachment-drafts]')`), 'attachment draft chip must render');
  const draftText = await evaluate(page, `document.querySelector('[data-comment-attachment-drafts]').innerText`);
  assert.ok(draftText.includes('comment-paste.png') || draftText.includes('KB'), `draft must list the image: ${draftText}`);

  console.log('PASS browser: pasting an image into the comment box adds a draft attachment');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

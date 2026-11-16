// Attachments: "download all" clicks one anchor per file.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9501, profile: path.join(process.env.TEMP || '.', `aether-download-all-${process.pid}`) });
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
  page = await newPage(9501);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const issueId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const issue = data.getState().createIssue({ title: 'Attachments fixture', status: 'todo' });
    for (let index = 1; index <= 3; index += 1) {
      data.getState().addAttachment(issue.id, {
        id: 'att_' + index,
        name: 'file-' + index + '.txt',
        size: 12,
        type: 'text/plain',
        text: 'attachment ' + index,
      });
    }
    return issue.id;
  })()`);
  await wait(600);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('[data-issue-attachments]')`), 'attachments must render');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-download-all]')`), 'download-all must render');

  await evaluate(page, `(() => {
    window.__downloads = 0;
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched() {
      window.__downloads += 1;
      if (this.download) return;
      return original.call(this);
    };
  })()`);
  await evaluate(page, `document.querySelector('[data-download-all]')?.click()`);
  await wait(1000);
  assert.equal(await evaluate(page, `window.__downloads`), 3, 'one download per attachment');

  console.log('PASS browser: download-all triggers one download per attachment');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

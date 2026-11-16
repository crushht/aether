// Oversized attachments are refused with an explanation.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9508, profile: path.join(process.env.TEMP || '.', `aether-attach-large-${process.pid}`) });
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
  page = await newPage(9508);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const projectId = await evaluate(page, `window.__AETHER_DATA__.getState().createProject({ name: 'Large attachment project' }).id`);
  await wait(700);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-update-file]')`), 'attachment input must render');

  await evaluate(page, `(() => {
    const input = document.querySelector('[data-project-update-file]');
    const dt = new DataTransfer();
    dt.items.add(new File(['x'.repeat(300000)], 'too-large.txt', { type: 'text/plain' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.ok(
    await waitFor(`document.body.innerText.includes('跳过 1 个文件') || document.body.innerText.includes('Skipped 1 files')`),
    'the refusal must be explained',
  );
  assert.equal(await evaluate(page, `!!document.querySelector('[data-project-update-files]')`), false, 'nothing may be staged');

  console.log('PASS browser: oversized update attachments are refused with a reason');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

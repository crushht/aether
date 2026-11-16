// Project update attachments are capped at five, with a visible warning.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9504, profile: path.join(process.env.TEMP || '.', `aether-update-limit-${process.pid}`) });
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
  page = await newPage(9504);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const projectId = await evaluate(page, `window.__AETHER_DATA__.getState().createProject({ name: 'Attachment limit project' }).id`);
  await wait(700);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-update-file]')`), 'attachment input must render');

  await evaluate(page, `(() => {
    const input = document.querySelector('[data-project-update-file]');
    const dt = new DataTransfer();
    for (let index = 1; index <= 6; index += 1) {
      dt.items.add(new File(['body ' + index], 'file-' + index + '.txt', { type: 'text/plain' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.ok(await waitFor(`document.querySelectorAll('[data-project-update-files] span').length === 5`), 'only five files are staged');
  assert.ok(
    await waitFor(`document.body.innerText.includes('最多 5 个附件') || document.body.innerText.includes('Up to 5 attachments')`),
    'the cap must be explained',
  );

  console.log('PASS browser: update attachments are capped at five with a warning');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

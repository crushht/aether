// Project updates can carry attachments.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9503, profile: path.join(process.env.TEMP || '.', `aether-update-files-${process.pid}`) });
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
  page = await newPage(9503);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const projectId = await evaluate(page, `window.__AETHER_DATA__.getState().createProject({ name: 'Attachment update project' }).id`);
  await wait(700);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-update-file]')`), 'attachment input must render');

  await evaluate(page, `(() => {
    const input = document.querySelector('[data-project-update-file]');
    const dt = new DataTransfer();
    dt.items.add(new File(['notes body'], 'notes.txt', { type: 'text/plain' }));
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.ok(await waitFor(`document.querySelectorAll('[data-project-update-files] span').length === 2`), 'both files must be staged');

  await evaluate(page, `(() => {
    const el = document.querySelector('[data-project-update-input]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, 'Update with **files**');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(200);
  await evaluate(page, `document.querySelector('[data-project-update-submit]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-update-attachments]')`), 'attachments must render on the update');

  const stored = await evaluate(page, `(() => {
    const project = window.__AETHER_DATA__.getState().projects.find((p) => p.id === '${projectId}');
    return project.updates[0].attachments.map((file) => ({ name: file.name, size: file.size, hasData: Boolean(file.dataUrl || file.text) }));
  })()`);
  assert.equal(stored.length, 2);
  assert.ok(stored.every((file) => file.hasData && file.size > 0));

  console.log('PASS browser: project updates store and render attachments');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

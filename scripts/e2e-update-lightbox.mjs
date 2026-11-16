// Image attachments in project updates open a lightbox.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9507, profile: path.join(process.env.TEMP || '.', `aether-lightbox-${process.pid}`) });
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
  page = await newPage(9507);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Lightbox project' });
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    data.setState((state) => ({
      projects: state.projects.map((item) => item.id === project.id ? {
        ...item,
        updates: [{
          id: 'upd_lightbox', body: 'Screenshot attached', authorId: 'me', createdAt: new Date().toISOString(),
          attachments: [
            { id: 'att_lightbox', name: 'shot.png', mime: 'image/png', size: 100, uploaderId: 'me', createdAt: new Date().toISOString(), dataUrl: png },
            { id: 'att_lightbox_2', name: 'shot-2.png', mime: 'image/png', size: 100, uploaderId: 'me', createdAt: new Date().toISOString(), dataUrl: png },
          ],
        }],
      } : item),
    }));
    return project.id;
  })()`);
  await wait(700);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-update-attachments] button')`), 'attachment must render');

  await evaluate(page, `document.querySelector('[data-update-attachments] button')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-attachment-lightbox]')`), 'lightbox must open');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-attachment-lightbox] img')`), 'lightbox must show the image');
  assert.ok((await evaluate(page, `document.querySelector('[data-attachment-lightbox]').innerText`)).includes('1 / 2'), 'counter must start at one');
  await evaluate(page, `document.querySelector('[data-attachment-lightbox]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await wait(200);
  assert.ok((await evaluate(page, `document.querySelector('[data-attachment-lightbox]').innerText`)).includes('2 / 2'), 'ArrowRight must advance');

  await evaluate(page, `document.querySelector('[data-attachment-lightbox]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(200);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-attachment-lightbox]')`), false, 'Escape closes the lightbox');

  console.log('PASS browser: update image attachments open a lightbox and close with Escape');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}


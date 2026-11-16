// Large images are downscaled before they enter the workspace snapshot.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9514, profile: path.join(process.env.TEMP || '.', `aether-compress-${process.pid}`) });
let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, timeout = 20000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expr)) return true;
    await wait(250);
  }
  return false;
};

try {
  page = await newPage(9514);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const projectId = await evaluate(page, `window.__AETHER_DATA__.getState().createProject({ name: 'Compression project' }).id`);
  await wait(600);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-update-file]')`), 'input must render');

  const diagnostics = await evaluate(page, `(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    const image = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.floor(Math.random() * 255);
      image.data[i + 1] = Math.floor(Math.random() * 255);
      image.data[i + 2] = Math.floor(Math.random() * 255);
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    window.__originalBytes = blob.size;
    const input = document.querySelector('[data-project-update-file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'big.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { original: blob.size };
  })()`);
  console.log('fixture', diagnostics);

  const stagedOk = await waitFor(`!!document.querySelector('[data-project-update-files] span')`, 30000);
  if (!stagedOk) {
    console.log('toast:', await evaluate(page, `document.body.innerText.slice(0, 400)`));
    throw new Error('image was not staged');
  }
  const original = await evaluate(page, `window.__originalBytes`);
  const staged = await evaluate(page, `document.querySelector('[data-project-update-files] span').innerText`);
  assert.ok(original > 400000, `fixture should be large (got ${original})`);
  assert.ok(staged.includes('webp'), `staged file must be re-encoded: ${staged}`);

  console.log(`PASS browser: ${Math.round(original / 1024)}KB PNG re-encoded before staging (${staged.trim()})`);
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

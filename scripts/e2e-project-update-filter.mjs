// "With attachments" narrows the update timeline.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9509, profile: path.join(process.env.TEMP || '.', `aether-update-filter-${process.pid}`) });
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
  page = await newPage(9509);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');
  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Filter attachments project' });
    const now = new Date().toISOString();
    data.setState((state) => ({
      projects: state.projects.map((item) => item.id === project.id ? {
        ...item,
        updates: [
          { id: 'upd_plain', body: 'No files here', authorId: 'me', createdAt: now },
          { id: 'upd_files', body: 'With a file', authorId: 'me', createdAt: now, attachments: [{ id: 'att1', name: 'a.txt', mime: 'text/plain', size: 5, text: 'hello', uploaderId: 'me', createdAt: now }] },
        ],
      } : item),
    }));
    return project.id;
  })()`);
  await wait(700);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`document.querySelectorAll('[data-project-update]').length === 2`), 'both updates must render');

  await evaluate(page, `document.querySelector('[data-update-filter="attachments"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 1, 'filter must narrow to one update');
  assert.ok((await evaluate(page, `document.querySelector('[data-project-update]').innerText`)).includes('With a file'));

  await evaluate(page, `document.querySelector('[data-update-filter="attachments"]')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `document.querySelectorAll('[data-project-update]').length`), 2, 'toggling restores both');

  console.log('PASS browser: the attachments filter narrows and restores updates');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

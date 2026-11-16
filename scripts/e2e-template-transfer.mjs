// Template export/import: a bundle file imports both template kinds.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9474, profile: path.join(process.env.TEMP || '.', `aether-tpl-transfer-${process.pid}`) });
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
  page = await newPage(9474);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/templates`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-template-import]')`), 'template settings must render');
  assert.ok(await evaluate(page, `[...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('导出模板') || (b.textContent || '').includes('Export templates'))`), 'export action must render');

  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    issueTemplates: [{
      name: 'Imported issue template', title: 'Imported issue title', description: 'from a file',
      status: 'in_progress', priority: 'high', labelIds: [], projectId: null, estimate: 2, createdAt: 1,
    }],
    projectTemplates: [{
      name: 'Imported project template', summary: 'Imported summary', agentInstructions: 'Keep it small',
      knowledgeIds: [], health: 'at_risk', createdAt: 1,
    }],
  };

  const before = await evaluate(page, `({
    issues: window.__AETHER_TEMPLATES__.getState().templates.length,
    projects: window.__AETHER_PROJECT_TEMPLATES__.getState().templates.length,
  })`);
  await evaluate(page, `(() => {
    const input = document.querySelector('[data-template-import]');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(JSON.stringify(bundle))}], 'templates.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  assert.ok(await waitFor(`window.__AETHER_TEMPLATES__.getState().templates.some((t) => t.name === 'Imported issue template')`, 8000), 'issue template must import');
  assert.ok(await waitFor(`window.__AETHER_PROJECT_TEMPLATES__.getState().templates.some((t) => t.name === 'Imported project template')`, 8000), 'project template must import');
  assert.ok(await waitFor(`document.body.innerText.includes('Imported issue template') && document.body.innerText.includes('Imported project template')`), 'imported templates must render');

  const after = await evaluate(page, `({
    issues: window.__AETHER_TEMPLATES__.getState().templates.length,
    projects: window.__AETHER_PROJECT_TEMPLATES__.getState().templates.length,
  })`);
  assert.equal(after.issues, before.issues + 1);
  assert.equal(after.projects, before.projects + 1);

  // Re-importing the same bundle must not duplicate by name+title.
  await evaluate(page, `(() => {
    const input = document.querySelector('[data-template-import]');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(JSON.stringify(bundle))}], 'templates.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(800);
  const again = await evaluate(page, `window.__AETHER_TEMPLATES__.getState().templates.filter((t) => t.name === 'Imported issue template').length`);
  assert.equal(again, 1, 're-import must not duplicate');

  console.log('PASS browser: template bundle imports both kinds and skips duplicates');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

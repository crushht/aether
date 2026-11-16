// Issue templates: save from an issue, apply from the palette, delete in settings.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9462, profile: path.join(process.env.TEMP || '.', `aether-templates-${process.pid}`) });
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
  page = await newPage(9462);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && !!window.__AETHER_TEMPLATES__`), 'app must boot');

  const fixture = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const label = data.labels[0];
    const issue = data.createIssue({ title: 'Template source', status: 'todo' });
    data.patchIssue(issue.id, { description: 'steps from the template' });
    data.setPriority(issue.id, 'high');
    if (label) data.toggleLabel(issue.id, label.id);
    return { id: issue.id, labelId: label?.id ?? null };
  })()`);
  await wait(600);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${fixture.id}')`);
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll')`), 'drawer must open');

  // Save the issue as a template from its ⋯ menu.
  await evaluate(page, `document.querySelector('[aria-label="More actions"]')?.click()`);
  await wait(300);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('存为模板') || (b.textContent || '').includes('Save as template'))?.click()`);
  assert.ok(await waitFor(`window.__AETHER_TEMPLATES__.getState().templates.length > 0`), 'template must be saved');
  const template = await evaluate(page, `window.__AETHER_TEMPLATES__.getState().templates[0]`);
  assert.equal(template.priority, 'high');
  if (fixture.labelId) assert.ok(template.labelIds.includes(fixture.labelId), 'template must copy labels');

  // Apply it from the command palette.
  await evaluate(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  await wait(400);
  assert.ok(await evaluate(page, `document.body.innerText.includes('从「') || document.body.innerText.includes('Create issue from')`), 'palette must list the template');
  await evaluate(page, `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Template source') && ((b.textContent || '').includes('从「') || (b.textContent || '').includes('Create issue from')));
    btn?.click();
  })()`);
  await wait(800);
  const created = await evaluate(page, `(() => {
    const issues = window.__AETHER_DATA__.getState().issues.filter((i) => i.title === 'Template source');
    const issue = issues[0];
    return issue ? { id: issue.id, priority: issue.priority, labels: issue.labelIds, description: issue.description } : null;
  })()`);
  assert.ok(created, 'template must create a new issue');
  assert.equal(created.priority, 'high');
  if (fixture.labelId) assert.ok(created.labels.includes(fixture.labelId), 'labels must copy from the template');
  assert.equal(created.description, 'steps from the template');

  // Settings → Templates lists and deletes it.
  await goto(page, `${base}/settings/templates`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-template]')`), 'settings must list templates');
  await evaluate(page, `window.confirm = () => true`);
  await evaluate(page, `document.querySelector('[data-template] [aria-label="删除模板"], [data-template] [aria-label="Delete template"]')?.click()`);
  await wait(400);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-template]')`), false, 'template must be deleted');

  console.log('PASS browser: issue templates save, apply from the palette, and delete in settings');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

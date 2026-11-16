// Project templates: save from a project, create another, delete in settings.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9473, profile: path.join(process.env.TEMP || '.', `aether-prjtpl-${process.pid}`) });
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
  page = await newPage(9473);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const projectId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const project = data.getState().createProject({ name: 'Template source project', summary: 'Reusable structure' });
    data.getState().updateProject(project.id, { agentInstructions: 'Use the same milestones.', health: 'at_risk' });
    return project.id;
  })()`);
  await wait(700);
  await goto(page, `${base}/projects/${projectId}`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-save-template]')`), 'save-template must render');
  await evaluate(page, `document.querySelector('[data-project-save-template]')?.click()`);
  assert.ok(await waitFor(`window.__AETHER_PROJECT_TEMPLATES__.getState().templates.length > 0`), 'template must be saved');
  const template = await evaluate(page, `window.__AETHER_PROJECT_TEMPLATES__.getState().templates[0]`);
  assert.equal(template.summary, 'Reusable structure');
  assert.equal(template.agentInstructions, 'Use the same milestones.');

  // Create a new project from it on the projects page.
  await goto(page, `${base}/projects`, 3000);
  assert.ok(await waitFor(`[...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('从模板创建') || (b.textContent || '').includes('From template'))`), 'template entry must render');
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('从模板创建') || (b.textContent || '').includes('From template'))?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-template-option="${template.id}"]')`), 'template option must appear');
  await evaluate(page, `document.querySelector('[data-project-template-option="${template.id}"]')?.click()`);
  assert.ok(await waitFor(`location.pathname.startsWith('/projects/') && !location.pathname.endsWith('${projectId}')`, 6000), 'creating from a template must open the new project');
  const created = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const project = data.projects.find((p) => p.name === 'Template source project' && p.id !== '${projectId}');
    return project ? { id: project.id, summary: project.summary, instructions: project.agentInstructions, health: project.health } : null;
  })()`);
  assert.ok(created, 'a new project must be created');
  assert.equal(created.summary, 'Reusable structure');
  assert.equal(created.instructions, 'Use the same milestones.');
  assert.equal(created.health, 'at_risk');

  // Settings lists and deletes project templates.
  await goto(page, `${base}/settings/templates`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-project-template="${template.id}"]')`), 'settings must list the project template');
  await evaluate(page, `window.confirm = () => true`);
  await evaluate(page, `document.querySelector('[data-project-template="${template.id}"] [aria-label="删除项目模板"], [data-project-template="${template.id}"] [aria-label="Delete project template"]')?.click()`);
  await wait(400);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-project-template="${template.id}"]')`), false, 'project template must be deleted');

  console.log('PASS browser: project templates save, create a copy, and delete in settings');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

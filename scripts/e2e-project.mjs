// Focused check: a project page renders the project agent space.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9445, profile: path.join(process.env.TEMP || '.', `aether-proj-${process.pid}`) });
let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  page = await newPage(9445);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/projects`, 5000);
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(page, `document.body.innerText.length > 80`)) break;
    await wait(250);
  }
  // Create a project through the real store API, then open its detail page.
  const projectId = await evaluate(page, `(async () => {
    const res = await fetch('/api/workspace', { cache: 'no-store' });
    const snap = await res.json();
    const id = 'e2e_project';
    const projects = [...(snap.projects || []).filter((p) => p.id !== id), { id, name: 'E2E Project', summary: 'Browser acceptance project', status: 'planned', leadId: 'local', memberIds: ['local'], targetDate: new Date(Date.now() + 86400000).toISOString(), progress: 0, health: 'on_track', color: '#5E6AD2', icon: 'E', agentInstructions: 'Focus on the E2E project.' }];
    await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snap, projects, baseVersion: snap.updatedAt }) });
    return id;
  })()`);
  await goto(page, `${base}/projects/${projectId}`, 5000);
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(page, `!!document.querySelector('[data-project-space]')`)) break;
    await wait(250);
  }
  const space = await evaluate(page, `(() => { const el = document.querySelector('[data-project-space]'); return el ? el.innerText.slice(0, 300) : null; })()`);
  if (!space) {
    const text = await evaluate(page, 'document.body.innerText.slice(0, 800)');
    console.log('PAGE TEXT:', text);
    console.log('HAS PROJECT NOT FOUND:', text.includes('Project not found') || text.includes('未找到项目'));
    throw new Error(`project space must render; page starts: ${text.slice(0, 200)}`);
  }
  assert.ok(space.includes('Project agent') || space.includes('项目智能体'), `unexpected space copy: ${space}`);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Edit') || b.textContent.includes('编辑'))?.click()`);
  await wait(300);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-project-instructions]')`), 'instruction editor must open');
  const textarea = await evaluate(page, `document.querySelector('[data-project-instructions]').value`);
  assert.equal(textarea, 'Focus on the E2E project.');
  await shot(page, path.resolve('docs/checks/231-project-space.png'));
  console.log('PASS browser: project space renders, instructions load and edit');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

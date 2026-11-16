// Consistency checks: comment deletion and derived project progress.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9459, profile: path.join(process.env.TEMP || '.', `aether-consistency-${process.pid}`) });
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
  page = await newPage(9459);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const fixture = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const issue = data.createIssue({ title: 'Deletion fixture', status: 'todo' });
    data.addComment(issue.id, 'local', 'comment to delete');
    const project = data.createProject({ name: 'Progress fixture' });
    const done = data.createIssue({ title: 'Done in project', status: 'todo' });
    data.setProject(done.id, project.id);
    data.setStatus(done.id, 'done');
    return { issue: issue.id, project: project.id };
  })()`);
  await wait(800);

  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${fixture.issue}')`);
  assert.ok(await waitFor(`!!document.querySelector('[data-comment-delete]')`), 'own comment must be deletable');
  await evaluate(page, `window.confirm = () => true`);
  await evaluate(page, `document.querySelector('[data-comment-delete]').click()`);
  await wait(500);
  const remaining = await evaluate(page, `window.__AETHER_DATA__.getState().issues.find((i) => i.id === '${fixture.issue}').comments.length`);
  assert.equal(remaining, 0, 'comment must be removed');

  await goto(page, `${base}/projects/${fixture.project}`, 3000);
  assert.ok(await waitFor(`document.body.innerText.includes('Progress fixture')`), 'project page must load');
  const text = await evaluate(page, `document.body.innerText`);
  assert.ok(text.includes('100%'), `derived progress must be 100%, page shows: ${text.slice(0, 300)}`);

  console.log('PASS browser: comments can be deleted, project progress is derived from issues');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

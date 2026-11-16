// Daily digest: one summary per day, counts by kind, readable in the inbox.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9478, profile: path.join(process.env.TEMP || '.', `aether-digest-${process.pid}`) });
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
  page = await newPage(9478);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const result = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    // reset today's digest so this run proves generation
    for (const notification of data.getState().notifications.filter((n) => n.kind === 'digest')) {
      data.getState().deleteNotification(notification.id);
    }
    const key = (date) => \`\${date.getFullYear()}-\${String(date.getMonth() + 1).padStart(2, '0')}-\${String(date.getDate()).padStart(2, '0')}\`;
    const today = key(new Date());
    const base = { mention: 0, agent: 0, cycle: 0, project_update: 0 };
    for (const n of data.getState().notifications) {
      if (n.kind === 'digest') continue;
      const created = new Date(n.createdAt);
      if (key(created) !== today) continue;
      if (n.kind in base) base[n.kind] += 1;
    }
    const baseTotal = base.mention + base.agent + base.cycle + base.project_update;
    const issue = data.getState().createIssue({ title: 'Digest issue', status: 'todo' });
    data.getState().pushNotification({ issueId: issue.id, kind: 'mention', count: 1 });
    data.getState().pushNotification({ issueId: issue.id, kind: 'agent', count: 1 });
    const project = data.getState().createProject({ name: 'Digest project' });
    data.getState().addProjectUpdate(project.id, 'digest update', 'on_track');
    const before = data.getState().notifications.filter((n) => n.kind === 'digest').length;
    data.getState().ensureDailyDigest();
    const digests = data.getState().notifications.filter((n) => n.kind === 'digest');
    const digest = digests[0];
    data.getState().ensureDailyDigest();
    const after = data.getState().notifications.filter((n) => n.kind === 'digest').length;
    return {
      before,
      after,
      base,
      baseTotal,
      total: digest?.count,
      counts: digest?.digest?.counts,
      date: digest?.digestDate,
      id: digest?.id,
    };
  })()`);
  assert.equal(result.before, 0, 'digest is reset for the run');
  assert.equal(result.after, 1, 'only one digest per day');
  assert.equal(result.total, result.baseTotal + 3, 'digest counts today\'s added notifications');
  assert.equal(result.counts.mention, result.base.mention + 1);
  assert.equal(result.counts.agent, result.base.agent + 1);
  assert.equal(result.counts.project_update, result.base.project_update + 1);
  assert.ok(result.date, 'digest carries its day');
  await wait(1200);

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-notification="${result.id}"]')`), 'digest must render');
  const text = await evaluate(page, `document.querySelector('[data-notification="${result.id}"]').innerText`);
  assert.ok(text.includes('每日摘要') || text.includes('Daily digest'), `digest title missing: ${text}`);
  assert.ok(text.includes('今天 ') || text.includes('updates today'), `digest count missing: ${text}`);
  assert.ok(text.includes('提及') || text.includes('Mention'), 'per-kind counts must render');

  const pathBefore = await evaluate(page, `location.pathname`);
  await evaluate(page, `document.querySelector('[data-notification="${result.id}"] button')?.click()`);
  await wait(300);
  assert.equal(await evaluate(page, `location.pathname`), pathBefore, 'clicking a digest must not navigate');

  console.log('PASS browser: daily digest is generated once with per-kind counts and renders in the inbox');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

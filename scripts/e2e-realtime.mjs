// Realtime acceptance: SSE pull for another device's write, and conflict merge.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9454, profile: path.join(process.env.TEMP || '.', `aether-realtime-${process.pid}`) });
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
const serverSnapshot = async () => (await fetch(`${base}/api/workspace`, { cache: 'no-store' })).json();
const writeServer = async (mutate) => {
  const snap = await serverSnapshot();
  const body = mutate(snap);
  const response = await fetch(`${base}/api/workspace`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, baseVersion: snap.updatedAt }),
  });
  assert.ok(response.ok, `server write failed (${response.status})`);
  return response.json();
};

try {
  page = await newPage(9454);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && window.__AETHER_DATA__.getState().syncState === 'saved'`), 'app must boot and settle');

  // 1. Another device writes; this tab has no local work, so it pulls by itself.
  const marker = `Realtime ${Date.now()}`;
  await writeServer((snap) => ({
    ...snap,
    issues: [
      {
        id: 'realtime-remote', key: 'ENG-RT1', teamKey: 'ENG', title: marker, description: '', status: 'todo',
        priority: 'medium', assigneeId: null, creatorId: 'local', labelIds: [], projectId: null, cycleId: null,
        estimate: null, dueDate: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        comments: [], activities: [],
      },
      ...snap.issues,
    ],
  }));
  assert.ok(
    await waitFor(`document.body.innerText.includes(${JSON.stringify(marker)})`, 15000),
    'a remote write must reach this tab over SSE without a manual refresh',
  );

  // 2. Local + remote diverge inside the debounce window, producing a 409.
  const remote2 = `Remote conflict ${Date.now()}`;
  const local2 = `Local conflict ${Date.now()}`;
  const remoteId = `conflict-remote-${Date.now()}`;
  await evaluate(page, `(async () => {
    const snap = await (await fetch('/api/workspace', { cache: 'no-store' })).json();
    await fetch('/api/workspace', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...snap, issues: [{ ...snap.issues[0], id: ${JSON.stringify(remoteId)}, key: 'ENG-RT' + String(Date.now()).slice(-4), title: ${JSON.stringify(remote2)}, updatedAt: new Date().toISOString() }, ...snap.issues], baseVersion: snap.updatedAt }),
    });
    window.__AETHER_DATA__.getState().createIssue({ title: ${JSON.stringify(local2)} });
  })()`);
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().syncState === 'conflict'`, 15000), 'stale local write must surface a conflict');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-sync-status="conflict"]')`), 'conflict must be visible');
  await evaluate(page, `document.querySelector('[data-sync-status="conflict"]').click()`);
  await wait(300);
  const panelText = await evaluate(page, `document.querySelector('[data-sync-panel]').innerText`);
  assert.ok(panelText.includes('合并双方') || panelText.includes('Merge both sides'), `merge action missing: ${panelText}`);
  await evaluate(page, `[...document.querySelectorAll('[data-sync-panel] button')].find((b) => b.textContent.includes('合并双方') || b.textContent.includes('Merge both sides'))?.click()`);
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().syncState === 'saved'`, 15000), 'merge must settle as saved');

  const finalSnapshot = await serverSnapshot();
  const titles = finalSnapshot.issues.map((issue) => issue.title);
  assert.ok(titles.includes(remote2), `merged server copy must keep the remote issue; missing ${remote2}`);
  assert.ok(titles.includes(local2), 'merged server copy must keep the local issue');

  console.log('PASS browser: SSE pull for remote writes, 409 visible, merge keeps both sides');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

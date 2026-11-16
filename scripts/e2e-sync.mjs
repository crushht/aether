// Acceptance for the workspace sync state machine: a real 409 must not be
// silently resolved, and both resolutions must work.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9446, profile: path.join(process.env.TEMP || '.', `aether-sync-${process.pid}`) });
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
  page = await newPage(9446);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`document.body.innerText.length > 100 && !!window.__AETHER_DATA__`), 'app must boot');
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().syncState === 'saved'`, 12000), 'initial pull must complete');

  // Another device writes once, so this tab's baseVersion is now stale.
  const serverVersion = await evaluate(page, `(async () => {
    const res = await fetch('/api/workspace', { cache: 'no-store' });
    const snap = await res.json();
    const projects = [...(snap.projects || []), { id: 'other-device', name: 'Other device project', summary: '', status: 'planned', leadId: 'local', memberIds: ['local'], targetDate: new Date().toISOString(), progress: 0, health: 'on_track', color: '#5E6AD2', icon: 'O' }];
    const put = await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snap, projects, baseVersion: snap.updatedAt }) });
    const out = await put.json();
    return { ok: put.ok, updatedAt: out.updatedAt };
  })()`);
  assert.ok(serverVersion.ok, 'remote write must succeed');
  await wait(300);

  // A local edit made against the stale base version must surface a conflict.
  await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'Sync conflict survivor' })`);
  const conflicted = await waitFor(`window.__AETHER_DATA__.getState().syncState === 'conflict'`, 15000);
  assert.ok(conflicted, `expected conflict, got ${await evaluate(page, 'window.__AETHER_DATA__.getState().syncState')}`);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-sync-status="conflict"]')`), 'conflict must be visible in the top bar');
  assert.ok(await evaluate(page, `window.__AETHER_DATA__.getState().issues.some((i) => i.title === 'Sync conflict survivor')`), 'local edit must survive the conflict');

  // Keep local: the local issue is written and the state returns to saved.
  await evaluate(page, `document.querySelector('[data-sync-status="conflict"]').click()`);
  await wait(300);
  await evaluate(page, `[...document.querySelectorAll('[data-sync-panel] button')].find((b) => b.textContent.includes('保留本机修改'))?.click()`);
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().syncState === 'saved'`, 15000), 'keeping local must save cleanly');
  const remote = await evaluate(page, `(async () => { const snap = await (await fetch('/api/workspace', { cache: 'no-store' })).json(); return snap.issues.some((i) => i.title === 'Sync conflict survivor'); })()`);
  assert.ok(remote, 'local issue must reach the server after resolution');

  // Load server: a deliberately newer server snapshot replaces local data.
  const second = await evaluate(page, `(async () => {
    const snap = await (await fetch('/api/workspace', { cache: 'no-store' })).json();
    const put = await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snap, issues: snap.issues.map((i) => i.id === snap.issues[0].id ? { ...i, title: 'Server side rename' } : i), baseVersion: snap.updatedAt }) });
    return put.ok;
  })()`);
  assert.ok(second, 'second remote write must succeed');
  await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'Local loses this one' })`);
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().syncState === 'conflict'`, 15000), 'second conflict must appear');
  await evaluate(page, `document.querySelector('[data-sync-status="conflict"]').click()`);
  await wait(300);
  await evaluate(page, `[...document.querySelectorAll('[data-sync-panel] button')].find((b) => b.textContent.includes('载入服务器版本'))?.click()`);
  assert.ok(await waitFor(`window.__AETHER_DATA__.getState().syncState === 'saved'`, 15000), 'loading remote must settle');
  assert.ok(await evaluate(page, `!window.__AETHER_DATA__.getState().issues.some((i) => i.title === 'Local loses this one')`), 'remote choice must drop the local-only issue');
  assert.ok(await evaluate(page, `window.__AETHER_DATA__.getState().issues.some((i) => i.title === 'Server side rename')`), 'remote choice must load server data');

  console.log('PASS browser: 409 conflict is visible, local edits survive, both resolutions work');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

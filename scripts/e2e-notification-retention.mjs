// Notification retention: old archives are pruned, recent ones stay.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9495, profile: path.join(process.env.TEMP || '.', `aether-retention-${process.pid}`) });
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
  page = await newPage(9495);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const result = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__;
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const recent = new Date(Date.now() - 2 * 86400000).toISOString();
    data.setState((state) => ({
      notifications: [
        { id: 'old-archive', kind: 'agent', issueId: '', count: 1, createdAt: old, archivedAt: old },
        { id: 'new-archive', kind: 'agent', issueId: '', count: 1, createdAt: recent, archivedAt: recent },
        { id: 'active', kind: 'agent', issueId: '', count: 1, createdAt: recent },
        ...state.notifications,
      ],
    }));
    data.getState().ensureCycleRollover();
    const ids = data.getState().notifications.map((n) => n.id);
    return { hasOld: ids.includes('old-archive'), hasNew: ids.includes('new-archive'), hasActive: ids.includes('active') };
  })()`);
  assert.equal(result.hasOld, false, 'an archive older than 30 days must be pruned');
  assert.equal(result.hasNew, true, 'a recent archive stays');
  assert.equal(result.hasActive, true, 'active notifications stay');

  console.log('PASS browser: expired notification archives are pruned on load');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

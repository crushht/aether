// Cycle notices: started/ending fire once and render in the inbox.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9466, profile: path.join(process.env.TEMP || '.', `aether-cycle-${process.pid}`) });
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
  page = await newPage(9466);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const result = await evaluate(page, `(() => {
    const now = Date.now();
    const data = window.__AETHER_DATA__;
    const cycle = { id: 'cyc-notice-test', name: 'Notice test cycle', number: 901, startsAt: new Date(now - 3600_000).toISOString(), endsAt: new Date(now + 13 * 86400_000).toISOString(), progress: 0, current: true };
    data.setState((state) => ({ cycles: [cycle, ...state.cycles.filter((c) => c.id !== cycle.id)] }));
    data.getState().ensureCycleNotices();
    const started = data.getState().notifications.filter((n) => n.cycleId === cycle.id && n.event === 'started').length;
    // Move the end inside 24h: an ending notice appears once.
    data.setState((state) => ({ cycles: state.cycles.map((c) => c.id === cycle.id ? { ...c, endsAt: new Date(now + 1800_000).toISOString() } : c) }));
    data.getState().ensureCycleNotices();
    const ending = data.getState().notifications.filter((n) => n.cycleId === cycle.id && n.event === 'ending').length;
    const before = data.getState().notifications.filter((n) => n.cycleId === cycle.id).length;
    data.getState().ensureCycleNotices();
    const after = data.getState().notifications.filter((n) => n.cycleId === cycle.id).length;
    return { started, ending, before, after };
  })()`);
  assert.equal(result.started, 1, 'one started notice');
  assert.equal(result.ending, 1, 'one ending notice');
  assert.equal(result.after, result.before, 'notices must be idempotent');

  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`document.body.innerText.includes('Notice test cycle') || document.body.innerText.includes('周期开始') || document.body.innerText.includes('Cycle started')`), 'inbox must show the cycle notice');
  const text = await evaluate(page, `document.querySelector('main').innerText`);
  assert.ok(text.includes('周期开始') || text.includes('Cycle started'), 'started copy must render');
  assert.ok(text.includes('周期即将结束') || text.includes('Cycle ending'), 'ending copy must render');

  console.log('PASS browser: cycle started/ending notices are idempotent and visible in the inbox');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

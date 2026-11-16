// Members settings can refresh invite state on demand.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9512, profile: path.join(process.env.TEMP || '.', `aether-invite-refresh-${process.pid}`) });
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
  page = await newPage(9512);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/members`, 5000);
  assert.ok(await waitFor(`!!document.querySelector('[data-invite-refresh]')`), 'refresh button must render');
  await evaluate(page, `document.querySelector('[data-invite-refresh]')?.click()`);
  assert.ok(
    await waitFor(`document.body.innerText.includes('邀请信息已刷新') || document.body.innerText.includes('Invite status refreshed')`),
    'refresh must confirm',
  );
  assert.equal(await evaluate(page, `document.querySelector('[data-invite-refresh]').disabled`), false, 'button re-enables');

  console.log('PASS browser: invite state can be refreshed');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

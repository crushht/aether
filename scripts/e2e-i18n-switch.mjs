// Switching to English actually changes the interface, and back.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9519, profile: path.join(process.env.TEMP || '.', `aether-i18n-${process.pid}`) });
let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, timeout = 15000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expr)) return true;
    await wait(250);
  }
  return false;
};

try {
  page = await newPage(9519);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/settings/preferences`, 5000);
  assert.ok(await waitFor(`document.documentElement.lang === 'zh-CN'`), 'default locale is Chinese');

  await evaluate(page, `(() => {
    const buttons = [...document.querySelectorAll('button')];
    buttons.find((b) => b.textContent.trim() === 'English')?.click();
  })()`);
  assert.ok(await waitFor(`document.documentElement.lang === 'en'`), 'html lang must switch to en');
  await wait(400);
  const english = await evaluate(page, `document.body.innerText`);
  assert.ok(/Settings|Preferences/.test(english), 'settings chrome must be English');
  assert.ok(!english.includes('设置'), 'no Chinese settings title in English mode');

  await evaluate(page, `(() => {
    const buttons = [...document.querySelectorAll('button')];
    buttons.find((b) => b.textContent.trim() === '中文')?.click();
  })()`);
  assert.ok(await waitFor(`document.documentElement.lang === 'zh-CN'`), 'html lang returns to zh-CN');
  await wait(400);
  assert.ok((await evaluate(page, `document.body.innerText`)).includes('设置'), 'Chinese titles are back');

  console.log('PASS browser: locale switch flips the interface both ways');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

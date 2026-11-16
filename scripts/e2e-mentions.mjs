// Mentions acceptance: picker, stored mentions, inbox filter and notification.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9458, profile: path.join(process.env.TEMP || '.', `aether-mentions-${process.pid}`) });
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
  page = await newPage(9458);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const issueId = await evaluate(page, `window.__AETHER_DATA__.getState().createIssue({ title: 'Mention fixture', status: 'todo' }).id`);
  await wait(700);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll')`), 'drawer must open');

  // Typing "@" opens the member picker.
  await evaluate(page, `(() => {
    const area = [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('comment') || (t.placeholder || '').includes('评论'));
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(area, '@');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.focus();
    area.setSelectionRange(1, 1);
  })()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-mention-menu]')`), 'mention menu must open');
  const handle = await evaluate(page, `document.querySelector('[data-mention-menu] [data-mention-option]')?.getAttribute('data-mention-option')`);
  assert.ok(handle, 'a member option must exist');
  await evaluate(page, `document.querySelector('[data-mention-option="${handle}"]').click()`);
  await wait(300);
  const composed = await evaluate(page, `[...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('comment') || (t.placeholder || '').includes('评论'))?.value`);
  assert.ok(composed.startsWith('@'), `mention insert failed: ${composed}`);
  assert.ok(!composed.includes('@ '), 'there must be a handle after @');

  await evaluate(page, `(() => {
    const area = [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('comment') || (t.placeholder || '').includes('评论'));
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(area, area.value + ' please review');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  })()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-comment-mentions]')`), 'mention chips must render under the comment');
  const mentions = await evaluate(page, `window.__AETHER_DATA__.getState().issues.find((i) => i.id === '${issueId}').comments.at(-1)?.mentions`);
  assert.ok(Array.isArray(mentions) && mentions.length > 0, `mentions must be stored, got ${JSON.stringify(mentions)}`);

  const notified = await evaluate(page, `window.__AETHER_DATA__.getState().notifications.some((n) => n.kind === 'mention' && n.issueId === '${issueId}')`);
  assert.ok(notified, 'a mention notification must be created');

  // Inbox: Mentions filter shows the new item.
  await goto(page, `${base}/inbox`, 3000);
  assert.ok(await waitFor(`!!document.querySelector('[data-inbox-filter]')`), 'inbox filters must render');
  await evaluate(page, `[...document.querySelectorAll('[data-inbox-filter] button')].find((b) => (b.textContent || '').includes('提及') || (b.textContent || '').includes('Mentions'))?.click()`);
  await wait(400);
  assert.ok((await evaluate(page, `document.querySelector('main').innerText`)).includes('Mention fixture'), 'mentions filter must include the issue');

  console.log('PASS browser: mention picker, stored mentions, notification and inbox filter');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

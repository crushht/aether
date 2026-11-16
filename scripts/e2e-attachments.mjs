// Attachments acceptance: upload via the real file input, render, delete, persist.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9455, profile: path.join(process.env.TEMP || '.', `aether-att-${process.pid}`) });
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

const pickFile = (selector, name, content, type = 'text/plain') => evaluate(page, `(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) throw new Error('file input missing: ${selector}');
  const data = new DataTransfer();
  data.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.files.length;
})()`);

try {
  page = await newPage(9455);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'app must boot');

  const issueId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const issue = data.createIssue({ title: 'Attachment fixture', status: 'todo' });
    return issue.id;
  })()`);
  await wait(800);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll')`), 'drawer must open');

  // Issue-level upload through the header file input.
  const count = await pickFile('[data-issue-attachment-input]', 'notes.txt', 'release checklist\nsecond line');
  assert.equal(count, 1);
  assert.ok(await waitFor(`!!document.querySelector('[data-issue-attachments]')`), 'attachment section must appear');
  assert.ok((await evaluate(page, `document.querySelector('[data-issue-attachments]').innerText`)).includes('notes.txt'));
  const storedText = await evaluate(page, `window.__AETHER_DATA__.getState().issues.find((i) => i.id === '${issueId}').attachments?.[0]?.text`);
  assert.ok(String(storedText).includes('release checklist'), 'text content must be stored');

  // Comment upload: draft chip, then post and render under the comment.
  await pickFile('[data-comment-attachment-input]', 'spec.md', '# spec\nbody');
  assert.ok(await waitFor(`!!document.querySelector('[data-comment-attachment-drafts]')`), 'comment draft chip must render');
  await evaluate(page, `(() => {
    const area = [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('comment') || (t.placeholder || '').includes('评论'));
    area.focus();
  })()`);
  await evaluate(page, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '评论' || b.textContent.trim() === 'Comment')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-comment-attachments]')`), 'comment attachment must render');
  assert.ok((await evaluate(page, `document.querySelector('[data-comment-attachments]').innerText`)).includes('spec.md'));

  // The store persists through a 500 ms debounce before it PUTs to the server.
  // Navigating before that fires loses the edit entirely (no unload flush), so
  // poll the server snapshot until both the attachment and the comment have
  // landed — a stale `syncState === 'saved'` from the previous push is not
  // proof, the persisted rows are.
  const persisted = async () => {
    try {
      const snapshot = await (await fetch(`${base}/api/workspace`)).json();
      const issue = (snapshot.issues ?? []).find((row) => row.id === issueId);
      return Boolean(
        issue &&
          (issue.attachments ?? []).some((row) => row.name === 'notes.txt') &&
          (issue.comments ?? []).some((row) => (row.attachments ?? []).some((file) => file.name === 'spec.md')),
      );
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + 15000;
  while (!(await persisted())) {
    if (Date.now() > deadline) assert.fail('comment and attachments must reach the server snapshot before reload');
    await wait(250);
  }

  // Reload: both attachments survive the snapshot.
  await goto(page, `${base}/team/ENG`, 3000);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue('${issueId}')`);
  assert.ok(await waitFor(`!!document.querySelector('[data-issue-attachments]')`), 'issue attachment must survive reload');
  assert.ok(await waitFor(`!!document.querySelector('[data-comment-attachments]')`), 'comment attachment must survive reload');

  // Delete the issue attachment.
  await evaluate(page, `document.querySelector('[data-issue-attachments] [aria-label^="移除附件"], [data-issue-attachments] [aria-label^="Remove attachment"]')?.click()`);
  await wait(500);
  assert.equal(await evaluate(page, `!!document.querySelector('[data-issue-attachments]')`), false, 'removing the last issue attachment must hide the section');

  console.log('PASS browser: issue and comment attachments upload, persist, and delete');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

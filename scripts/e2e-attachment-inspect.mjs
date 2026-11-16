// Attachment analysis: the ⋯ menu on an issue attachment runs the same static
// triage the agent uses (`/api/agent/inspect`) and renders the report inline.
// Covers the route round-trip, the menu, the card, hash copy and the no-bytes path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9541, profile: path.join(process.env.TEMP || '.', `aether-analyze-${process.pid}`) });
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

const post = (body) =>
  fetch(`${base}/api/agent/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// A DOS/MZ header is enough to prove the route sniffed real bytes.
const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const mzB64 = mz.toString('base64');
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dropperText = [
  'release checklist',
  '',
  'powershell -enc AAAA',
  'https://evil.example/x',
  `payload ${mzB64}`,
  '',
].join('\n');

try {
  // --- the route ---------------------------------------------------------
  const okResponse = await post({ name: 'sample.bin', base64: mzB64 });
  assert.equal(okResponse.status, 200);
  const okJson = await okResponse.json();
  assert.equal(okJson.ok, true);
  assert.equal(okJson.report.format.id, 'mz', 'the server sniffs the magic bytes');
  assert.match(okJson.report.format.label, /DOS/, 'the label names the format');
  assert.equal(okJson.hashes.sha256, createHash('sha256').update(mz).digest('hex'), 'the hash matches the bytes');
  assert.equal(okJson.hashes.md5.length, 32);

  const emptyResponse = await post({ name: 'empty.txt', text: '' });
  assert.equal(emptyResponse.status, 400, 'an empty artifact is refused');
  const noneResponse = await post({ name: 'nothing' });
  assert.equal(noneResponse.status, 400, 'a body with neither bytes nor text is refused');
  const unauthless = await post({ name: 'sample.bin', base64: mzB64 });
  assert.equal(unauthless.status, 200, 'with AUTH_DISABLED the local account is still resolved');

  // --- the UI ------------------------------------------------------------
  page = await newPage(9541);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__`), 'the app must boot');

  const issueId = await evaluate(page, `(() => {
    const data = window.__AETHER_DATA__.getState();
    const issue = data.createIssue({ title: 'Artifact triage fixture', status: 'todo' });
    data.addAttachment(issue.id, { name: 'dropper.txt', mime: 'text/plain', size: ${dropperText.length}, text: ${JSON.stringify(dropperText)} });
    data.addAttachment(issue.id, { name: 'pixel.png', mime: 'image/png', size: 70, dataUrl: ${JSON.stringify(pixel)} });
    data.addAttachment(issue.id, { name: 'ghost.bin', mime: 'application/octet-stream', size: 10 });
    return issue.id;
  })()`);
  await wait(600);
  await evaluate(page, `window.__AETHER_VIEW__.getState().openIssue(${JSON.stringify(issueId)})`);
  assert.ok(await waitFor(`!!document.querySelector('[data-issue-attachments]')`), 'the attachment section must render');

  const ids = await evaluate(page, `(() => {
    const issue = window.__AETHER_DATA__.getState().issues.find((item) => item.id === ${JSON.stringify(issueId)});
    return issue.attachments.map((file) => ({ id: file.id, name: file.name }));
  })()`);
  const textFile = ids.find((file) => file.name === 'dropper.txt');
  const ghostFile = ids.find((file) => file.name === 'ghost.bin');

  // The menu: one entry, "Analyze", and it closes on an outside click.
  await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${textFile.id}"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-attachment-menu="${textFile.id}"]')`), 'the ⋯ menu opens');
  const menuLabel = await evaluate(page, `document.querySelector('[data-attachment-menu-item="analyze"]').innerText`);
  assert.ok(menuLabel.includes('分析') || menuLabel.includes('Analyze'), `the menu offers Analyze, got: ${menuLabel}`);
  assert.equal(await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${textFile.id}"]').getAttribute('aria-expanded')`), 'true');
  await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${textFile.id}"]').click()`);
  assert.ok(await waitFor(`!document.querySelector('[data-attachment-menu="${textFile.id}"]')`), 'clicking the trigger again closes it');

  await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${textFile.id}"]').click()`);
  await waitFor(`!!document.querySelector('[data-attachment-menu="${textFile.id}"]')`);
  // Outside click closes the menu without opening the panel.
  await evaluate(page, `(() => {
    const overlay = document.querySelector('[data-attachment-menu="${textFile.id}"]').previousElementSibling;
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  })()`);
  assert.ok(await waitFor(`!document.querySelector('[data-attachment-menu="${textFile.id}"]')`), 'an outside click closes the menu');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-attachment-analysis]')`), false, 'closing the menu must not analyse');

  // Analyze the text attachment: indicators, the embedded MZ blob, a sha256.
  await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${textFile.id}"]').click()`);
  await waitFor(`!!document.querySelector('[data-attachment-menu-item="analyze"]')`);
  await evaluate(page, `document.querySelector('[data-attachment-menu-item="analyze"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-attachment-analysis]')`), 'the analysis panel opens');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-attachment-menu="${textFile.id}"]')`), false, 'the menu closes behind it');
  assert.ok(await waitFor(`!!document.querySelector('[data-attachment-analysis] [data-tool-card="inspect"]')`), 'the card renders once the route answers');
  const analysisText = await evaluate(page, `document.querySelector('[data-attachment-analysis]').innerText`);
  assert.ok(analysisText.includes('dropper.txt'), 'the panel names the file');
  assert.ok(/Text|UTF-8/.test(analysisText), `the format is shown, got: ${analysisText}`);
  assert.ok(analysisText.includes('powershell -enc'), 'command indicators are listed');
  assert.ok(analysisText.includes('https://evil.example/x'), 'URL indicators are listed');
  assert.ok(analysisText.includes('DOS executable (MZ)'), 'the embedded payload is unwrapped, not just counted');
  assert.match(analysisText, /[0-9a-f]{64}/, 'a sha256 is present');
  assert.equal(
    await evaluate(page, `document.querySelectorAll('[data-attachment-analysis] [data-tool-card="inspect"]').length`),
    1,
    'exactly one report body',
  );

  // Copy the hash — the panel reuses the transcript's copy control.
  await evaluate(page, `(() => {
    window.__copied = null;
    navigator.clipboard.writeText = (value) => { window.__copied = value; return Promise.resolve(); };
  })()`);
  await evaluate(page, `document.querySelector('[data-attachment-analysis] [data-copy-value="sha256"]').click()`);
  assert.ok(await waitFor(`typeof window.__copied === 'string' && /^[0-9a-f]{64}$/.test(window.__copied)`), 'the sha256 reaches the clipboard');
  const expectedHash = createHash('sha256').update(Buffer.from(dropperText, 'utf8')).digest('hex');
  assert.equal(await evaluate(page, `window.__copied`), expectedHash, 'the copied hash is the hash of the attachment bytes');

  // Escape closes the panel only — the issue drawer behind it stays open.
  await evaluate(page, `(() => {
    const panel = document.querySelector('[data-attachment-analysis]');
    panel.focus();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`);
  assert.ok(await waitFor(`!document.querySelector('[data-attachment-analysis]')`), 'Escape closes the panel');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-issue-attachments]')`), true, 'the drawer survives the modal Escape');

  // The binary path: a PNG data URL keeps its real magic bytes.
  const imageFile = ids.find((file) => file.name === 'pixel.png');
  await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${imageFile.id}"]').click()`);
  await waitFor(`!!document.querySelector('[data-attachment-menu-item="analyze"]')`);
  await evaluate(page, `document.querySelector('[data-attachment-menu-item="analyze"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-attachment-analysis] [data-tool-card="inspect"]')`), 'the PNG report renders');
  const imageText = await evaluate(page, `document.querySelector('[data-attachment-analysis]').innerText`);
  assert.ok(imageText.includes('PNG image'), `a data URL is sent as bytes, got: ${imageText}`);
  await evaluate(page, `document.querySelector('[data-analysis-close]').click()`);
  assert.ok(await waitFor(`!document.querySelector('[data-attachment-analysis]')`), 'the close button closes the panel');

  // An attachment that carries no bytes never reaches the route.
  await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${ghostFile.id}"]').click()`);
  await waitFor(`!!document.querySelector('[data-attachment-menu-item="analyze"]')`);
  await evaluate(page, `document.querySelector('[data-attachment-menu-item="analyze"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-analysis-error]')`), 'a byte-less attachment explains itself');
  assert.equal(
    await evaluate(page, `!!document.querySelector('[data-attachment-analysis] [data-tool-card="inspect"]')`),
    false,
    'no report body without bytes',
  );
  const errorText = await evaluate(page, `document.querySelector('[data-analysis-error]').innerText`);
  assert.ok(errorText.includes('没有可分析的字节'), `the reason is local and translated, got: ${errorText}`);
  await evaluate(page, `document.querySelector('[data-analysis-close]').click()`);
  await waitFor(`!document.querySelector('[data-attachment-analysis]')`);

  // A screenshot with the report open, for the docs.
  await evaluate(page, `document.querySelector('[data-attachment-menu-toggle="${textFile.id}"]').click()`);
  await waitFor(`!!document.querySelector('[data-attachment-menu-item="analyze"]')`);
  await evaluate(page, `document.querySelector('[data-attachment-menu-item="analyze"]').click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-attachment-analysis] [data-tool-card="inspect"]')`));
  await wait(400);
  await shot(page, 'docs/checks/265-attachment-analysis.png', { width: 1440, height: 1000 });

  console.log('PASS browser: attachment ⋯ menu analyses a file through /api/agent/inspect (card, copy, PNG, no-bytes)');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

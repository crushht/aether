// Desktop notification click: the preload callback opens a project or issue.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9477, profile: path.join(process.env.TEMP || '.', `aether-desktop-click-${process.pid}`) });
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
  page = await newPage(9477);
  await viewport(page, 1440, 960);
  // A stand-in for the Electron preload bridge, installed before the app loads.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.desktop = {
        platform: 'test',
        versions: {},
        notify: () => true,
        onNotificationClick: (cb) => { window.__desktopClick = cb; return () => { window.__desktopClick = null; }; },
      };
    `,
  });
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_DATA__ && typeof window.__desktopClick === 'function'`), 'app must register the click handler');

  const fixture = await evaluate(page, `(() => {
    const issue = window.__AETHER_DATA__.getState().createIssue({ title: 'Desktop click issue', status: 'todo' });
    const project = window.__AETHER_DATA__.getState().createProject({ name: 'Desktop click project' });
    return { issueId: issue.id, projectId: project.id };
  })()`);
  await wait(700);

  await evaluate(page, `window.__desktopClick({ projectId: '${fixture.projectId}', issueId: null })`);
  assert.ok(await waitFor(`location.pathname === '/projects/${fixture.projectId}'`, 6000), 'project payload must open the project');

  await evaluate(page, `window.__desktopClick({ issueId: '${fixture.issueId}', projectId: null })`);
  assert.ok(await waitFor(`!!document.querySelector('#issue-scroll')`, 6000), 'issue payload must open the issue drawer');

  console.log('PASS browser: desktop notification clicks route to the project and issue');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

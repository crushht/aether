// Agent usage card: rolls up run records into today/week numbers.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9522, profile: path.join(process.env.TEMP || '.', `aether-usage-${process.pid}`) });
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
  page = await newPage(9522);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/settings/agents`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_AGENT__`), 'agent store must be exposed in dev');

  await evaluate(page, `(() => {
    const now = Date.now();
    const run = (id, at, status, prompt, completion, model) => ({
      id, at, ms: 120, model, provider: '本地网关', status, steps: 2, tools: 1,
      promptTokens: prompt, completionTokens: completion,
    });
    window.__AETHER_AGENT__.setState({
      sessions: {
        'chat:usage_test': {
          targetId: 'usage_test', status: 'idle', pending: null, log: [],
          runs: [
            run('r1', now - 60_000, 'ok', 1200, 800, 'hy4-preview-f'),
            run('r2', now - 3_600_000, 'error', 300, 100, 'glm-5.3'),
            run('r3', now - 10 * 86_400_000, 'ok', 5000, 5000, 'old-model'),
          ],
        },
      },
      hydrated: true,
    });
  })()`);

  assert.ok(await waitFor(`!!document.querySelector('[data-usage-summary]')`), 'usage card must render');
  await wait(400);
  const today = await evaluate(page, `document.querySelector('[data-usage-summary]').innerText`);
  assert.ok(today.includes('2,400'), `today tokens must be 2,400, got: ${today.replace(/\\n/g, ' | ')}`);
  assert.ok(today.includes('hy4-preview-f'), 'model chips must list the model used today');

  await evaluate(page, `document.querySelector('[data-usage-range="week"]')?.click()`);
  await wait(300);
  const week = await evaluate(page, `document.querySelector('[data-usage-summary]').innerText`);
  assert.ok(week.includes('2,400'), 'the 8-day-old run stays out of the week window');
  assert.ok(!week.includes('old-model'), 'old model must not appear in the week window');

  console.log('PASS browser: agent usage card aggregates today and week windows');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

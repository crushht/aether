// The default-model field lists every model the upstream returned, and a chip
// fills the field in one click (the datalist alone hides them behind the value).
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9517, profile: path.join(process.env.TEMP || '.', `aether-model-picker-${process.pid}`) });
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
  page = await newPage(9517);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/settings/agents`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_WORKSPACE__`), 'workspace store must be exposed in dev');
  // Inject after the workspace hydrated, otherwise its own pull overwrites the fixture.
  assert.ok(await waitFor(`window.__AETHER_WORKSPACE__.getState().loaded === true`), 'workspace must load');

  // A provider whose upstream catalogue does not contain the preset default.
  await evaluate(page, `window.__AETHER_WORKSPACE__.setState({
    providers: [{
      id: 'prov_local', name: '本地网关', baseUrl: 'http://127.0.0.1:8788/v1',
      models: ['hy4-preview-f', 'hy3', 'deepseek-v4.1-flash', 'glm-5.3'],
      defaultModel: 'gpt-4o', contextWindow: 100000, temperature: 0.3, maxSteps: 8,
      hasKey: true, keyHint: 'sk-…1234',
    }],
  })`);
  assert.ok(await waitFor(`!!document.querySelector('[data-edit-provider="prov_local"]')`), 'provider row must render');
  await evaluate(page, `document.querySelector('[data-edit-provider="prov_local"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-model-choices]')`), 'model chips must render');
  const chips = await evaluate(page, `[...document.querySelectorAll('[data-model-choice]')].map((el) => el.textContent)`);
  assert.ok(chips.includes('glm-5.3'), `chips must list upstream models, got ${chips.join(',')}`);

  // An unknown default is called out, with a one-click fix.
  assert.ok(await evaluate(page, `!!document.querySelector('[data-model-warning]')`), 'unknown default must be flagged');
  await evaluate(page, `document.querySelector('[data-use-first-model]')?.click()`);
  await wait(250);
  const fixed = await evaluate(page, `(() => {
    const field = document.querySelector('[data-model-choices]').parentElement;
    return field.querySelector('input').value;
  })()`);
  assert.equal(fixed, 'hy4-preview-f', 'the fix button must adopt the first upstream model');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-model-warning]')`), false, 'the warning clears');

  await evaluate(page, `document.querySelector('[data-model-choice="glm-5.3"]')?.click()`);
  await wait(250);
  const value = await evaluate(page, `(() => {
    const field = document.querySelector('[data-model-choices]').parentElement;
    return field.querySelector('input').value;
  })()`);
  assert.equal(value, 'glm-5.3', 'clicking a chip must set the default model');

  // Scene routes get the same treatment: pick a model instead of guessing.
  assert.ok(await waitFor(`!!document.querySelector('[data-route-models]')`), 'route model chips must render');
  await evaluate(page, `document.querySelector('[data-route-model="hy3"]')?.click()`);
  await wait(250);
  const routeValue = await evaluate(page, `(() => {
    const box = document.querySelector('[data-route-models]').parentElement;
    return box.querySelector('input').value;
  })()`);
  assert.equal(routeValue, 'hy3', 'clicking a route chip must set that scene model');

  console.log('PASS browser: upstream models are listed and fill the default-model field');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

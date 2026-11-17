// Precision presets: one click sets temperature and steps together, the active
// chip follows the numbers, and a hand-tuned pair is called custom.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9535, profile: path.join(process.env.TEMP || '.', `aether-presets-${process.pid}`) });
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
const read = () =>
  evaluate(page, `({
    temperature: document.querySelector('[data-temperature]')?.value ?? null,
    steps: document.querySelector('[data-max-steps]')?.value ?? null,
    pressed: [...document.querySelectorAll('[data-precision][aria-pressed="true"]')].map((el) => el.getAttribute('data-precision')),
    custom: !!document.querySelector('[data-precision-custom]'),
    chips: [...document.querySelectorAll('[data-precision]')].map((el) => el.getAttribute('data-precision')),
  })`);

try {
  page = await newPage(9535);
  await viewport(page, 1440, 1000);
  await goto(page, `${base}/settings/agents`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_WORKSPACE__`), 'the workspace store must be exposed in dev');
  assert.ok(await waitFor(`window.__AETHER_WORKSPACE__.getState().loaded === true`), 'the workspace must load');

  // A provider at the factory default, so the middle chip is the honest answer.
  await evaluate(page, `window.__AETHER_WORKSPACE__.setState({
    providers: [{
      id: 'prov_preset', name: '本地网关', baseUrl: 'http://127.0.0.1:8788/v1',
      models: ['hy3', 'glm-5.3'], defaultModel: 'hy3', contextWindow: 100000,
      temperature: 0.3, maxSteps: 8, hasKey: true, keyHint: 'sk-…1234',
    }],
  })`);
  assert.ok(await waitFor(`!!document.querySelector('[data-edit-provider="prov_preset"]')`), 'the provider row renders');
  await evaluate(page, `document.querySelector('[data-edit-provider="prov_preset"]')?.click()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-precision-presets]')`), 'the preset chips render');

  const initial = await read();
  assert.deepEqual(initial.chips, ['precise', 'balanced', 'creative'], 'three shapes, in order');
  assert.equal(initial.temperature, '0.3');
  assert.equal(initial.steps, '8');
  assert.deepEqual(initial.pressed, ['balanced'], 'a fresh provider is balanced, not custom');
  assert.equal(initial.custom, false, 'no custom badge on a preset pair');

  // --- one click sets both halves ----------------------------------------
  await evaluate(page, `document.querySelector('[data-precision="creative"]')?.click()`);
  assert.ok(await waitFor(`document.querySelector('[data-temperature]').value === '0.7'`), 'the temperature follows the chip');
  const creative = await read();
  assert.equal(creative.steps, '20', 'the step budget follows the same click');
  assert.deepEqual(creative.pressed, ['creative']);
  assert.equal(creative.custom, false);

  await evaluate(page, `document.querySelector('[data-precision="precise"]')?.click()`);
  assert.ok(await waitFor(`document.querySelector('[data-max-steps]').value === '6'`), 'precise goes to six steps');
  const precise = await read();
  assert.equal(precise.temperature, '0.1');
  assert.deepEqual(precise.pressed, ['precise']);

  // --- a hand-tuned pair says so -----------------------------------------
  await evaluate(page, `(() => {
    const input = document.querySelector('[data-max-steps]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '14');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.ok(await waitFor(`!!document.querySelector('[data-precision-custom]')`), 'a custom step budget is labelled');
  const tuned = await read();
  assert.deepEqual(tuned.pressed, [], 'no chip claims a pair it does not describe');
  assert.equal(tuned.steps, '14');

  // --- and a chip takes it back ------------------------------------------
  await evaluate(page, `document.querySelector('[data-precision="balanced"]')?.click()`);
  assert.ok(await waitFor(`!document.querySelector('[data-precision-custom]')`), 'the custom badge clears');
  const back = await read();
  assert.equal(back.temperature, '0.3');
  assert.equal(back.steps, '8');
  assert.deepEqual(back.pressed, ['balanced']);

  await wait(300);
  await shot(page, 'docs/checks/270-precision-presets.png', { width: 1440, height: 1000 });
  console.log('PASS browser: one click sets temperature and steps, and a hand-tuned pair reads as custom');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}

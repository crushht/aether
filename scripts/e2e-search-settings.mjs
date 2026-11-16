// Web search source: a SearXNG endpoint and the engine order, as settings.
//
// Everything is local: a fake SearXNG listens on 127.0.0.1, so the script
// proves JSON parsing, the HTML fallback and "save then the agent uses it"
// without leaving the machine.
//
//   $env:AUTH_DISABLED='1'; $env:LAB_DATA_DIR='<scratch dir>'; npm run dev
//   node scripts/e2e-search-settings.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate, shot } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const PORT = Number(process.env.AETHER_FAKE_SEARX_PORT || 8899);
const endpoint = `http://127.0.0.1:${PORT}/search`;
const htmlEndpoint = `http://127.0.0.1:${PORT}/plain`;

const call = async (url, init = {}) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};
const settings = (method, body) =>
  call('/api/settings/search', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

/* ----------------------------------------------------------- fake SearXNG */

const seen = { requests: [], json: 0, html: 0 };

const JSON_HITS = [
  { title: 'Aether release notes', url: 'https://example.com/aether/releases', content: 'Every shipped change, newest first.' },
  { title: 'SearXNG documentation', url: 'https://example.com/searxng/docs', content: 'How to enable the JSON output format.' },
  { title: 'Bring your own model', url: 'https://example.com/byom', content: 'A workspace that never ships a model.' },
];

const HTML_PAGE = `<!doctype html><html><body>
  <h3><a href="https://html.example/one">HTML One</a></h3><p>first html summary</p>
  <h3><a href="https://html.example/two">HTML Two</a></h3><p>second html summary</p>
</body></html>`;

function startSearx() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
    const format = url.searchParams.get('format') ?? '';
    seen.requests.push(`${url.pathname}?${url.searchParams.toString()}`);
    if (url.pathname === '/plain') {
      if (format === 'json') {
        // A real SearXNG with `format=json` disabled answers 403; the fetcher
        // must then read the HTML on the same path.
        response.writeHead(403, { 'Content-Type': 'text/plain' });
        response.end('JSON format is disabled');
        return;
      }
      seen.html += 1;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(HTML_PAGE);
      return;
    }
    if (format === 'json') {
      seen.json += 1;
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ query: url.searchParams.get('q'), results: JSON_HITS }));
      return;
    }
    seen.html += 1;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(HTML_PAGE);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const searx = await startSearx();
console.log(`fake SearXNG on 127.0.0.1:${PORT}`);

try {
  /* -------------------------------------------------------------- API leg */

  // Known starting point: nothing saved in this data directory.
  await settings('DELETE');

  const initial = await settings('GET');
  assert.ok(initial.response.ok, `search settings must load: ${JSON.stringify(initial.json)}`);
  assert.equal(initial.json.saved, null, 'the script starts with nothing saved');
  assert.equal(initial.json.canManage, true, 'local mode is the owner, so the form is editable');
  assert.deepEqual(
    initial.json.catalog.map((engine) => engine.id),
    ['duckduckgo', 'bing', 'sogou', 'baidu', '360'],
    'the shipped chain is offered in its shipped order',
  );
  assert.ok(['default', 'env'].includes(initial.json.effective.source), 'a clean data dir falls back to env or defaults');

  // A draft endpoint can be probed before it is saved.
  const probed = await settings('POST', { query: 'aether search', url: endpoint });
  assert.ok(probed.response.ok, `the test search failed: ${JSON.stringify(probed.json)}`);
  assert.equal(probed.json.provider, `127.0.0.1:${PORT}`, 'the answer names the endpoint');
  assert.deepEqual(probed.json.results.map((hit) => hit.title), JSON_HITS.map((hit) => hit.title));
  assert.equal(seen.json, 1, 'the JSON output format was used, not the HTML layout');

  // Save: endpoint + order, normalised.
  const saved = await settings('PUT', { url: `127.0.0.1:${PORT}/search`, engines: ['baidu', 'duckduckgo', 'bing'] });
  assert.ok(saved.response.ok, `saving failed: ${JSON.stringify(saved.json)}`);
  assert.equal(saved.json.saved.url, endpoint, 'a bare local host is normalised to http://host:port/search');
  assert.deepEqual(saved.json.saved.engines, ['baidu', 'duckduckgo', 'bing'], 'the order is kept as written');
  assert.equal(saved.json.effective.kind, 'searxng', 'a /search endpoint reads as SearXNG');
  assert.equal(saved.json.effective.source, 'settings');
  assert.equal(saved.json.effective.host, `127.0.0.1:${PORT}`);

  // The agent's own tool endpoint now uses it — no restart, no env var.
  const live = await call('/api/agent/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'aether', limit: 3 }),
  });
  assert.ok(live.response.ok, `web_search failed: ${JSON.stringify(live.json)}`);
  assert.equal(live.json.source, 'settings', 'the saved source is what the tool used');
  assert.equal(live.json.provider, `127.0.0.1:${PORT}`);
  assert.equal(live.json.results.length, 3);

  // Bad endpoints are refused with a reason, not stored.
  const refused = await settings('PUT', { url: 'ftp://nope' });
  assert.equal(refused.response.status, 400);
  assert.ok(refused.json.errors?.url, `the form gets a field error: ${JSON.stringify(refused.json)}`);
  const still = await settings('GET');
  assert.equal(still.json.saved.url, endpoint, 'a refused save leaves the previous source alone');

  // An instance with `format=json` disabled still answers: HTML fallback.
  const fallback = await settings('POST', { query: 'aether', url: htmlEndpoint });
  assert.ok(fallback.response.ok, `the HTML fallback failed: ${JSON.stringify(fallback.json)}`);
  assert.deepEqual(fallback.json.results.map((hit) => hit.title), ['HTML One', 'HTML Two']);
  assert.ok(seen.html >= 1, 'the HTML layout was parsed');

  // Chain mode: no endpoint, order only.
  const chain = await settings('PUT', { url: '', engines: ['360', 'baidu'] });
  assert.ok(chain.response.ok, `chain save failed: ${JSON.stringify(chain.json)}`);
  assert.equal(chain.json.saved.url, '');
  assert.equal(chain.json.effective.kind, 'builtin');
  assert.deepEqual(chain.json.effective.engines, ['360', 'baidu']);

  console.log('PASS API: probe, save (normalised), live web_search uses it, refused endpoint, HTML fallback, chain order');

  /* ---------------------------------------------------------- browser leg */

  // Back to a pinned endpoint so the panel has something to show.
  await settings('PUT', { url: endpoint, engines: ['bing', 'baidu'] });

  let chrome = null;
  let page = null;
  try {
    chrome = await launch({ port: 9494, profile: path.join(process.env.TEMP || '.', `aether-search-${process.pid}`) });
    page = await newPage(9494);
    await viewport(page, 1280, 900);
    await goto(page, `${base}/settings/search`, 4000);
    const waitFor = async (expression, timeout = 12_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await evaluate(page, expression)) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return false;
    };

    assert.ok(await waitFor(`!!document.querySelector('[data-search-panel]')`), 'the search panel renders');
    assert.ok(
      await waitFor(`document.querySelector('[data-search-status]')?.dataset.searchKind === 'searxng'`),
      'the panel reports SearXNG',
    );
    assert.equal(
      await evaluate(page, `document.querySelector('[data-search-status]')?.dataset.searchSource ?? ''`),
      'settings',
      'and that it is saved in this workspace',
    );
    assert.equal(
      await evaluate(page, `document.querySelector('[data-search-url]')?.value ?? ''`),
      endpoint,
      'the form is filled from the saved endpoint',
    );
    assert.equal(
      await evaluate(
        page,
        `[...document.querySelectorAll('[data-engine-on="1"]')].map((row) => row.dataset.searchEngine).join(',')`,
      ),
      'bing,baidu',
      'the engine rows follow the saved priority',
    );

    // Reorder from the UI, then save: the API agrees afterwards.
    await evaluate(page, `document.querySelector('[data-search-engine="bing"] [data-engine-down]')?.click()`);
    assert.ok(
      await waitFor(
        `[...document.querySelectorAll('[data-engine-on="1"]')].map((row) => row.dataset.searchEngine).join(',') === 'baidu,bing'`,
      ),
      'the arrow moves the engine down',
    );
    await evaluate(page, `document.querySelector('[data-search-save]')?.click()`);
    assert.ok(await waitFor(`!!document.querySelector('[data-search-note]')`), 'a successful save reports back');
    const afterMove = await settings('GET');
    assert.deepEqual(afterMove.json.saved.engines, ['baidu', 'bing'], 'the new order is stored');

    // Test the endpoint from the panel: three hits, all links http(s).
    await evaluate(page, `document.querySelector('[data-search-test]')?.click()`);
    assert.ok(
      await waitFor(`document.querySelector('[data-search-test-result]')?.dataset.testOk === '1'`),
      'the test search answers',
    );
    assert.ok(
      await waitFor(`document.querySelectorAll('[data-search-hit]').length >= 1`),
      'at least one hit is rendered',
    );
    assert.equal(
      await evaluate(page, `document.querySelector('[data-search-test-provider]')?.textContent ?? ''`),
      `127.0.0.1:${PORT}`,
      'the provider is named',
    );
    const linkProtocols = await evaluate(
      page,
      `[...document.querySelectorAll('[data-search-hit] a')].map((a) => new URL(a.href).protocol).join(',')`,
    );
    assert.match(linkProtocols, /^https?:/, 'hit links stay http(s)');

    // Evidence for docs: the panel after a successful save and test.
    await shot(page, process.env.AETHER_SEARCH_SHOT || path.join(process.env.TEMP || '.', 'aether-search-settings.png'));

    // A rejected endpoint leaves an inline error instead of a silent failure.
    await evaluate(
      page,
      `(() => {
        const input = document.querySelector('[data-search-url]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'ftp://nope');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-search-save]').click();
      })()`,
    );
    assert.ok(await waitFor(`!!document.querySelector('[data-search-error]')`), 'an unusable endpoint shows an error');
    const message = await evaluate(page, `document.querySelector('[data-search-error]')?.textContent ?? ''`);
    assert.match(message, /http/, `the error explains the rule: ${message}`);

    await shot(page, path.join(process.env.TEMP || '.', 'aether-search-settings-error.png'));
    console.log('PASS browser: panel, saved source, engine reorder, test search and inline error');
  } catch (error) {
    console.log(`SKIP browser leg: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    page?.ws?.close();
    chrome?.proc?.kill();
  }

  /* -------------------------------------------------------------- reset */

  const cleared = await settings('DELETE');
  assert.ok(cleared.response.ok, 'clearing the saved source works');
  assert.equal(cleared.json.saved, null, 'nothing is saved afterwards');
  assert.ok(['default', 'env'].includes(cleared.json.effective.source), 'clearing falls back to env or the shipped chain');
  console.log('PASS API: clearing falls back to AETHER_SEARCH_URL / the shipped chain');
} finally {
  await new Promise((resolve) => searx.close(resolve));
}

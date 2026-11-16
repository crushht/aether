/** Pure logic smoke tests; no external test runner required. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

async function loadTs(file, replacements = {}) {
  const source = readFile(file, 'utf8');
  const output = ts.transpileModule(await source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (replacements[id]) return replacements[id];
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(file), `${id}.ts`);
      return require.cache?.[target] ?? null;
    }
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'module', 'exports', output)(require, module, module.exports);
  return module.exports;
}

async function run() {
  const { compactMessages, contextTokens } = await loadTs(path.resolve('lib/agent/compact.ts'));
  const many = [{ role: 'system', content: 'system' }];
  for (let i = 0; i < 12; i++) many.push({ role: 'user', content: `question ${i} ${'x'.repeat(600)}` }, { role: 'assistant', content: 'answer', toolCalls: [{ id: `call-${i}`, name: 'list_issues', args: {} }] }, { role: 'tool', toolCallId: `call-${i}`, content: '[]' });
  const compacted = compactMessages(many, 1200);
  assert.equal(compacted[0].role, 'system');
  assert.equal(compacted.at(-1).role, 'tool');
  assert.ok(compacted.length < many.length);
  for (const message of compacted) if (message.role === 'tool') assert.ok(compacted.some((entry) => entry.toolCalls?.some((call) => call.id === message.toolCallId)));
  assert.ok(contextTokens(compacted) < contextTokens(many));

  // Lexical retrieval: CJK bigrams, overlapping chunks and chunk-level ranking.
  const search = await loadTs(path.resolve('lib/agent/search.ts'));
  const tokens = search.searchTokens('发布节奏');
  assert.ok(tokens.includes('发布') && tokens.includes('布节') && tokens.includes('节奏'), 'CJK bigrams must be indexed');
  const long = `${'A'.repeat(500)}\n\n${'B'.repeat(400)}\n\n${'release notes'.repeat(120)}`;
  const chunks = search.chunkText(long, 400, 60);
  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
  assert.ok(chunks.every((chunk, index) => index === 0 || chunk.start > 0), 'chunks must carry offsets');
  const entries = [
    { id: 'k1', title: 'General notes', content: `${'filler '.repeat(200)}\n\nthe deployment checklist lives here`, tags: [], kind: 'note', at: 1, updatedAt: 1, chars: 1 },
    { id: 'k2', title: 'deployment', content: 'unrelated body', tags: [], kind: 'note', at: 1, updatedAt: 2, chars: 1 },
  ];
  const ranked = search.rankKnowledgeChunks(entries, 'deployment', 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].item.id, 'k2', 'a title hit must outrank a body-only hit');
  const bodyHit = ranked.find((row) => row.item.id === 'k1');
  assert.ok(bodyHit?.chunk, 'a body hit must cite a chunk');
  assert.equal(search.rankKnowledge(entries, 'deployment', 1)[0].id, 'k2');

  // Hybrid retrieval: cosine math, and a lexical fallback when no embedding
  // endpoint is reachable (the Node test environment has no relative fetch).
  const semantic = await loadTs(path.resolve('lib/agent/semantic.ts'), { './search': search });
  assert.ok(Math.abs(semantic.cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(semantic.cosine([1, 0], [0, 1]), 0);
  assert.equal(semantic.cosine([], [1, 2]), 0);
  const hybrid = await semantic.hybridRankKnowledge(entries, 'deployment', 2);
  assert.equal(hybrid.mode, 'lexical', 'without an embedding endpoint it must fall back to lexical');
  assert.equal(hybrid.rows[0].item.id, 'k2');

  // Connector URL rules: same-origin paths only; plain http only for localhost.
  const connectors = await loadTs(path.resolve('lib/agent/connectors.ts'));
  assert.equal(connectors.connectorUrl('https://api.github.com', '/repos/acme/app'), 'https://api.github.com/repos/acme/app');
  assert.equal(connectors.connectorUrl('https://api.github.com/base/', 'issues'), 'https://api.github.com/base/issues');
  assert.equal(connectors.connectorUrl('https://api.github.com', 'https://evil.example/x'), null);
  assert.equal(connectors.connectorUrl('https://api.github.com', '//evil.example/x'), null);
  assert.equal(connectors.connectorUrl('http://127.0.0.1:9000', '/health'), 'http://127.0.0.1:9000/health');
  assert.equal(connectors.connectorUrl('http://example.com', '/x'), null);
  assert.equal(connectors.connectorUrl('ftp://example.com', '/x'), null);
  assert.equal(connectors.isReadOnlyConnectorMethod('GET'), true);
  assert.equal(connectors.isReadOnlyConnectorMethod('HEAD'), true);
  assert.equal(connectors.isReadOnlyConnectorMethod('POST'), false);

  const requireCjs = createRequire(import.meta.url);
  const updater = requireCjs(path.resolve('desktop/update.cjs'));
  const windowState = requireCjs(path.resolve('desktop/window-state.cjs'));
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(windowState.sanitizeWindowState({ width: 1200, height: 800 }, [primary]), {
    width: 1200, height: 800, maximized: false,
  });
  assert.equal(windowState.sanitizeWindowState({ width: 100, height: 100 }, [primary]).width, 900, 'minimum width');
  assert.equal(windowState.sanitizeWindowState({ width: 5000, height: 5000 }, [primary]).width, 1920, 'clamped to the screen');
  assert.deepEqual(windowState.sanitizeWindowState({ width: 1200, height: 800, x: 200, y: 100, maximized: true }, [primary]), {
    width: 1200, height: 800, x: 200, y: 100, maximized: true,
  });
  const offscreen = windowState.sanitizeWindowState({ width: 1200, height: 800, x: 9000, y: 9000 }, [primary]);
  assert.equal(offscreen.x, undefined, 'an off-screen window is re-centred');
  assert.equal(offscreen.height, 800);  assert.ok(updater.compareVersions('0.4.0', '0.3.9') > 0);
  assert.equal(updater.compareVersions('v1.2.3', '1.2.3'), 0);
  assert.ok(updater.compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(updater.compareVersions('garbage', '1.0.0'), -1);
  assert.equal(updater.pickUpdate({ version: '0.3.0', url: 'https://example.com/a' }, '0.3.0'), null);
  assert.equal(updater.pickUpdate({ version: '0.4.0' }, '0.3.0'), null);
  assert.equal(updater.pickUpdate({ version: '0.4.0', url: 'ftp://example.com/a' }, '0.3.0'), null);
  assert.deepEqual(updater.pickUpdate({ version: '0.4.0', url: 'https://example.com/a', notes: 'x' }, '0.3.0'), {
    version: '0.4.0',
    url: 'https://example.com/a',
    notes: 'x',
  });

  // Run export: readable Markdown with the trace, sanitized filename.
  const exporter = await loadTs(path.resolve('lib/agent/run-export.ts'));
  const exported = exporter.runToMarkdown(
    { id: 'wf1', name: 'Nightly triage' },
    {
      id: 'run_abc', at: 1_700_000_000_000, status: 'ok', summary: 'All clear', steps: 2, tools: 1,
      model: 'demo', issueKey: 'ENG-9', events: [
        { kind: 'step', text: 'Step 1: 1 tool call(s)', at: 1_700_000_000_500 },
        { kind: 'tool', text: 'list_issues ok', at: 1_700_000_001_000, ok: true },
        { kind: 'final', text: 'Done', at: 1_700_000_002_000 },
      ],
    },
  );
  assert.ok(exported.includes('# Nightly triage'), 'title');
  assert.ok(exported.includes('Status: ok') && exported.includes('ENG-9'), 'metadata');
  assert.ok(exported.includes('**tool**') && exported.includes('list_issues'), 'trace');
  const emptyExport = exporter.runToMarkdown({ id: 'wf2', name: 'Empty' }, { id: 'r', at: 0, status: 'ok', summary: '', steps: 0, tools: 0 });
  assert.ok(emptyExport.includes('No step details'), 'empty trace is explicit');
  assert.equal(exporter.runFileName({ name: 'A/B test?' }, { id: 'run_1' }, 'md'), 'A-B-test-run_1.md');

  // Project context: instructions, health, recent updates and issue lines.
  const projectContext = await loadTs(path.resolve('lib/agent/project-context.ts'));
  const project = {
    id: 'p1', name: 'Search', summary: 'Search rebuild', status: 'in_progress', health: 'at_risk',
    agentInstructions: 'Prefer small PRs.', updates: [
      { id: 'u1', body: 'Index migration done', health: 'on_track', authorId: 'me', createdAt: '' },
      { id: 'u2', body: 'Rollout paused for review', health: 'at_risk', authorId: 'me', createdAt: '' },
    ],
  };
  const context = projectContext.projectContextText(project, [
    { key: 'ENG-1', title: 'Wire index', status: 'in_progress', priority: 'high', projectId: 'p1' },
    { key: 'ENG-2', title: 'Unrelated', status: 'todo', priority: 'low', projectId: 'p2' },
  ], { maxUpdates: 1 });
  assert.ok(context.includes('Project: Search'), 'project name');
  assert.ok(context.includes('Prefer small PRs.'), 'instructions');
  assert.ok(context.includes('at risk'), 'health');
  assert.ok(context.includes('Index migration done') && !context.includes('Rollout paused'), 'only recent updates');
  assert.ok(context.includes('ENG-1') && !context.includes('ENG-2'), 'only project issues');
  assert.ok(projectContext.projectContextText({ ...project, updates: [] }, []).includes('No issues in this project yet.'), 'empty project');

  // Project health series: sorted, filtered to explicit observations.
  const health = await loadTs(path.resolve('lib/project-health.ts'));
  const series = health.healthSeries({
    updates: [
      { id: 'u3', body: '', health: 'off_track', authorId: 'a', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'u1', body: '', health: 'on_track', authorId: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'u2', body: '', authorId: 'a', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'u4', body: '', health: 'at_risk', authorId: 'a', createdAt: '2026-01-02T12:00:00.000Z' },
    ],
  });
  assert.deepEqual(series.map((point) => point.updateId), ['u1', 'u4', 'u3'], 'health points are filtered and sorted');
  assert.equal(health.HEALTH_Y.on_track < health.HEALTH_Y.off_track, true);
  assert.ok(health.HEALTH_COLOR.at_risk.includes('orange'));

  // Template transfer: bundle round-trip and input sanitising.
  const types = await loadTs(path.resolve('lib/types.ts'));
  const transfer = await loadTs(path.resolve('lib/template-transfer.ts'), { '@/lib/types': types });
  const issueTemplate = {
    id: 't1', name: 'Bug report', title: 'Fix checkout', description: 'Steps', status: 'todo',
    priority: 'high', labelIds: ['l1'], projectId: null, estimate: 3, createdAt: 1,
  };
  const projectTemplate = {
    id: 'p1', name: 'Launch', summary: 'Ship it', agentInstructions: 'Small PRs',
    knowledgeIds: ['k1'], health: 'at_risk', createdAt: 1,
  };
  const bundle = transfer.buildTemplateBundle([issueTemplate], [projectTemplate]);
  const parsed = transfer.parseTemplateBundle(bundle);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.issueTemplates[0].title, 'Fix checkout');
  assert.equal(parsed.projectTemplates[0].health, 'at_risk');
  assert.equal(transfer.parseTemplateBundle('{not json').error, 'invalid-json');
  assert.equal(transfer.parseTemplateBundle('{}').error, 'empty');
  assert.equal(transfer.parseTemplateBundle('[]').error, 'invalid-shape');
  const dirty = transfer.parseTemplateBundle(JSON.stringify({
    issueTemplates: [{ name: 'A', title: 'B', status: 'bogus', priority: 'bogus' }, { name: '', title: 'skipped' }],
    projectTemplates: [{ name: 'P', health: 'bogus' }],
  }));
  assert.equal(dirty.ok, true);
  assert.equal(dirty.issueTemplates.length, 1);
  assert.equal(dirty.issueTemplates[0].status, 'todo');
  assert.equal(dirty.issueTemplates[0].priority, 'none');
  assert.equal(dirty.projectTemplates[0].health, 'on_track');
  const capped = transfer.parseTemplateBundle(JSON.stringify({
    issueTemplates: Array.from({ length: 150 }, (_, index) => ({ name: `T${index}`, title: `Title ${index}` })),
  }));
  assert.equal(capped.issueTemplates.length, 100, 'imports are capped');

  // Quiet hours: normal window, cross-midnight window, disabled, all day.
  const quiet = await loadTs(path.resolve('lib/notification-quiet.ts'));
  const at = (hour) => new Date(2026, 0, 1, hour, 30);
  assert.equal(quiet.inQuietHours({ enabled: true, start: 22, end: 8 }, at(23)), true);
  assert.equal(quiet.inQuietHours({ enabled: true, start: 22, end: 8 }, at(3)), true);
  assert.equal(quiet.inQuietHours({ enabled: true, start: 22, end: 8 }, at(8)), false);
  assert.equal(quiet.inQuietHours({ enabled: true, start: 22, end: 8 }, at(12)), false);
  assert.equal(quiet.inQuietHours({ enabled: true, start: 9, end: 17 }, at(12)), true);
  assert.equal(quiet.inQuietHours({ enabled: false, start: 22, end: 8 }, at(23)), false);
  assert.equal(quiet.inQuietHours({ enabled: true, start: 10, end: 10 }, at(4)), true, 'equal hours means all day');
  assert.equal(quiet.canNotifyDesktop(true, { enabled: true, start: 22, end: 8 }, at(23)), false);
  assert.equal(quiet.canNotifyDesktop(true, { enabled: true, start: 22, end: 8 }, at(12)), true);
  assert.equal(quiet.canNotifyDesktop(false, { enabled: false, start: 22, end: 8 }, at(12)), false);
  assert.equal(quiet.normalizeQuiet({ enabled: true, start: 99, end: -1 }).start, 22, 'invalid hours fall back');

  // Desktop notification click routing: project wins, then issue, else nothing.
  const route = await loadTs(path.resolve('lib/desktop-notification-route.ts'));
  assert.deepEqual(route.routeForNotification({ projectId: 'p1', issueId: 'i1' }), { kind: 'project', id: 'p1' });
  assert.deepEqual(route.routeForNotification({ projectId: '', issueId: 'i1' }), { kind: 'issue', id: 'i1' });
  assert.equal(route.routeForNotification({ projectId: '  ', issueId: '  ' }), null);
  assert.equal(route.routeForNotification(null), null);

  // Daily digest: local-day counting, digests excluded, malformed dates skipped.
  const digest = await loadTs(path.resolve('lib/notification-digest.ts'));
  const today = new Date(2026, 2, 5, 10, 0);
  const todayKey = digest.localDayKey(today);
  assert.equal(digest.localDayKey(new Date(2026, 2, 5, 23, 59)), todayKey, 'day key is local');
  const summary = digest.summarizeDay(
    [
      { id: '1', kind: 'mention', createdAt: new Date(2026, 2, 5, 9, 0).toISOString() },
      { id: '2', kind: 'project_update', createdAt: new Date(2026, 2, 5, 12, 0).toISOString() },
      { id: '3', kind: 'project_update', createdAt: new Date(2026, 2, 5, 13, 0).toISOString() },
      { id: '4', kind: 'digest', createdAt: new Date(2026, 2, 5, 14, 0).toISOString() },
      { id: '5', kind: 'agent', createdAt: new Date(2026, 2, 4, 23, 0).toISOString() },
      { id: '6', kind: 'cycle', createdAt: 'not a date' },
    ],
    todayKey,
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.counts.mention, 1);
  assert.equal(summary.counts.project_update, 2);
  assert.equal(summary.counts.agent, 0);

  // Project audit export: header, filter note, entries and empty case.
  const auditExport = await loadTs(path.resolve('lib/project-audit-export.ts'));
  const auditMarkdown = auditExport.auditToMarkdown(
    { id: 'p1', name: 'Search rebuild' },
    [
      { id: 'a1', updateId: 'u1', action: 'edited', actorId: 'me', at: '2026-03-05T10:00:00.000Z', summary: 'body' },
      { id: 'a2', updateId: 'u1', action: 'created', actorId: 'me', at: '2026-03-04T10:00:00.000Z', summary: 'first' },
    ],
    { authorName: () => 'YG', filterLabel: 'all / YG' },
  );
  assert.ok(auditMarkdown.includes('# Search rebuild · update audit'), 'title');
  assert.ok(auditMarkdown.includes('- Records: 2') && auditMarkdown.includes('- Filter: all / YG'), 'header');
  assert.ok(auditMarkdown.includes('**edited** · YG · body'), 'entry');
  assert.ok(auditMarkdown.includes('**created** · YG · first'), 'second entry');
  assert.ok(auditExport.auditToMarkdown({ id: 'p', name: 'P' }, []).includes('No audit records matched'), 'empty case');
  assert.match(auditExport.auditFileName({ name: 'A/B audit?' }), /^A-B-audit-\d{4}-\d{2}-\d{2}\.md$/);
  const auditJson = JSON.parse(
    auditExport.auditToJson(
      { id: 'p1', name: 'Search rebuild' },
      [{ id: 'a1', updateId: 'u1', action: 'deleted', actorId: 'me', at: '2026-03-05T10:00:00.000Z', summary: 'old' }],
      { authorName: () => 'YG', filterLabel: 'deleted / YG' },
    ),
  );
  assert.equal(auditJson.kind, 'project-audit');
  assert.equal(auditJson.project.name, 'Search rebuild');
  assert.equal(auditJson.filter, 'deleted / YG');
  assert.equal(auditJson.records.length, 1);
  assert.equal(auditJson.records[0].actorName, 'YG');
  assert.equal(auditJson.records[0].action, 'deleted');
  assert.deepEqual(JSON.parse(auditExport.auditToJson({ id: 'p', name: 'P' }, [])).records, []);

  // Reaction summary: weekly buckets, Monday keys, window and ordering.
  const reactions = await loadTs(path.resolve('lib/project-reactions-summary.ts'));
  const reactionWeeks = reactions.summarizeReactions(
    {
      updates: [
        { id: 'u1', body: '', authorId: 'a', createdAt: '2026-11-10T10:00:00', likedBy: ['a', 'b'], acknowledgedBy: ['a'] },
        { id: 'u2', body: '', authorId: 'a', createdAt: '2026-11-05T10:00:00', likedBy: ['a'] },
        { id: 'u3', body: '', authorId: 'a', createdAt: '2026-11-11T10:00:00' },
        { id: 'u4', body: '', authorId: 'a', createdAt: '2026-09-01T10:00:00', likedBy: ['a'] },
      ],
    },
    new Date(2026, 10, 14, 12),
  );
  assert.deepEqual(reactionWeeks.map((week) => week.weekStart), ['2026-11-09', '2026-11-02']);
  assert.equal(reactionWeeks[0].likes, 2);
  assert.equal(reactionWeeks[0].acks, 1);
  assert.equal(reactionWeeks[0].updates, 2);
  assert.equal(reactionWeeks[1].likes, 1);
  assert.equal(reactions.startOfWeek(new Date(2026, 10, 15)).getDay(), 1, 'weeks start on Monday');

  // Weekly export: range, entries with health and reaction counts, empty week.
  const weekly = await loadTs(path.resolve('lib/weekly-export.ts'));
  const weeklyMd = weekly.weekToMarkdown(
    { id: 'p1', name: 'Search rebuild' },
    '2026-11-09',
    [
      { id: 'u1', body: 'Shipped **beta**', authorId: 'me', health: 'on_track', createdAt: '2026-11-10T10:00:00.000Z', likedBy: ['a', 'b'], acknowledgedBy: ['a'], attachments: [{ id: 'f1', name: 'shot.png', mime: 'image/png', size: 5, uploaderId: 'me', createdAt: '2026-11-10T10:00:00.000Z' }] },
      { id: 'u2', body: 'Risk logged', authorId: 'you', health: 'at_risk', createdAt: '2026-11-12T10:00:00.000Z', likedBy: [], acknowledgedBy: [] },
    ],
    { authorName: (id) => (id === 'me' ? 'YG' : 'Kim') },
  );
  assert.ok(weeklyMd.includes('# Search rebuild · weekly update report'), 'title');
  assert.ok(weeklyMd.includes('- Week: 2026-11-09 → 2026-11-15'), 'week range');
  assert.ok(weeklyMd.includes('- Updates: 2'), 'count');
  assert.ok(weeklyMd.includes('· YG · on_track'), 'author and health');
  assert.ok(weeklyMd.includes('Reactions: 2 like(s) · 1 acknowledgement(s)'), 'reactions');
  assert.ok(weeklyMd.includes('Attachments: shot.png'), 'weekly export lists attachments');
  assert.ok(weekly.weekToMarkdown({ id: 'p', name: 'P' }, '2026-11-09', []).includes('No updates in this week'), 'empty week');
  assert.equal(weekly.weekFileName({ name: 'A/B' }, '2026-11-09'), 'A-B-2026-11-09.md');
  const weeksMd = weekly.weeksToMarkdown(
    { id: 'p1', name: 'Search rebuild' },
    [
      { weekStart: '2026-11-09', likes: 3, acks: 1, updates: 2 },
      { weekStart: '2026-11-02', likes: 0, acks: 0, updates: 1 },
      { weekStart: '2026-10-26', likes: 0, acks: 0, updates: 0 },
    ],
    [
      { id: 'u1', body: 'Shipped beta', authorId: 'me', health: 'on_track', createdAt: '2026-11-10T10:00:00', likedBy: ['a', 'b', 'c'], acknowledgedBy: ['a'] },
      { id: 'u2', body: 'Risk', authorId: 'you', createdAt: '2026-11-04T10:00:00' },
    ],
    { authorName: (id) => (id === 'me' ? 'YG' : 'Kim') },
  );
  assert.ok(weeksMd.includes('# Search rebuild · recent weekly reports'), 'weeks title');
  assert.ok(weeksMd.includes('- Weeks: 3'), 'weeks count');
  assert.ok(weeksMd.includes('## 2026-11-09 → 2026-11-15') && weeksMd.includes('## 2026-11-02 → 2026-11-08'), 'two ranges');
  assert.ok(weeksMd.includes('· YG · on_track') && weeksMd.includes('Reactions: 3 like(s) · 1 acknowledgement(s)'), 'entry');
  assert.ok(weeksMd.includes('## 2026-10-26 → 2026-11-01') && weeksMd.includes('_No updates in this week._'), 'empty week section');
  assert.match(weekly.weeksFileName({ name: 'A/B' }), /^A-B-weekly-reports-\d{4}-\d{2}-\d{2}\.md$/);

  // Highlight: case-insensitive segments and a clipped match snippet.
  const highlight = await loadTs(path.resolve('lib/highlight.ts'));
  const segments = highlight.highlightSegments('Alpha rollout ALPHA done', 'alpha');
  assert.deepEqual(segments.filter((segment) => segment.hit).map((segment) => segment.text), ['Alpha', 'ALPHA']);
  assert.deepEqual(highlight.highlightSegments('no match', 'zzz'), [{ text: 'no match', hit: false }]);
  assert.deepEqual(highlight.highlightSegments('anything', ''), [{ text: 'anything', hit: false }]);
  const longText = `${'x'.repeat(100)}needle${'y'.repeat(100)}`;
  const snippet = highlight.matchSnippet(longText, 'needle', 10);
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…') && snippet.includes('needle'), 'snippet clips around the match');
  assert.equal(highlight.matchSnippet('short text', 'text', 40), 'short text');
  assert.equal(highlight.matchSnippet('short text', 'missing'), '');

  // Audit range: all time, this week, this month and malformed timestamps.
  const auditRange = await loadTs(path.resolve('lib/audit-range.ts'));
  const now = new Date(2026, 10, 14, 12);
  assert.equal(auditRange.inAuditRange('2026-11-10T10:00:00', 'week', now), true);
  assert.equal(auditRange.inAuditRange('2026-11-08T10:00:00', 'week', now), false, 'Sunday before Monday is out');
  assert.equal(auditRange.inAuditRange('2026-11-01T10:00:00', 'month', now), true);
  assert.equal(auditRange.inAuditRange('2026-10-31T10:00:00', 'month', now), false);
  assert.equal(auditRange.inAuditRange('2026-01-01T00:00:00', 'all', now), true);
  assert.equal(auditRange.inAuditRange('not a date', 'week', now), false);
  assert.equal(auditRange.auditRangeStart('all', now), null);
  assert.equal(new Date(auditRange.auditRangeStart('week', now)).getDay(), 1, 'week starts Monday');

  // Project summary: state, progress, instructions, updates and audit counts.
  const summaryExport = await loadTs(path.resolve('lib/project-summary.ts'));
  const summaryMd = summaryExport.projectSummaryMarkdown(
    {
      id: 'p1', name: 'Search rebuild', summary: 'Search v2', status: 'in_progress', health: 'at_risk',
      targetDate: '2026-12-01T00:00:00.000Z', leadId: 'me', memberIds: ['me', 'you'],
      agentInstructions: 'Small PRs only.', updates: [
        { id: 'u1', body: 'Beta shipped', authorId: 'me', health: 'on_track', createdAt: '2026-11-10T10:00:00.000Z', likedBy: ['a'], acknowledgedBy: ['b'], attachments: [{ id: 'f1', name: 'plan.pdf', mime: 'application/pdf', size: 10, uploaderId: 'me', createdAt: '2026-11-10T10:00:00.000Z' }] },
      ],
      updateAudit: [
        { id: 'a1', updateId: 'u1', action: 'created', actorId: 'me', at: '2026-11-10T10:00:00.000Z' },
        { id: 'a2', updateId: 'u1', action: 'liked', actorId: 'me', at: '2026-11-10T11:00:00.000Z' },
        { id: 'a3', updateId: 'u1', action: 'liked', actorId: 'you', at: '2026-11-10T12:00:00.000Z' },
      ],
    },
    [
      { id: 'i1', key: 'ENG-1', title: 'A', status: 'done', priority: 'high', projectId: 'p1' },
      { id: 'i2', key: 'ENG-2', title: 'B', status: 'done', priority: 'low', projectId: 'p1' },
      { id: 'i3', key: 'ENG-3', title: 'C', status: 'in_progress', priority: 'medium', projectId: 'p1' },
      { id: 'i4', key: 'ENG-4', title: 'D', status: 'todo', priority: 'low', projectId: 'p2' },
    ],
    { authorName: (id) => (id === 'me' ? 'YG' : 'Kim'), now: new Date('2026-11-14T12:00:00.000Z') },
  );
  assert.ok(summaryMd.includes('# Search rebuild · project summary'), 'title');
  assert.ok(summaryMd.includes('- Status: in_progress') && summaryMd.includes('- Health: at_risk'), 'state');
  assert.ok(summaryMd.includes('- Progress: 67% · 2 done · 1 open · 3 total'), 'progress');
  assert.ok(summaryMd.includes('- Lead: YG · members: 2'), 'people');
  assert.ok(summaryMd.includes('Small PRs only.'), 'instructions');
  assert.ok(summaryMd.includes('## Issues (3)'), 'issue section');
  assert.ok(summaryMd.includes('### done (2)') && summaryMd.includes('### in_progress (1)'), 'issues grouped by status');
  assert.ok(summaryMd.includes('ENG-1 · A · high') && summaryMd.includes('ENG-3 · C · medium'), 'issue lines');
  assert.ok(!summaryMd.includes('ENG-4'), 'other projects are excluded');
  assert.ok(summaryMd.includes('Beta shipped') && summaryMd.includes('Reactions: 1 like(s) · 1 acknowledgement(s)'), 'updates');
  assert.ok(summaryMd.includes('Attachments: plan.pdf'), 'update attachments are listed');
  assert.ok(summaryMd.includes('## Audit (3 records)') && summaryMd.includes('- liked: 2') && summaryMd.includes('- created: 1'), 'audit counts');
  assert.match(summaryExport.projectSummaryFileName({ name: 'A/B' }), /^A-B-summary-\d{4}-\d{2}-\d{2}\.md$/);
  const summaryJson = JSON.parse(
    summaryExport.projectSummaryJson(
      {
        id: 'p1', name: 'Search rebuild', summary: 'Search v2', status: 'in_progress', health: 'at_risk',
        targetDate: '2026-12-01T00:00:00.000Z', leadId: 'me', memberIds: ['me', 'you'],
        agentInstructions: 'Small PRs only.', updates: [
          { id: 'u1', body: 'Beta shipped', authorId: 'me', health: 'on_track', createdAt: '2026-11-10T10:00:00.000Z', likedBy: ['a'], acknowledgedBy: ['b'], attachments: [{ id: 'f1', name: 'plan.pdf', mime: 'application/pdf', size: 10, uploaderId: 'me', createdAt: '2026-11-10T10:00:00.000Z' }] },
        ],
        updateAudit: [
          { id: 'a1', updateId: 'u1', action: 'created', actorId: 'me', at: '2026-11-10T10:00:00.000Z' },
          { id: 'a2', updateId: 'u1', action: 'liked', actorId: 'me', at: '2026-11-10T11:00:00.000Z' },
        ],
      },
      [
        { id: 'i1', key: 'ENG-1', title: 'A', status: 'done', priority: 'high', projectId: 'p1' },
        { id: 'i2', key: 'ENG-2', title: 'B', status: 'done', priority: 'low', projectId: 'p1' },
        { id: 'i3', key: 'ENG-3', title: 'C', status: 'in_progress', priority: 'medium', projectId: 'p1' },
        { id: 'i4', key: 'ENG-4', title: 'D', status: 'todo', priority: 'low', projectId: 'p2' },
      ],
      { authorName: (id) => (id === 'me' ? 'YG' : 'Kim'), now: new Date('2026-11-14T12:00:00.000Z') },
    ),
  );
  assert.equal(summaryJson.kind, 'project-summary');
  assert.equal(summaryJson.project.leadName, 'YG');
  assert.deepEqual(summaryJson.progress, { percent: 67, done: 2, open: 1, total: 3 });
  assert.equal(summaryJson.issues.length, 3);
  assert.equal(summaryJson.updates[0].attachments[0], 'plan.pdf');
  assert.equal(summaryJson.audit.liked, 1);

  // Invite links: no code, a code, trimming and reading from a search string.
  const invite = await loadTs(path.resolve('lib/invite.ts'));
  assert.equal(invite.inviteLink('https://app.example', null), 'https://app.example/');
  assert.equal(invite.inviteLink('https://app.example/', ' abc 123 '), 'https://app.example/?invite=abc%20123');
  assert.equal(invite.inviteLink('http://localhost:4321', 'code'), 'http://localhost:4321/?invite=code');
  assert.equal(invite.inviteCodeFromSearch('?invite=abc'), 'abc');
  assert.equal(invite.inviteCodeFromSearch('?invite=%20abc%20'), 'abc');
  assert.equal(invite.inviteCodeFromSearch(''), '');

  // Session UA labels: browser and OS, never the raw string.
  const ua = await loadTs(path.resolve('lib/ua.ts'));
  assert.equal(
    ua.describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'),
    'Chrome · Windows',
  );
  assert.equal(ua.describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1) Gecko/20100101 Firefox/121.0'), 'Firefox · macOS');
  assert.equal(ua.describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'), 'Safari · iOS');
  assert.equal(ua.describeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0'), 'Edge · Windows');
  assert.equal(ua.describeUserAgent(''), 'Unknown device');

  // Tool approval: read-only and allowed tools skip the prompt.
  const approval = await loadTs(path.resolve('lib/agent/tool-approval.ts'));
  const baseApproval = { requireApproval: true, isReadOnly: false, allowed: [], name: 'update_issue' };
  assert.equal(approval.needsToolApproval(baseApproval), true);
  assert.equal(approval.needsToolApproval({ ...baseApproval, requireApproval: false }), false);
  assert.equal(approval.needsToolApproval({ ...baseApproval, isReadOnly: true }), false);
  assert.equal(approval.needsToolApproval({ ...baseApproval, allowed: ['update_issue'] }), false);
  assert.equal(approval.needsToolApproval({ ...baseApproval, allowed: ['other_tool'] }), true);

  // Notification retention: archived items expire, active and malformed stay.
  const retention = await loadTs(path.resolve('lib/notification-retention.ts'));
  const retentionNow = new Date('2026-11-14T12:00:00.000Z').getTime();
  const archivedOld = { id: 'n1', kind: 'agent', issueId: '', createdAt: '2026-09-01T00:00:00.000Z', archivedAt: '2026-10-01T00:00:00.000Z' };
  const archivedNew = { id: 'n2', kind: 'agent', issueId: '', createdAt: '2026-11-01T00:00:00.000Z', archivedAt: '2026-11-10T00:00:00.000Z' };
  const active = { id: 'n3', kind: 'agent', issueId: '', createdAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(retention.isExpiredArchive(archivedOld, retentionNow), true);
  assert.equal(retention.isExpiredArchive(archivedNew, retentionNow), false);
  assert.equal(retention.isExpiredArchive(active, retentionNow), false);
  assert.deepEqual(retention.pruneExpiredArchives([archivedOld, archivedNew, active], retentionNow).map((item) => item.id), ['n2', 'n3']);

  // Inbox day buckets: local today/yesterday/earlier and invalid input.
  const inboxGroups = await loadTs(path.resolve('lib/inbox-groups.ts'));
  const dayNow = new Date(2026, 10, 14, 12);
  assert.equal(inboxGroups.inboxDay(new Date(2026, 10, 14, 9).toISOString(), dayNow), 'today');
  assert.equal(inboxGroups.inboxDay(new Date(2026, 10, 13, 23).toISOString(), dayNow), 'yesterday');
  assert.equal(inboxGroups.inboxDay(new Date(2026, 10, 10, 9).toISOString(), dayNow), 'earlier');
  assert.equal(inboxGroups.inboxDay('not a date', dayNow), 'earlier');

  // Login rate limiting: sliding window, retry hint and expiry.
  const limiter = await loadTs(path.resolve('lib/server/rate-limit.ts'));
  limiter.resetRateLimits();
  const start = 1_000_000;
  assert.equal(limiter.rateLimit('ip', 2, 1_000, start).ok, true);
  assert.equal(limiter.rateLimit('ip', 2, 1_000, start + 10).ok, true);
  const blockedLimit = limiter.rateLimit('ip', 2, 1_000, start + 20);
  assert.equal(blockedLimit.ok, false);
  assert.ok(blockedLimit.retryAfterSeconds >= 1);
  assert.equal(limiter.rateLimit('ip', 2, 1_000, start + 1_500).ok, true, 'the window expires');
  limiter.clearRateLimit('ip');
  assert.equal(limiter.rateLimit('ip', 2, 1_000, start + 1_600).ok, true, 'a successful sign-in clears it');

  // Persisted store helpers: malformed JSON, type filtering, caps and quota failure.
  const storage = await loadTs(path.resolve('lib/store/storage.ts'));
  const memory = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        if (key === 'boom') throw new Error('quota');
        memory.set(key, value);
      },
    },
  };
  assert.deepEqual(storage.readStorage('missing', () => null, ['fallback']), ['fallback']);
  memory.set('bad', '{not json');
  assert.deepEqual(storage.readStorage('bad', (value) => (Array.isArray(value) ? value : null), []), []);
  memory.set('mixed', JSON.stringify(['a', 1, 'b']));
  assert.deepEqual(storage.readStorage('mixed', (value) => storage.isStringArray(value, 1), []), ['a']);
  assert.equal(storage.writeStorage('boom', [1]), false);
  assert.equal(storage.writeStorage('good', ['x']), true);
  assert.equal(memory.get('good'), '["x"]');
  delete globalThis.window;

  // Agent usage roll-up: window filtering, token sums and model ordering.
  const usage = await loadTs(path.resolve('lib/agent/usage-summary.ts'));
  const usageNow = new Date(2026, 10, 15, 12, 0, 0).getTime();
  const runFixture = (id, at, status, prompt, completion, model = 'm1') => ({
    id, at, ms: 10, model, provider: 'p', status, steps: 2, tools: 1, promptTokens: prompt, completionTokens: completion,
  });
  const usageRuns = [
    runFixture('a', usageNow - 60_000, 'ok', 100, 40),
    runFixture('b', usageNow - 3_600_000, 'error', 50, 10),
    runFixture('c', usageNow - 8 * 86_400_000, 'ok', 999, 999, 'old'),
  ];
  const todayUsage = usage.summarizeUsage(usageRuns, usage.startOfLocalDay(usageNow));
  assert.equal(todayUsage.runs, 2, 'today keeps only today runs');
  assert.equal(todayUsage.totalTokens, 200);
  assert.equal(todayUsage.failed, 1);
  assert.equal(todayUsage.steps, 4);
  const week = usage.summarizeUsage(usageRuns, usage.usageSinceDays(7, usageNow));
  assert.equal(week.runs, 2, 'an 8-day-old run stays out of the week window');
  assert.deepEqual(
    usage.usageByModel(usageRuns, usage.usageSinceDays(7, usageNow)).map((row) => row.model),
    ['m1'],
  );

  // Backup diff: what a restore would add or drop.
  const backupDiff = await loadTs(path.resolve('lib/backup-diff.ts'));
  const diff = backupDiff.diffBackup(
    { issues: [{ key: 'A' }, { key: 'B' }], projects: [{ name: 'P1' }] },
    { issues: [{ key: 'B' }, { key: 'C' }], projects: [{ name: 'P2' }] },
  );
  assert.deepEqual(diff.issues.added, ['A']);
  assert.deepEqual(diff.issues.removed, ['C']);
  assert.equal(diff.issues.common, 1);
  assert.deepEqual(diff.projects.added, ['P1']);
  assert.deepEqual(diff.projects.removed, ['P2']);
  const diffLines = backupDiff.diffSummary(diff);
  assert.ok(diffLines.some((line) => line.startsWith('+1 issue')), 'summary lists added issues');
  assert.ok(diffLines.some((line) => line.startsWith('-1 project')), 'summary lists removed projects');

  const historyFile = path.resolve('lib/store/history.ts');  const { recordIssueHistory, undoIssueHistory, redoIssueHistory, clearIssueHistory } = await loadTs(historyFile);
  clearIssueHistory();
  let state;
  const a = { issues: [{ id: 'a', status: 'todo' }], notifications: [] };
  const b = { issues: [{ id: 'a', status: 'done' }], notifications: [] };
  recordIssueHistory(a, b);
  assert.equal(undoIssueHistory((snapshot) => { state = snapshot; }), true);
  assert.equal(state.issues[0].status, 'todo');
  assert.equal(redoIssueHistory((snapshot) => { state = snapshot; }), true);
  assert.equal(state.issues[0].status, 'done');
  assert.equal(undoIssueHistory(() => {}), true);
  assert.equal(undoIssueHistory(() => {}), false);
  clearIssueHistory();

  const storeFile = path.resolve('lib/server/store.ts');
  const storeSource = ts.transpileModule(await readFile(storeFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const temp = await mkdtemp(path.join(tmpdir(), 'aether-store-'));
  try {
    const storeModule = { exports: {} };
    const storeRequire = (id) => {
      if (id === 'node:fs') return { promises: { readFile, writeFile, mkdir: (dir, opts) => import('node:fs/promises').then(m => m.mkdir(dir, opts)), rename: (src, dest) => import('node:fs/promises').then(m => m.rename(src, dest)), unlink: (p) => import('node:fs/promises').then(m => m.unlink(p)) } };
      if (id === 'node:path') return path;
      throw new Error(`Unexpected dependency ${id}`);
    };
    new Function('require', 'module', 'exports', 'process', storeSource)(storeRequire, storeModule, storeModule.exports, { ...process, env: { ...process.env, LAB_DATA_DIR: temp }, cwd: () => temp });
    const { writeJson, readJson, withLock } = storeModule.exports;
    await Promise.all(Array.from({ length: 20 }, (_, i) => withLock('counter', async () => {
      const current = await readJson('counter', { values: [] });
      await writeJson('counter', { values: [...current.values, i] });
    })));
    const counter = await readJson('counter', { values: [] });
    assert.equal(counter.values.length, 20);
    assert.equal(new Set(counter.values).size, 20);
    await writeJson('valid', { hello: 'world' });
    assert.deepEqual(await readJson('valid', {}), { hello: 'world' });
    await writeFile(path.join(temp, 'broken.json'), '{broken', 'utf8');
    assert.deepEqual(await readJson('broken.json', { fallback: true }), { fallback: true });
  } finally { await rm(temp, { recursive: true, force: true }); }

  console.log('PASS compactMessages: complete tool turns and bounded context');
  console.log('PASS knowledge search: CJK bigrams, overlapping chunks, title-first ranking');
  console.log('PASS semantic search: cosine similarity and lexical fallback');
  console.log('PASS connectors: same-origin URLs, local-only http, method classification');
  console.log('PASS desktop updater: version compare and manifest validation');
  console.log('PASS window state: defaults, minimums, clamping and off-screen reset');
  console.log('PASS tool approval: policy, read-only and allowlist exemptions');
  console.log('PASS notification retention: archived items expire, active one stays');
  console.log('PASS inbox day buckets: local today, yesterday, earlier and invalid');
  console.log('PASS login rate limit: sliding window, retry hint, expiry and reset');
  console.log('PASS storage helpers: malformed JSON, filtering, caps and quota failure');
  console.log('PASS agent usage: today/week windows, token sums and model ordering');
  console.log('PASS backup diff: added/removed/shared issues and projects');
  console.log('PASS run export: Markdown trace, empty trace and filename sanitising');
  console.log('PASS project context: instructions, health, recent updates, issue scope');
  console.log('PASS project health series: filtered, sorted observations');
  console.log('PASS template transfer: round-trip, sanitising and caps');
  console.log('PASS quiet hours: normal, cross-midnight, all-day and desktop gating');
  console.log('PASS desktop notification routing: project, issue and empty payloads');
  console.log('PASS daily digest: local day, per-kind counts, digest self-exclusion');
  console.log('PASS project audit export: header, entries, empty case and filename');
  console.log('PASS project audit JSON: metadata, mapped authors and empty records');
  console.log('PASS reaction summary: weekly buckets, Monday keys, window and ordering');
  console.log('PASS weekly export: range, entries, reactions, empty week and filename');
  console.log('PASS multi-week export: sections, counts, empty weeks and filename');
  console.log('PASS highlight: case-insensitive segments and clipped snippets');
  console.log('PASS audit range: week/month boundaries, all time and bad dates');
  console.log('PASS project summary: state, progress, updates, audit counts and filename');
  console.log('PASS invite link: code encoding, trimming and search parsing');
  console.log('PASS user agent labels: browser and OS, empty fallback');
  console.log('PASS issue history: undo, redo and cleared future');
  console.log('PASS JSON store: atomic writes and 20 serialized read-modify-write operations');
  // Email sign-in: rules, message copy and SMTP framing.
  const emailRules = await loadTs(path.resolve('lib/email-rules.ts'));
  assert.equal(emailRules.normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
  assert.ok(emailRules.isEmailAddress('a@b.co'));
  assert.ok(!emailRules.isEmailAddress('a@b'));
  assert.ok(emailRules.isCodeShape('012345'));
  assert.ok(!emailRules.isCodeShape('12345'));
  assert.equal(emailRules.maskEmail('alice@qq.com'), 'a****@qq.com');
  assert.equal(emailRules.resendInSeconds(1_000, 1_000), 60);
  assert.equal(emailRules.resendInSeconds(1_000, 61_000), 0);
  assert.ok(emailRules.codeIsLive({ expiresAt: 2_000, attempts: 0, usedAt: null }, 1_000));
  assert.ok(!emailRules.codeIsLive({ expiresAt: 1_000, attempts: 0, usedAt: null }, 2_000));
  assert.ok(!emailRules.codeIsLive({ expiresAt: 9_000, attempts: 5, usedAt: null }, 1_000));
  assert.ok(!emailRules.codeIsLive({ expiresAt: 9_000, attempts: 0, usedAt: 5 }, 1_000));
  const mailCopy = emailRules.codeMailCopy({ code: '123456', purpose: 'signin' });
  assert.ok(mailCopy.subject.includes('登录') && mailCopy.text.includes('123456') && mailCopy.html.includes('123456'));
  console.log('PASS email rules: address, code shape, masking, cooldown, live check and mail copy');

  const smtp = await loadTs(path.resolve('lib/smtp.ts'));
  const multiline = smtp.takeReply('250-first\r\n250 second\r\nrest');
  assert.equal(multiline.reply.code, 250);
  assert.deepEqual(multiline.reply.lines, ['first', 'second']);
  assert.equal(multiline.rest, 'rest');
  assert.equal(smtp.takeReply('250-partial\r\n'), null, 'an unfinished multiline reply waits');
  assert.match(smtp.describeReply({ code: 535, lines: ['Authentication failed'] }), /535 Authentication failed/);
  assert.ok(smtp.replyOk({ code: 235, lines: [] }, [235]));
  assert.ok(!smtp.replyOk({ code: 535, lines: [] }, [235]));
  assert.equal(smtp.dotStuff('a\r\n.\r\nb'), 'a\r\n..\r\nb');
  assert.ok(smtp.encodeHeaderValue('Aether 登录验证码').startsWith('=?UTF-8?B?'));
  const mime = smtp.buildMimeMessage({
    from: { name: 'Aether', email: 'a@qq.com' },
    to: [{ email: 'b@qq.com' }],
    subject: '登录验证码 123456',
    text: 'code 123456',
    html: '<b>123456</b>',
    messageId: 'x@y',
    date: new Date('2026-01-02T03:04:05Z'),
  });
  assert.ok(mime.includes('Content-Type: multipart/alternative'), 'html mail is multipart');
  assert.ok(mime.includes('Subject: =?UTF-8?B?'), 'a Chinese subject is RFC 2047 encoded');
  assert.ok(mime.includes(Buffer.from('<b>123456</b>', 'utf8').toString('base64')), 'html part is base64');
  const textOnly = smtp.buildMimeMessage({
    from: { email: 'a@qq.com' },
    to: [{ email: 'b@qq.com' }],
    subject: 'plain',
    text: 'hello',
  });
  assert.ok(textOnly.includes('Content-Type: text/plain; charset=UTF-8'));
  console.log('PASS SMTP framing: multiline replies, dot stuffing, RFC 2047 subject and base64 body');

  // Mail relay settings: presets, normalising, validation and precedence.
  const mail = await loadTs(path.resolve('lib/mail-settings.ts'), { '@/lib/email-rules': emailRules });
  assert.equal(mail.normalizeHost('  smtp://SMTP.QQ.com:465/  '), 'smtp.qq.com', 'a pasted URL becomes a host');
  assert.equal(mail.normalizeHost('127.0.0.1:2525'), '127.0.0.1');
  assert.equal(mail.normalizeHost('localhost'), 'localhost');
  assert.equal(mail.mailPresetFor(' Me@QQ.com ').host, 'smtp.qq.com');
  assert.equal(mail.mailPresetFor('a@gmail.com').port, 465);
  const outlookPreset = mail.mailPresetFor('a@outlook.com');
  assert.equal(outlookPreset.port, 587);
  assert.equal(outlookPreset.secure, false);
  assert.equal(outlookPreset.starttls, true);
  assert.equal(mail.mailPresetFor('a@example.com'), null);

  const qqDefaults = mail.normalizeMailSettings({ user: 'me@qq.com' });
  assert.equal(qqDefaults.host, 'smtp.qq.com', 'the QQ account fills the host');
  assert.equal(qqDefaults.port, 465);
  assert.equal(qqDefaults.secure, true);
  assert.equal(qqDefaults.starttls, false);
  assert.equal(qqDefaults.from, 'me@qq.com', 'the sender defaults to the account');
  assert.equal(qqDefaults.fromName, 'Aether');
  assert.equal(qqDefaults.enabled, true);

  const blank = mail.validateMailDraft({ enabled: true, user: 'me@qq.com', host: 'smtp.qq.com' });
  assert.equal(blank.ok, false, 'an enabled relay needs a password');
  assert.ok(blank.errors.pass, 'the missing field is named');
  const complete = mail.validateMailDraft({
    enabled: true,
    user: 'me@qq.com',
    host: 'smtp.qq.com',
    port: '465',
    pass: 'abcdefghijklmnop',
  });
  assert.equal(complete.ok, true, `a complete QQ relay is valid: ${JSON.stringify(complete.errors)}`);
  assert.deepEqual(complete.notices, [], 'a 16-character QQ code needs no notice');
  const shortCode = mail.validateMailDraft({ user: 'me@qq.com', pass: 'oops' });
  assert.ok(shortCode.notices.includes('qqAuthCode'), 'a short QQ password is flagged as "use the auth code"');
  const noTls = mail.validateMailDraft({ user: 'me@example.com', host: 'mail.example.com', port: '25', secure: false, starttls: false, pass: 'x' });
  assert.ok(noTls.errors.starttls, 'plaintext to a public relay is refused');
  const lanRelay = mail.validateMailDraft({ user: 'bot@example.com', host: '127.0.0.1', port: '2525', secure: false, starttls: false, pass: 'x' });
  assert.equal(lanRelay.ok, true, `a relay on this machine may skip TLS: ${JSON.stringify(lanRelay.errors)}`);
  assert.ok(lanRelay.notices.includes('plaintext'), 'and it is still called out');
  assert.ok(mail.isLocalHost('localhost'));
  assert.ok(mail.isLocalHost('127.0.0.1'));
  assert.ok(mail.isLocalHost('192.168.1.9'));
  assert.ok(mail.isLocalHost('10.0.0.5'));
  assert.ok(!mail.isLocalHost('smtp.qq.com'));
  assert.ok(!mail.isLocalHost('8.8.8.8'));

  assert.equal(mail.validateMailDraft({ enabled: false }).ok, true, 'a disabled entry may stay empty');
  assert.ok(mail.validateMailDraft({ enabled: true, user: 'me@qq.com', pass: 'x', secure: true, starttls: true }).errors.starttls);
  assert.ok(mail.validateMailDraft({ enabled: true, user: 'me@qq.com', pass: 'x', port: '0' }).errors.port);
  assert.ok(mail.validateMailDraft({ enabled: true, user: 'me@qq.com', pass: 'x', port: '70000' }).errors.port);
  assert.ok(mail.validateMailDraft({ enabled: true, user: 'nope', pass: 'x' }).errors.user);
  assert.ok(mail.validateMailDraft({ enabled: true, user: 'me@qq.com', pass: 'x', host: 'not a host' }).errors.host);
  assert.ok(mail.validateMailDraft({ enabled: true, user: 'me@qq.com', pass: 'x', from: 'nonsense' }).errors.from);
  assert.equal(mail.normalizeMailSettings({ from: 'Aether <b@example.com>' }).from, 'b@example.com');

  assert.equal(mail.mailPassHint('abcdefghijklmnop'), '••••op', 'the hint keeps two characters at most');
  assert.equal(mail.mailPassHint(''), '');
  assert.equal(mail.mailPassHint('abc'), '••••');

  const fromEnv = mail.envMailConfig({ AETHER_SMTP_USER: 'me@qq.com', AETHER_SMTP_PASS: 'x'.repeat(16) });
  assert.equal(fromEnv.host, 'smtp.qq.com', '.env.local still infers the QQ host');
  assert.equal(fromEnv.port, 465);
  assert.equal(fromEnv.secure, true);
  assert.equal(mail.envMailConfig({ AETHER_SMTP_USER: 'me@qq.com' }), null, 'no password means no mailer');
  const starttlsEnv = mail.envMailConfig({
    SMTP_USER: 'me@example.com',
    SMTP_PASS: 'secret',
    SMTP_HOST: 'mail.example.com',
    SMTP_PORT: '587',
  });
  assert.equal(starttlsEnv.starttls, true, 'port 587 turns STARTTLS on');
  assert.equal(starttlsEnv.secure, false);

  const saved = { ...qqDefaults, pass: 'p'.repeat(16) };
  assert.equal(mail.resolveMailConfig(saved, fromEnv).source, 'settings', 'a saved relay outranks .env.local');
  assert.equal(mail.resolveMailConfig(null, fromEnv).source, 'env');
  assert.equal(mail.resolveMailConfig(null, null).source, 'none');
  assert.equal(mail.resolveMailConfig(null, null).config, null);
  assert.equal(mail.mailConfigFrom(qqDefaults, ''), null, 'no password, no usable config');
  assert.equal(mail.mailConfigFrom(qqDefaults, 'secret').pass, 'secret');
  assert.equal(mail.mailConfigFrom({ ...qqDefaults, enabled: false }, 'secret'), null);
  console.log('PASS mail settings: presets, normalising, field errors, TLS notices, env fallback and precedence');

  // Web search parsing (DuckDuckGo html + lite layouts).
  const webSearch = await loadTs(path.resolve('lib/server/web-search.ts'), {
    '@/lib/agent/guard': { safePageUrl: (value) => String(value) },
  });
  assert.equal(webSearch.decodeHtml('A &amp; B &#39;c&#x27;'), "A & B 'c'");
  assert.equal(
    webSearch.duckDuckGoHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc&rut=1'),
    'https://example.com/doc',
  );
  const ddg = webSearch.parseDuckDuckGo(
    '<div class="result results_links"><div class="links_main result__body"><h2 class="result__title">' +
      '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc&amp;rut=x">Example <b>Doc</b></a>' +
      '</h2><a class="result__snippet" href="x">A &amp; B <em>snippet</em></a></div></div>',
    5,
  );
  assert.equal(ddg.length, 1);
  assert.equal(ddg[0].url, 'https://example.com/doc');
  assert.equal(ddg[0].title, 'Example Doc');
  assert.equal(ddg[0].snippet, 'A & B snippet');
  const lite = webSearch.parseDuckDuckGo(
    "<a rel=\"nofollow\" class='result-link' href=\"https://lite.example/a\">Lite A</a></td><td class='result-snippet'>Snippet A</td>",
    3,
  );
  assert.equal(lite[0]?.url, 'https://lite.example/a');
  assert.equal(lite[0]?.snippet, 'Snippet A');
  const heading = webSearch.parseHeadingResults(
    '<h3 class="t"><a href="/link?url=abc">Baidu <em>Hit</em></a></h3><div class="c-abstract">A short summary</div>' +
      '<h3><a href="https://other.example/x">Second</a></h3><p>Next summary</p>',
    'https://www.baidu.com/s?wd=x',
    5,
  );
  assert.equal(heading.length, 2);
  assert.equal(heading[0].url, 'https://www.baidu.com/link?url=abc');
  assert.equal(heading[0].title, 'Baidu Hit');
  assert.ok(heading[0].snippet.startsWith('A short summary'));
  assert.equal(
    webSearch.trimSnippet('This is a reasonably long summary sentence that keeps going baidu.com https://x'),
    'This is a reasonably long summary sentence that keeps going',
  );
  console.log('PASS web search: redirect unwrap, entity decoding, html/lite/heading layouts, snippet trim');

  // Artifact triage: magic bytes, headers, entropy, strings and indicators.
  const reverse = await loadTs(path.resolve('lib/agent/reverse.ts'));
  assert.equal(reverse.sniffFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).id, 'png');
  assert.equal(reverse.sniffFormat(Buffer.from('%PDF-1.7\n')).id, 'pdf');
  assert.equal(reverse.sniffFormat(Buffer.from('hello world, plain text\n')).kind, 'text');
  assert.equal(reverse.sniffFormat(Buffer.from('{"a":1}')).id, 'json');
  assert.equal(reverse.shannonEntropy(Uint8Array.from([1, 1, 1, 1])), 0);

  const peBytes = new Uint8Array(1024);
  const peView = new DataView(peBytes.buffer);
  const peOffset = 0x40;
  peBytes.set([0x4d, 0x5a], 0);
  peView.setUint32(0x3c, peOffset, true);
  peBytes.set([0x50, 0x45, 0x00, 0x00], peOffset);
  peView.setUint16(peOffset + 4, 0x8664, true); // x64
  peView.setUint16(peOffset + 6, 1, true); // one section
  peView.setUint16(peOffset + 20, 0xe0, true); // optional header size
  peView.setUint16(peOffset + 22, 0x0022, true); // executable, not a dll
  peView.setUint16(peOffset + 24 + 68, 3, true); // console subsystem
  const sectionAt = peOffset + 24 + 0xe0;
  peBytes.set(Buffer.from('.text\u0000\u0000\u0000', 'binary'), sectionAt);
  peView.setUint32(sectionAt + 8, 0x100, true);
  peView.setUint32(sectionAt + 16, 0x100, true);
  peView.setUint32(sectionAt + 20, 0x400, true);
  for (let index = 0; index < 256; index += 1) peBytes[0x400 + index] = (index * 37 + 11) & 0xff;
  const pe = reverse.readPe(peBytes);
  assert.equal(pe.machine, 'x64');
  assert.equal(pe.subsystem, 'console');
  assert.equal(pe.dll, false);
  assert.equal(pe.sections.length, 1);
  assert.ok(reverse.sniffFormat(peBytes).label.includes('PE'));

  const indicators = reverse.findIndicators([
    'GET https://evil.example/c2 HTTP/1.1',
    'powershell -enc SQBFAFgA',
    '192.168.1.20',
    'VirtualAlloc',
  ]);
  assert.ok(indicators.some((item) => item.kind === 'url'));
  assert.ok(indicators.some((item) => item.kind === 'command'));
  assert.ok(indicators.some((item) => item.kind === 'ip'));
  assert.ok(indicators.some((item) => item.kind === 'api'));
  assert.deepEqual(reverse.extractStrings(Buffer.from('\u0000hello world\u0000ab\u0000'), 5), ['hello world']);

  const gzip = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(40, 7)]);
  const embedded = reverse.decodeEmbedded(`blob: ${gzip.toString('base64')}`);
  assert.ok(embedded.some((entry) => entry.kind === 'base64' && entry.format.includes('GZIP')), 'base64 gzip is unwrapped');
  const report = reverse.inspectArtifact(Buffer.from('powershell -enc AAAA https://evil.example/x'), 'sample.txt');
  assert.ok(report.indicators.length >= 2);
  assert.ok(report.hex[0].startsWith('00000000'));
  const packed = reverse.inspectArtifact(new Uint8Array(requireCjs('node:crypto').randomBytes(4096)), 'packed.bin');
  assert.ok(packed.entropy > 7 && packed.packed, 'high-entropy bytes read as packed');
  console.log('PASS artifact triage: magic bytes, PE headers, entropy, strings, indicators and embedded payloads');

  // Tool receipts: the bounded cards the transcript can expand. Everything is
  // clipped here because a card is written back into the session snapshot.
  const cards = await loadTs(path.resolve('lib/agent/tool-cards.ts'));
  assert.equal(cards.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(cards.safeHttpUrl('file:///etc/passwd'), null);
  assert.equal(cards.safeHttpUrl('not a url'), null);
  assert.equal(cards.safeHttpUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(cards.hostOf('https://www.example.com/docs'), 'example.com');
  assert.equal(cards.hostOf(''), '');
  assert.equal(cards.formatBytes(512), '512 B');
  assert.equal(cards.formatBytes(1536), '1.5 KB');
  assert.equal(cards.formatBytes(1024 * 1024 * 10), '10 MB');
  assert.equal(cards.formatBytes(-4), '0 B');

  const searchCard = cards.buildSearchCard({
    query: '  next.js   streaming ',
    provider: 'duckduckgo',
    results: [
      { title: '  Streaming  docs ', url: 'https://www.nextjs.org/docs/streaming', snippet: 'x'.repeat(500) },
      { title: 'Dropped: no url and no title', url: 'javascript:alert(1)', snippet: '' },
      { title: 'Second hit', url: 'https://example.com/two', snippet: 'short' },
      { title: 'Third', url: 'https://example.com/three', snippet: '' },
      { title: 'Fourth', url: 'https://example.com/four', snippet: '' },
      { title: 'Fifth', url: 'https://example.com/five', snippet: '' },
      { title: 'Sixth', url: 'https://example.com/six', snippet: '' },
      { title: 'Seventh', url: 'https://example.com/seven', snippet: '' },
    ],
  });
  assert.equal(searchCard.kind, 'search');
  assert.equal(searchCard.query, 'next.js streaming');
  assert.equal(searchCard.source, 'duckduckgo');
  assert.equal(searchCard.hits.length, cards.CARD_LIMITS.hits, 'hit list is capped');
  assert.equal(searchCard.hits[0].title, 'Streaming docs');
  assert.equal(searchCard.hits[0].url, 'https://www.nextjs.org/docs/streaming');
  assert.equal(searchCard.hits[0].snippet.length, cards.CARD_LIMITS.snippet);
  assert.equal(searchCard.hits[1].title, 'Dropped: no url and no title', 'a hit with no usable URL is kept as text');
  assert.equal(searchCard.hits[1].url, '');
  assert.equal(cards.buildSearchCard({ query: 'x', results: [] }), null);
  assert.equal(cards.buildSearchCard({}), null);

  const inspectCard = cards.buildInspectCard({
    name: 'sample.exe',
    size: 4096,
    format: { label: 'PE executable', id: 'pe', detail: 'x64 · console' },
    entropy: 7.3456,
    packed: true,
    hashes: { sha256: 'A'.repeat(64), md5: 'not-a-hash' },
    structure: Array.from({ length: 20 }, (_, index) => `line ${index}`),
    indicators: Array.from({ length: 30 }, (_, index) => ({ kind: 'url', value: `https://evil.example/${index}` })),
    embedded: Array.from({ length: 12 }, (_, index) => ({ kind: 'base64', bytes: index * 10, format: 'ZIP' })),
    notes: ['note a', 'note b', 'note c', 'note d'],
    strings: Array.from({ length: 25 }, (_, index) => `string-${index}-${'y'.repeat(300)}`),
    hex: ['0f 01 02'],
  });
  assert.equal(inspectCard.kind, 'inspect');
  assert.equal(inspectCard.name, 'sample.exe');
  assert.equal(inspectCard.entropy, 7.35, 'entropy is rounded to two decimals');
  assert.equal(inspectCard.packed, true);
  assert.equal(inspectCard.sha256, 'a'.repeat(64), 'a hex sha256 is kept, lower-cased');
  assert.equal(inspectCard.md5, undefined, 'a malformed hash is dropped');
  assert.equal(inspectCard.structure.length, cards.CARD_LIMITS.structure);
  assert.equal(inspectCard.indicators.length, cards.CARD_LIMITS.indicators);
  assert.equal(inspectCard.embedded.length, cards.CARD_LIMITS.embedded);
  assert.equal(inspectCard.notes.length, cards.CARD_LIMITS.notes);
  assert.equal(inspectCard.strings.length, cards.CARD_LIMITS.strings);
  assert.equal(inspectCard.stringTotal, 25, 'the card can still say how many strings there were');
  assert.equal(inspectCard.strings[0].length, 200, 'each string line is clipped');
  const bare = cards.buildInspectCard({});
  assert.equal(bare.name, 'artifact');
  assert.equal(bare.format, 'unknown');
  assert.equal(bare.entropy, 0);
  assert.deepEqual(bare.indicators, []);

  assert.equal(cards.isToolCard(searchCard), true);
  assert.equal(cards.isToolCard(inspectCard), true);
  assert.equal(cards.isToolCard(JSON.parse(JSON.stringify(inspectCard))), true, 'a persisted card survives JSON');
  assert.equal(cards.isToolCard({ kind: 'search', hits: [] }), false, 'missing fields are rejected');
  assert.equal(cards.isToolCard({ kind: 'search', query: 'q', source: '', hits: [{ title: 't', url: '', snippet: 1 }] }), false);
  assert.equal(cards.isToolCard({ kind: 'inspect', name: 'a' }), false);
  assert.equal(cards.isToolCard({ kind: 'nope' }), false);
  assert.equal(cards.isToolCard(null), false);
  console.log('PASS tool cards: URL/hash validation, clipping, byte formatting and the persistence guard');

  console.log('Browser regression: node scripts/e2e.mjs (with the dev server running)');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


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
  console.log('Browser regression: node scripts/e2e.mjs (with the dev server running)');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


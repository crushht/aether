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

  // Answer sources: collected from tool receipts, never written by the model.
  const toolCards = await loadTs(path.resolve('lib/agent/tool-cards.ts'));
  const citations = await loadTs(path.resolve('lib/agent/citations.ts'), { './tool-cards': toolCards });
  const web = { kind: 'web', title: 'Linear docs', url: 'https://linear.app/docs' };
  const knowledge = { kind: 'knowledge', title: 'Release checklist', ref: 'k12#3' };
  assert.deepEqual(citations.addSources([], [web, knowledge]).length, 2);
  assert.equal(citations.addSources([web], [web]).length, 1, 'the same page is cited once');
  assert.equal(citations.addSources([], [web, web, { ...web, url: 'https://linear.app/docs#x' }]).length, 2);
  assert.equal(
    citations.addSources([], Array.from({ length: 9 }, (_, index) => ({ kind: 'web', title: `p${index}`, url: `https://e.dev/${index}` }))).length,
    citations.SOURCE_LIMIT,
    'sources are capped',
  );
  assert.deepEqual(citations.addSources([], [{ kind: 'web', title: 'no url' }]), [], 'a web source needs http(s)');
  assert.deepEqual(citations.addSources([], [{ kind: 'web', title: 'ftp', url: 'ftp://e.dev/x' }]), []);
  assert.deepEqual(citations.addSources([], [{ kind: 'knowledge', title: '' }]), [], 'a knowledge source needs a title');
  assert.equal(citations.sourceLabel(web), 'linear.app');
  assert.equal(citations.sourceHref(web), 'https://linear.app/docs');
  assert.equal(citations.sourceHref(knowledge), '/knowledge?id=k12');
  assert.equal(
    citations.sourcesMarkdown([web, knowledge]),
    '- [Linear docs](https://linear.app/docs)\n- Knowledge: Release checklist',
  );
  assert.ok(citations.isChatSource(knowledge) && !citations.isChatSource({ kind: 'file', title: 'x' }));
  console.log('PASS citations: de-duplication, cap, validation, labels and markdown');

  // Filter query language: `status:todo assignee:me label:Bug -priority:low`.
  const query = await loadTs(path.resolve('lib/query.ts'));
  assert.deepEqual(query.tokenize('status:todo "two words" label:"needs design"'), [
    'status:todo',
    '"two words"',
    'label:"needs design"',
  ]);
  const q = query.parseQuery('status:todo,in-progress label:Bug -priority:low "login flow" owner:me');
  assert.equal(q.terms.length, 3);
  assert.deepEqual(q.terms[0], { key: 'status', values: ['todo', 'in-progress'], negated: false });
  assert.deepEqual(q.terms[2], { key: 'priority', values: ['low'], negated: true });
  assert.deepEqual(q.text, ['login flow', 'owner:me']);
  assert.deepEqual(q.unknown, ['owner']);
  assert.deepEqual(query.describeQuery(query.parseQuery('status:done -label:Bug')), ['status:done', '-label:bug']);

  const fixture = (patch) => ({
    id: patch.key ?? 'i1',
    key: 'ENG-1',
    title: 'Login flow breaks',
    description: 'SSO callback drops the cookie',
    status: 'todo',
    priority: 'high',
    assigneeId: 'u_me',
    creatorId: 'u_me',
    labelIds: ['l_bug'],
    projectId: 'p1',
    cycleId: 'c1',
    dueDate: '2020-01-01T00:00:00.000Z',
    ...patch,
  });
  const ctx = {
    meId: 'u_me',
    now: Date.parse('2026-01-10T00:00:00Z'),
    labelName: (id) => (id === 'l_bug' ? 'Bug' : undefined),
    projectName: (id) => (id === 'p1' ? 'Atlas' : undefined),
  };
  const match = (text, issue = fixture({})) => query.issueMatchesQuery(issue, query.parseQuery(text), ctx);
  assert.ok(match('status:todo'), 'status matches');
  assert.ok(!match('status:done'), 'a status the issue does not have fails');
  assert.ok(match('priority:high'), 'priority matches');
  assert.ok(match('assignee:me'), 'assignee:me resolves through the context');
  assert.ok(!match('assignee:none'), 'an assigned issue is not unassigned');
  assert.ok(match('label:bug'), 'label names are case-insensitive');
  assert.ok(match('project:atlas'), 'project names match');
  assert.ok(match('cycle:c1'), 'cycle ids match');
  assert.ok(match('due:overdue'), 'overdue compares against now');
  assert.ok(match('-status:done'), 'negation inverts: a todo issue is not done');
  assert.ok(!match('-status:todo'), 'negation inverts: a todo issue is todo');
  assert.ok(match('login flow'), 'free words search title and description');
  assert.ok(!match('login nope'), 'every free word must appear');
  assert.ok(match('is:open'), 'is:open covers unfinished issues');
  assert.ok(query.issueMatchesQuery(fixture({}), query.parseQuery(''), ctx), 'an empty query matches everything');
  console.log('PASS query language: tokenizer, key aliases, negation, names, due dates and free words');

  // Who may receive a code: closed by default, so a relay cannot become a
  // sender for the whole internet.
  const mailPolicy = await loadTs(path.resolve('lib/mail-policy.ts'));
  assert.deepEqual(mailPolicy.parseAllowlist(' A@X.com, @b.io, c.net, not-an-address!, a@x.com '), [
    'a@x.com',
    'b.io',
    'c.net',
  ]);
  assert.deepEqual(mailPolicy.parseAllowlist(undefined), []);
  assert.ok(mailPolicy.allowlistMatches('a@x.com', ['a@x.com']));
  assert.ok(mailPolicy.allowlistMatches('b@x.com', ['x.com']));
  assert.ok(!mailPolicy.allowlistMatches('b@y.com', ['x.com']));
  assert.ok(!mailPolicy.allowlistMatches('nonsense', ['x.com']));
  const closed = { open: false, allowlist: [] };
  assert.ok(!mailPolicy.recipientAllowed('new@site.dev', closed, { knownAccount: false, firstAccount: false }));
  assert.ok(mailPolicy.recipientAllowed('owner@site.dev', closed, { knownAccount: false, firstAccount: true }));
  assert.ok(mailPolicy.recipientAllowed('member@site.dev', closed, { knownAccount: true, firstAccount: false }));
  assert.ok(mailPolicy.recipientAllowed('invited@site.dev', { open: false, allowlist: ['site.dev'] }, { knownAccount: false, firstAccount: false }));
  assert.ok(mailPolicy.recipientAllowed('anyone@else.dev', { open: true, allowlist: [] }, { knownAccount: false, firstAccount: false }));
  assert.deepEqual(mailPolicy.mailPolicyFromEnv({ AETHER_MAIL_OPEN: '1', AETHER_MAIL_ALLOWLIST: 'A@b.co' }), {
    open: true,
    allowlist: ['a@b.co'],
  });
  console.log('PASS mail policy: allowlist parsing, domain match, bootstrap and closed default');

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
  const searchSettings = await loadTs(path.resolve('lib/search-settings.ts'));
  const webSearch = await loadTs(path.resolve('lib/server/web-search.ts'), {
    '@/lib/agent/guard': { safePageUrl: (value) => String(value) },
    '@/lib/search-settings': searchSettings,
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

  // Search source: endpoint rules, SearXNG JSON, engine order, env precedence.
  assert.equal(searchSettings.engineIds().length, 5);
  assert.deepEqual(searchSettings.engineIds().slice(0, 3), ['duckduckgo', 'bing', 'sogou']);
  assert.equal(searchSettings.checkSearchEndpoint('').kind, 'builtin');
  assert.equal(searchSettings.checkSearchEndpoint(undefined).ok, true, 'no value means the built-in chain');
  const bareHost = searchSettings.checkSearchEndpoint('searx.example.com');
  assert.equal(bareHost.url, 'https://searx.example.com/', 'a bare host gets https');
  assert.equal(bareHost.kind, 'searxng');
  assert.equal(bareHost.host, 'searx.example.com');
  const localEndpoint = searchSettings.checkSearchEndpoint('127.0.0.1:8888');
  assert.equal(localEndpoint.url, 'http://127.0.0.1:8888/', 'a local endpoint may speak plain http');
  const lanEndpoint = searchSettings.checkSearchEndpoint('http://192.168.1.5:8080/search');
  assert.equal(lanEndpoint.ok, true);
  assert.equal(lanEndpoint.kind, 'searxng', 'a /search path reads as SearXNG');
  assert.equal(lanEndpoint.host, '192.168.1.5:8080');
  assert.equal(searchSettings.checkSearchEndpoint('ftp://nope').ok, false, 'only http(s) answers a search');
  assert.match(searchSettings.checkSearchEndpoint('ftp://nope').error, /http/);
  assert.equal(searchSettings.checkSearchEndpoint('http://searx.example.com').ok, false, 'plain http to a public host leaks queries');
  assert.equal(searchSettings.checkSearchEndpoint('https://user:pass@searx.example.com').ok, false, 'no credentials in the URL');
  assert.equal(searchSettings.checkSearchEndpoint('   ').kind, 'builtin');
  const cleanedEndpoint = searchSettings.checkSearchEndpoint('https://searx.example.com/search?q=old&language=zh#top');
  assert.equal(cleanedEndpoint.ok, true);
  assert.ok(cleanedEndpoint.url.includes('language=zh'), 'other parameters survive');
  assert.ok(!/[?&]q=/.test(cleanedEndpoint.url), 'a pasted q= is dropped, the query is ours');
  assert.ok(!cleanedEndpoint.url.includes('#'));
  assert.equal(
    searchSettings.buildSearchUrl('https://searx.example.com/search?language=zh', 'a b'),
    'https://searx.example.com/search?language=zh&q=a+b',
  );
  assert.equal(searchSettings.searxngJsonUrl('http://127.0.0.1:8888/search'), 'http://127.0.0.1:8888/search?format=json');
  assert.equal(searchSettings.looksLikeJsonBody('  {"results":[]}'), true);
  assert.equal(searchSettings.looksLikeJsonBody('<html>'), false);

  const searxBody = JSON.stringify({
    results: [
      { title: 'Aether  <b>release</b>', url: 'https://example.com/a', content: 'first   result' },
      { title: 'bad', url: 'ftp://nope' },
      { title: 'Duplicate', url: 'https://example.com/a', content: 'again' },
      { title: 'Second', url: 'http://example.com/b', snippet: 'second body' },
      { title: 'Long', url: 'https://example.com/c', content: 'x'.repeat(400) },
    ],
  });
  const searxHits = searchSettings.parseSearxngPayload(searxBody, 5);
  assert.equal(searxHits.length, 3, 'non-http and duplicate rows are dropped');
  assert.equal(searxHits[0].title, 'Aether <b>release</b>');
  assert.equal(searxHits[0].snippet, 'first result');
  assert.equal(searxHits[1].snippet, 'second body');
  assert.equal(searxHits[2].snippet.length, 260, 'a long snippet is clipped');
  assert.equal(searchSettings.parseSearxngPayload({ results: [{ title: 't', url: 'https://x.example/y' }] })[0].snippet, '');
  assert.equal(
    searchSettings.parseSearxngPayload({ results: [{ url: 'https://x.example/y' }] })[0].title,
    'https://x.example/y',
    'a missing title falls back to the URL',
  );
  assert.deepEqual(searchSettings.parseSearxngPayload('not json', 3), []);
  assert.deepEqual(searchSettings.parseSearxngPayload('{oops', 3), []);
  assert.deepEqual(searchSettings.parseSearxngPayload({ results: 'nope' }, 3), []);
  assert.equal(
    searchSettings.parseSearxngPayload(
      { results: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://x.example/${i}` })) },
      3,
    ).length,
    3,
  );

  assert.deepEqual(searchSettings.normalizeEngineOrder('baidu, NOPE, baidu , bing'), ['baidu', 'bing']);
  assert.equal(searchSettings.normalizeEngineOrder([]).length, 5, 'an empty order means every engine');
  assert.deepEqual(searchSettings.normalizeEngineOrder(''), searchSettings.engineIds());
  const engineOrder = searchSettings.engineIds();
  assert.deepEqual(searchSettings.moveEngine(engineOrder, 'sogou', -1), ['duckduckgo', 'sogou', 'bing', 'baidu', '360']);
  assert.deepEqual(searchSettings.moveEngine(engineOrder, 'duckduckgo', -1), engineOrder, 'the top engine stays');
  assert.deepEqual(searchSettings.moveEngine(engineOrder, '360', 1), engineOrder, 'the bottom engine stays');
  assert.deepEqual(searchSettings.moveEngine(engineOrder, 'nope', 1), engineOrder);
  assert.deepEqual(searchSettings.toggleEngine(engineOrder, 'bing'), ['duckduckgo', 'sogou', 'baidu', '360']);
  assert.deepEqual(searchSettings.toggleEngine(['baidu'], 'bing'), ['baidu', 'bing'], 'a re-enabled engine goes last');
  assert.deepEqual(searchSettings.toggleEngine(['baidu'], 'baidu'), ['baidu'], 'the last engine cannot be turned off');
  assert.deepEqual(searchSettings.toggleEngine(engineOrder, 'nope'), engineOrder);

  const envPinned = searchSettings.envSearchSettings({ AETHER_SEARCH_URL: '127.0.0.1:8888/search' });
  assert.equal(envPinned.url, 'http://127.0.0.1:8888/search');
  assert.equal(searchSettings.envSearchSettings({ AETHER_SEARCH_ENGINES: 'baidu, 360' }).engines.join(','), 'baidu,360');
  assert.equal(searchSettings.envSearchSettings({ AETHER_SEARCH_URL: 'ftp://nope' }).url, '', 'an unusable variable is ignored');
  assert.equal(searchSettings.envSearchSettings({}), null);

  const savedSearch = { url: 'http://127.0.0.1:8888/search', engines: ['baidu', 'bing'] };
  assert.equal(searchSettings.resolveSearchSettings(savedSearch, envPinned).source, 'settings', 'saved outranks the environment');
  assert.equal(searchSettings.resolveSearchSettings(null, envPinned).source, 'env');
  const searchDefaults = searchSettings.resolveSearchSettings(null, null);
  assert.equal(searchDefaults.source, 'default');
  assert.equal(searchDefaults.settings.url, '');
  assert.equal(searchDefaults.settings.engines.length, 5);
  assert.equal(searchSettings.describeSearchSource(searchDefaults.settings, 'default').kind, 'builtin');
  const describedSource = searchSettings.describeSearchSource(savedSearch, 'settings');
  assert.equal(describedSource.kind, 'searxng');
  assert.equal(describedSource.host, '127.0.0.1:8888');
  assert.equal(describedSource.endpoint, 'http://127.0.0.1:8888/search');

  assert.equal(searchSettings.validateSearchDraft({ url: 'ftp://nope' }).ok, false);
  assert.ok(searchSettings.validateSearchDraft({ url: 'ftp://nope' }).errors.url);
  assert.equal(searchSettings.validateSearchDraft({ url: '' }).ok, true);
  assert.deepEqual(searchSettings.validateSearchDraft({ url: 'http://127.0.0.1:8888/search', engines: ['baidu'] }).settings.engines, ['baidu']);

  const pinnedProviders = webSearch.buildProviders(savedSearch);
  assert.equal(pinnedProviders.length, 1, 'a pinned endpoint replaces the chain');
  assert.equal(pinnedProviders[0].label, '127.0.0.1:8888');
  assert.match(pinnedProviders[0].jsonUrl, /format=json/);
  assert.match(pinnedProviders[0].url('a b'), /q=a\+b/);
  const chainProviders = webSearch.buildProviders({ engines: ['baidu', 'bing'] });
  assert.deepEqual(chainProviders.map((provider) => provider.id), ['baidu', 'bing']);
  assert.equal(chainProviders[0].label, 'baidu.com');
  assert.equal(webSearch.buildProviders({}).length, 5, 'no settings means the shipped chain');
  assert.equal(webSearch.buildProviders({ engines: ['nope'] }).length, 5, 'an unknown engine falls back to the chain');
  assert.equal(webSearch.buildProviders({ url: 'ftp://nope' }).length, 5, 'an unusable endpoint falls back to the chain');
  console.log('PASS search settings: endpoint rules, SearXNG JSON, engine order, env precedence and the provider plan');

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

  // Attachment analysis: the same `/api/agent/inspect` answer feeds the agent
  // tool and the issue attachment menu. Structure lines are built from
  // attacker-controlled fields, so they are sanitised and clipped here.
  const artReport = await loadTs(path.resolve('lib/agent/inspect-report.ts'), { './tool-cards': cards });
  assert.deepEqual(artReport.structureLines(null), []);
  assert.deepEqual(artReport.structureLines({}), [], 'a report without headers adds no lines');
  assert.deepEqual(artReport.structureLines({ pe: null, elf: null, zip: [] }), []);

  const peLines = artReport.structureLines({
    pe: {
      machine: 'x64',
      subsystem: 'console',
      timestamp: '2024-01-02T03:04:05Z',
      sections: Array.from({ length: 12 }, (_, index) => ({ name: `.s${index}`, rawSize: 4096, entropy: 7.3456 })),
    },
  });
  assert.equal(peLines[0], 'PE x64 · console · built 2024-01-02T03:04:05Z · 12 section(s)');
  assert.equal(peLines.length, 1 + artReport.REPORT_LIMITS.sections + 1, 'sections are capped plus a "… more" row');
  assert.equal(peLines[1], '· .s0 raw=4096B entropy=7.35');
  assert.equal(peLines.at(-1), `· … ${12 - artReport.REPORT_LIMITS.sections} more`);
  const peSevered = artReport.structureLines({ pe: { sections: 'not an array' } });
  assert.equal(peSevered[0], 'PE unknown · unknown · built unknown · 0 section(s)', 'garbage fields degrade, never throw');
  const peDirty = artReport.structureLines({
    pe: {
      machine: 'x\u0000\u000764'.padEnd(300, 'M'),
      subsystem: 'gui',
      timestamp: 'now',
      sections: [{ name: 'evil\u0007'.padEnd(300, 'N'), rawSize: 1 }],
    },
  });
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(peDirty.join('\n')), 'control characters never reach the panel');
  assert.ok(peDirty[0].startsWith('PE x 64'), 'control characters collapse to a space, the text survives');
  assert.ok(peDirty[0].length < 300, 'a hostile field cannot stretch the header line to the cap');

  assert.deepEqual(artReport.structureLines({ elf: { bits: 64, endian: 'little', machine: 'EM_X86_64', entry: '0x401000' } }), [
    'ELF 64-bit little EM_X86_64 entry 0x401000',
  ]);
  assert.deepEqual(artReport.structureLines({ macho: { bits: 64, cpu: 'arm64', filetype: 'executable' } }), [
    'Mach-O 64-bit arm64 executable',
  ]);
  const zipLines = artReport.structureLines({
    zip: Array.from({ length: 20 }, (_, index) => ({ name: `lib/${index}.dex`, size: index })),
  });
  assert.equal(zipLines[0], 'archive entries:');
  assert.equal(zipLines.length, 1 + artReport.REPORT_LIMITS.entries + 1);
  assert.equal(zipLines[1], '· lib/0.dex (0B)');
  assert.equal(zipLines.at(-1), '· … 5 more');

  const inspectResponse = {
    ok: true,
    hashes: { sha256: 'C'.repeat(64), sha1: 'd'.repeat(40), md5: 'E'.repeat(32) },
    report: {
      name: 'dropper.exe',
      size: 8192,
      format: { label: 'PE executable', id: 'pe', detail: 'x64 · console' },
      entropy: 7.4,
      packed: true,
      pe: { machine: 'x64', subsystem: 'console', timestamp: 'now', sections: [{ name: '.text', rawSize: 4096, entropy: 7.9 }] },
      strings: ['powershell -enc AAAA', 'VirtualAlloc'],
      indicators: [{ kind: 'command', value: 'powershell -enc AAAA' }],
      embedded: [{ kind: 'base64', bytes: 2048, format: 'ZIP' }],
      notes: ['high entropy'],
      hex: ['00000000  4d 5a'],
    },
  };
  const menuCard = artReport.inspectCardFromResponse(inspectResponse);
  assert.equal(menuCard.kind, 'inspect');
  assert.equal(menuCard.format, 'PE executable');
  assert.equal(menuCard.entropy, 7.4);
  assert.equal(menuCard.packed, true);
  assert.equal(menuCard.sha256, 'c'.repeat(64));
  assert.equal(menuCard.md5, 'e'.repeat(32));
  assert.deepEqual(menuCard.structure, ['PE x64 · console · built now · 1 section(s)', '· .text raw=4096B entropy=7.9']);
  assert.equal(menuCard.stringTotal, 2);
  assert.ok(cards.isToolCard(menuCard), 'the menu card passes the same guard the transcript uses');

  assert.equal(artReport.inspectCardFromResponse(null), null);
  assert.equal(artReport.inspectCardFromResponse('nope'), null);
  assert.equal(artReport.inspectCardFromResponse({ ok: false, error: 'too large' }), null, 'a failed answer has no card');
  assert.equal(artReport.inspectCardFromResponse({}), null);
  assert.equal(artReport.inspectCardFromResponse({ report: {} }), null, 'a report with no size and no format is not a report');
  assert.equal(artReport.inspectCardFromResponse({ report: { size: 12 } }).format, 'unknown', 'a bare report still renders');
  assert.equal(artReport.inspectCardFromResponse({ report: { size: 12 }, hashes: { sha256: 'nope' } }).sha256, undefined);

  assert.deepEqual(artReport.inspectRequestBody({ name: ' shot.png ', dataUrl: 'data:image/png;base64,AAAA', text: null }), {
    name: 'shot.png',
    base64: 'data:image/png;base64,AAAA',
  });
  assert.deepEqual(artReport.inspectRequestBody({ name: 'notes.txt', text: 'release checklist' }), {
    name: 'notes.txt',
    text: 'release checklist',
  });
  assert.deepEqual(
    artReport.inspectRequestBody({ name: 'both', dataUrl: 'data:image/png;base64,AAAA', text: 'text' }),
    { name: 'both', base64: 'data:image/png;base64,AAAA' },
    'the stored bytes win over a text copy',
  );
  assert.equal(artReport.inspectRequestBody({ name: 'empty.txt' }), null, 'an attachment with no bytes is refused, not sent');
  assert.equal(artReport.inspectRequestBody(null), null);
  assert.equal(artReport.inspectRequestBody({ text: 'body' }).name, 'artifact', 'a nameless attachment still gets a label');
  assert.equal(
    artReport.inspectRequestBody({ name: '\u0000x'.padEnd(400, 'y'), text: 'b' }).name.length,
    200,
    'the name is clipped before it reaches the request',
  );
  console.log('PASS attachment analysis: report mapping, header lines, clipping, and the request body');

  // Security audit: an address is masked, a line is parsed defensively, and a
  // member never sees someone else's events.
  const secRange = await loadTs(path.resolve('lib/audit-range.ts'));
  const audit = await loadTs(path.resolve('lib/security-audit.ts'), { './audit-range': secRange });

  assert.equal(audit.maskEmail('Alice@Example.COM'), 'a***@example.com');
  assert.equal(audit.maskEmail('a@b.co'), 'a***@b.co');
  assert.equal(audit.maskEmail('no-at-sign'), 'n***', 'a value without @ keeps one character');
  assert.equal(audit.maskEmail(''), '');
  assert.equal(audit.maskEmail(null), '');
  assert.equal(audit.auditText('a\nb\tc\u0000d', 20), 'a b c d');
  assert.equal(audit.auditText('x'.repeat(50), 10).length, 10);
  assert.equal(audit.auditText(42, 10), '');
  assert.equal(audit.auditText({}, 10), '');

  const base = Date.parse('2026-11-16T10:00:00.000Z');
  const first = audit.normalizeSecurityEvent({
    kind: 'sign_in',
    ok: false,
    at: base,
    actorEmail: 'Bob@Example.com',
    ip: '10.0.0.1',
    ua: 'Mozilla/5.0 (Windows NT 10.0)',
    detail: 'Wrong email or password. · password',
  });
  assert.equal(first.kind, 'sign_in');
  assert.equal(first.ok, false);
  assert.equal(first.actorEmail, 'b***@example.com', 'the audit never stores a full address');
  assert.equal(first.at, '2026-11-16T10:00:00.000Z');
  assert.match(first.id, /^ev_/);
  assert.equal(audit.normalizeSecurityEvent({ kind: 'nope', ok: true }), null);
  assert.equal(audit.normalizeSecurityEvent({ kind: 'sign_in', at: 'not a date' }), null);
  assert.equal(audit.normalizeSecurityEvent({ kind: 'sign_in', at: 0 }), null);
  assert.equal(audit.normalizeSecurityEvent(null), null);

  const stable = audit.normalizeSecurityEvent({ kind: 'sign_out', at: base });
  const stableAgain = audit.normalizeSecurityEvent({ kind: 'sign_out', at: base });
  assert.equal(stable.ok, true, 'ok defaults to true when the caller omits it');
  assert.equal(stable.id, stableAgain.id, 'a missing id is derived, so two reads agree');

  const rawLines = [
    audit.securityAuditLine(first),
    '',
    'not json at all',
    audit.securityAuditLine(stable),
    audit.securityAuditLine(first),
  ].join('\n');
  const parsedLines = audit.parseSecurityAudit(rawLines);
  assert.equal(parsedLines.length, 2, 'blank, broken and duplicate lines are dropped');
  assert.equal(audit.parseSecurityAudit('').length, 0);

  const ev = (kind, ok, minutes, extra = {}) =>
    audit.normalizeSecurityEvent({
      kind,
      ok,
      at: base + minutes * 60_000,
      actorId: 'u_1',
      actorName: 'Alice',
      actorEmail: 'alice@example.com',
      ip: '10.0.0.1',
      ua: 'Chrome/120 · Windows',
      detail: '',
      ...extra,
    });
  const events = [
    ev('sign_in', true, 0, { detail: 'password' }),
    ev('sign_in', false, 5, { detail: 'Wrong email or password.', actorId: '', actorName: '', actorEmail: 'ghost@example.com' }),
    ev('code', true, 10, { detail: 'purpose=signin · echo' }),
    ev('password_change', true, 15, { detail: 'other sessions signed out' }),
    ev('password_reset', false, 20, { detail: 'Code expired.' }),
    ev('register', true, 25, { detail: 'role=owner' }),
    ev('session_revoke', true, 30, { detail: 'revoked session abcd1234' }),
    ev('sign_out', true, 35),
  ];
  assert.ok(events.every(Boolean), 'every fixture normalises');
  const secNow = new Date(base + 40 * 60_000);

  assert.equal(audit.filterSecurityAudit(events, {}, secNow).length, 8);
  assert.equal(audit.filterSecurityAudit(events, { group: 'sign_in' }, secNow).length, 3, 'sign-out belongs to the sign-in group');
  assert.equal(audit.filterSecurityAudit(events, { group: 'password' }, secNow).length, 2);
  assert.equal(audit.filterSecurityAudit(events, { group: 'code' }, secNow).length, 1);
  assert.equal(audit.filterSecurityAudit(events, { group: 'account' }, secNow).length, 2);
  assert.equal(audit.filterSecurityAudit(events, { group: 'bogus' }, secNow).length, 8, 'an unknown group falls back to all');
  assert.equal(audit.filterSecurityAudit(events, { failuresOnly: true }, secNow).length, 2);
  assert.equal(audit.filterSecurityAudit(events, { actorId: 'u_1' }, secNow).length, 7);
  assert.equal(audit.filterSecurityAudit(events, { needle: 'g***@example.com' }, secNow).length, 1, 'the masked address is searchable');
  assert.equal(audit.filterSecurityAudit(events, { needle: 'Code expired' }, secNow).length, 1, 'the reason is searchable');
  assert.equal(audit.filterSecurityAudit(events, { needle: '10.0.0.1' }, secNow).length, 8);
  assert.equal(audit.filterSecurityAudit(events, { range: 'week' }, secNow).length, 8);
  assert.equal(audit.filterSecurityAudit(events, { range: 'month' }, secNow).length, 8);
  assert.equal(audit.filterSecurityAudit(events, { range: 'week' }, new Date(base + 60 * 86_400_000)).length, 0);
  const newestThree = audit.filterSecurityAudit(events, { limit: 3 }, secNow);
  assert.deepEqual(newestThree.map((row) => row.kind), ['sign_out', 'session_revoke', 'register'], 'newest first');
  assert.equal(audit.filterSecurityAudit(events, { limit: 0 }, secNow).length, 8, 'a zero limit is not a request for nothing');

  const secCapped = audit.capSecurityEvents(events, 3);
  assert.equal(secCapped.length, 3);
  assert.equal(secCapped[0].kind, 'sign_out');
  assert.equal(audit.capSecurityEvents(events, 0).length, 0);
  const body = audit.securityAuditFileBody(events, 3);
  assert.equal(body.trim().split('\n').length, 3);
  assert.match(body.split('\n')[0], /"kind":"register"/, 'the trimmed file is written oldest first');
  assert.equal(audit.securityAuditFileBody([], 5), '');

  assert.equal(audit.securityAuditVisibleTo(events[1], { id: 'u_1', role: 'member' }), false, 'an unattributed refusal stays with the owner');
  assert.equal(audit.securityAuditVisibleTo(events[0], { id: 'u_1', role: 'member' }), true);
  assert.equal(audit.securityAuditVisibleTo(events[1], { id: 'u_1', role: 'owner' }), true);
  assert.equal(audit.securityAuditVisibleTo(events[0], null), false);
  assert.equal(audit.visibleSecurityEvents(events, { id: 'u_1', role: 'member' }).length, 7);
  assert.equal(audit.visibleSecurityEvents(events, { id: 'u_9', role: 'member' }).length, 0);
  assert.equal(audit.visibleSecurityEvents(events, { id: 'u_9', role: 'owner' }).length, 8);

  const secSummary = audit.securityAuditSummary(events, secNow);
  assert.equal(secSummary.total, 8);
  assert.equal(secSummary.today, 8);
  assert.equal(secSummary.failures, 2);
  assert.equal(secSummary.lastAt, new Date(base + 35 * 60_000).toISOString());
  assert.deepEqual(secSummary.byGroup, { all: 8, sign_in: 3, password: 2, code: 1, account: 2 });
  const old = audit.securityAuditSummary(events, new Date(base + 3 * 86_400_000));
  assert.equal(old.total, 8, 'an old window does not drop the events, only the counters');
  assert.equal(old.today, 0);
  assert.equal(old.failures, 0);
  assert.equal(audit.securityAuditSummary([], secNow).lastAt, null);
  assert.equal(audit.securityAuditSummary([], secNow).byGroup.all, 0);

  const markdown = audit.securityAuditMarkdown(events, { scope: 'all', filter: 'All · All time', secNow });
  assert.ok(markdown.startsWith('# Aether security audit'));
  assert.ok(markdown.includes('- scope: whole workspace'));
  assert.ok(markdown.includes('- filter: All · All time'));
  assert.ok(markdown.includes('- events: 8'));
  assert.ok(markdown.includes('| when | event | result | who | ip | device | detail |'));
  assert.ok(markdown.includes('| sign_in | refused |'), 'a refusal is labelled, not hidden');
  assert.equal(markdown.trim().split('\n').filter((line) => line.startsWith('| 20')).length, 8);
  const selfMarkdown = audit.securityAuditMarkdown(events, { scope: 'self', secNow });
  assert.ok(selfMarkdown.includes('- scope: your events only'));
  assert.ok(selfMarkdown.includes('- filter: all'));
  const emptyMarkdown = audit.securityAuditMarkdown([], { secNow, filter: 'Codes' });
  assert.ok(emptyMarkdown.includes('No events match this filter.'));
  assert.ok(!emptyMarkdown.includes('| when |'));
  const piped = audit.securityAuditMarkdown([ev('sign_in', true, 0, { detail: 'a | b' })], { secNow });
  assert.ok(piped.includes('a \\| b'), 'a pipe in the detail cannot break the table');
  assert.equal(audit.securityAuditFileName(new Date('2026-11-16T10:00:00.000Z')), 'aether-security-audit-2026-11-16.md');
  console.log('PASS security audit: masking, JSONL parsing, filters, member scope, counters and the Markdown export');

  // The PR gate: which gates were asked for, what a run means, whether a red
  // tree gets parked, and what CI uploads. All decisions, no I/O.
  const gate = await loadTs(path.resolve('lib/ci/gate-report.ts'));
  assert.deepEqual(gate.parseGates('typecheck, Regression ,,build').planned, ['typecheck', 'regression', 'build']);
  assert.deepEqual(gate.parseGates('typecheck,typecheck').planned, ['typecheck'], 'duplicates collapse');
  assert.deepEqual(gate.parseGates('').planned, ['typecheck', 'regression'], 'an empty list falls back to the PR default');
  assert.deepEqual(gate.parseGates('  ').planned, ['typecheck', 'regression']);
  assert.deepEqual(gate.parseGates('nope,typecheck').unknown, ['nope'], 'a typo is reported, never silently dropped');
  assert.deepEqual(gate.parseGates('../../etc/passwd').planned, ['etc-passwd'], 'a gate name cannot walk out of the log dir');
  assert.deepEqual(gate.parseGates('Build; rm -rf /').planned, ['build-rm-rf'], 'shell punctuation is folded away');
  assert.equal(gate.safeGateName(''), 'gate');
  assert.equal(gate.safeGateName(null), 'gate');
  assert.equal(gate.safeGateName('  TYPE  '), 'type');
  assert.ok(gate.KNOWN_GATES.includes('regression'));

  const noise = ['\u001b[31mred\u001b[0m', '\u0000null', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\n');
  const tail = gate.tailOf(`\n\n${noise}\n\n`);
  assert.equal(tail.split('\n').length, gate.GATE_TAIL_LINES, 'only the last lines survive');
  assert.ok(tail.endsWith('line 19'));
  assert.ok(!tail.includes('\u001b') && !tail.includes('\u0000'), 'colour codes and NULs are stripped');
  assert.equal(gate.tailOf(''), '');
  assert.equal(gate.tailOf(undefined), '');
  assert.equal(gate.tailOf('x'.repeat(gate.GATE_TAIL_CHARS + 500)).length, gate.GATE_TAIL_CHARS + 3, 'a huge line is clipped');

  const failedRun = gate.summarizeGates(['typecheck', 'regression', 'build'], [
    { name: 'typecheck', ok: false, code: 2, tail: 'error TS2322: nope' },
  ]);
  assert.equal(failedRun.ok, false);
  assert.deepEqual(failedRun.failed.map((row) => row.name), ['typecheck']);
  assert.deepEqual(failedRun.skipped, ['regression', 'build'], 'a gate that never ran is not a pass');
  assert.equal(gate.exitCodeFor({ summary: failedRun }), 1);
  const green = gate.summarizeGates(['typecheck', 'regression'], [
    { name: 'typecheck', ok: true },
    { name: 'regression', ok: true },
  ]);
  assert.equal(green.ok, true);
  assert.deepEqual(green.passed, ['typecheck', 'regression']);
  assert.equal(gate.exitCodeFor({ summary: green }), 0);
  assert.equal(gate.exitCodeFor(null), 1, 'no report is never a pass');
  assert.equal(gate.summarizeGates([], []).ok, false, 'an empty gate list does not pass by default');
  const extra = gate.summarizeGates(['typecheck'], [{ name: 'lint', ok: true }]);
  assert.equal(extra.extra.length, 1);
  assert.equal(extra.ok, false, 'an unplanned result cannot make a planned gate green');

  assert.deepEqual(gate.normalizeGateResults([null, 3, { name: '' }, { name: '../../../x', ok: true }, { name: 'tdd', ok: true }]).map((row) => row.name), ['x', 'tdd']);
  const normalized = gate.normalizeGateResults([{ name: 'typecheck', ok: false, code: 'x', tail: 'boom' }, { name: 'typecheck', ok: false }]);
  assert.equal(normalized.length, 1, 'a repeated gate keeps its first result');
  assert.equal(normalized[0].code, 1, 'a non-numeric exit code on a failure reads as 1');
  assert.equal(normalized[0].tail, 'boom');
  assert.deepEqual(gate.normalizeGateResults('nope'), []);

  assert.deepEqual(gate.stashPlan({ enabled: true, failed: true, dirty: true }), { run: true, reason: 'ok' });
  assert.deepEqual(gate.stashPlan({ enabled: false, failed: true, dirty: true }), { run: false, reason: 'disabled' });
  assert.deepEqual(gate.stashPlan({ enabled: true, failed: false, dirty: true }), { run: false, reason: 'not-failed' });
  assert.deepEqual(gate.stashPlan({ enabled: true, failed: true, dirty: false }), { run: false, reason: 'clean-tree' });
  assert.equal(gate.stashMessage({ failed: 'typecheck', at: '2026-11-16T10:20:30.123Z' }), 'autopilot gate failed: typecheck @ 2026-11-16 10:20:30');
  assert.equal(gate.stashMessage({}), 'autopilot gate failed: gate @ unknown time');
  assert.equal(gate.normalizeStamp('2026-11-16T10:20:30Z'), '2026-11-16 10:20:30');
  assert.equal(gate.normalizeStamp(''), 'unknown time');

  const redReport = gate.normalizeReport({
    at: '2026-11-16T10:20:30.123Z',
    planned: ['typecheck', 'regression'],
    results: [{ name: 'typecheck', ok: false, code: 2, tail: 'error TS2322: broken\nts(1,2)\n```' }],
    logs: [{ name: 'typecheck', file: '.improve\\logs\\gate-typecheck.log', bytes: 42 }, { name: 'x', file: '  ' }],
    stash: { attempted: true, created: true, reason: 'ok', ref: 'stash@{0} (abc1234)', message: 'autopilot gate failed: typecheck @ 2026-11-16 10:20:30' },
    meta: { branch: 'main', commit: 'abc1234', dirty: true, node: 'v22.0.0' },
  });
  assert.equal(redReport.version, 1);
  assert.equal(redReport.summary.ok, false);
  assert.deepEqual(redReport.logs, [{ name: 'typecheck', file: '.improve/logs/gate-typecheck.log', bytes: 42 }]);
  const redMarkdown = gate.gateReportMarkdown(redReport);
  assert.ok(redMarkdown.startsWith('## autopilot gate — failed'));
  assert.ok(redMarkdown.includes('| typecheck | FAIL | 2 |'));
  assert.ok(redMarkdown.includes('| regression | not run | — |'));
  assert.ok(redMarkdown.includes('    error TS2322: broken'), 'the failure tail is indented, not fenced');
  assert.ok(redMarkdown.includes('· working tree dirty'));
  assert.ok(redMarkdown.includes('working tree stashed: `stash@{0} (abc1234)`'));
  assert.ok(redMarkdown.includes('`.improve/logs/gate-typecheck.log` (42 bytes)'));
  const greenMarkdown = gate.gateReportMarkdown(
    gate.normalizeReport({
      at: '2026-11-16T10:20:30Z',
      planned: ['typecheck'],
      results: [{ name: 'typecheck', ok: true, code: 0 }],
      stash: { attempted: false, created: false, reason: 'not-failed', ref: '', message: '' },
    }),
  );
  assert.ok(greenMarkdown.startsWith('## autopilot gate — passed'));
  assert.ok(greenMarkdown.includes('not needed (gate passed)'));
  assert.ok(!greenMarkdown.includes('### typecheck'), 'a green run has no failure section');
  const roundTrip = JSON.parse(gate.gateReportJson(redReport));
  assert.deepEqual(roundTrip, redReport, 'the uploaded JSON is the report');
  assert.equal(gate.normalizeReport({ planned: ['typecheck'] }).summary.ok, false, 'a missing result is not a pass');
  console.log('PASS gate report: gate parsing, skipped vs failed, stash policy, artifact JSON and the CI summary');

  // Cycle burndown: daily remaining points (estimate, or 1 when unestimated),
  // canceled scope removed, and the SVG geometry derived from those points.
  const cyclesLib = await loadTs(path.resolve('lib/cycles.ts'));
  const DAY_MS = 86_400_000;
  const isoOf = (ms) => new Date(ms).toISOString();
  const START = Date.UTC(2026, 0, 1);
  const cycle = {
    id: 'cyc-bd',
    name: 'Burndown',
    number: 1,
    startsAt: isoOf(START),
    endsAt: isoOf(START + 10 * DAY_MS),
    progress: 0,
  };
  const scoped = (id, estimate, status, createdOffset, closedOffset) => ({
    id,
    key: id,
    cycleId: 'cyc-bd',
    status,
    estimate,
    createdAt: isoOf(START + createdOffset),
    updatedAt: isoOf(START + closedOffset),
  });
  const scopedIssues = [
    scoped('a', 3, 'done', -2 * DAY_MS, 1 * DAY_MS),
    scoped('b', 2, 'in_progress', -3600_000, -3600_000),
    scoped('c', null, 'todo', -3600_000, -3600_000),
    scoped('d', 4, 'canceled', -3600_000, 3 * DAY_MS),
    scoped('e', 5, 'todo', 3 * DAY_MS + 3600_000, 3 * DAY_MS + 3600_000),
    scoped('f', 7, 'done', -1 * DAY_MS, 6 * DAY_MS),
  ];
  assert.equal(cyclesLib.issuePoints({ estimate: 3 }), 3);
  assert.equal(cyclesLib.issuePoints({ estimate: 0 }), 1, 'a zero estimate still takes a point');
  assert.equal(cyclesLib.issuePoints({ estimate: -2 }), 1);
  assert.equal(cyclesLib.issuePoints({ estimate: null }), 1);
  assert.equal(cyclesLib.issuePoints({ estimate: Number.NaN }), 1);
  assert.equal(cyclesLib.issuePoints({ estimate: '3' }), 1, 'a string estimate is not a number');

  const midCycle = START + 4 * DAY_MS + 3600_000;
  const daily = cyclesLib.burndown(scopedIssues, cycle, midCycle);
  assert.deepEqual(daily.map((point) => point.day), [0, 1, 2, 3, 4]);
  assert.deepEqual(daily.map((point) => point.scope), [17, 17, 17, 17, 22], 'scope grows when work is added mid-cycle');
  assert.deepEqual(daily.map((point) => point.done), [0, 3, 3, 3, 3], 'a completion only counts once it happened');
  assert.deepEqual(daily.map((point) => point.canceled), [0, 0, 0, 4, 4], 'canceled work leaves the scope');
  assert.deepEqual(daily.map((point) => point.remaining), [17, 14, 14, 10, 15]);
  assert.equal(daily[4].at, START + 4 * DAY_MS, 'buckets are anchored on the cycle start');

  const before = cyclesLib.burndown(scopedIssues, cycle, START - 5 * DAY_MS);
  assert.equal(before.length, 1, 'an upcoming cycle draws a single opening point');
  assert.equal(before[0].at, START);
  assert.equal(before[0].remaining, 17);
  const after = cyclesLib.burndown(scopedIssues, cycle, START + 40 * DAY_MS);
  assert.equal(after.length, 11, 'a finished cycle draws every day of its window');
  assert.equal(after.at(-1).at, START + 10 * DAY_MS, 'the last point lands on the closing day');
  assert.equal(after.at(-1).remaining, 8, 'both completions burn, the canceled block leaves the scope');
  assert.equal(cyclesLib.burndown(scopedIssues, { ...cycle, startsAt: 'nope' }, midCycle).length, 0);
  assert.equal(cyclesLib.burndown(scopedIssues, { ...cycle, endsAt: isoOf(START - DAY_MS) }, midCycle).length, 0);
  assert.equal(cyclesLib.burndown(scopedIssues, { ...cycle, id: 'other' }, midCycle)[0].scope, 0, 'another cycle owns nothing here');
  const inverted = cyclesLib.burndown(
    [{ ...scoped('x', 3, 'done', 5 * DAY_MS, 1 * DAY_MS) }],
    cycle,
    START + 6 * DAY_MS,
  );
  assert.ok(inverted.every((point) => point.remaining >= 0), 'remaining never goes negative');

  const geometry = cyclesLib.burndownGeometry(cycle, daily);
  assert.equal(geometry.max, 22);
  assert.equal(geometry.cutoff, 288, 'the real line stops on the last computed day');
  assert.deepEqual(geometry.grid, [12, 82, 152]);
  assert.equal(geometry.idealPath, 'M0,12 L720,152', 'the guide runs from today scope to zero at the close');
  const polyline = geometry.polyline.split(' ');
  assert.equal(polyline.length, 5);
  const xs = polyline.map((pair) => Number(pair.split(',')[0]));
  [0, 72, 144, 216, 288].forEach((expected, index) =>
    assert.ok(Math.abs(xs[index] - expected) < 0.2, `x ${index} should be ~${expected}, got ${xs[index]}`),
  );
  const ys = [43.8, 62.9, 62.9, 88.4, 56.5];
  polyline.forEach((pair, index) => {
    const value = Number(pair.split(',')[1]);
    assert.ok(Math.abs(value - ys[index]) < 0.15, `y ${index} should be ~${ys[index]}, got ${value}`);
  });
  assert.ok(geometry.path.startsWith('M0,43.8 L'), `unexpected path start: ${geometry.path.slice(0, 24)}`);
  assert.ok(geometry.area.endsWith(' L288,152 L0,152 Z'), 'the fill closes against the baseline');
  assert.ok(!geometry.polyline.includes('NaN') && !geometry.area.includes('NaN'));
  const emptyGeometry = cyclesLib.burndownGeometry(cycle, []);
  assert.equal(emptyGeometry.path, '');
  assert.equal(emptyGeometry.max, 1);
  assert.deepEqual(emptyGeometry.grid, []);
  const flatGeometry = cyclesLib.burndownGeometry(cycle, [
    { at: START, day: 0, scope: 0, done: 0, canceled: 0, remaining: 0 },
  ]);
  assert.equal(flatGeometry.max, 1, 'an empty cycle still has a usable scale');
  assert.equal(flatGeometry.polyline, '0,152');
  console.log('PASS cycle burndown: daily remaining points, unestimated work, canceled scope and SVG geometry');

  // Tool retries: what may be replayed, what the row looks like afterwards, and
  // whether the model's copy of the result follows the transcript.
  const retryLib = await loadTs(path.resolve('lib/agent/tool-retry.ts'));
  const failedRow = {
    id: 'log1', kind: 'tool', text: 'Issue NOPE-1 not found.', ok: false,
    name: 'get_issue', args: { key: 'NOPE-1' }, callId: 'call-1', ms: 12, at: 1,
  };
  const plan = retryLib.retryPlan(failedRow, 'done');
  assert.equal(plan.retryable, true);
  assert.equal(plan.name, 'get_issue');
  assert.deepEqual(plan.args, { key: 'NOPE-1' });
  assert.equal(plan.attempts, 1);
  assert.equal(retryLib.retryPlan(failedRow, 'running').blocked, 'busy');
  assert.equal(retryLib.retryPlan(failedRow, 'waiting').blocked, 'busy');
  assert.equal(retryLib.retryPlan({ ...failedRow, ok: true }, 'done').blocked, 'not-failed');
  assert.equal(retryLib.retryPlan({ ...failedRow, kind: 'final' }, 'done').blocked, 'not-a-tool');
  assert.equal(retryLib.retryPlan(undefined, 'done').blocked, 'not-a-tool');
  assert.equal(retryLib.retryPlan({ ...failedRow, name: '   ' }, 'done').blocked, 'unnamed');
  assert.equal(
    retryLib.retryPlan({ ...failedRow, text: 'Rejected by you', ok: false }, 'done').blocked,
    'rejected',
    'a rejected write stays rejected: the person already decided',
  );
  assert.deepEqual(retryLib.retryPlan({ ...failedRow, args: undefined }, 'done').args, {}, 'no args is an empty set, not a refusal');
  assert.equal(retryLib.retryPlan({ ...failedRow, attempts: 4 }, 'done').attempts, 4);
  assert.equal(retryLib.isRejectedRow(failedRow), false);
  assert.equal(retryLib.isRejectedRow({ ...failedRow, text: 'Rejected by you' }), true);

  const retried = retryLib.retriedEntry(failedRow, { ok: true, summary: 'ENG-1 read' }, 2400);
  assert.equal(retried.id, 'log1');
  assert.equal(retried.ok, true);
  assert.equal(retried.text, 'ENG-1 read');
  assert.equal(retried.ms, 2400);
  assert.equal(retried.attempts, 2);
  assert.equal(retried.at, 1, 'the row keeps its place in the transcript');
  assert.equal(retried.callId, 'call-1');
  assert.ok(retried.retriedAt > 0);
  assert.equal(retried.card, undefined, 'a stale receipt is dropped when the new call has none');
  const thrice = retryLib.retriedEntry(retried, { ok: false, summary: 'still failing' }, -5);
  assert.equal(thrice.attempts, 3);
  assert.equal(thrice.ms, undefined, 'a negative duration is not a measurement');
  const withCard = retryLib.retriedEntry(failedRow, { ok: true, summary: 'ok', card: { kind: 'search', query: 'q', hits: [], source: 'settings' } }, 10);
  assert.ok(withCard.card, 'a fresh receipt replaces the old one');
  assert.equal(retryLib.retriedEntry({ ...failedRow, attempts: 0 }, { ok: true, summary: 'x' }, 1).attempts, 2, 'attempts never fall below 1');

  const retryMessages = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'get_issue', args: { key: 'NOPE-1' } }] },
    { role: 'tool', toolCallId: 'call-1', content: 'Issue NOPE-1 not found.' },
    { role: 'assistant', content: 'Sorry.' },
  ];
  const reconciled = retryLib.reconcileToolMessage(retryMessages, 'call-1', 'ENG-1 · Read');
  assert.equal(reconciled.patched, true);
  assert.equal(reconciled.messages.length, 3);
  assert.equal(reconciled.messages[1].content, 'ENG-1 · Read');
  assert.equal(retryMessages[1].content, 'Issue NOPE-1 not found.', 'the input array is not mutated');
  const appended = retryLib.reconcileToolMessage(retryMessages, 'call-9', 'late result');
  assert.equal(appended.patched, false);
  assert.equal(appended.messages.length, 4);
  assert.equal(appended.messages.at(-1).toolCallId, 'call-9', 'a call missing from history is appended, not dropped');
  const noId = retryLib.reconcileToolMessage(retryMessages, undefined, 'x');
  assert.equal(noId.patched, false);
  assert.equal(noId.messages, retryMessages);

  assert.equal(retryLib.formatDuration(820), '820 ms');
  assert.equal(retryLib.formatDuration(0), '0 ms');
  assert.equal(retryLib.formatDuration(2400), '2.4 s');
  assert.equal(retryLib.formatDuration(45_900), '46 s');
  assert.equal(retryLib.formatDuration(125_000), '2m 05s');
  assert.equal(retryLib.formatDuration(59_700), '1m 00s', 'a rounded 60 s carries into the minute');
  assert.equal(retryLib.formatDuration(-1), '');
  assert.equal(retryLib.formatDuration(Number.NaN), '');
  assert.equal(retryLib.formatDuration(undefined), '');
  const toolRow = (extra) => ({ id: 'a', kind: 'tool', text: '', at: 0, ...extra });
  assert.equal(retryLib.toolMeta(toolRow({ ms: 2400 })), '2.4 s');
  assert.equal(retryLib.toolMeta(toolRow({ ms: 2400, attempts: 2 })), '2.4 s · #2');
  assert.equal(retryLib.toolMeta(toolRow({ attempts: 3 })), '#3');
  assert.equal(retryLib.toolMeta(toolRow({})), '');
  console.log('PASS tool retries: replay rules, row patching, message reconciliation and durations');

  // Context budget: a cut is described instead of performed silently.
  const compact = await loadTs(path.resolve('lib/agent/compact.ts'));
  const systemTurn = { role: 'system', content: 'system prompt' };
  const makeTurn = (index) => [
    { role: 'user', content: `question ${index} ${'x'.repeat(2000)}` },
    { role: 'assistant', content: 'answer', toolCalls: [{ id: `c${index}`, name: 'list_issues', args: {} }] },
    { role: 'tool', toolCallId: `c${index}`, content: '[]' },
  ];
  const longThread = [systemTurn, ...makeTurn(0), ...makeTurn(1), ...makeTurn(2), ...makeTurn(3), { role: 'user', content: 'last question' }];
  const budget = 1200;
  const cutReport = compact.compactionReport(longThread, budget);
  assert.equal(cutReport.applied, true);
  assert.ok(cutReport.droppedCount > 0);
  assert.ok(cutReport.droppedTurns >= 1);
  assert.ok(cutReport.droppedTokens > 0);
  assert.ok(cutReport.afterTokens < cutReport.beforeTokens, 'the sent transcript must be smaller');
  assert.equal(cutReport.totalMessages, longThread.length);
  assert.equal(cutReport.keptMessages, compact.compactMessages(longThread, budget).length);
  assert.ok(cutReport.keptFrom.startsWith('question'), `the report names the surviving window, got: ${cutReport.keptFrom}`);
  assert.ok(cutReport.dropped.length <= 8, 'previews are capped for storage');
  assert.equal(cutReport.dropped.at(-1).role, 'tool', 'the newest dropped message is nearest the cut');
  assert.ok(cutReport.dropped.every((row) => row.tokens > 0 && row.preview.length <= 140 && !row.preview.includes('\n')));
  const keptTurns = compact.compactMessages(longThread, budget);
  for (const message of keptTurns) {
    if (message.role !== 'tool') continue;
    assert.ok(keptTurns.some((entry) => entry.toolCalls?.some((call) => call.id === message.toolCallId)), 'no orphan tool message survives');
  }
  assert.equal(keptTurns[0].content.split('Some earlier turns were removed').length - 1, 1, 'the note is added once');

  const shortThread = [systemTurn, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }];
  const noCut = compact.compactionReport(shortThread, 60_000);
  assert.equal(noCut.applied, false);
  assert.equal(noCut.droppedCount, 0);
  assert.equal(noCut.droppedTokens, 0);
  assert.deepEqual(noCut.dropped, []);
  assert.equal(noCut.beforeTokens, noCut.afterTokens);
  assert.equal(noCut.keptFrom, 'hi', 'without a cut the window starts at the first question');
  assert.equal(compact.compactionSummary(noCut), '');

  const summaryLine = compact.compactionSummary(cutReport);
  assert.ok(
    /^\d+ turn\(s\) · \d+ message\(s\) · \d+ token\(s\)$/.test(summaryLine),
    `unexpected summary: ${summaryLine}`,
  );
  const noteRow = { kind: 'note', compaction: cutReport };
  const newer = { ...cutReport, applied: false };
  assert.equal(compact.lastCompaction([{ kind: 'user' }, noteRow, { kind: 'final' }]), cutReport);
  assert.equal(compact.lastCompaction([noteRow, { kind: 'note', compaction: newer }]), newer, 'the newest cut wins');
  assert.equal(compact.lastCompaction([{ kind: 'note' }, { kind: 'user' }]), undefined, 'a note without a report is not a cut');
  assert.equal(compact.lastCompaction([]), undefined);
  assert.equal(compact.lastCompaction(undefined), undefined);
  console.log('PASS context budget: compaction report, dropped previews, summary and last-cut lookup');

  console.log('Browser regression: node scripts/e2e.mjs (with the dev server running)');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


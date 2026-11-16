import { readJson, withLock, writeJson } from './store';
import { readAether, resolveTarget, updateAether } from './aether';
import { DATA_DIR } from './store';
import type { Issue, Project, Cycle, StatusKey, Priority } from '@/lib/types';
import type { AgentWorkflow, WorkflowRun, WorkflowRunEvent } from '@/lib/agent/types';

/**
 * Server-side execution of saved workflows.
 *
 * The browser runner (lib/agent/workflow-runner.ts) is for a person pressing
 * Run; this one runs without a tab open, so it cannot use the zustand stores.
 * It reads and writes the same snapshot and aether files, with the same version
 * discipline, and reuses the provider resolution from `aether.ts`.
 */

interface Snapshot {
  issues: Issue[];
  labels: unknown[];
  projects: Project[];
  cycles: Cycle[];
  notifications: unknown[];
  updatedAt?: number;
}

const EMPTY: Snapshot = { issues: [], labels: [], projects: [], cycles: [], notifications: [] };
const PERSONAL = process.env.WORKSPACE_MODE === 'personal';
const MAX_STEPS = 12;

/**
 * Cooperative cancellation for headless runs. The scheduler and the cancel
 * route live in one server process; the set is on globalThis so hot reloads
 * keep it, and each run clears its own key when it finishes.
 */
const cancelRequests: Set<string> =
  (globalThis as unknown as { __aetherWorkflowCancels?: Set<string> }).__aetherWorkflowCancels ??= new Set();

export function cancelWorkflowRun(accountId: string, workflowId: string) {
  cancelRequests.add(`${accountId}:${workflowId}`);
}

const snapshotFile = (accountId: string) => (PERSONAL ? `workspaces/${accountId}.json` : 'workspace.json');

async function readSnapshot(accountId: string): Promise<Snapshot> {
  const raw = await readJson<Partial<Snapshot>>(snapshotFile(accountId), EMPTY);
  return {
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    cycles: Array.isArray(raw.cycles) ? raw.cycles : [],
    notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
    updatedAt: raw.updatedAt,
  };
}

const statusKeys: StatusKey[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'];
const priorities: Priority[] = ['none', 'urgent', 'high', 'medium', 'low'];

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'list_issues',
      description: 'List issues in the workspace (recently updated first).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          status: { type: 'string', enum: statusKeys },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_issue',
      description: 'Read one issue by key, e.g. ENG-1.',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_projects',
      description: 'List projects with status and issue counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_cycles',
      description: 'List cycles with their window and progress.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge',
      description: 'Search the account knowledge base; returns ids and excerpts.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_knowledge',
      description: 'Read one knowledge entry by id.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_issue',
      description: 'Create an issue in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: statusKeys },
          priority: { type: 'string', enum: priorities },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_comment',
      description: 'Add a comment to an issue.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' }, body: { type: 'string' } },
        required: ['key', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'bulk_update',
      description: 'Apply one status/priority change to several issues by key.',
      parameters: {
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: statusKeys },
          priority: { type: 'string', enum: priorities },
        },
        required: ['keys'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_cycle',
      description: 'Put an issue into a cycle by id, number or name; pass "none" to take it out.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' }, cycle: { type: 'string' } },
        required: ['key', 'cycle'],
      },
    },
  },
];

const issueLine = (issue: Issue) =>
  `${issue.key} [${issue.status}/${issue.priority}] ${issue.title}${issue.assigneeId ? ` · ${issue.assigneeId}` : ''}`;

const nextIssue = (snapshot: Snapshot, input: Record<string, unknown>, projectId: string | null) => {
  const numbers = snapshot.issues
    .map((issue) => Number(issue.key.split('-')[1]))
    .filter((value) => Number.isFinite(value));
  const key = `ENG-${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
  const now = new Date().toISOString();
  const status = statusKeys.includes(input.status as StatusKey) ? (input.status as StatusKey) : 'todo';
  const priority = priorities.includes(input.priority as Priority) ? (input.priority as Priority) : 'none';
  return {
    id: `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    key,
    teamKey: 'ENG',
    title: String(input.title ?? 'Workflow report').slice(0, 200),
    description: String(input.description ?? '').slice(0, 20_000),
    status,
    priority,
    assigneeId: null,
    creatorId: 'agent',
    labelIds: [],
    projectId,
    cycleId: null,
    estimate: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    comments: [],
    activities: [
      {
        id: `a_${Date.now().toString(36)}`,
        actorId: 'agent',
        kind: 'created',
        detail: 'Created by a workflow',
        createdAt: now,
      },
    ],
  } satisfies Issue;
};

/** Execute one tool against the account's snapshot + knowledge, returning model-readable text. */
async function runTool(
  accountId: string,
  name: string,
  args: Record<string, unknown>,
  options: { allowWrites: boolean; projectId: string | null },
): Promise<string> {
  const store = await readAether(accountId);
  const snapshot = await readSnapshot(accountId);

  switch (name) {
    case 'list_issues': {
      const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(1, args.limit), 40) : 20;
      let list = snapshot.issues;
      if (args.status) list = list.filter((issue) => issue.status === args.status);
      if (query) {
        list = list.filter(
          (issue) => issue.title.toLowerCase().includes(query) || issue.key.toLowerCase().includes(query),
        );
      }
      const slice = [...list].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, limit);
      return slice.length ? slice.map(issueLine).join('\n') : 'No issues match.';
    }

    case 'get_issue': {
      const key = String(args.key ?? '').toUpperCase();
      const issue = snapshot.issues.find((item) => item.key.toUpperCase() === key);
      if (!issue) return `${key} not found.`;
      return [
        issueLine(issue),
        `Description: ${issue.description.replace(/\s+/g, ' ').slice(0, 1_200) || '(empty)'}`,
        `Comments: ${issue.comments.length} · Project: ${issue.projectId ?? 'none'} · Cycle: ${issue.cycleId ?? 'none'}`,
      ].join('\n');
    }

    case 'list_projects':
      return snapshot.projects.length
        ? snapshot.projects
            .map(
              (project) =>
                `${project.name} (${project.status}) · ${snapshot.issues.filter((issue) => issue.projectId === project.id).length} issues`,
            )
            .join('\n')
        : 'No projects.';

    case 'list_cycles':
      return snapshot.cycles.length
        ? snapshot.cycles
            .map((cycle) => `${cycle.id} ${cycle.name} · ${cycle.startsAt.slice(0, 10)} → ${cycle.endsAt.slice(0, 10)}`)
            .join('\n')
        : 'No cycles.';

    case 'search_knowledge': {
      const query = String(args.query ?? '').toLowerCase();
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(1, args.limit), 10) : 5;
      const matches = store.knowledge
        .map((item) => {
          let score = 0;
          if (item.title.toLowerCase().includes(query)) score += 6;
          if (item.tags.some((tag) => tag.includes(query))) score += 4;
          if (item.content.toLowerCase().includes(query)) score += 2;
          return { item, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return matches.length
        ? matches.map(({ item }) => `- ${item.id} · ${item.title}\n  ${item.content.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
        : `No knowledge matches "${query}".`;
    }

    case 'read_knowledge': {
      const item = store.knowledge.find((entry) => entry.id === args.id);
      return item ? `${item.title}\n\n${item.content.slice(0, 8_000)}` : 'Entry not found.';
    }

    case 'create_issue': {
      if (!options.allowWrites) return 'This workflow is read-only: create_issue was not executed.';
      const issue = await withLock(snapshotFile(accountId), async () => {
        const current = await readSnapshot(accountId);
        const created = nextIssue(current, args, options.projectId);
        await writeJson(snapshotFile(accountId), {
          ...current,
          issues: [created, ...current.issues],
          updatedAt: Date.now(),
        });
        return created;
      });
      return `${issue.key} created: ${issue.title}`;
    }

    case 'add_comment': {
      if (!options.allowWrites) return 'This workflow is read-only: add_comment was not executed.';
      const key = String(args.key ?? '').toUpperCase();
      const body = String(args.body ?? '').slice(0, 8_000);
      const found = await withLock(snapshotFile(accountId), async () => {
        const current = await readSnapshot(accountId);
        const issue = current.issues.find((item) => item.key.toUpperCase() === key);
        if (!issue) return false;
        await writeJson(snapshotFile(accountId), {
          ...current,
          issues: current.issues.map((item) =>
            item.id === issue.id
              ? {
                  ...item,
                  comments: [
                    ...item.comments,
                    { id: `c_${Date.now().toString(36)}`, authorId: 'agent', body, createdAt: new Date().toISOString() },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
          updatedAt: Date.now(),
        });
        return true;
      });
      return found ? `Comment added to ${key}.` : `${key} not found.`;
    }

    case 'bulk_update': {
      if (!options.allowWrites) return 'This workflow is read-only: bulk_update was not executed.';
      const keys = new Set(
        (Array.isArray(args.keys) ? args.keys : []).map((key) => String(key).toUpperCase()),
      );
      const status = statusKeys.includes(args.status as StatusKey) ? (args.status as StatusKey) : undefined;
      const priority = priorities.includes(args.priority as Priority)
        ? (args.priority as Priority)
        : undefined;
      if (!keys.size || (!status && !priority)) return 'Nothing to change: pass keys plus status or priority.';

      let writes = 0;
      await withLock(snapshotFile(accountId), async () => {
        const current = await readSnapshot(accountId);
        const now = new Date().toISOString();
        const issues = current.issues.map((issue) => {
          if (!keys.has(issue.key.toUpperCase())) return issue;
          writes += 1;
          return {
            ...issue,
            ...(status ? { status } : {}),
            ...(priority ? { priority } : {}),
            updatedAt: now,
          };
        });
        await writeJson(snapshotFile(accountId), { ...current, issues, updatedAt: Date.now() });
      });
      return `${writes} issue(s) updated.`;
    }

    case 'set_cycle': {
      if (!options.allowWrites) return 'This workflow is read-only: set_cycle was not executed.';
      const key = String(args.key ?? '').toUpperCase();
      const target = String(args.cycle ?? '').trim();
      const lower = target.toLowerCase();

      let result = `${key} not found.`;
      await withLock(snapshotFile(accountId), async () => {
        const current = await readSnapshot(accountId);
        const issue = current.issues.find((item) => item.key.toUpperCase() === key);
        if (!issue) return;
        if (lower === 'none') {
          await writeJson(snapshotFile(accountId), {
            ...current,
            issues: current.issues.map((item) =>
              item.id === issue.id ? { ...item, cycleId: null, updatedAt: new Date().toISOString() } : item,
            ),
            updatedAt: Date.now(),
          });
          result = `${key} removed from its cycle.`;
          return;
        }
        const cycle = current.cycles.find(
          (item) =>
            item.id === target ||
            String(item.number) === target ||
            item.name.toLowerCase() === lower ||
            item.name.toLowerCase().includes(lower),
        );
        if (!cycle) {
          result = `Cycle "${target}" not found.`;
          return;
        }
        await writeJson(snapshotFile(accountId), {
          ...current,
          issues: current.issues.map((item) =>
            item.id === issue.id ? { ...item, cycleId: cycle.id, updatedAt: new Date().toISOString() } : item,
          ),
          updatedAt: Date.now(),
        });
        result = `${key} → ${cycle.name}.`;
      });
      return result;
    }

    default:
      return `Unknown tool ${name}.`;
  }
}

const reportTitle = (text: string) => {
  const first = text.split('\n').map((line) => line.trim()).find(Boolean) ?? 'Workflow report';
  return first.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').slice(0, 140);
};

/** Run one workflow headlessly. Returns the run record that was appended. */
export async function runWorkflowOnServer(accountId: string, workflow: AgentWorkflow): Promise<WorkflowRun | null> {
  const startedAt = Date.now();
  const target = await resolveTarget(accountId, {
    route: 'workflow',
    providerId: workflow.providerId ?? undefined,
    model: workflow.model || undefined,
  });
  if (!target || !target.model) return null;
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(new URL(target.provider.baseUrl).hostname);
  if (!target.apiKey && !local) return null;

  const snapshot = await readSnapshot(accountId);
  const store = await readAether(accountId);
  const memory = store.memoryEnabled ? store.memory.slice(-20) : [];
  const system = [
    store.persona ? `${store.persona}\n\n` : '',
    'You are a workflow runner inside Aether. You run one saved instruction without a human in the loop.',
    'Read before writing. A write is allowed only when the workflow permits it; if a tool says it is read-only, do not retry.',
    'Finish with a compact report: what you checked, what you found, what needs a person. Plain text, no headings.',
    "Write statuses and priorities as words in the user's language, never raw keys.",
    store.instructions ? `\nWorkspace instructions:\n${store.instructions}` : '',
    memory.length ? `\nLong-term memory:\n${memory.map((item) => `- [${item.kind}] ${item.text}`).join('\n')}` : '',
    store.knowledge.length
      ? `\nKnowledge base (${store.knowledge.length} entries): ${store.knowledge.slice(0, 20).map((item) => item.title).join(' · ')}`
      : '',
    `\nWorkspace: ${snapshot.issues.length} issues, ${snapshot.projects.length} projects, ${snapshot.cycles.length} cycles. Today: ${new Date().toISOString().slice(0, 10)}`,
    `\nWorkflow: ${workflow.name}\n${workflow.description}`.trim(),
  ].join('\n');

  const messages: Record<string, unknown>[] = [
    { role: 'system', content: system },
    { role: 'user', content: workflow.prompt },
  ];

  let finalText = '';
  let steps = 0;
  let toolsUsed = 0;
  let failure = '';
  let canceled = false;
  const cancelKey = `${accountId}:${workflow.id}`;
  const events: WorkflowRunEvent[] = [];
  const trace = (kind: WorkflowRunEvent['kind'], text: string, ok?: boolean) => {
    events.push({ kind, text: text.replace(/\s+/g, ' ').slice(0, 600), at: Date.now(), ...(ok === undefined ? {} : { ok }) });
    if (events.length > 100) events.shift();
  };

  try {
    for (let step = 0; step < Math.min(MAX_STEPS, Math.max(1, workflow.maxSteps)); step += 1) {
      if (cancelRequests.has(cancelKey)) {
        canceled = true;
        failure = 'Canceled by user.';
        break;
      }
      const response = await fetch(`${target.provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: target.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: target.temperature,
          stream: false,
        }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`${response.status} · ${detail.slice(0, 300)}`);
      }

      const json = (await response.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
      };
      const message = json.choices?.[0]?.message;
      const calls = message?.tool_calls ?? [];
      finalText = message?.content?.trim() || finalText;
      steps += 1;
      trace('step', `Step ${step + 1}: ${calls.length ? `${calls.length} tool call(s)` : 'answer'}`);

      if (!calls.length) break;

      messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const args = (() => {
          try {
            return JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        const toolRun = await runTool(accountId, call.function.name, args, {
          allowWrites: workflow.allowWrites,
          projectId: workflow.projectId,
        });
        toolsUsed += 1;
        trace('tool', `${call.function.name} · ${toolRun.slice(0, 240)}`);
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolRun });
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    trace('error', failure, false);
  } finally {
    cancelRequests.delete(cancelKey);
  }

  if (!failure) trace('final', finalText.slice(0, 500) || 'Empty answer', true);

  const run: WorkflowRun = {
    id: `run_${Date.now().toString(36)}`,
    at: Date.now(),
    status: canceled ? 'canceled' : failure ? 'error' : 'ok',
    summary: (failure ? `${failure}\n${finalText}` : finalText).slice(0, 2_000),
    steps,
    tools: toolsUsed,
    ms: Date.now() - startedAt,
    model: target.model,
    events,
    ...(failure ? { error: failure } : {}),
  };

  // the report can become an issue even when the run itself is headless
  if (!failure && workflow.createIssue && finalText.trim()) {
    try {
      const created = await withLock(snapshotFile(accountId), async () => {
        const current = await readSnapshot(accountId);
        const issue = nextIssue(
          current,
          {
            title: `[${workflow.name}] ${reportTitle(finalText)}`,
            description: finalText,
            status: workflow.issueStatus ?? 'todo',
            priority: 'none',
          },
          workflow.projectId,
        );
        await writeJson(snapshotFile(accountId), {
          ...current,
          issues: [issue, ...current.issues],
          updatedAt: Date.now(),
        });
        return issue;
      });
      run.issueKey = created.key;
    } catch {
      /* the report still lives in the run history */
    }
  }

  await updateAether(accountId, (current) => ({
    workflows: current.workflows.map((item) =>
      item.id === workflow.id
        ? { ...item, lastRunAt: run.at, runs: [run, ...item.runs].slice(0, 20), updatedAt: Date.now() }
        : item,
    ),
  }));

  return run;
}

/** Local-time schedule check, shared with the browser runner. */
export { workflowDue } from '@/lib/agent/schedule';

export const schedulerDataDir = () => `${DATA_DIR}/aether`;

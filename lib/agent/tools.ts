import { useData } from '@/lib/store/data';
import { peopleNow } from '@/lib/people';
import { useChats } from './chats';
import { RELATION_INVERSE, STATUSES, type Issue, type Priority, type RelationType, type StatusKey } from '@/lib/types';
import { useWorkspace } from './workspace';
import { chunkText } from './search';
import { hybridRankKnowledge } from './semantic';
import { inspectCardFromResponse, structureLines } from './inspect-report';
import { buildSearchCard, type ToolCard } from './tool-cards';
import type { ChatSource } from './types';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolOutcome {
  ok: boolean;
  content: string;
  summary: string;
  /** structured receipt for the transcript card; only some tools produce one */
  card?: ToolCard;
  /** outside material this call actually opened, for the answer's sources */
  sources?: ChatSource[];
}

const statusKeys = STATUSES.map((status) => status.key);
const priorityKeys: Priority[] = ['none', 'urgent', 'high', 'medium', 'low'];
const relationKeys: RelationType[] = ['blocks', 'blocked_by', 'related', 'duplicate'];

const issueLine = (issue: Issue) =>
  `${issue.key} [${issue.status}/${issue.priority}] ${issue.title}` +
  (issue.assigneeId ? ` · ${userIdToName(issue.assigneeId)}` : '');

function userIdToName(id: string | null) {
  if (!id) return '';
  return peopleNow().users.find((user) => user.id === id)?.name ?? id;
}

function findIssue(key: unknown): Issue | undefined {
  if (typeof key !== 'string') return undefined;
  const normalized = key.trim().toUpperCase();
  return useData.getState().issues.find((issue) => issue.key.toUpperCase() === normalized || issue.id === key);
}

function findUser(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const needle = value.trim().toLowerCase();
  if (needle === 'me' || needle === '我') return peopleNow().me;
  return (
    peopleNow().users.find((user) => user.id === needle) ??
    peopleNow().users.find((user) => user.handle.toLowerCase() === needle) ??
    peopleNow().users.find((user) => user.name.toLowerCase().includes(needle)) ??
    null
  );
}

const ok = (content: string, summary = content, card?: ToolCard): ToolOutcome =>
  card ? { ok: true, content, summary, card } : { ok: true, content, summary };
const fail = (content: string): ToolOutcome => ({ ok: false, content, summary: content });

export const TOOLS: ToolSpec[] = [
  {
    name: 'list_issues',
    description:
      'List issues in the workspace. Use it before acting when you do not already know the issue key. Defaults to the 20 most recently updated.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'substring of the title or the issue key' },
        status: { type: 'string', enum: statusKeys },
        assignee: { type: 'string', description: 'user name, handle, id, or "me"' },
        label: { type: 'string', description: 'label name, e.g. Bug' },
        cycle: { type: 'string', description: 'cycle id such as c43' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_issue',
    description: 'Read one issue: description, properties, sub-issues, relations and the last comments.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'issue key, e.g. ENG-1' } },
      required: ['key'],
    },
  },
  {
    name: 'create_issue',
    description: 'Create an issue. Returns the new key. Use parent to create a sub-issue.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: statusKeys },
        priority: { type: 'string', enum: priorityKeys },
        assignee: { type: 'string' },
        parent: { type: 'string', description: 'parent issue key for a sub-issue' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_issue',
    description: 'Change one issue property. Only the fields you pass are changed.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        status: { type: 'string', enum: statusKeys },
        priority: { type: 'string', enum: priorityKeys },
        assignee: { type: 'string', description: 'user name/handle, or "none" to unassign' },
        cycle: { type: 'string', description: 'cycle id, or "none"' },
        estimate: { type: 'number' },
      },
      required: ['key'],
    },
  },
  {
    name: 'add_comment',
    description: 'Post a comment on an issue as the current user.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, body: { type: 'string' } },
      required: ['key', 'body'],
    },
  },
  {
    name: 'add_label',
    description: 'Attach a label to an issue, creating the label when it does not exist yet.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, label: { type: 'string' } },
      required: ['key', 'label'],
    },
  },
  {
    name: 'relate_issues',
    description: 'Link two issues. type is what the first issue does to the target (blocks / blocked_by / related / duplicate).',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        type: { type: 'string', enum: relationKeys },
        target: { type: 'string' },
      },
      required: ['key', 'type', 'target'],
    },
  },
  {
    name: 'list_cycles',
    description: 'List cycles with their window, phase and open scope size.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_projects',
    description: 'List projects with their status and how many issues sit in each.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_project',
    description: 'Create a project — a group of issues that ship together.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_cycle',
    description: 'Create a cycle (a two-week window of work) starting now.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        days: { type: 'number', description: 'length in days, default 14' },
      },
    },
  },
  {
    name: 'set_project',
    description: 'Put an issue into a project (by name or id), or pass "none" to take it out.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, project: { type: 'string' } },
      required: ['key', 'project'],
    },
  },
  {
    name: 'set_cycle',
    description: 'Schedule an issue into a cycle (by id or number), or pass "none" to take it out.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, cycle: { type: 'string' } },
      required: ['key', 'cycle'],
    },
  },
  {
    name: 'bulk_update',
    description: 'Apply the same property change to several issues at once.',
    parameters: {
      type: 'object',
      properties: {
        keys: { type: 'array', items: { type: 'string' }, description: 'issue keys, e.g. ["ENG-1","ENG-2"]' },
        status: { type: 'string', enum: statusKeys },
        priority: { type: 'string', enum: priorityKeys },
        assignee: { type: 'string', description: 'user name/handle, or "none"' },
      },
      required: ['keys'],
    },
  },
  {
    name: 'remember',
    description:
      'Store a durable fact about the user or this workspace (a preference, a decision, a constraint). Use it only for things worth knowing next week, never for transient state.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'one self-contained sentence' },
        kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'note'] },
        scope: { type: 'string', enum: ['global', 'chat', 'issue'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'recall',
    description: 'Search the long-term memory of this account. Returns the matching facts, newest first.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'optional substring' } },
    },
  },
  {
    name: 'search_knowledge',
    description:
      'Search the knowledge base (notes, saved pages, files). Returns entry ids; call read_knowledge with an id to read the body.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'default 5, max 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_knowledge',
    description: 'Read one knowledge entry in full, by the id returned from search_knowledge.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list_workflows',
    description: 'List the saved workflows with their trigger and last run, so you can suggest reusing one.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_connectors',
    description:
      'List the external connectors this workspace has configured. Use one with call_connector to read or update the connected service.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'call_connector',
    description:
      'Make one request through a configured connector. GET and HEAD run directly; POST/PUT/PATCH/DELETE need the user to approve them. The path stays inside the connector base URL.',
    parameters: {
      type: 'object',
      properties: {
        connector: { type: 'string', description: 'connector id or name' },
        method: { type: 'string', enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        path: { type: 'string', description: 'path under the connector base URL, e.g. /repos/acme/app/issues' },
        body: { type: 'object', description: 'JSON body for write methods' },
      },
      required: ['connector', 'method', 'path'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the public web and get titles, URLs and snippets back. Use it for version numbers, error messages, library docs and anything the workspace does not know.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'what to look for, 1-200 characters' },
        limit: { type: 'number', description: 'how many results, 1-10, default 6' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Read one public page as title + text + outbound links. Follow a search hit with this before quoting it. Local and private addresses are refused.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL' },
        maxChars: { type: 'number', description: 'clip the text, default 6000' },
      },
      required: ['url'],
    },
  },
  {
    name: 'inspect_artifact',
    description:
      'Static triage of a file or pasted blob: format, hashes, entropy (packed or not), PE/ELF/Mach-O headers, ZIP/APK listing, printable strings, URLs/IPs/commands and embedded base64 payloads. Reads an issue attachment by name, or raw base64/text. Never executes the sample.',
    parameters: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'issue key whose attachment should be analysed' },
        attachment: { type: 'string', description: 'attachment file name on that issue' },
        base64: { type: 'string', description: 'raw base64 (or data: URL) when no attachment is given' },
        text: { type: 'string', description: 'a text blob to analyse instead of bytes' },
      },
    },
  },
];

export async function runTool(name: string, rawArgs: Record<string, unknown>): Promise<ToolOutcome> {
  const data = useData.getState();
  switch (name) {
    case 'list_issues': {
      const limit = typeof rawArgs.limit === 'number' ? Math.min(Math.max(1, rawArgs.limit), 50) : 20;
      const query = typeof rawArgs.query === 'string' ? rawArgs.query.trim().toLowerCase() : '';
      const user = findUser(rawArgs.assignee);
      let list = data.issues;
      if (rawArgs.status) list = list.filter((issue) => issue.status === rawArgs.status);
      if (rawArgs.label) {
        const label = data.labels.find((item) => item.name.toLowerCase() === String(rawArgs.label).toLowerCase());
        list = label ? list.filter((issue) => issue.labelIds.includes(label.id)) : [];
      }
      if (rawArgs.cycle) list = list.filter((issue) => issue.cycleId === rawArgs.cycle);
      if (user) list = list.filter((issue) => issue.assigneeId === user.id);
      if (query) {
        list = list.filter(
          (issue) => issue.key.toLowerCase().includes(query) || issue.title.toLowerCase().includes(query),
        );
      }
      const slice = [...list]
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, limit);
      return slice.length
        ? ok(slice.map(issueLine).join('\n'), `${list.length} match(es), showing ${slice.length}`)
        : ok('No issues match that filter.');
    }

    case 'get_issue': {
      const issue = findIssue(rawArgs.key);
      if (!issue) return fail(`Issue ${String(rawArgs.key)} not found.`);
      const children = data.issues.filter((child) => child.parentId === issue.id);
      const relations = (issue.relations ?? [])
        .map((relation) => `${relation.type} ${relation.issueId}`)
        .join(', ');
      const comments = issue.comments
        .slice(-3)
        .map((comment) => `- ${userIdToName(comment.authorId)}: ${comment.body.slice(0, 200)}`)
        .join('\n');
      const attachments = (issue.attachments ?? [])
        .map(
          (file) =>
            `- ${file.name} (${file.mime}, ${file.size}B)${file.text ? `\n  ${file.text.replace(/\s+/g, ' ').slice(0, 500)}` : ''}`,
        )
        .join('\n');
      return ok(
        [
          `${issue.key} · ${issue.title}`,
          `status=${issue.status} priority=${issue.priority} assignee=${userIdToName(issue.assigneeId) || 'none'} cycle=${issue.cycleId ?? 'none'} project=${issue.projectId ?? 'none'} labels=${issue.labelIds.join(',') || 'none'}`,
          issue.description ? `description:\n${issue.description.slice(0, 1200)}` : 'description: (empty)',
          children.length ? `sub-issues: ${children.map((child) => `${child.key} [${child.status}]`).join(', ')}` : '',
          relations ? `relations: ${relations}` : '',
          attachments ? `attachments:\n${attachments}` : '',
          comments ? `recent comments:\n${comments}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        `${issue.key} read`,
      );
    }

    case 'create_issue': {
      const title = typeof rawArgs.title === 'string' ? rawArgs.title.trim() : '';
      if (!title) return fail('Title is required.');
      const parent = rawArgs.parent ? findIssue(rawArgs.parent) : undefined;
      if (rawArgs.parent && !parent) return fail(`Parent ${String(rawArgs.parent)} not found.`);
      const created = data.createIssue({
        title,
        status: (rawArgs.status as StatusKey) ?? 'todo',
        priority: (rawArgs.priority as Priority) ?? 'none',
        assigneeId: findUser(rawArgs.assignee)?.id ?? null,
        parentId: parent?.id ?? null,
        projectId: typeof rawArgs.projectId === 'string' ? rawArgs.projectId : null,
      });
      if (typeof rawArgs.description === 'string' && rawArgs.description.trim()) {
        data.patchIssue(created.id, { description: rawArgs.description.trim() });
      }
      for (const label of Array.isArray(rawArgs.labels) ? rawArgs.labels : []) {
        const existing = data.labels.find((item) => item.name.toLowerCase() === String(label).toLowerCase());
        const id = existing?.id ?? data.addLabel(String(label)).id;
        data.toggleLabel(created.id, id);
      }
      return ok(`${created.key} created: ${created.title}`, `已创建 ${created.key}`);
    }

    case 'update_issue': {
      const issue = findIssue(rawArgs.key);
      if (!issue) return fail(`Issue ${String(rawArgs.key)} not found.`);
      const changes: string[] = [];
      if (typeof rawArgs.status === 'string') {
        if (!statusKeys.includes(rawArgs.status as StatusKey)) return fail(`Unknown status ${rawArgs.status}.`);
        data.setStatus(issue.id, rawArgs.status as StatusKey, 'agent');
        changes.push(`status → ${rawArgs.status}`);
      }
      if (typeof rawArgs.priority === 'string') {
        if (!priorityKeys.includes(rawArgs.priority as Priority)) return fail(`Unknown priority ${rawArgs.priority}.`);
        data.setPriority(issue.id, rawArgs.priority as Priority, 'agent');
        changes.push(`priority → ${rawArgs.priority}`);
      }
      if (rawArgs.assignee !== undefined) {
        const unassign = String(rawArgs.assignee).toLowerCase() === 'none';
        data.setAssignee(issue.id, unassign ? null : findUser(rawArgs.assignee)?.id ?? null, 'agent');
        changes.push(`assignee → ${unassign ? 'none' : userIdToName(findUser(rawArgs.assignee)?.id ?? null)}`);
      }
      if (rawArgs.cycle !== undefined) {
        const target = String(rawArgs.cycle).toLowerCase();
        const cycle = data.cycles.find((item) => item.id === target || String(item.number) === target);
        if (target !== 'none' && !cycle) return fail(`Unknown cycle ${rawArgs.cycle}.`);
        data.setCycle(issue.id, target === 'none' ? null : cycle!.id);
        changes.push(`cycle → ${target === 'none' ? 'none' : cycle!.name}`);
      }
      if (typeof rawArgs.estimate === 'number') {
        data.setEstimate(issue.id, rawArgs.estimate);
        changes.push(`estimate → ${rawArgs.estimate}`);
      }
      return changes.length
        ? ok(`${issue.key}: ${changes.join(', ')}`, `已更新 ${changes.join(', ')}`)
        : fail('No changes were requested.');
    }

    case 'add_comment': {
      const issue = findIssue(rawArgs.key);
      if (!issue) return fail(`Issue ${String(rawArgs.key)} not found.`);
      const body = typeof rawArgs.body === 'string' ? rawArgs.body.trim() : '';
      if (!body) return fail('Comment body is required.');
      data.addComment(issue.id, peopleNow().meId, body);
      return ok(`Comment added to ${issue.key}.`, `已评论 ${issue.key}`);
    }

    case 'add_label': {
      const issue = findIssue(rawArgs.key);
      if (!issue) return fail(`Issue ${String(rawArgs.key)} not found.`);
      const name = typeof rawArgs.label === 'string' ? rawArgs.label.trim() : '';
      if (!name) return fail('Label name is required.');
      const existing = data.labels.find((item) => item.name.toLowerCase() === name.toLowerCase());
      const label = existing ?? data.addLabel(name);
      if (!issue.labelIds.includes(label.id)) data.toggleLabel(issue.id, label.id);
      return ok(`${label.name} on ${issue.key}.`, `已加标签 ${label.name}`);
    }

    case 'relate_issues': {
      const issue = findIssue(rawArgs.key);
      const target = findIssue(rawArgs.target);
      if (!issue || !target) return fail('Both issues must exist.');
      if (!relationKeys.includes(rawArgs.type as RelationType)) return fail(`Unknown relation ${rawArgs.type}.`);
      data.addRelation(issue.id, rawArgs.type as RelationType, target.id);
      return ok(
        `${issue.key} ${rawArgs.type} ${target.key} (inverse: ${RELATION_INVERSE[rawArgs.type as RelationType]}).`,
        `${rawArgs.type} ${target.key}`,
      );
    }

    case 'list_cycles': {
      const now = Date.now();
      const list = data.cycles;
      const lines = list.map((cycle) => {
        const scope = data.issues.filter((issue) => issue.cycleId === cycle.id);
        const phase = now < +new Date(cycle.startsAt) ? 'upcoming' : now > +new Date(cycle.endsAt) ? 'completed' : 'current';
        return `${cycle.id} ${cycle.name} (${phase}) ${cycle.startsAt.slice(0, 10)} → ${cycle.endsAt.slice(0, 10)} · ${scope.length} issues`;
      });
      return ok(lines.length ? lines.join('\n') : 'No cycles yet.');
    }

    case 'list_projects': {
      const list = data.projects;
      if (!list.length) return ok('No projects yet.');
      return ok(
        list
          .map((project) => {
            const count = data.issues.filter((issue) => issue.projectId === project.id).length;
            return `${project.id} ${project.name} (${project.status}) · ${count} issues`;
          })
          .join('\n'),
      );
    }

    case 'create_project': {
      const name = typeof rawArgs.name === 'string' ? rawArgs.name.trim() : '';
      if (!name) return fail('Project name is required.');
      const project = data.createProject({
        name,
        summary: typeof rawArgs.summary === 'string' ? rawArgs.summary : '',
      });
      return ok(`${project.id} created: ${project.name}`, `已创建项目 ${project.name}`);
    }

    case 'create_cycle': {
      const name = typeof rawArgs.name === 'string' && rawArgs.name.trim() ? rawArgs.name : undefined;
      const days = typeof rawArgs.days === 'number' ? Math.min(Math.max(1, rawArgs.days), 60) : 14;
      const cycle = data.createCycle({ name, days });
      return ok(
        `${cycle.id} ${cycle.name} · ${cycle.startsAt.slice(0, 10)} → ${cycle.endsAt.slice(0, 10)}`,
        `Created ${cycle.name}`,
      );
    }

    case 'set_project': {
      const issue = findIssue(rawArgs.key);
      if (!issue) return fail(`Issue ${String(rawArgs.key)} not found.`);
      const target = String(rawArgs.project ?? '').trim().toLowerCase();
      if (target === 'none') {
        data.setProject(issue.id, null);
        return ok(`${issue.key} is no longer in a project.`, '已移出项目');
      }
      const project = data.projects.find(
        (item) => item.id.toLowerCase() === target || item.name.toLowerCase() === target,
      );
      if (!project) return fail(`Unknown project ${String(rawArgs.project)}. Call list_projects first.`);
      data.setProject(issue.id, project.id);
      return ok(`${issue.key} → ${project.name}.`, `已加入项目 ${project.name}`);
    }

    case 'set_cycle': {
      const issue = findIssue(rawArgs.key);
      if (!issue) return fail(`Issue ${String(rawArgs.key)} not found.`);
      const target = String(rawArgs.cycle ?? '').trim().toLowerCase();
      if (target === 'none') {
        data.setCycle(issue.id, null);
        return ok(`${issue.key} is no longer in a cycle.`, '已移出周期');
      }
      const cycle = data.cycles.find(
        (item) => item.id.toLowerCase() === target || String(item.number) === target || item.name.toLowerCase() === target,
      );
      if (!cycle) return fail(`Unknown cycle ${String(rawArgs.cycle)}. Call list_cycles first.`);
      data.setCycle(issue.id, cycle.id);
      return ok(`${issue.key} → ${cycle.name}.`, `已排入周期 ${cycle.name}`);
    }

    case 'bulk_update': {
      const keys = Array.isArray(rawArgs.keys) ? rawArgs.keys.map(String) : [];
      if (!keys.length) return fail('keys is required.');
      const found = keys.map((key) => findIssue(key)).filter((issue): issue is Issue => Boolean(issue));
      if (!found.length) return fail('None of those issue keys exist.');

      let writes = 0;
      data.batchIssues(() => {
        for (const issue of found) {
          if (typeof rawArgs.status === 'string' && statusKeys.includes(rawArgs.status as StatusKey)) {
            data.setStatus(issue.id, rawArgs.status as StatusKey, 'agent');
            writes += 1;
          }
          if (typeof rawArgs.priority === 'string' && priorityKeys.includes(rawArgs.priority as Priority)) {
            data.setPriority(issue.id, rawArgs.priority as Priority, 'agent');
            writes += 1;
          }
          if (rawArgs.assignee !== undefined) {
            const unassign = String(rawArgs.assignee).toLowerCase() === 'none';
            data.setAssignee(issue.id, unassign ? null : findUser(rawArgs.assignee)?.id ?? null, 'agent');
            writes += 1;
          }
        }
      });
      return ok(`${found.length} issue(s) updated (${writes} field writes).`, `已更新 ${found.length} 个议题`);
    }

    case 'remember': {
      const text = String(rawArgs.text ?? '').trim();
      if (!text) return fail('Nothing to remember: "text" is empty.');
      const kind = ['fact', 'preference', 'decision', 'note'].includes(String(rawArgs.kind))
        ? String(rawArgs.kind)
        : 'note';
      const scope = ['global', 'chat', 'issue'].includes(String(rawArgs.scope)) ? String(rawArgs.scope) : 'global';
      const chatTarget = typeof rawArgs.targetId === 'string' ? rawArgs.targetId : '';
      const chatId = chatTarget.startsWith('chat:') ? chatTarget.slice(5) : chatTarget;
      const projectId = useChats.getState().chats.find((chat) => chat.id === chatId)?.projectId;
      const response = await fetch('/api/agent/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind, scope, ref: String(rawArgs.ref ?? ''), projectId, source: 'agent' }),
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; memory?: unknown };
      if (!response.ok || !json.ok) return fail('Could not save that memory.');
      if (Array.isArray(json.memory)) useWorkspace.setState({ memory: json.memory as never });
      return ok(`Remembered (${scope}/${kind}): ${text}`, `已记住 ${text.slice(0, 40)}`);
    }

    case 'recall': {
      const query = typeof rawArgs.query === 'string' ? rawArgs.query.trim().toLowerCase() : '';
      const memory = useWorkspace.getState().memory;
      const matches = (query ? memory.filter((entry) => entry.text.toLowerCase().includes(query)) : memory).slice(-20);
      return matches.length
        ? ok(matches.map((entry) => `- [${entry.scope}/${entry.kind}] ${entry.text}`).join('\n'), `${matches.length} 条记忆`)
        : ok('No memories match that.');
    }

    case 'search_knowledge': {
      const query = String(rawArgs.query ?? '').trim();
      const limit = typeof rawArgs.limit === 'number' ? Math.min(Math.max(1, rawArgs.limit), 10) : 5;
      if (!query) return fail('A query is required.');
      const items = useWorkspace.getState().knowledge;
      const result = await hybridRankKnowledge(items, query, limit);
      const scored = result.rows;

      if (!scored.length) {
        return items.length
          ? ok(`Nothing matches "${query}". The knowledge base has ${items.length} entries.`)
          : ok('The knowledge base is empty.');
      }
      const knowledgeSources = scored.slice(0, 5).map(({ item, chunk }) => ({
        kind: 'knowledge' as const,
        title: item.title,
        ref: chunk ? `${item.id}#${chunk.chunkId}` : item.id,
      }));
      return {
        ...ok(
          scored
            .map(({ item, chunk }) => {
              const ref = chunk ? `${item.id}#${chunk.chunkId}` : item.id;
              const body = (chunk?.text ?? item.content).replace(/\s+/g, ' ').slice(0, 260);
              return `- ${ref} · ${item.title} (${item.kind})${item.tags.length ? ` · ${item.tags.join(', ')}` : ''}\n  ${body}`;
            })
            .join('\n') +
            `\n\nSearch mode: ${result.mode === 'hybrid' ? 'lexical + embedding rerank' : 'lexical (no embedding model configured)'}.` +
            '\nUse read_knowledge with the full "id#chunk" reference to read that section.',
          `${scored.length} 条知识命中${result.mode === 'hybrid' ? '（语义）' : ''}`,
        ),
        sources: knowledgeSources,
      };
    }

    case 'read_knowledge': {
      const rawId = String(rawArgs.id ?? '');
      if (!rawId) return fail('An entry id is required.');
      const [id, chunkId] = rawId.split('#');
      const response = await fetch(`/api/agent/knowledge?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        item?: { title: string; content: string; url?: string; chars: number };
      };
      if (!response.ok || !json.ok || !json.item) return fail(`Knowledge entry ${id} was not found.`);
      const item = json.item;
      if (chunkId !== undefined) {
        const chunk = chunkText(item.content).find((entry) => entry.chunkId === chunkId);
        if (!chunk) return fail(`Chunk ${chunkId} was not found in ${id}.`);
        return {
          ...ok(
            `${item.title}${item.url ? ` · ${item.url}` : ''} · section ${chunk.chunkId} (offset ${chunk.start})\n\n${chunk.text.slice(0, 8_000)}`,
            `${item.title} §${chunk.chunkId}`,
          ),
          sources: [{ kind: 'knowledge' as const, title: item.title, ref: rawId }],
        };
      }
      return {
        ...ok(
          `${item.title}${item.url ? ` · ${item.url}` : ''}\n\n${item.content.slice(0, 8_000)}`,
          `${item.title}（${item.chars} 字）`,
        ),
        sources: [{ kind: 'knowledge' as const, title: item.title, ref: id }],
      };
    }

    case 'list_workflows': {
      const workflows = useWorkspace.getState().workflows;
      return workflows.length
        ? ok(
            workflows
              .map(
                (workflow) =>
                  `- ${workflow.name} · ${workflow.trigger.kind}${workflow.enabled ? '' : ' (paused)'} · ${
                    workflow.lastRunAt ? new Date(workflow.lastRunAt).toISOString().slice(0, 16).replace('T', ' ') : 'never run'
                  }\n  ${workflow.description || workflow.prompt.slice(0, 140)}`,
              )
              .join('\n'),
            `${workflows.length} 个工作流`,
          )
        : ok('No workflows saved yet.');
    }

    case 'list_connectors': {
      const response = await fetch('/api/agent/connectors', { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        connectors?: { id: string; name: string; baseUrl: string; hasToken: boolean }[];
        error?: string;
      };
      if (!response.ok || !json.ok) return fail(json.error ?? 'Could not read connectors.');
      if (!json.connectors?.length) return ok('No connectors are configured. Add one in Settings → Connectors.');
      return ok(
        json.connectors
          .map((connector) => `- ${connector.id} · ${connector.name} · ${connector.baseUrl}${connector.hasToken ? ' · authorized' : ''}`)
          .join('\n'),
        `${json.connectors.length} 个连接器`,
      );
    }

    case 'call_connector': {
      const response = await fetch('/api/agent/connectors', { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        connectors?: { id: string; name: string }[];
      };
      const target = String(rawArgs.connector ?? '').trim().toLowerCase();
      const connector = json.connectors?.find(
        (item) => item.id.toLowerCase() === target || item.name.toLowerCase() === target,
      );
      if (!connector) return fail(`Unknown connector ${String(rawArgs.connector)}. Call list_connectors first.`);
      const method = String(rawArgs.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return fail(`Unsupported method ${method}.`);
      const path = String(rawArgs.path ?? '/');
      const call = await fetch('/api/agent/connectors/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: connector.id, method, path, body: rawArgs.body }),
      });
      const result = (await call.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: number;
        body?: string;
        truncated?: boolean;
        error?: { code: string; message: string } | string;
      };
      if (!call.ok || !result.ok) {
        const message = typeof result.error === 'string' ? result.error : result.error?.message;
        return fail(message ?? `The connector request failed (${call.status}).`);
      }
      const text = String(result.body ?? '').slice(0, 8_000);
      return ok(
        `${connector.name} · ${method} ${path} → ${result.status}${result.truncated ? ' (truncated)' : ''}\n${text}`,
        `${connector.name} ${method} ${path} → ${result.status}`,
      );
    }

    case 'web_search': {
      const query = String(rawArgs.query ?? '').trim();
      if (!query) return fail('A query is required.');
      const limit = typeof rawArgs.limit === 'number' ? Math.min(Math.max(1, rawArgs.limit), 10) : 6;
      const response = await fetch('/api/agent/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        results?: { title: string; url: string; snippet: string }[];
        provider?: string;
        error?: string;
      };
      if (!response.ok || !json.ok) return fail(json.error ?? `The search failed (${response.status}).`);
      const hits = json.results ?? [];
      if (!hits.length) return ok(`Nothing found for "${query}".`);
      const card = buildSearchCard({ query, provider: json.provider, results: hits });
      return {
        ...ok(
          [
            ...hits.map(
              (hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}${hit.snippet ? `\n   ${hit.snippet.slice(0, 240)}` : ''}`,
            ),
            '',
            `Read one with fetch_url before quoting it. Source: ${json.provider ?? 'web search'}.`,
          ].join('\n'),
          `${hits.length} 条网页结果`,
          card ?? undefined,
        ),
        // the hits themselves are what an answer may cite; the card is the
        // expandable receipt, this is the short list under the answer
        sources: hits
          .filter((hit) => Boolean(hit.url))
          .slice(0, 5)
          .map((hit) => ({ kind: 'web' as const, title: hit.title || hit.url, url: hit.url })),
      };
    }

    case 'fetch_url': {
      const url = String(rawArgs.url ?? '').trim();
      if (!url) return fail('A URL is required.');
      const maxChars = typeof rawArgs.maxChars === 'number' ? Math.min(Math.max(500, rawArgs.maxChars), 20_000) : 6_000;
      const response = await fetch('/api/agent/fetch-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        page?: {
          url: string;
          title: string;
          text: string;
          chars: number;
          truncated: boolean;
          links?: { text: string; href: string }[];
        };
        error?: string;
      };
      if (!response.ok || !json.ok || !json.page) {
        return fail(json.error ?? `That page could not be read (${response.status}).`);
      }
      const page = json.page;
      const links = (page.links ?? [])
        .slice(0, 12)
        .map((link) => `- ${link.text} → ${link.href}`)
        .join('\n');
      return {
        ...ok(
          [
            page.title,
            page.url,
            '',
            page.text.slice(0, maxChars) + (page.text.length > maxChars ? '\n… (clipped)' : ''),
            links ? `\nlinks:\n${links}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          `${page.title}（${page.chars} 字）`,
        ),
        sources: [{ kind: 'web' as const, title: page.title || page.url, url: page.url }],
      };
    }

    case 'inspect_artifact': {
      const issue = rawArgs.issue ? findIssue(rawArgs.issue) : undefined;
      let name = String(rawArgs.attachment ?? '').trim();
      const payload: { base64?: string; text?: string } = {};
      if (typeof rawArgs.base64 === 'string' && rawArgs.base64.trim()) {
        payload.base64 = rawArgs.base64.trim();
      } else if (typeof rawArgs.text === 'string' && rawArgs.text.length) {
        payload.text = rawArgs.text;
      } else if (issue) {
        const files = issue.attachments ?? [];
        const file = name
          ? files.find((item) => item.name.toLowerCase() === name.toLowerCase()) ??
            files.find((item) => item.name.toLowerCase().includes(name.toLowerCase()))
          : files[0];
        if (!file) return fail(`${issue.key} has no attachment ${name ? `named ${name}` : 'to inspect'}.`);
        name = file.name;
        if (file.dataUrl) payload.base64 = file.dataUrl;
        else if (file.text) payload.text = file.text;
        else return fail(`${file.name} carries no bytes in the workspace snapshot.`);
      }
      if (!payload.base64 && typeof payload.text !== 'string') {
        return fail('Pass an issue attachment name, base64, or text to inspect.');
      }

      const response = await fetch('/api/agent/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'pasted-artifact', ...payload }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        hashes?: { sha256: string; sha1: string; md5: string };
        report?: {
          name: string;
          size: number;
          format: { label: string; id: string; detail?: string };
          entropy: number;
          packed: boolean;
          pe?: {
            machine: string;
            timestamp: string;
            subsystem: string;
            sections: { name: string; rawSize: number; entropy: number }[];
          };
          elf?: { bits: number; endian: string; machine: string; entry: string };
          macho?: { bits: number; cpu: string; filetype: string };
          zip?: { name: string; size: number }[];
          strings?: string[];
          wide?: string[];
          indicators?: { kind: string; value: string }[];
          embedded?: { kind: string; bytes: number; format: string }[];
          hex?: string[];
          notes?: string[];
        };
        error?: string;
      };
      if (!response.ok || !json.ok || !json.report) return fail(json.error ?? `Analysis failed (${response.status}).`);
      const report = json.report;
      // Same mapping the issue attachment panel uses, so the receipt and the
      // menu can never describe one artifact two different ways.
      const structure = structureLines(report);
      const indicators = (report.indicators ?? []).map((item) => `- ${item.kind}: ${item.value}`).join('\n');
      const embedded = (report.embedded ?? []).map((item) => `- ${item.kind} blob → ${item.format} (${item.bytes}B)`).join('\n');
      const strings = (report.strings ?? []).slice(0, 20).join('\n');

      const card = inspectCardFromResponse(json) ?? undefined;

      return ok(
        [
          `${report.name} · ${report.size} bytes · ${report.format.label}${report.format.detail ? ` · ${report.format.detail}` : ''}`,
          json.hashes ? `sha256 ${json.hashes.sha256}\nmd5    ${json.hashes.md5}` : '',
          `entropy ${report.entropy}${report.packed ? ' (high — packed, encrypted or compressed)' : ''}`,
          structure.join('\n'),
          (report.notes ?? []).map((note) => `! ${note}`).join('\n'),
          embedded ? `embedded payloads:\n${embedded}` : '',
          indicators ? `indicators:\n${indicators}` : '',
          strings ? `strings (first 20):\n${strings}` : '',
          (report.hex ?? []).length ? `hex:\n${(report.hex ?? []).join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        `${report.format.label} · entropy ${report.entropy}`,
        card,
      );
    }

    default:
      return fail(`Unknown tool ${name}.`);
  }
}

export const toolSchemas = TOOLS.map((tool) => ({
  type: 'function' as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));

export const READ_ONLY_TOOLS = new Set([
  'list_issues',
  'get_issue',
  'list_cycles',
  'list_projects',
  'recall',
  'search_knowledge',
  'read_knowledge',
  'list_workflows',
  'list_connectors',
  'web_search',
  'fetch_url',
  'inspect_artifact',
]);

/** GET/HEAD through a connector is a read; everything else needs approval. */
export function isReadOnlyToolCall(name: string, args: Record<string, unknown>): boolean {
  if (READ_ONLY_TOOLS.has(name)) return true;
  if (name !== 'call_connector') return false;
  const method = String(args.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

export interface ToolPreviewRow {
  field: 'status' | 'priority' | 'assignee' | 'cycle' | 'project' | 'estimate' | 'label' | 'parent' | 'title' | 'relation';
  from?: string;
  to?: string;
}

export interface ToolPreview {
  /** issue key (or the new title for create_issue) */
  title: string;
  rows: ToolPreviewRow[];
  note?: string;
}

/** Human-readable preview of a write tool, computed without touching the store. */
export function previewTool(name: string, args: Record<string, unknown>): ToolPreview {
  const issue = findIssue(args.key ?? args.parent);
  const key = issue?.key ?? String(args.key ?? args.parent ?? '');
  switch (name) {
    case 'update_issue': {
      const rows: ToolPreviewRow[] = [];
      if (typeof args.status === 'string') rows.push({ field: 'status', from: issue?.status, to: args.status });
      if (typeof args.priority === 'string') rows.push({ field: 'priority', from: issue?.priority, to: args.priority });
      if (args.assignee !== undefined) {
        const user = findUser(args.assignee);
        rows.push({
          field: 'assignee',
          from: issue?.assigneeId ?? 'none',
          to: String(args.assignee).toLowerCase() === 'none' ? 'none' : user?.id ?? String(args.assignee),
        });
      }
      if (args.cycle !== undefined) rows.push({ field: 'cycle', from: issue?.cycleId ?? 'none', to: String(args.cycle) });
      if (typeof args.estimate === 'number') rows.push({ field: 'estimate', from: String(issue?.estimate ?? 'none'), to: String(args.estimate) });
      return { title: key, rows };
    }
    case 'create_issue':
      return {
        title: typeof args.title === 'string' ? args.title : '(untitled)',
        rows: [
          ...(typeof args.status === 'string' ? [{ field: 'status' as const, to: args.status }] : []),
          ...(typeof args.priority === 'string' ? [{ field: 'priority' as const, to: args.priority }] : []),
          ...(typeof args.parent === 'string' ? [{ field: 'parent' as const, to: String(args.parent) }] : []),
        ],
        note: typeof args.description === 'string' ? args.description : undefined,
      };
    case 'add_comment':
      return { title: key, rows: [], note: typeof args.body === 'string' ? args.body : '' };
    case 'add_label':
      return { title: key, rows: [{ field: 'label', to: String(args.label ?? '') }] };
    case 'relate_issues':
      return {
        title: key,
        rows: [{ field: 'relation', from: String(args.type ?? ''), to: String(args.target ?? '') }],
      };
    case 'create_project':
      return {
        title: String(args.name ?? ''),
        rows: [],
        note: typeof args.summary === 'string' ? args.summary : undefined,
      };
    case 'create_cycle':
      return { title: String(args.name ?? 'Cycle'), rows: [] };
    case 'set_project': {
      const target = String(args.project ?? '');
      const state = useData.getState();
      const project = state.projects.find(
        (item) => item.id === target || item.name.toLowerCase() === target.toLowerCase(),
      );
      return {
        title: key,
        rows: [
          {
            field: 'project',
            from: issue?.projectId ? state.projects.find((item) => item.id === issue.projectId)?.name ?? issue.projectId : 'none',
            to: target.toLowerCase() === 'none' ? 'none' : project?.name ?? target,
          },
        ],
      };
    }
    case 'set_cycle': {
      const target = String(args.cycle ?? '');
      const state = useData.getState();
      const cycle = state.cycles.find(
        (item) => item.id === target || String(item.number) === target || item.name.toLowerCase() === target.toLowerCase(),
      );
      return {
        title: key,
        rows: [
          {
            field: 'cycle',
            from: issue?.cycleId ? state.cycles.find((item) => item.id === issue.cycleId)?.name ?? issue.cycleId : 'none',
            to: target.toLowerCase() === 'none' ? 'none' : cycle?.name ?? target,
          },
        ],
      };
    }
    case 'bulk_update': {
      const keys = Array.isArray(args.keys) ? args.keys.map(String) : [];
      const rows: ToolPreviewRow[] = [];
      if (typeof args.status === 'string') rows.push({ field: 'status', to: args.status });
      if (typeof args.priority === 'string') rows.push({ field: 'priority', to: args.priority });
      if (args.assignee !== undefined) rows.push({ field: 'assignee', to: String(args.assignee) });
      return { title: keys.join(', '), rows };
    }
    case 'remember':
      return {
        title: typeof args.text === 'string' ? args.text.slice(0, 160) : 'Remember',
        rows: [],
        note: typeof args.kind === 'string' ? `memory · ${args.scope ?? 'global'}/${args.kind}` : 'memory',
      };
    case 'call_connector':
      return {
        title: `${String(args.method ?? 'GET').toUpperCase()} ${String(args.path ?? '/')}`,
        rows: [{ field: 'relation', from: 'connector', to: String(args.connector ?? '') }],
        note: typeof args.body === 'object' && args.body ? JSON.stringify(args.body).slice(0, 400) : undefined,
      };
    case 'list_connectors':
      return { title: 'Connectors', rows: [] };
    default:
      return { title: key || name, rows: [] };
  }
}

/** Compact workspace context the model gets up front, to save tool round-trips. */
/**
 * Context for a conversation about the whole workspace (the ⌘J chat).
 * Deliberately compact: counts, the live cycles/projects, and the issues that
 * moved most recently — enough to answer "what is left in this cycle" without
 * shipping the entire workspace on every turn.
 */
export function workspaceSummary() {
  const data = useData.getState();
  const open = data.issues.filter((issue) => issue.status !== 'done' && issue.status !== 'canceled' && issue.status !== 'duplicate');
  const recent = [...data.issues]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 12);
  const byStatus = data.issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.status] = (acc[issue.status] ?? 0) + 1;
    return acc;
  }, {});

  return [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Issues: ${data.issues.length} total, ${open.length} open (${Object.entries(byStatus)
      .map(([status, count]) => `${status}:${count}`)
      .join(' ')})`,
    `Projects: ${data.projects.length ? data.projects.map((p) => `${p.name}(${p.status})`).join(', ') : '(none)'}`,
    `Cycles: ${data.cycles.length ? data.cycles.map((c) => `${c.id}=${c.name}`).join(', ') : '(none)'}`,
    `Labels: ${data.labels.length ? data.labels.map((label) => label.name).join(', ') : '(none)'}`,
    `People: ${peopleNow().users.map((user) => `${user.name}(${user.handle})`).join(', ')}`,
    recent.length ? `Recent issues: ${recent.map((issue) => issueLine(issue)).join(' | ')}` : 'Recent issues: (none)',
  ].join('\n');
}

export function workspaceContext(focus: Issue) {
  const data = useData.getState();
  const children = data.issues.filter((issue) => issue.parentId === focus.id);
  const related = data.issues
    .filter((issue) => issue.id !== focus.id && (issue.projectId === focus.projectId || issue.labelIds.some((id) => focus.labelIds.includes(id))))
    .slice(0, 6);
  return [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Current issue: ${issueLine(focus)}`,
    `Description: ${focus.description.replace(/\s+/g, ' ').slice(0, 600) || '(empty)'}`,
    children.length ? `Sub-issues: ${children.map((issue) => issueLine(issue)).join(' | ')}` : '',
    related.length ? `Related: ${related.map((issue) => issueLine(issue)).join(' | ')}` : '',
    `Cycles: ${data.cycles.length ? data.cycles.map((cycle) => `${cycle.id}=${cycle.name}`).join(', ') : '(none)'}`,
    `Labels: ${data.labels.length ? data.labels.map((label) => label.name).join(', ') : '(none)'}`,
    `People: ${peopleNow().users.map((user) => `${user.name}(${user.handle})`).join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

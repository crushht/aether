import type { IssueTemplate } from '@/lib/store/issue-templates';
import type { ProjectTemplate } from '@/lib/store/project-templates';
import { PRIORITIES, STATUSES } from '@/lib/types';

export interface TemplateBundle {
  version: 1;
  exportedAt: string;
  issueTemplates: IssueTemplate[];
  projectTemplates: ProjectTemplate[];
}

const MAX_EACH = 100;
const statusKeys = new Set(STATUSES.map((status) => status.key));
const priorityKeys = new Set(PRIORITIES.map((priority) => priority.key));

export function buildTemplateBundle(issueTemplates: IssueTemplate[], projectTemplates: ProjectTemplate[]): string {
  const bundle: TemplateBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    issueTemplates,
    projectTemplates,
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export type ParseResult =
  | { ok: true; issueTemplates: IssueTemplate[]; projectTemplates: ProjectTemplate[] }
  | { ok: false; error: string };

const text = (value: unknown, max = 400) => (typeof value === 'string' ? value.slice(0, max) : '');

export function parseTemplateBundle(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'invalid-shape' };
  const record = data as Record<string, unknown>;

  const issueSource = Array.isArray(record.issueTemplates) ? record.issueTemplates : [];
  const projectSource = Array.isArray(record.projectTemplates) ? record.projectTemplates : [];
  if (!issueSource.length && !projectSource.length) return { ok: false, error: 'empty' };

  const issueTemplates: IssueTemplate[] = [];
  for (const raw of issueSource.slice(0, MAX_EACH)) {
    const item = raw as Record<string, unknown>;
    const name = text(item.name, 120).trim();
    const title = text(item.title, 240).trim();
    if (!name || !title) continue;
    issueTemplates.push({
      id: text(item.id, 80) || `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      title,
      description: text(item.description, 8_000),
      status: statusKeys.has(item.status as never) ? (item.status as IssueTemplate['status']) : 'todo',
      priority: priorityKeys.has(item.priority as never) ? (item.priority as IssueTemplate['priority']) : 'none',
      labelIds: Array.isArray(item.labelIds) ? item.labelIds.map((id) => text(id, 80)).filter(Boolean).slice(0, 20) : [],
      projectId: typeof item.projectId === 'string' && item.projectId ? item.projectId.slice(0, 80) : null,
      estimate: typeof item.estimate === 'number' && Number.isFinite(item.estimate) ? item.estimate : null,
      createdAt: Date.now(),
    });
  }

  const projectTemplates: ProjectTemplate[] = [];
  for (const raw of projectSource.slice(0, MAX_EACH)) {
    const item = raw as Record<string, unknown>;
    const name = text(item.name, 120).trim();
    if (!name) continue;
    const health = item.health;
    projectTemplates.push({
      id: text(item.id, 80) || `prjtpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      summary: text(item.summary, 2_000),
      agentInstructions: text(item.agentInstructions, 20_000),
      knowledgeIds: Array.isArray(item.knowledgeIds)
        ? item.knowledgeIds.map((id) => text(id, 80)).filter(Boolean).slice(0, 100)
        : [],
      health: health === 'at_risk' || health === 'off_track' ? health : 'on_track',
      createdAt: Date.now(),
    });
  }

  if (!issueTemplates.length && !projectTemplates.length) return { ok: false, error: 'empty' };
  return { ok: true, issueTemplates, projectTemplates };
}

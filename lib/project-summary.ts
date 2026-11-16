import type { Issue, Project } from '@/lib/types';

export interface ProjectSummaryOptions {
  authorName?: (id: string) => string;
  now?: Date;
}

const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'] as const;

/** A one-file project brief: state, progress, issues, updates and audit counts. */
export function projectSummaryMarkdown(
  project: Project,
  issues: Issue[],
  options: ProjectSummaryOptions = {},
): string {
  const name = options.authorName ?? ((id: string) => id);
  const now = options.now ?? new Date();
  const projectIssues = issues.filter((issue) => issue.projectId === project.id);
  const closed = projectIssues.filter((issue) => ['done', 'canceled', 'duplicate'].includes(issue.status)).length;
  const done = projectIssues.filter((issue) => issue.status === 'done').length;
  const open = projectIssues.length - closed;
  const progress = projectIssues.length ? Math.round((done / projectIssues.length) * 100) : 0;
  const updates = (project.updates ?? []).slice(0, 10);
  const audit = project.updateAudit ?? [];
  const auditCounts = audit.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.action] = (counts[entry.action] ?? 0) + 1;
    return counts;
  }, {});

  const lines: string[] = [
    `# ${project.name} · project summary`,
    '',
    `- Project: ${project.id}`,
    `- Exported: ${now.toISOString()}`,
    `- Status: ${project.status}`,
    `- Health: ${project.health}`,
    `- Progress: ${progress}% · ${done} done · ${open} open · ${projectIssues.length} total`,
    `- Target: ${project.targetDate ? project.targetDate.slice(0, 10) : '—'}`,
    `- Lead: ${name(project.leadId)} · members: ${project.memberIds.length}`,
    project.summary ? `- Summary: ${project.summary}` : '',
    '',
    '## Project instructions',
    '',
    project.agentInstructions ? project.agentInstructions : '_None._',
    '',
    `## Issues (${projectIssues.length})`,
    '',
  ].filter((line) => line !== '');
  if (!projectIssues.length) {
    lines.push('_No issues in this project yet._');
  } else {
    for (const status of STATUS_ORDER) {
      const group = projectIssues.filter((issue) => issue.status === status);
      if (!group.length) continue;
      lines.push(`### ${status} (${group.length})`, '');
      for (const issue of group.slice(0, 100)) {
        lines.push(`- ${issue.key} · ${issue.title} · ${issue.priority}`);
      }
      lines.push('');
    }
  }

  lines.push(`## Recent updates (${updates.length})`, '');
  if (!updates.length) {
    lines.push('_No updates yet._');
  } else {
    for (const update of updates) {
      const likes = (update.likedBy ?? []).length;
      const acks = (update.acknowledgedBy ?? []).length;
      lines.push(
        `### ${new Date(update.createdAt).toISOString().slice(0, 10)} · ${name(update.authorId)}${
          update.health ? ` · ${update.health}` : ''
        }`,
        '',
        update.body,
        '',
        `Reactions: ${likes} like(s) · ${acks} acknowledgement(s)`,
        ...(update.attachments?.length
          ? [`Attachments: ${update.attachments.map((file) => file.name).join(', ')}`]
          : []),
        '',
      );
    }
  }

  lines.push(`## Audit (${audit.length} records)`, '');
  if (!audit.length) {
    lines.push('_No audit records yet._');
  } else {
    lines.push(
      Object.entries(auditCounts)
        .map(([action, count]) => `- ${action}: ${count}`)
        .join('\n'),
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function projectSummaryFileName(project: Pick<Project, 'name'>, extension = 'md'): string {
  const safe =
    `${project.name}-summary-${new Date().toISOString().slice(0, 10)}`
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'project-summary';
  return `${safe}.${extension}`;
}

/** The same brief as structured JSON, for scripts and spreadsheets. */
export function projectSummaryJson(
  project: Project,
  issues: Issue[],
  options: ProjectSummaryOptions = {},
): string {
  const name = options.authorName ?? ((id: string) => id);
  const now = options.now ?? new Date();
  const projectIssues = issues.filter((issue) => issue.projectId === project.id);
  const done = projectIssues.filter((issue) => issue.status === 'done').length;
  const closed = projectIssues.filter((issue) => ['done', 'canceled', 'duplicate'].includes(issue.status)).length;
  const auditCounts = (project.updateAudit ?? []).reduce<Record<string, number>>((counts, entry) => {
    counts[entry.action] = (counts[entry.action] ?? 0) + 1;
    return counts;
  }, {});
  return `${JSON.stringify(
    {
      kind: 'project-summary',
      version: 1,
      project: {
        id: project.id,
        name: project.name,
        summary: project.summary,
        status: project.status,
        health: project.health,
        targetDate: project.targetDate,
        leadId: project.leadId,
        leadName: name(project.leadId),
        members: project.memberIds.length,
        instructions: project.agentInstructions ?? '',
      },
      progress: {
        percent: projectIssues.length ? Math.round((done / projectIssues.length) * 100) : 0,
        done,
        open: projectIssues.length - closed,
        total: projectIssues.length,
      },
      issues: projectIssues.map((issue) => ({
        key: issue.key,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
      })),
      updates: (project.updates ?? []).slice(0, 10).map((update) => ({
        at: update.createdAt,
        authorId: update.authorId,
        authorName: name(update.authorId),
        health: update.health ?? null,
        body: update.body,
        likes: (update.likedBy ?? []).length,
        acknowledgements: (update.acknowledgedBy ?? []).length,
        attachments: (update.attachments ?? []).map((file) => file.name),
      })),
      audit: auditCounts,
      exportedAt: now.toISOString(),
    },
    null,
    2,
  )}\n`;
}

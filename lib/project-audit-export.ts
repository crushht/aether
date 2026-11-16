import type { Project, ProjectUpdateAudit } from '@/lib/types';

export interface AuditExportOptions {
  authorName?: (id: string) => string;
  /** what the list was filtered to, recorded in the header */
  filterLabel?: string;
}

/** Markdown export of a project's update audit, newest first as stored. */
export function auditToMarkdown(
  project: Pick<Project, 'id' | 'name'>,
  entries: ProjectUpdateAudit[],
  options: AuditExportOptions = {},
): string {
  const name = options.authorName ?? ((id: string) => id);
  const lines: string[] = [
    `# ${project.name} · update audit`,
    '',
    `- Project: ${project.id}`,
    `- Exported: ${new Date().toISOString()}`,
    `- Records: ${entries.length}`,
    options.filterLabel ? `- Filter: ${options.filterLabel}` : '',
    '',
    '## Records',
    '',
  ].filter((line) => line !== '');
  if (!entries.length) {
    lines.push('_No audit records matched._');
  } else {
    for (const entry of entries) {
      lines.push(
        `- ${new Date(entry.at).toISOString()} · **${entry.action}** · ${name(entry.actorId)}${
          entry.summary ? ` · ${entry.summary}` : ''
        }`,
      );
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function auditFileName(project: Pick<Project, 'name'>, extension = 'md'): string {
  const safe =
    `${project.name}-${new Date().toISOString().slice(0, 10)}`
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'project-audit';
  return `${safe}.${extension}`;
}

/** Structured export for spreadsheets, scripts or archiving. */
export function auditToJson(
  project: Pick<Project, 'id' | 'name'>,
  entries: ProjectUpdateAudit[],
  options: AuditExportOptions = {},
): string {
  const name = options.authorName ?? ((id: string) => id);
  return `${JSON.stringify(
    {
      kind: 'project-audit',
      version: 1,
      project: { id: project.id, name: project.name },
      exportedAt: new Date().toISOString(),
      filter: options.filterLabel ?? null,
      records: entries.map((entry) => ({
        id: entry.id,
        updateId: entry.updateId,
        action: entry.action,
        at: entry.at,
        actorId: entry.actorId,
        actorName: name(entry.actorId),
        summary: entry.summary ?? null,
      })),
    },
    null,
    2,
  )}\n`;
}

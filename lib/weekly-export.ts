import type { Project, ProjectUpdate } from '@/lib/types';
import type { ReactionWeek } from '@/lib/project-reactions-summary';

export interface WeekExportOptions {
  authorName?: (id: string) => string;
}

const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Markdown for one week of project updates: body, health and reactions. */
export function weekToMarkdown(
  project: Pick<Project, 'id' | 'name'>,
  weekStart: string,
  updates: ProjectUpdate[],
  options: WeekExportOptions = {},
): string {
  const name = options.authorName ?? ((id: string) => id);
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const range = `${weekStart} → ${localDate(end)}`;

  const lines: string[] = [
    `# ${project.name} · weekly update report`,
    '',
    `- Project: ${project.id}`,
    `- Week: ${range}`,
    `- Updates: ${updates.length}`,
    `- Exported: ${new Date().toISOString()}`,
    '',
    '## Updates',
    '',
  ];
  if (!updates.length) {
    lines.push('_No updates in this week._');
  } else {
    for (const update of updates) {
      const likes = (update.likedBy ?? []).length;
      const acks = (update.acknowledgedBy ?? []).length;
      lines.push(
        `### ${localDate(new Date(update.createdAt))} · ${name(update.authorId)}${
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
  return `${lines.join('\n').trimEnd()}\n`;
}

export function weekFileName(project: Pick<Project, 'name'>, weekStart: string, extension = 'md'): string {
  const safe =
    `${project.name}-${weekStart}`.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) ||
    'weekly-report';
  return `${safe}.${extension}`;
}

/** One document covering several weeks, for a report or a status post. */
export function weeksToMarkdown(
  project: Pick<Project, 'id' | 'name'>,
  weeks: ReactionWeek[],
  updates: ProjectUpdate[],
  options: WeekExportOptions = {},
): string {
  const name = options.authorName ?? ((id: string) => id);
  const lines: string[] = [
    `# ${project.name} · recent weekly reports`,
    '',
    `- Project: ${project.id}`,
    `- Exported: ${new Date().toISOString()}`,
    `- Weeks: ${weeks.length}`,
    '',
  ];
  if (!weeks.length) {
    lines.push('_No weekly reports yet._');
  }
  for (const week of weeks) {
    const start = new Date(`${week.weekStart}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const weekUpdates = updates.filter((update) => {
      const created = new Date(update.createdAt);
      if (Number.isNaN(created.getTime())) return false;
      const monday = new Date(created);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      return localDate(monday) === week.weekStart;
    });
    lines.push(`## ${week.weekStart} → ${localDate(end)}`, '', `- Updates: ${week.updates}`, '');
    if (!weekUpdates.length) {
      lines.push('_No updates in this week._', '');
      continue;
    }
    for (const update of weekUpdates) {
      const likes = (update.likedBy ?? []).length;
      const acks = (update.acknowledgedBy ?? []).length;
      lines.push(
        `### ${localDate(new Date(update.createdAt))} · ${name(update.authorId)}${
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
  return `${lines.join('\n').trimEnd()}\n`;
}

export function weeksFileName(project: Pick<Project, 'name'>, extension = 'md'): string {
  const safe =
    `${project.name}-weekly-reports-${localDate(new Date())}`
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'weekly-reports';
  return `${safe}.${extension}`;
}

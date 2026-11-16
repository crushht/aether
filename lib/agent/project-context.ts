import type { Issue, Project } from '@/lib/types';

const HEALTH_LABEL: Record<string, string> = {
  on_track: 'on track',
  at_risk: 'at risk',
  off_track: 'off track',
};

/**
 * The project block injected into an agent conversation. Pure so the exact
 * wording is testable; the store only adds who is speaking.
 */
export function projectContextText(
  project: Project,
  issues: Issue[],
  options: { maxIssues?: number; maxUpdates?: number } = {},
): string {
  const maxIssues = options.maxIssues ?? 100;
  const maxUpdates = options.maxUpdates ?? 3;
  const projectIssues = issues.filter((issue) => issue.projectId === project.id);
  const updates = (project.updates ?? []).slice(0, maxUpdates);

  const parts: string[] = [
    `Project: ${project.name}`,
    project.summary ? `Summary: ${project.summary}` : '',
    project.agentInstructions ? `Project instructions:\n${project.agentInstructions}` : '',
    `Health: ${HEALTH_LABEL[project.health] ?? project.health} · status: ${project.status}`,
  ].filter(Boolean);

  if (updates.length) {
    parts.push(
      `Recent updates:\n${updates
        .map(
          (update) =>
            `- [${HEALTH_LABEL[update.health ?? project.health] ?? 'unknown'}] ${update.body.replace(/\s+/g, ' ').slice(0, 400)}`,
        )
        .join('\n')}`,
    );
  }

  if (projectIssues.length) {
    parts.push(
      `Issues in this project:\n${projectIssues
        .slice(0, maxIssues)
        .map((issue) => `- ${issue.key} [${issue.status}/${issue.priority}] ${issue.title}`)
        .join('\n')}`,
    );
  } else {
    parts.push('No issues in this project yet.');
  }

  return parts.join('\n');
}

import type { AgentWorkflow, WorkflowRun } from './types';

/** Human-readable export of one run: what it did, in order. */
export function runToMarkdown(workflow: AgentWorkflow, run: WorkflowRun): string {
  const lines: string[] = [
    `# ${workflow.name} · run ${run.id}`,
    '',
    `- Started: ${new Date(run.at).toISOString()}`,
    `- Status: ${run.status}`,
    `- Model: ${run.model ?? '—'}`,
    `- Steps: ${run.steps} · Tools: ${run.tools}${run.ms ? ` · ${(run.ms / 1000).toFixed(1)}s` : ''}`,
    run.issueKey ? `- Report issue: ${run.issueKey}` : '',
    '',
    '## Summary',
    '',
    run.summary || '(empty)',
    '',
    '## Trace',
    '',
  ].filter((line) => line !== undefined);
  if (!run.events?.length) {
    lines.push('_No step details were recorded for this run._');
  } else {
    for (const event of run.events) {
      const time = new Date(event.at).toISOString().slice(11, 19);
      lines.push(`- ${time} **${event.kind}**${event.ok === false ? ' (failed)' : ''}: ${event.text}`);
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Download text from the browser; no-ops in a server render. */
export function downloadText(name: string, content: string, type = 'text/plain;charset=utf-8') {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function runFileName(workflow: AgentWorkflow, run: WorkflowRun, extension: 'md' | 'json') {
  const safe =
    `${workflow.name}-${run.id}`
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'run';
  return `${safe}.${extension}`;
}

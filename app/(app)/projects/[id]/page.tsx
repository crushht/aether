'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download, FilePlus2, Plus } from 'lucide-react';
import { downloadText } from '@/lib/agent/run-export';
import { projectSummaryFileName, projectSummaryJson, projectSummaryMarkdown } from '@/lib/project-summary';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useT } from '@/lib/use-t';
import { userById } from '@/lib/mock-data';
import { STATUSES } from '@/lib/types';
import { cn, plural, shortDate } from '@/lib/utils';
import { Avatar, Button } from '@/components/ui/primitives';
import { StatusIcon } from '@/components/ui/icons';
import { IssueRow } from '@/components/views/issue-row';
import { ProjectSpace } from '@/components/agent/project-space';
import { ProjectUpdates } from '@/components/projects/project-updates';
import { projectProgress } from '@/lib/selectors';
import { useProjectTemplates } from '@/lib/store/project-templates';
import { useUI } from '@/lib/store/ui';

function statusColor(status: string) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projects = useData((s) => s.projects);
  const project = projects.find((item) => item.id === params.id);
  const issues = useData((s) => s.issues);
  const labels = useData((s) => s.labels);
  const createIssue = useData((s) => s.createIssue);
  const setProject = useData((s) => s.setProject);
  const openIssue = useView((s) => s.openIssue);
  const select = useView((s) => s.select);
  const display = useView((s) => s.display);
  const selectedIds = useView((s) => s.selectedIds);
  const t = useT();

  if (!project) {
    return (
      <div className="p-8 text-t3">
        {t('Project not found')} {'\u00b7'}{' '}
        <Link href="/projects" className="text-t2 underline">
          {t('back to projects')}
        </Link>
      </div>
    );
  }

  const projectIssues = issues.filter((i) => i.projectId === project.id);
  const ordered = projectIssues.map((i) => i.id);
  const lead = userById.get(project.leadId);
  const progress = projectProgress(issues, project.id);
  const progressPct = Math.round(progress.ratio * 100);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-4 sm:px-6 sm:py-5">
      <Link
        href="/projects"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-t4 transition-colors hover:text-t2"
      >
        <ArrowLeft size={13} strokeWidth={1.8} />
        Projects
      </Link>

      <div className="flex items-start gap-3">
        <span
          className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-r6 text-[15px]"
          style={{
            background: `color-mix(in srgb, ${project.color} 16%, transparent)`,
            color: project.color,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${project.color} 30%, transparent)`,
          }}
        >
          {project.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-title3 font-[590] text-t1">{project.name}</h1>
          <p className="mt-1 max-w-[640px] text-[14.5px] leading-[1.55] text-t3">{project.summary}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            data-project-summary
            onClick={() =>
              downloadText(
                projectSummaryFileName(project),
                projectSummaryMarkdown(project, issues, {
                  authorName: (id) => userById.get(id)?.name ?? id,
                }),
                'text/markdown;charset=utf-8',
              )
            }
          >
            <Download size={13} strokeWidth={1.8} />
            {t('Export summary')}
          </Button>
          <button
            type="button"
            data-project-summary-json
            aria-label={t('Export summary as JSON')}
            onClick={() =>
              downloadText(
                projectSummaryFileName(project, 'json'),
                projectSummaryJson(project, issues, {
                  authorName: (id) => userById.get(id)?.name ?? id,
                }),
                'application/json',
              )
            }
            className="grid h-[28px] min-w-[30px] place-items-center rounded-r6 px-1 font-mono text-[10px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {'{}'}
          </button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          data-project-save-template
          onClick={() => {
            const template = useProjectTemplates.getState().saveFromProject(project);
            useUI.getState().pushToast({
              title: template ? t('Project saved as a template') : t('Could not save the template'),
              description: template?.name,
              tone: template ? 'success' : 'danger',
            });
          }}
        >
          <FilePlus2 size={13} strokeWidth={1.8} />
          {t('Save as template')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            // put a fresh issue straight into this project and open it to edit
            const created = createIssue({ title: t('Untitled issue') });
            setProject(created.id, project.id);
            openIssue(created.id);
          }}
        >
          <Plus size={13} strokeWidth={2} />
          {t('Add issue')}
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-r8 px-4 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[.05em] text-t4">{t('Progress')}</span>
          <span className="flex items-center gap-2">
            <span className="h-[4px] w-[120px] overflow-hidden rounded-full bg-[var(--bg-selected)]">
              <span className="block h-full rounded-full" style={{ width: `${progressPct}%`, background: project.color }} />
            </span>
            <span className="tnum text-[13px] text-t2">{progressPct}%</span>
          </span>
        </div>
        <div className="flex flex-col gap-1" data-project-health>
          <span className="text-[12px] uppercase tracking-[.05em] text-t4">{t('Health')}</span>
          <span className="flex items-center gap-1.5 text-[13.5px] text-t2">
            <span
              className="h-[6px] w-[6px] rounded-full"
              style={{
                background:
                  project.health === 'on_track'
                    ? 'var(--green)'
                    : project.health === 'at_risk'
                      ? 'var(--orange)'
                      : 'var(--red)',
              }}
            />
            {project.health === 'on_track'
              ? t('On track')
              : project.health === 'at_risk'
                ? t('At risk')
                : t('Off track')}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[.05em] text-t4">{t('Lead')}</span>
          <span className="flex items-center gap-1.5">
            {lead ? <Avatar name={lead.name} color={lead.color} size="xs" /> : null}
            <span className="text-[13.5px] text-t2">{lead?.name}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[.05em] text-t4">{t('Members')}</span>
          <span className="flex items-center gap-1">
            {project.memberIds
              .filter((id) => id !== project.leadId)
              .map((id) => userById.get(id))
              .filter((member): member is NonNullable<typeof member> => Boolean(member))
              .map((member) => (
                <Avatar key={member.id} name={member.name} color={member.color} size="sm" ring />
              ))}
            {project.memberIds.length === 1 ? (
              <span className="text-[13px] text-t4">{t('Just you')}</span>
            ) : null}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[.05em] text-t4">{t('Target')}</span>
          <span className="text-[13.5px] text-t2">{shortDate(project.targetDate)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[.05em] text-t4">{t('Issues')}</span>
          <span className="text-[13.5px] text-t2">{plural(projectIssues.length, 'issue')}</span>
        </div>
      </div>

      <ProjectSpace projectId={project.id} />
      <ProjectUpdates project={project} />

      <div className="mt-6">
        {STATUSES.map((status) => {
          const items = projectIssues.filter((i) => i.status === status.key);
          if (!items.length) return null;
          return (
            <section key={status.key} className="mb-2">
              <div className="flex h-[30px] items-center gap-2 px-1 text-[13px] font-[510] text-t3">
                <StatusIcon status={status.key} size={13} style={{ color: statusColor(status.key) }} />
                {status.label}
                <span className="tnum font-[400] text-t4">{items.length}</span>
              </div>
              {items.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  cursor={false}
                  selected={selectedIds.includes(issue.id)}
                  display={display}
                  labels={labels}
                  assignee={issue.assigneeId ? userById.get(issue.assigneeId) : undefined}
                  onOpen={() => openIssue(issue.id)}
                  onClickRow={(e) => {
                    if (e.metaKey || e.ctrlKey) select(issue.id, 'toggle', ordered);
                    else openIssue(issue.id);
                  }}
                  onToggleSelect={() => select(issue.id, 'toggle', ordered)}
                  showCheckbox={false}
                />
              ))}
            </section>
          );
        })}
        {projectIssues.length === 0 ? (
          <div className={cn('rounded-r8 px-4 py-10 text-center text-[14px] text-t4 shadow-[inset_0_0_0_1px_var(--line-subtle)]')}>
            No issues in this project yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}
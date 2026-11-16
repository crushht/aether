'use client';

import * as React from 'react';
import Link from 'next/link';
import { LayoutTemplate, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';
import { useProjectTemplates } from '@/lib/store/project-templates';
import { resolvePerson } from '@/lib/people';
import { projectProgress } from '@/lib/selectors';
import type { ProjectStatus } from '@/lib/types';
import { cn, shortDate, plural } from '@/lib/utils';
import { Avatar, Button } from '@/components/ui/primitives';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  planned: 'Planned',
  in_progress: 'In Progress',
  paused: 'Paused',
  completed: 'Completed',
};

const HEALTH_COLOR = {
  on_track: 'var(--green)',
  at_risk: 'var(--orange)',
  off_track: 'var(--red)',
} as const;

const TABS: { key: 'all' | ProjectStatus; label: string }[] = [
  { key: 'all', label: 'All projects' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'planned', label: 'Planned' },
  { key: 'backlog', label: 'Backlog' },
];

export default function ProjectsPage() {
  const issues = useData((s) => s.issues);
  const projects = useData((s) => s.projects);
  const createProject = useData((s) => s.createProject);
  const projectTemplates = useProjectTemplates((s) => s.templates);
  const hydrateTemplates = useProjectTemplates((s) => s.hydrate);
  const createFromTemplate = useProjectTemplates((s) => s.createFromTemplate);
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = React.useState<'all' | ProjectStatus>('all');
  const [composing, setComposing] = React.useState(false);
  const [name, setName] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [error, setError] = React.useState(false);
  const [templatesOpen, setTemplatesOpen] = React.useState(false);

  React.useEffect(() => hydrateTemplates(), [hydrateTemplates]);

  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setComposing(true);
  }, []);

  const list = projects.filter((p) => (tab === 'all' ? true : p.status === tab));

  const submit = () => {
    const title = name.trim();
    if (!title) {
      setError(true);
      return;
    }
    const project = createProject({ name: title, summary: summary.trim() });
    setComposing(false);
    setName('');
    setSummary('');
    router.push(`/projects/${project.id}`);
  };

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-4 sm:px-6 sm:py-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[15px] font-[590] text-t1">{t('Projects')}</h1>
          <span className="tnum text-[13px] text-t4">{projects.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {projectTemplates.length ? (
            <div className="relative">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setTemplatesOpen((value) => !value)}>
                <LayoutTemplate size={13} strokeWidth={1.8} />
                {t('From template')}
              </Button>
              {templatesOpen ? (
                <>
                  <div className="fixed inset-0 z-[300]" onMouseDown={() => setTemplatesOpen(false)} />
                  <div className="absolute right-0 top-[32px] z-[310] w-[240px] rounded-r8 bg-[var(--bg-elevated)] p-1 shadow-pop">
                    {projectTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        data-project-template-option={template.id}
                        onClick={() => {
                          const id = createFromTemplate(template.id);
                          setTemplatesOpen(false);
                          if (id) router.push(`/projects/${id}`);
                        }}
                        className="flex h-[30px] w-full items-center gap-2 rounded-r5 px-2 text-left text-[13px] text-t2 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                      >
                        <LayoutTemplate size={12} className="shrink-0 text-t4" />
                        <span className="truncate">{template.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => { setComposing(true); setError(false); }}>
            <Plus size={13} strokeWidth={2} />
            {t('New project')}
          </Button>
        </div>
      </div>

      {composing ? (
        <div className="mb-3 rounded-r8 bg-[var(--bg-hover)] p-3 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') setComposing(false);
              }}
              placeholder={t('Project name')}
              className={cn(
                'h-[30px] min-w-0 flex-1 rounded-r6 bg-[var(--bg-panel)] px-2.5 text-[14px] text-t1 outline-none placeholder:text-t4',
                error && !name.trim() ? 'shadow-[inset_0_0_0_1px_rgba(235,87,87,.7)]' : 'shadow-[inset_0_0_0_1px_var(--line)]',
              )}
            />
            <input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') setComposing(false);
              }}
              placeholder={t('Summary (optional)')}
              className="h-[30px] min-w-0 flex-1 rounded-r6 bg-[var(--bg-panel)] px-2.5 text-[14px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-t4"
            />
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="primary" size="sm" onClick={submit}>
                {t('Create project')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setComposing(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
          {error && !name.trim() ? <p className="mt-1.5 text-[13px] text-[#f08080]">{t('A name is required')}</p> : null}
        </div>
      ) : null}

      <div className="mb-3 flex items-center gap-0.5">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => setTab(tabItem.key)}
            className={cn(
              'h-[26px] rounded-r6 px-2 text-[13.5px] font-[510] transition-colors duration-100',
              tab === tabItem.key ? 'bg-[var(--bg-active)] text-t1' : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
            )}
          >
            {t(tabItem.label)}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {list.length === 0 ? (
          <div className="flex h-[120px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-[14px] text-t2">{t('No projects yet')}</p>
            <p className="max-w-[320px] text-[13px] leading-[1.6] text-t4">
              {t('A project groups issues that ship together. Create the first one to give this workspace structure.')}
            </p>
          </div>
        ) : null}
        {list.map((project, i) => {
          const projectIssues = issues.filter((x) => x.projectId === project.id);
          const pct = Math.round(projectProgress(issues, project.id).ratio * 100);
          const lead = resolvePerson(project.leadId);
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className={cn(
                'group flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-100 hover:bg-[var(--bg-hover)]',
                i > 0 && 'border-t border-[var(--line-subtle)]',
              )}
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-[13px]"
                style={{
                  background: `color-mix(in srgb, ${project.color} 16%, transparent)`,
                  color: project.color,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${project.color} 30%, transparent)`,
                }}
              >
                {project.icon}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14.5px] font-[510] text-t2 group-hover:text-t1">{project.name}</span>
                  <span className="flex items-center gap-1 text-[12.5px] text-t4">
                    <span className="h-[5px] w-[5px] rounded-full" style={{ background: HEALTH_COLOR[project.health] }} />
                    {t(STATUS_LABEL[project.status])}
                  </span>
                  <span className="tnum text-[12.5px] text-t4">{plural(projectIssues.length, 'issue')}</span>
                </div>
                <div className="mt-0.5 truncate text-[13px] text-t4">{project.summary}</div>
              </div>

              <div className="hidden w-[130px] shrink-0 items-center gap-2 md:flex">
                <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-[var(--bg-selected)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{ width: `${pct}%`, background: project.color }}
                  />
                </div>
                <span className="tnum w-[28px] text-right text-[12px] text-t4">{pct}%</span>
              </div>

              <div className="hidden w-[86px] shrink-0 items-center justify-end gap-1.5 lg:flex">
                {lead ? <Avatar name={lead.name} color={lead.color} size="xs" /> : null}
                <span className="truncate text-[12.5px] text-t4">{lead?.name.split(' ')[0]}</span>
              </div>

              <span className="tnum hidden w-[52px] shrink-0 text-right text-[12.5px] text-t4 sm:block">
                {shortDate(project.targetDate)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

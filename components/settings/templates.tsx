'use client';

import * as React from 'react';
import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { useIssueTemplates } from '@/lib/store/issue-templates';
import { useProjectTemplates } from '@/lib/store/project-templates';
import { useUI } from '@/lib/store/ui';
import { downloadText } from '@/lib/agent/run-export';
import { buildTemplateBundle, parseTemplateBundle } from '@/lib/template-transfer';
import { useT } from '@/lib/use-t';
import { PRIORITIES, STATUSES } from '@/lib/types';

export function TemplatesPanel() {
  const t = useT();
  const templates = useIssueTemplates((s) => s.templates);
  const hydrate = useIssueTemplates((s) => s.hydrate);
  const remove = useIssueTemplates((s) => s.remove);
  const projectTemplates = useProjectTemplates((s) => s.templates);
  const hydrateProjects = useProjectTemplates((s) => s.hydrate);
  const removeProject = useProjectTemplates((s) => s.remove);
  const importIssues = useIssueTemplates((s) => s.importMany);
  const importProjects = useProjectTemplates((s) => s.importMany);
  const pushToast = useUI((s) => s.pushToast);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [importing, setImporting] = React.useState(false);

  React.useEffect(() => {
    hydrate();
    hydrateProjects();
  }, [hydrate, hydrateProjects]);

  const exportAll = () => {
    downloadText(
      `aether-templates-${new Date().toISOString().slice(0, 10)}.json`,
      buildTemplateBundle(templates, projectTemplates),
      'application/json',
    );
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const result = parseTemplateBundle(await file.text());
      if (!result.ok) {
        pushToast({
          title: t('Could not import templates'),
          description:
            result.error === 'invalid-json'
              ? t('That file is not valid JSON.')
              : result.error === 'empty'
                ? t('That file contains no usable templates.')
                : t('That file is not a template bundle.'),
          tone: 'danger',
        });
        return;
      }
      const issues = importIssues(result.issueTemplates);
      const projects = importProjects(result.projectTemplates);
      pushToast({
        title: t('Imported {issues} issue and {projects} project template(s)', { issues, projects }),
        tone: 'success',
      });
    } catch {
      pushToast({ title: t('Could not read that file'), tone: 'danger' });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div data-templates-panel className="max-w-[720px]">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-r6 bg-[var(--bg-hover)] text-t3">
          <FileText size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-[590] text-t1">{t('Templates')}</h2>
          <p className="mt-0.5 text-[13px] leading-[1.55] text-t3">
            {t('Save an issue as a template from its ⋯ menu, then create new issues from the command palette.')}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={exportAll} disabled={!templates.length && !projectTemplates.length}>
            <Download size={12} />
            {t('Export templates')}
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {t('Import templates')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-template-import
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="rounded-r9 bg-[var(--bg-elevated)] p-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {templates.length === 0 ? (
          <p className="py-3 text-[13px] text-t4">{t('No templates yet')}</p>
        ) : (
          <div className="flex flex-col">
            {templates.map((template) => (
              <div key={template.id} data-template={template.id} className="flex items-center gap-2 border-b border-[var(--line-subtle)] py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-[510] text-t1">{template.name}</div>
                  <div className="truncate text-[12px] text-t4">
                    {t(STATUSES.find((status) => status.key === template.status)?.label ?? template.status)} ·{' '}
                    {t(PRIORITIES.find((priority) => priority.key === template.priority)?.label ?? template.priority)}
                    {template.labelIds.length ? ` · ${template.labelIds.length} labels` : ''}
                    {template.projectId ? ` · ${template.projectId}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t('Delete template')}
                  onClick={() => {
                    if (!window.confirm(t('Delete this template?'))) return;
                    remove(template.id);
                  }}
                  className="grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 rounded-r9 bg-[var(--bg-elevated)] p-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <h3 className="text-[13px] font-[510] text-t2">{t('Project templates')}</h3>
        {projectTemplates.length === 0 ? (
          <p className="py-2 text-[13px] text-t4">{t('No project templates yet')}</p>
        ) : (
          <div className="mt-1 flex flex-col">
            {projectTemplates.map((template) => (
              <div key={template.id} data-project-template={template.id} className="flex items-center gap-2 border-b border-[var(--line-subtle)] py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-[510] text-t1">{template.name}</div>
                  <div className="truncate text-[12px] text-t4">
                    {template.summary || t('No summary')}
                    {template.knowledgeIds.length ? ` · ${template.knowledgeIds.length} knowledge` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t('Delete project template')}
                  onClick={() => {
                    if (!window.confirm(t('Delete this project template?'))) return;
                    removeProject(template.id);
                  }}
                  className="grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

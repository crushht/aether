'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Copy,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/lib/agent/workspace';
import { useData } from '@/lib/store/data';
import { runWorkflowNow, useWorkflowRuntime, cancelWorkflow } from '@/lib/agent/workflow-runner';
import { downloadText, runFileName, runToMarkdown } from '@/lib/agent/run-export';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn, relativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import { type AgentWorkflow } from '@/lib/agent/types';
import { WORKFLOW_TEMPLATES } from '@/lib/agent/workflow-templates';
import { formatNextRun, nextRunAt } from '@/lib/agent/schedule';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

type Draft = {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  providerId: string | null;
  model: string;
  trigger: AgentWorkflow['trigger'];
  enabled: boolean;
  allowWrites: boolean;
  createIssue: boolean;
  issueStatus: 'backlog' | 'todo' | 'in_progress';
  projectId: string | null;
  maxSteps: number;
};

const blank = (): Draft => ({
  name: '',
  description: '',
  prompt: '',
  providerId: null,
  model: '',
  trigger: { kind: 'manual' },
  enabled: true,
  allowWrites: false,
  createIssue: false,
  issueStatus: 'todo',
  projectId: null,
  maxSteps: 6,
});

const toDraft = (workflow: AgentWorkflow): Draft => ({
  id: workflow.id,
  name: workflow.name,
  description: workflow.description,
  prompt: workflow.prompt,
  providerId: workflow.providerId,
  model: workflow.model,
  trigger: workflow.trigger,
  enabled: workflow.enabled,
  allowWrites: workflow.allowWrites,
  createIssue: workflow.createIssue,
  issueStatus: workflow.issueStatus ?? 'todo',
  projectId: workflow.projectId,
  maxSteps: workflow.maxSteps,
});

function Switch({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cn(
          'relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-160',
          on ? 'bg-[var(--accent)]' : 'bg-[var(--bg-selected)]',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform duration-160',
            on ? 'translate-x-[14px]' : 'translate-x-[2px]',
          )}
        />
      </button>
      <span className="text-[12.5px] text-t2">{label}</span>
    </label>
  );
}

const inputClass =
  'h-[36px] w-full rounded-r6 bg-[var(--bg-panel)] px-2.5 text-[13.5px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_55%,transparent),0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]';

function WorkflowEditor({
  draft,
  onChange,
  onClose,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onClose: () => void;
}) {
  const t = useT();
  const providers = useWorkspace((s) => s.providers);
  const projects = useData((s) => s.projects);
  const createWorkflow = useWorkspace((s) => s.createWorkflow);
  const updateWorkflow = useWorkspace((s) => s.updateWorkflow);
  const pushToast = useUI((s) => s.pushToast);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyTemplate = (template: (typeof WORKFLOW_TEMPLATES)[number]) => {
    onChange({
      name: template.name,
      description: template.description,
      prompt: template.prompt,
      trigger: template.trigger,
      createIssue: template.createIssue,
      maxSteps: template.maxSteps,
    });
  };

  const triggerKind = draft.trigger.kind;
  const provider = providers.find((item) => item.id === draft.providerId) ?? providers[0];

  const save = async () => {    if (!draft.name.trim() || !draft.prompt.trim() || saving) return;
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      description: draft.description,
      prompt: draft.prompt,
      providerId: draft.providerId,
      model: draft.model,
      trigger: draft.trigger,
      enabled: draft.enabled,
      allowWrites: draft.allowWrites,
      createIssue: draft.createIssue,
      issueStatus: draft.issueStatus,
      projectId: draft.projectId,
      maxSteps: draft.maxSteps,
    };
    const result = draft.id ? await updateWorkflow(draft.id, payload) : await createWorkflow(payload);
    setSaving(false);
    if (!result.ok) {
      pushToast({ title: t('Could not save the workflow'), description: result.error, tone: 'danger' });
      return;
    }
    pushToast({ title: t('Workflow saved'), tone: 'success' });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[670] grid place-items-center overflow-y-auto bg-[rgba(24,25,27,.34)] px-4 py-10 backdrop-blur-[3px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.995 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.18, ease: EASE }}
        className="w-full max-w-[660px] rounded-r12 bg-panel p-4 shadow-[0_30px_70px_-20px_rgba(9,10,12,.35),inset_0_0_0_1px_var(--line)]"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-[var(--bg-accent-subtle)] text-[var(--accent)]">
            <WorkflowIcon size={14} strokeWidth={1.9} />
          </span>
          <span className="text-[14px] font-[590] text-t1">{draft.id ? t('Edit workflow') : t('New workflow')}</span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label={t('Close')}
            onClick={onClose}
            className="grid h-[26px] w-[26px] place-items-center rounded-r6 text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <X size={14} strokeWidth={1.9} />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {!draft.id ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-t4">{t('Start from a template')}</span>
              {WORKFLOW_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="h-[24px] rounded-full bg-[var(--bg-hover)] px-2.5 text-[11.5px] font-[510] text-t3 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
                >
                  {template.name}
                </button>
              ))}
            </div>
          ) : null}
          <input
            autoFocus
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder={t('Name — e.g. Monday status digest')}
            className={inputClass}
          />
          <input
            value={draft.description}
            onChange={(event) => onChange({ description: event.target.value })}
            placeholder={t('One line about what this is for (optional)')}
            className={inputClass}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-[510] text-t2">{t('Instruction')}</span>
            <textarea
              value={draft.prompt}
              onChange={(event) => onChange({ prompt: event.target.value })}
              rows={5}
              placeholder={t('e.g. Summarise what moved in the current cycle, flag anything blocked, and list what needs a decision.')}
              className="w-full resize-y rounded-r6 bg-[var(--bg-panel)] px-2.5 py-2 text-[13px] leading-[1.6] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_55%,transparent)]"
            />
          </label>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-[510] text-t2">{t('Provider')}</span>
              <select
                value={draft.providerId ?? ''}
                onChange={(event) => onChange({ providerId: event.target.value || null, model: '' })}
                className={inputClass}
              >
                <option value="">{t('Automatic (Workflows route)')}</option>
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-[510] text-t2">{t('Model')}</span>
              <input
                value={draft.model}
                onChange={(event) => onChange({ model: event.target.value })}
                placeholder={provider?.defaultModel || t('provider default')}
                spellCheck={false}
                className={cn(inputClass, 'font-mono text-[12.5px]')}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-[510] text-t2">{t('Trigger')}</span>
              <select
                value={triggerKind}
                onChange={(event) =>
                  onChange({
                    trigger:
                      event.target.value === 'daily'
                        ? { kind: 'daily', hour: 9 }
                        : event.target.value === 'weekly'
                          ? { kind: 'weekly', weekday: 1, hour: 9 }
                          : event.target.value === 'interval'
                            ? { kind: 'interval', minutes: 60 }
                            : { kind: 'manual' },
                  })
                }
                className={inputClass}
              >
                <option value="manual">{t('Manual')}</option>
                <option value="daily">{t('Every day')}</option>
                <option value="weekly">{t('Every week')}</option>
                <option value="interval">{t('Every N minutes')}</option>
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] font-[510] text-t2">{t('Schedule')}</span>
              <div className="flex h-[36px] items-center gap-1.5">
                {triggerKind === 'interval' ? (
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={draft.trigger.minutes ?? 60}
                    onChange={(event) =>
                      onChange({ trigger: { kind: 'interval', minutes: Math.max(5, Number(event.target.value) || 60) } })
                    }
                    className={cn(inputClass, 'tnum w-[92px]')}
                  />
                ) : null}
                {triggerKind === 'weekly' ? (
                  <select
                    value={draft.trigger.weekday ?? 1}
                    onChange={(event) =>
                      onChange({ trigger: { ...draft.trigger, weekday: Number(event.target.value) } })
                    }
                    className={cn(inputClass, 'w-[104px]')}
                  >
                    {[t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')].map((day, index) => (
                      <option key={day} value={index + 1}>
                        {day}
                      </option>
                    ))}
                  </select>
                ) : null}
                {triggerKind === 'daily' || triggerKind === 'weekly' ? (
                  <select
                    value={draft.trigger.hour ?? 9}
                    onChange={(event) => onChange({ trigger: { ...draft.trigger, hour: Number(event.target.value) } })}
                    className={cn(inputClass, 'w-[92px] tnum')}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                ) : null}
                {triggerKind === 'manual' ? <span className="text-[12px] text-t4">{t('Run it yourself')}</span> : null}
                {(triggerKind === 'interval') ? <span className="text-[12px] text-t4">{t('minutes')}</span> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--line-subtle)] pt-3">
            <Switch on={draft.allowWrites} onChange={(value) => onChange({ allowWrites: value })} label={t('May change issues')} />
            <Switch on={draft.createIssue} onChange={(value) => onChange({ createIssue: value })} label={t('Turn the report into an issue')} />
            <Switch on={draft.enabled} onChange={(value) => onChange({ enabled: value })} label={t('Enabled')} />
            {draft.createIssue ? (
              <label className="flex items-center gap-1.5 text-[12px] text-t3">
                {t('Project for the report')}
                <select
                  value={draft.issueStatus}
                  onChange={(event) =>
                    onChange({ issueStatus: event.target.value as 'backlog' | 'todo' | 'in_progress' })
                  }
                  className="h-[28px] rounded-r6 bg-[var(--bg-panel)] px-2 text-[12px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] outline-none"
                >
                  <option value="backlog">{t('Backlog')}</option>
                  <option value="todo">{t('Todo')}</option>
                  <option value="in_progress">{t('In Progress')}</option>
                </select>
                <select
                  value={draft.projectId ?? ''}
                  onChange={(event) => onChange({ projectId: event.target.value || null })}
                  className="h-[28px] rounded-r6 bg-[var(--bg-panel)] px-2 text-[12px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] outline-none"
                >
                  <option value="">{t('No project')}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={save} disabled={saving || !draft.name.trim() || !draft.prompt.trim()}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('Save workflow')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={async () => {
              const definition = {
                name: draft.name,
                description: draft.description,
                prompt: draft.prompt,
                providerId: draft.providerId,
                model: draft.model,
                trigger: draft.trigger,
                enabled: draft.enabled,
                allowWrites: draft.allowWrites,
                createIssue: draft.createIssue,
                issueStatus: draft.issueStatus,
                maxSteps: draft.maxSteps,
              };
              await navigator.clipboard.writeText(JSON.stringify(definition, null, 2)).catch(() => undefined);
              pushToast({ title: t('Definition copied'), tone: 'success' });
            }}
            className="flex h-[28px] items-center gap-1.5 rounded-r6 px-2 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <Copy size={12} strokeWidth={1.9} />
            {t('Copy definition')}
          </button>
          <span className="text-[11.5px] text-t4">
            {t('Scheduled workflows run while Aether is open.')}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

export default function WorkflowsPage() {
  const t = useT();
  const workflows = useWorkspace((s) => s.workflows);
  const loading = useWorkspace((s) => s.loading);
  const hydrate = useWorkspace((s) => s.hydrate);
  const updateWorkflow = useWorkspace((s) => s.updateWorkflow);
  const deleteWorkflow = useWorkspace((s) => s.deleteWorkflow);
  const pushToast = useUI((s) => s.pushToast);
  const running = useWorkflowRuntime((s) => s.running);
  const progress = useWorkflowRuntime((s) => s.progress);

  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [runningAll, setRunningAll] = React.useState(false);

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('new') && !params.get('prompt')) return;
    const prompt = params.get('prompt') ?? '';
    setDraft({
      ...blank(),
      prompt,
      name: prompt.replace(/\s+/g, ' ').slice(0, 40),
    });
  }, []);

  const startTemplate = (template: (typeof WORKFLOW_TEMPLATES)[number]) => {
    setDraft({
      ...blank(),
      name: template.name,
      description: template.description,
      prompt: template.prompt,
      trigger: template.trigger,
      createIssue: template.createIssue,
      maxSteps: template.maxSteps,
    });
  };

  const runNow = async (workflow: AgentWorkflow) => {
    if (!workflow.prompt.trim()) {
      pushToast({ title: t('This workflow has no instruction'), tone: 'danger' });
      return;
    }
    const result = await runWorkflowNow(workflow);
    if (result.status === 'error') {
      pushToast({ title: t('Workflow failed'), description: result.error, tone: 'danger' });
    }
  };

  const runAll = async () => {
    if (runningAll) return;
    const targets = workflows.filter((workflow) => workflow.enabled && workflow.prompt.trim());
    if (!targets.length) return;
    setRunningAll(true);
    let ok = 0;
    let failed = 0;
    for (const workflow of targets) {
      const result = await runWorkflowNow(workflow);
      if (result.status === 'error') failed += 1;
      else ok += 1;
    }
    setRunningAll(false);
    pushToast({
      title: t('Ran {n} workflows', { n: ok }),
      description: failed ? t('{n} failed', { n: failed }) : undefined,
      tone: failed ? 'danger' : 'success',
    });
  };

  const [scheduler, setScheduler] = React.useState<{
    started: boolean;
    lastTickAt: number | null;
    running: number;
    disabled: boolean;
  } | null>(null);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/agent/status', { cache: 'no-store' });
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          scheduler?: { started: boolean; lastTickAt: number | null; running: number; disabled: boolean };
        };
        if (active && json.ok && json.scheduler) setScheduler(json.scheduler);
      } catch {
        /* keep the last known status */
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="mx-auto max-w-[940px] px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title2 font-[590] text-t1">{t('Workflows')}</h1>
          <p className="mt-1 max-w-[560px] text-[14px] leading-[1.6] text-t3">
            {t('Save a recurring instruction as a workflow. It runs with the same tools and model routing as the agent — every run keeps a report.')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => void runAll()}
            disabled={runningAll || !workflows.some((workflow) => workflow.enabled)}
          >
            {runningAll ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} strokeWidth={2.2} />}
            {t('Run all')}
          </Button>
          <Button variant="primary" size="sm" className="gap-1.5" onClick={() => setDraft(blank())}>
            <Plus size={12} strokeWidth={2.2} />
            {t('New workflow')}
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-[12px] text-t4" data-scheduler-status>
        <WorkflowIcon size={12} strokeWidth={1.8} />
        {t('{n} workflows', { n: workflows.length })}
        <span className="text-[var(--line-strong)]">·</span>
        <Clock size={12} strokeWidth={1.8} />
        <span
          className={cn(
            'inline-flex items-center gap-1.5',
            scheduler?.disabled ? 'text-[var(--red)]' : scheduler?.started ? 'text-[var(--green)]' : 'text-t4',
          )}
        >
          <span
            className={cn(
              'h-[5px] w-[5px] rounded-full',
              scheduler?.disabled ? 'bg-[var(--red)]' : scheduler?.started ? 'bg-[var(--green)]' : 'bg-[var(--line-strong)]',
            )}
          />
          {scheduler?.disabled
            ? t('Server scheduler disabled')
            : scheduler?.started
              ? t('Server scheduler running')
              : t('Server scheduler not started')}
        </span>
        {scheduler?.lastTickAt ? (
          <span>{t('last scan {when}', { when: relativeTime(new Date(scheduler.lastTickAt).toISOString()) })}</span>
        ) : null}
        {scheduler?.running ? <span>{t('{n} running', { n: scheduler.running })}</span> : null}
      </div>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-t4">
        {t('Scheduled runs happen on the server; no tab needs to stay open.')}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {loading && workflows.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <div
                key={row}
                className="flex animate-pulse items-start gap-3 rounded-r10 bg-[var(--bg-elevated)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
              >
                <span className="h-7 w-7 shrink-0 rounded-[7px] bg-[var(--bg-selected)]" />
                <span className="flex-1 space-y-2">
                  <span className="block h-[11px] w-[30%] rounded-full bg-[var(--bg-selected)]" />
                  <span className="block h-[9px] w-[62%] rounded-full bg-[var(--bg-hover)]" />
                </span>
              </div>
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <div className="rounded-r10 bg-[var(--bg-elevated)] px-5 py-12 text-center shadow-[inset_0_0_0_1px_var(--line-subtle)]">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--bg-hover)] text-t3">
              <WorkflowIcon size={17} strokeWidth={1.7} />
            </span>
            <p className="mt-3 text-[14px] font-[510] text-t1">{t('No workflows yet')}</p>
            <p className="mx-auto mt-1 max-w-[400px] text-[13px] leading-[1.6] text-t4">
              {t('A good first one: every Monday, summarise what moved and list what is blocked.')}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setDraft(blank())}>
                <Plus size={12} strokeWidth={2.2} />
                {t('Create a workflow')}
              </Button>
              {WORKFLOW_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => startTemplate(template)}
                  title={template.description}
                  className="h-[28px] rounded-r6 px-2.5 text-[12.5px] text-t3 shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                >
                  {template.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {workflows.map((workflow) => {
          const busy = running.includes(workflow.id);
          const last = workflow.runs[0];
          const nextAt = nextRunAt(workflow);
          return (
            <article
              key={workflow.id}
              data-workflow={workflow.id}
              className="rounded-r10 bg-[var(--bg-elevated)] shadow-[0_1px_2px_rgba(9,10,12,.04),inset_0_0_0_1px_var(--line-subtle)] transition-shadow hover:shadow-[0_2px_6px_rgba(9,10,12,.06),inset_0_0_0_1px_var(--line)]"
            >
              <div className="flex items-start gap-3 px-3.5 py-3">
                <span
                  className={cn(
                    'mt-[1px] grid h-7 w-7 shrink-0 place-items-center rounded-[7px]',
                    workflow.enabled ? 'bg-[var(--bg-accent-subtle)] text-[var(--accent)]' : 'bg-[var(--bg-hover)] text-t4',
                  )}
                >
                  <WorkflowIcon size={14} strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-[510] text-t1">{workflow.name}</span>
                    <span className="shrink-0 rounded-[4px] bg-[var(--bg-selected)] px-1.5 py-[1px] text-[10.5px] text-t3">
                      {workflow.trigger.kind === 'manual'
                        ? t('Manual')
                        : workflow.trigger.kind === 'daily'
                          ? `${t('Every day')} ${String(workflow.trigger.hour ?? 9).padStart(2, '0')}:00`
                          : workflow.trigger.kind === 'weekly'
                            ? `${[t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')][(workflow.trigger.weekday ?? 1) - 1]} ${String(workflow.trigger.hour ?? 9).padStart(2, '0')}:00`
                            : `${t('Every N minutes')} · ${workflow.trigger.minutes ?? 60}`}
                    </span>
                    {!workflow.enabled ? (
                      <span className="shrink-0 rounded-[4px] bg-[var(--bg-hover)] px-1.5 py-[1px] text-[10.5px] text-t4">
                        {t('paused')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.55] text-t3">
                    {workflow.description || workflow.prompt}
                  </p>
                  {busy && progress[workflow.id] ? (
                    <div data-workflow-progress className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
                      <Loader2 size={10} className="animate-spin" />
                      <span>
                        {t('Step {step}/{total}', {
                          step: progress[workflow.id].step,
                          total: progress[workflow.id].maxSteps,
                        })}
                      </span>
                      {progress[workflow.id].tool ? (
                        <span className="truncate font-mono text-t4">· {progress[workflow.id].tool}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-t4">
                    <span>
                      {workflow.lastRunAt
                        ? t('last run {when}', { when: relativeTime(new Date(workflow.lastRunAt).toISOString()) })
                        : t('never run')}
                    </span>
                    {last ? (
                      <>
                        <span className="text-[var(--line-strong)]">·</span>
                        <span
                          className={cn(
                            'flex items-center gap-1',
                            last.status === 'ok' ? 'text-[var(--green)]' : last.status === 'error' ? 'text-[var(--red)]' : 'text-t4',
                          )}
                        >
                          {last.status === 'ok' ? <Check size={9} strokeWidth={2.6} /> : null}
                          {last.status}
                        </span>
                        {last.issueKey ? (
                          <>
                            <span className="text-[var(--line-strong)]">·</span>
                            <span className="font-mono">{last.issueKey}</span>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {nextAt ? (
                      <>
                        <span className="text-[var(--line-strong)]">·</span>
                        <span>
                          {t('Next')} {formatNextRun(nextAt)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {last?.status === 'error' ? (
                    <button
                      type="button"
                      onClick={() => void runNow(workflow)}
                      disabled={busy}
                      aria-label={t('Retry')}
                      className="flex h-[26px] items-center gap-1 rounded-r5 px-1.5 text-[12px] text-[var(--red)] transition-colors hover:bg-[color-mix(in_srgb,var(--red)_10%,transparent)] disabled:opacity-60"
                    >
                      <RefreshCw size={11} strokeWidth={2} />
                      {t('Retry')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => (busy ? cancelWorkflow(workflow.id) : void runNow(workflow))}
                    className={cn(
                      'flex h-[26px] items-center gap-1 rounded-r5 px-2 text-[12px] font-[510] transition-colors',
                      busy
                        ? 'bg-[var(--bg-hover)] text-t2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[var(--bg-selected)]'
                        : 'bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]',
                    )}
                  >
                    {busy ? <Square size={10} /> : <Play size={10} strokeWidth={2.4} />}
                    {busy ? t('Stop') : t('Run')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('Edit')}
                    onClick={() => setDraft(toDraft(workflow))}
                    className="grid h-[26px] w-[26px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                  >
                    <Pencil size={12} strokeWidth={1.9} />
                  </button>
                  <button
                    type="button"
                    aria-label={workflow.enabled ? t('Pause') : t('Resume')}
                    onClick={() => void updateWorkflow(workflow.id, { enabled: !workflow.enabled })}
                    className="grid h-[26px] w-[26px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                  >
                    {workflow.enabled ? <Pause size={12} strokeWidth={1.9} /> : <Play size={12} strokeWidth={1.9} />}
                  </button>
                  <button
                    type="button"
                    aria-label={confirmDelete === workflow.id ? t('Click again to delete') : t('Delete')}
                    onClick={() => {
                      if (confirmDelete === workflow.id) {
                        void deleteWorkflow(workflow.id);
                        setConfirmDelete(null);
                        return;
                      }
                      setConfirmDelete(workflow.id);
                      window.setTimeout(
                        () => setConfirmDelete((current) => (current === workflow.id ? null : current)),
                        3000,
                      );
                    }}
                    className={cn(
                      'flex h-[26px] items-center gap-1 rounded-r5 px-1.5 text-[12px] transition-colors',
                      confirmDelete === workflow.id
                        ? 'text-[var(--red)]'
                        : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-[var(--red)]',
                    )}
                  >
                    <Trash2 size={12} strokeWidth={1.9} />
                    {confirmDelete === workflow.id ? t('Click again to delete') : null}
                  </button>
                  {workflow.runs.length ? (
                    <button
                      type="button"
                      aria-label={t('Run history')}
                      onClick={() => setExpanded(expanded === workflow.id ? null : workflow.id)}
                      className="grid h-[26px] w-[24px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                    >
                      <ChevronDown
                        size={13}
                        strokeWidth={2}
                        className={cn('transition-transform duration-160', expanded === workflow.id ? 'rotate-180' : '')}
                      />
                    </button>
                  ) : null}
                </div>
              </div>

              {expanded === workflow.id ? (
                <div className="border-t border-[var(--line-subtle)] px-3.5 py-2.5">
                  <div className="text-[11px] uppercase tracking-[.06em] text-t4">{t('Recent runs')}</div>
                  <ul className="mt-1.5 flex flex-col gap-2">
                    {workflow.runs.map((run) => (
                      <li key={run.id} className="flex items-start gap-2">
                        <span
                          className={cn(
                            'mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full',
                            run.status === 'ok' ? 'bg-[var(--green)]' : run.status === 'error' ? 'bg-[var(--red)]' : 'bg-[var(--orange)]',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[11.5px] text-t4">
                            <span>{relativeTime(new Date(run.at).toISOString())}</span>
                            <span className="text-[var(--line-strong)]">·</span>
                            <span>{run.status}</span>
                            <span className="text-[var(--line-strong)]">·</span>
                            <span className="tnum">{run.steps} {t('steps')}</span>
                            {run.ms ? (
                              <>
                                <span className="text-[var(--line-strong)]">·</span>
                                <span className="tnum">{(run.ms / 1000).toFixed(1)}s</span>
                              </>
                            ) : null}
                            {run.model ? (
                              <>
                                <span className="text-[var(--line-strong)]">·</span>
                                <span className="max-w-[140px] truncate font-mono">{run.model}</span>
                              </>
                            ) : null}
                            {run.issueKey ? <span className="font-mono">{run.issueKey}</span> : null}
                          </div>
                          {run.summary ? (
                            <p
                              title={run.summary}
                              className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-[1.55] text-t2"
                            >
                              {run.summary}
                            </p>
                          ) : null}
                          {run.events?.length ? (
                            <details data-run-events={run.id} className="mt-1">
                              <summary className="cursor-pointer select-none text-[11.5px] text-t4 transition-colors hover:text-t2">
                                {t('{n} events', { n: run.events.length })}
                              </summary>
                              <ol className="mt-1 flex flex-col gap-0.5 border-l border-[var(--line-subtle)] pl-2">
                                {run.events.map((event, index) => (
                                  <li key={`${event.at}-${index}`} data-run-event={event.kind} className="flex items-start gap-1.5 text-[11.5px] leading-[1.5]">
                                    <span
                                      className={cn(
                                        'w-[38px] shrink-0 font-mono text-[10.5px]',
                                        event.kind === 'error'
                                          ? 'text-[var(--red)]'
                                          : event.kind === 'tool'
                                            ? 'text-[var(--accent)]'
                                            : event.kind === 'final'
                                              ? 'text-[var(--green)]'
                                              : 'text-t4',
                                      )}
                                    >
                                      {event.kind}
                                    </span>
                                    <span className="min-w-0 flex-1 break-words text-t3">{event.text}</span>
                                  </li>
                                ))}
                              </ol>
                            </details>
                          ) : null}
                          <div className="mt-1 flex items-center gap-1.5">
                            <button
                              type="button"
                              data-run-export="md"
                              onClick={() => downloadText(runFileName(workflow, run, 'md'), runToMarkdown(workflow, run), 'text/markdown;charset=utf-8')}
                              className="rounded-r4 px-1.5 py-0.5 text-[11px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                            >
                              {t('Export Markdown')}
                            </button>
                            <button
                              type="button"
                              data-run-export="json"
                              onClick={() => downloadText(runFileName(workflow, run, 'json'), JSON.stringify({ workflow: { id: workflow.id, name: workflow.name }, run }, null, 2), 'application/json')}
                              className="rounded-r4 px-1.5 py-0.5 text-[11px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                            >
                              {t('Export JSON')}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <AnimatePresence>
        {draft ? (
          <WorkflowEditor
            draft={draft}
            onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
            onClose={() => setDraft(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

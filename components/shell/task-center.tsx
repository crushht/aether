'use client';

import * as React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Loader2, RotateCcw, Square, Workflow } from 'lucide-react';
import { useAgent, type AgentSession } from '@/lib/agent/store';
import { useChats } from '@/lib/agent/chats';
import { useWorkflowRuntime, runWorkflowNow, cancelWorkflow } from '@/lib/agent/workflow-runner';
import { useWorkspace } from '@/lib/agent/workspace';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { useView } from '@/lib/store/view';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';

interface ActiveAgent {
  key: string;
  title: string;
  session: AgentSession;
}

/**
 * One place to see what the agent and the workflows are doing right now, and
 * to recover what failed. Runs start in several surfaces; without this they
 * disappear the moment you close the panel that started them.
 */
export function TaskCenter() {
  const t = useT();
  const sessions = useAgent((s) => s.sessions);
  const cancel = useAgent((s) => s.cancel);
  const retry = useAgent((s) => s.retry);
  const chats = useChats((s) => s.chats);
  const selectChat = useChats((s) => s.select);
  const issues = useData((s) => s.issues);
  const workflows = useWorkspace((s) => s.workflows);
  const running = useWorkflowRuntime((s) => s.running);
  const progress = useWorkflowRuntime((s) => s.progress);
  const openChat = useUI((s) => s.openChat);
  const openIssue = useView((s) => s.openIssue);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const activeAgents: ActiveAgent[] = React.useMemo(() => {
    return Object.entries(sessions)
      .filter(([, session]) => session.status === 'running' || session.status === 'waiting')
      .map(([key, session]) => {
        let title = session.prompt.slice(0, 80) || t('Agent run');
        if (key.startsWith('chat:')) {
          title = chats.find((chat) => chat.id === key.slice(5))?.title || title;
        } else {
          const issue = issues.find((item) => item.id === key);
          if (issue) title = `${issue.key} · ${issue.title}`;
        }
        return { key, title, session };
      });
  }, [sessions, chats, issues, t]);

  const activeWorkflows = workflows.filter((workflow) => running.includes(workflow.id));

  const failedAgents = Object.entries(sessions)
    .filter(([, session]) => session.status === 'error' && session.error !== 'interrupted')
    .slice(0, 4)
    .map(([key, session]) => ({ key, session }));

  const failedWorkflows = workflows
    .map((workflow) => ({ workflow, run: workflow.runs.find((run) => run.status === 'error') }))
    .filter((row) => row.run)
    .slice(0, 4);

  const activeCount = activeAgents.length + activeWorkflows.length;
  const failedCount = failedAgents.length + failedWorkflows.length;

  const openAgent = (key: string) => {
    if (key.startsWith('chat:')) {
      selectChat(key.slice(5));
      openChat();
    } else {
      openIssue(key);
    }
    setOpen(false);
  };

  if (activeCount === 0 && failedCount === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        data-task-center
        aria-label={t('Tasks')}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative flex h-[26px] items-center gap-1.5 rounded-r6 px-1.5 text-[12px] transition-colors hover:bg-[var(--bg-hover)]',
          activeCount > 0 ? 'text-[var(--accent)]' : 'text-[var(--orange)]',
        )}
      >
        {activeCount > 0 ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
        <span className="tnum">{activeCount > 0 ? activeCount : failedCount}</span>
        {failedCount > 0 && activeCount > 0 ? (
          <span className="h-[5px] w-[5px] rounded-full bg-[var(--orange)]" aria-hidden />
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-[690]" onMouseDown={() => setOpen(false)} />
          <div
            data-task-panel
            className="absolute right-0 top-[32px] z-[700] w-[340px] rounded-r10 bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-pop)]"
          >
            <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-0.5">
              <Activity size={13} className="text-t4" />
              <span className="text-[12.5px] font-[590] text-t1">{t('Tasks')}</span>
              <span className="text-[11px] text-t4">{t('{n} running', { n: activeCount })}</span>
            </div>

            {activeAgents.map(({ key, title, session }) => (
              <div key={key} data-task-row="agent" className="flex items-center gap-2 rounded-r6 px-1.5 py-1.5 hover:bg-[var(--bg-hover)]">
                <Loader2 size={11} className="shrink-0 animate-spin text-[var(--accent)]" />
                <button type="button" onClick={() => openAgent(key)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[12.5px] text-t1">{title}</div>
                  <div className="text-[11px] text-t4">
                    {session.status === 'waiting' ? t('Waiting for approval') : t('Agent running')} · {session.model ?? '—'}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={t('Stop')}
                  onClick={() => cancel(key)}
                  className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1"
                >
                  <Square size={10} />
                </button>
              </div>
            ))}

            {activeWorkflows.map((workflow) => (
              <div key={workflow.id} data-task-row="workflow" className="flex items-center gap-2 rounded-r6 px-1.5 py-1.5 hover:bg-[var(--bg-hover)]">
                <Loader2 size={11} className="shrink-0 animate-spin text-[var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-t1">{workflow.name}</div>
                  <div className="truncate text-[11px] text-t4">
                    {progress[workflow.id]
                      ? `${t('Step {step}/{total}', {
                          step: progress[workflow.id].step,
                          total: progress[workflow.id].maxSteps,
                        })}${progress[workflow.id].tool ? ` · ${progress[workflow.id].tool}` : ''}`
                      : t('Workflow running')}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t('Stop')}
                  onClick={() => cancelWorkflow(workflow.id)}
                  className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1"
                >
                  <Square size={10} />
                </button>
              </div>
            ))}

            {failedAgents.length || failedWorkflows.length ? (
              <>
                <div className="my-1 h-px bg-[var(--line-subtle)]" />
                <div className="px-1 pb-1 text-[10.5px] font-[590] uppercase tracking-[.06em] text-t4">
                  {t('Needs attention')}
                </div>
                {failedAgents.map(({ key, session }) => (
                  <div key={key} data-task-row="agent-failed" className="flex items-center gap-2 rounded-r6 px-1.5 py-1.5 hover:bg-[var(--bg-hover)]">
                    <AlertTriangle size={11} className="shrink-0 text-[var(--orange)]" />
                    <button type="button" onClick={() => openAgent(key)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[12.5px] text-t1">{session.prompt.slice(0, 80) || t('Agent run')}</div>
                      <div className="truncate text-[11px] text-t4">{session.error}</div>
                    </button>
                    <button
                      type="button"
                      aria-label={t('Retry')}
                      onClick={() => {
                        retry(key);
                        setOpen(false);
                      }}
                      className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1"
                    >
                      <RotateCcw size={10} />
                    </button>
                  </div>
                ))}
                {failedWorkflows.map(({ workflow, run }) => (
                  <div key={workflow.id} data-task-row="workflow-failed" className="flex items-center gap-2 rounded-r6 px-1.5 py-1.5 hover:bg-[var(--bg-hover)]">
                    <Workflow size={11} className="shrink-0 text-[var(--orange)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] text-t1">{workflow.name}</div>
                      <div className="truncate text-[11px] text-t4">{run?.error ?? t('Last run failed')}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={t('Retry')}
                      disabled={busy === workflow.id || running.includes(workflow.id)}
                      onClick={async () => {
                        setBusy(workflow.id);
                        await runWorkflowNow(workflow);
                        setBusy(null);
                      }}
                      className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1 disabled:opacity-40"
                    >
                      {busy === workflow.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                    </button>
                  </div>
                ))}
              </>
            ) : null}

            {activeCount > 0 && failedCount === 0 ? (
              <div className="mt-1 flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-t4">
                <CheckCircle2 size={11} />
                {t('Runs keep going while you work elsewhere.')}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

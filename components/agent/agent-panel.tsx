'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Copy, HelpCircle, Loader2, Sparkles, Square, Wrench } from 'lucide-react';
import { useAgent } from '@/lib/agent/store';
import { isModelReady, useModelTarget } from '@/lib/agent/workspace';
import { useView } from '@/lib/store/view';
import type { AgentLogEntry, AgentPendingRow } from '@/lib/agent/types';
import { PRIORITIES, STATUSES, type Issue } from '@/lib/types';
import { usePeople } from '@/lib/people';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';
import { cn, isImeComposing } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import { Markdown } from '@/components/issue/markdown';
import { toPlainText } from '@/lib/agent/text';

export const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  cycle: 'Cycle',
  project: 'Project',
  estimate: 'Estimate',
  label: 'Label',
  parent: 'Parent',
  title: 'Title',
  relation: 'Relation',
};

/** pending rows carry raw ids; this maps them to what the user reads */
export function useValueLabel() {
  const t = useT();
  const { users } = usePeople();
  const cycles = useData((s) => s.cycles);
  return (row: AgentPendingRow) => {
    const raw = row.to ?? '';
    if (row.field === 'status') return t(STATUSES.find((item) => item.key === raw)?.label ?? raw);
    if (row.field === 'priority') return t(PRIORITIES.find((item) => item.key === raw)?.label ?? raw);
    if (row.field === 'assignee') {
      if (raw === 'none') return t('No assignee');
      return users.find((user) => user.id === raw)?.name ?? raw;
    }
    if (row.field === 'cycle') return cycles.find((cycle) => cycle.id === raw)?.name ?? (raw === 'none' ? '—' : raw);
    if (row.field === 'parent') return raw || '—';
    return raw || '—';
  };
}

/** Tool summaries are generated in the tool layer; only status keys need a label. */
const STATUS_REF = /status → (backlog|todo|in_progress|in_review|done|canceled|duplicate)/g;

function localizeToolSummary(text: string, t: (key: string) => string) {
  return text.replace(
    STATUS_REF,
    (_match, key: string) => `${t('Status')} → ${t(STATUSES.find((status) => status.key === key)?.label ?? key)}`,
  );
}

export function LogRow({ item }: { item: AgentLogEntry }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const summary = item.kind === 'tool' ? localizeToolSummary(item.text, t) : item.text;

  if (item.kind === 'tool') {
    const key = typeof item.args?.key === 'string' ? item.args.key : null;
    const content = (
      <>
        <Wrench size={11} strokeWidth={1.9} className="mt-[3px] shrink-0 text-t4" />
        <span className="shrink-0 font-mono text-[12.5px] text-t3">{item.name}</span>
        <span className="min-w-0 flex-1 truncate text-t4">{summary}</span>
        {item.ok ? (
          <Check size={11} strokeWidth={2.4} className="mt-[3px] shrink-0 text-[#7ac977]" />
        ) : (
          <AlertTriangle size={11} strokeWidth={2.2} className="mt-[3px] shrink-0 text-[#f08080]" />
        )}
      </>
    );

    // a tool that names an issue is a link to it
    if (key) {
      return (
        <button
          type="button"
          data-agent-tool={item.name}
          onClick={() => useView.getState().openIssue(key)}
          className="flex w-full items-start gap-1.5 rounded-r4 py-[3px] text-left text-[13px] leading-[1.5] transition-colors hover:bg-[var(--bg-hover)]"
        >
          {content}
        </button>
      );
    }

    return (
      <div data-agent-tool={item.name} className="flex items-start gap-1.5 py-[3px] text-[13px] leading-[1.5]">
        {content}
      </div>
    );
  }

  if (item.kind === 'user') {
    return (
      <div data-agent-user className="mt-1 flex justify-end">
        <div className="max-w-[85%] rounded-r8 bg-[var(--bg-active)] px-2.5 py-1.5 text-[13.5px] leading-[1.5] text-t2">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === 'error') {
    return (
      <div data-agent-error className="py-[3px] text-[13px] leading-[1.55] text-[#f08080]">
        {item.text}
      </div>
    );
  }

  if (item.kind === 'status') {
    return <div className="py-[3px] text-[13px] italic text-t4">{item.text}</div>;
  }

  if (item.kind === 'final') {
    return (
      <div data-agent-final className="mt-1 border-l-2 border-[color-mix(in_srgb,var(--accent)_70%,transparent)] pl-2.5">
        <Markdown
          text={item.text}
          className="prose-compact"
          onIssue={(key) => {
            const issue = useData.getState().issues.find((entry) => entry.key.toUpperCase() === key);
            if (issue) useView.getState().openIssue(issue.id);
          }}
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(toPlainText(item.text));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
          className="mt-1 flex h-[20px] items-center gap-1 rounded-r4 px-1 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
        >
          <Copy size={10} strokeWidth={1.9} />
          {copied ? t('Copied') : t('Copy')}
        </button>
      </div>
    );
  }

  return <div className="py-[3px] text-[13.5px] leading-[1.55] whitespace-pre-wrap text-t2">{item.text}</div>;
}

export function AgentPanel({ issue }: { issue: Issue }) {
  const t = useT();
  const router = useRouter();
  const session = useAgent((s) => s.sessions[issue.id]);
  const hydrate = useAgent((s) => s.hydrate);
  const run = useAgent((s) => s.run);
  const retry = useAgent((s) => s.retry);
  const cancel = useAgent((s) => s.cancel);
  const reset = useAgent((s) => s.reset);
  const approve = useAgent((s) => s.approve);
  const reject = useAgent((s) => s.reject);
  const valueLabel = useValueLabel();
  const [value, setValue] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    setExpanded(false);
  }, [session?.at]);

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // a run that starts from the comment box scrolls the panel into view
  React.useEffect(() => {
    if (!session) return;
    if (session.status === 'running' || session.status === 'waiting') {
      document.querySelector('[data-agent-panel]')?.scrollIntoView({ block: 'nearest' });
    }
  // Deliberately keyed on the run's identity/status, not the whole session object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.at, session?.status]);

  const target = useModelTarget('issue');
  const configured = isModelReady(target);
  const running = session?.status === 'running';
  const waiting = session?.status === 'waiting';
  const log = session?.log ?? [];
  const pending = session?.pending ?? null;

  // long runs collapse to the first few tool rows with a single "show more"
  const toolEntries = log.filter((item) => item.kind === 'tool');
  const hiddenCount = !expanded && toolEntries.length > 5 ? toolEntries.length - 3 : 0;
  const hiddenIds = new Set(toolEntries.slice(3, 3 + hiddenCount).map((item) => item.id));
  const rows: Array<AgentLogEntry | { kind: 'more'; id: string; count: number }> = [];
  let moreInserted = false;
  for (const item of log) {
    if (hiddenIds.has(item.id)) {
      if (!moreInserted) {
        rows.push({ kind: 'more', id: 'more', count: hiddenCount });
        moreInserted = true;
      }
      continue;
    }
    rows.push(item);
  }

  const submit = () => {
    const prompt = value.trim();
    if (!prompt || running || waiting) return;
    setValue('');
    void run(issue.id, prompt);
  };

  return (
    <div className="mt-8" data-agent-panel>
      <div className="flex items-center gap-2">
        <Sparkles size={13} strokeWidth={1.9} className="text-t3" />
        <h2 className="text-[14px] font-[590] text-t1">{t('Agent')}</h2>
        {running ? <Loader2 size={12} className="animate-spin text-t4" /> : null}
        <span className="flex-1" />
        {target?.model ? (
          <span className="hidden max-w-[160px] truncate font-mono text-[11px] text-t4 sm:block" title={target.providerName}>
            {target.model}
          </span>
        ) : null}
        {session && log.length && !running ? (
          <div className="flex items-center gap-1">
            {session.prompt ? (
              <button
                type="button"
                data-agent-retry
                onClick={() => retry(issue.id)}
                className="flex h-[24px] items-center rounded-r6 px-1.5 text-[13px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
              >
                {t('Retry')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => reset(issue.id)}
              className="flex h-[24px] items-center rounded-r6 px-1.5 text-[13px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
            >
              {t('Clear')}
            </button>
          </div>
        ) : null}
      </div>

      {log.length ? (
        <div
          data-agent-log
          className="scroll-container mt-1.5 max-h-[300px] overflow-y-auto rounded-r8 px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
        >
          {rows.map((item) =>
            item.kind === 'more' ? (
              <button
                key={item.id}
                type="button"
                data-agent-more
                onClick={() => setExpanded(true)}
                className="flex h-[24px] items-center rounded-r4 px-1 text-[12.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
              >
                {t('Show {n} more tool calls', { n: item.count })}
              </button>
            ) : (
              <LogRow key={item.id} item={item} />
            ),
          )}
        </div>
      ) : null}

      {session?.usage && !running && !waiting ? (
        <div data-agent-usage className="mt-1 flex items-center gap-2 text-[12px] text-t4">
          <span>
            {t('{steps} steps · {tools} tool calls', {
              steps: session.usage.steps,
              tools: session.usage.tools,
            })}
          </span>
          <span className="text-[var(--line-strong)]">·</span>
          <span className="tnum">
            {t('{n} tokens', { n: session.usage.promptTokens + session.usage.completionTokens })}
          </span>
          {session.status === 'done' ? (
            <button
              type="button"
              data-agent-again
              onClick={() => retry(issue.id)}
              className="ml-auto flex h-[20px] items-center rounded-r4 px-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
            >
              {t('Regenerate')}
            </button>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <div
          data-agent-pending
          className="mt-1.5 rounded-r8 bg-[var(--bg-hover)] px-2.5 py-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_38%,transparent)]"
        >
          <div className="flex items-center gap-1.5 text-[13px] text-t3">
            <HelpCircle size={12} strokeWidth={1.9} />
            {t('Approval needed')}
            <span className="font-mono text-[12px] text-t4">{pending.name}</span>
          </div>
          <div className="mt-1 text-[14px] font-[510] text-t1">{pending.title}</div>
          {pending.rows.length ? (
            <div className="mt-1 flex flex-col gap-0.5">
              {pending.rows.map((row, index) => (
                <div key={`${row.field}-${index}`} className="flex items-center gap-1.5 text-[13px] text-t4">
                  <span className="w-[64px] shrink-0">{t(FIELD_LABEL[row.field] ?? row.field)}</span>
                  {row.from ? <span className="line-through opacity-60">{valueLabel({ ...row, to: row.from })}</span> : null}
                  {row.from ? <span>→</span> : null}
                  <span className="text-t2">{valueLabel(row)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {pending.note ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] leading-[1.5] text-t3">{pending.note}</p>
          ) : null}
          <div className="mt-2 flex items-center gap-1.5">
            <Button variant="primary" size="sm" onClick={() => approve(issue.id)}>
              {t('Approve')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => reject(issue.id)}>
              {t('Reject')}
            </Button>
          </div>
        </div>
      ) : null}

      {configured ? (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            data-agent-input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isImeComposing(event)) {
                event.preventDefault();
                submit();
              }
            }}
            disabled={running || waiting}
            placeholder={t('Ask the agent to change this issue…')}
            className="h-[40px] min-w-0 flex-1 rounded-r6 bg-[var(--bg-hover)] px-2.5 text-[14px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-t4 focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)] disabled:opacity-60"
          />
          {running || waiting ? (
            <Button variant="secondary" size="sm" onClick={() => cancel(issue.id)}>
              <Square size={11} strokeWidth={2.4} />
              {t('Stop')}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={submit} disabled={!value.trim()}>
              {t('Run')}
            </Button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => router.push('/settings/agents')}
          className={cn(
            'mt-1.5 flex h-[40px] w-full items-center gap-2 rounded-r6 px-2.5 text-left text-[13.5px] text-t4',
            'shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t2',
          )}
        >
          <Sparkles size={12} strokeWidth={1.9} />
          {t('Set up a model to enable the agent')}
          <span className="text-t4">→</span>
        </button>
      )}
    </div>
  );
}

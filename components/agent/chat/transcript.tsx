'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitFork,
  Globe,
  ListPlus,
  Paperclip,
  Pencil,
  Scissors,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Workflow,
  X,
} from 'lucide-react';
import { useT } from '@/lib/use-t';
import { sourceHref, sourceKey, sourceLabel } from '@/lib/agent/citations';
import { cn } from '@/lib/utils';
import { Markdown } from '@/components/issue/markdown';
import { LogRow } from '@/components/agent/agent-panel';
import { toPlainText } from '@/lib/agent/text';
import type { AgentAttachment, AgentLogEntry, AgentUsage } from '@/lib/agent/types';
import type { CompactionReport } from '@/lib/agent/compact';
import type { RetryStatus } from '@/lib/agent/tool-retry';

export function ContextMeter({
  used,
  total,
  usage,
  compaction,
}: {
  used: number;
  total: number;
  usage?: AgentUsage;
  /** the last time the transcript had to be cut, so the meter can explain it */
  compaction?: CompactionReport;
}) {
  const t = useT();
  const pct = total ? Math.min(1, used / total) : 0;
  const tone = pct > 0.85 ? 'var(--red)' : pct > 0.65 ? 'var(--orange)' : 'var(--accent)';
  const trimmed = compaction?.applied ? compaction : null;
  const title = [
    usage ? `prompt ${usage.promptTokens} · completion ${usage.completionTokens}` : `${used} tokens`,
    usage ? `steps ${usage.steps} · tools ${usage.tools}` : '',
    `window ${total.toLocaleString()} · used ${used.toLocaleString()} (${total ? `${((used / total) * 100).toFixed(2)}%` : '—'})`,
    trimmed
      ? `${t('{n} earlier turn(s) were trimmed ({tokens} tokens)', { n: trimmed.droppedTurns, tokens: trimmed.droppedTokens })}`
      : '',
    trimmed && trimmed.keptFrom ? `${t('The window opens at')}: ${trimmed.keptFrom}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span data-context-meter className="flex items-center gap-1.5" title={title}>
      <span className="h-[3px] w-[52px] overflow-hidden rounded-full bg-[var(--bg-selected)]">
        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(3, pct * 100)}%`, background: tone }} />
      </span>
      <span className="tnum text-[11.5px] text-t4">{total ? (pct < 0.005 ? '<1%' : `${Math.round(pct * 100)}%`) : '—'}</span>
      {trimmed ? (
        <span
          data-context-trimmed={trimmed.droppedTurns}
          className="flex items-center gap-0.5 text-[11px] text-t4"
          title={title}
        >
          <Scissors size={9} strokeWidth={2} />
          {trimmed.droppedTurns}
        </span>
      ) : null}
    </span>
  );
}

export function AttachmentChips({ files, onRemove }: { files: AgentAttachment[]; onRemove?: (id: string) => void }) {
  const t = useT();
  if (!files.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {files.map((file) => (
        <span
          key={file.id}
          className="flex max-w-[220px] items-center gap-1.5 rounded-r6 bg-[var(--bg-selected)] px-2 py-1 text-[12px] text-t3"
        >
          {file.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.dataUrl} alt="" className="h-[18px] w-[18px] rounded-[3px] object-cover" />
          ) : file.kind === 'web' ? (
            <Globe size={11} strokeWidth={1.9} />
          ) : (
            <Paperclip size={11} strokeWidth={1.9} />
          )}
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 text-t4">{file.kind === 'image' ? t('image') : t('text')}</span>
          {onRemove ? (
            <button type="button" onClick={() => onRemove(file.id)} aria-label={`${t('Remove')} ${file.name}`} className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-t4 hover:bg-[var(--bg-active)] hover:text-t1">
              <X size={11} strokeWidth={2} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** One assistant turn plus the tools it called, collapsible as a plan step. */
export function StepGroup({
  items,
  index,
  defaultOpen,
  onRetryTool,
  retryStatus,
}: {
  items: AgentLogEntry[];
  index: number;
  defaultOpen: boolean;
  /** replay one failed call in place; absent = no retry affordance */
  onRetryTool?: (item: AgentLogEntry) => void;
  retryStatus?: RetryStatus;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(defaultOpen);
  const tools = items.filter((item) => item.kind === 'tool');
  const answer = items.find((item) => item.kind === 'assistant')?.text ?? '';
  const failed = tools.some((item) => item.ok === false);

  return (
    <div className="mt-2 rounded-r8 bg-[var(--bg-hover)] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-r8 px-2.5 py-1.5 text-left text-[12px] text-t3 transition-colors hover:bg-[var(--bg-selected)]"
      >
        <span className={cn('font-[510]', failed ? 'text-[var(--red)]' : 'text-t2')}>
          {t('Step {n}', { n: index })}
        </span>
        <span className="text-t4">{t('{n} tools', { n: tools.length })}</span>
        <span className="min-w-0 flex-1 truncate text-t4">{answer.replace(/\s+/g, ' ').slice(0, 80)}</span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={cn('shrink-0 text-t4 transition-transform duration-150', open ? 'rotate-180' : '')}
        />
      </button>
      {open ? (
        <div className="px-2.5 pb-1.5">
          {items.map((item) => (
            <LogRow key={item.id} item={item} onRetry={onRetryTool} retryStatus={retryStatus} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A user turn with its attachments, and the two actions worth having on it. */
export function UserBubble({ item, onEdit, onBranch }: { item: AgentLogEntry; onEdit: () => void; onBranch: () => void }) {
  const t = useT();
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(toPlainText(item.text)).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="group mt-5 flex flex-col items-end gap-1.5 first:mt-0" data-agent-user>
      {item.attachments?.length ? (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
          {item.attachments.map((file) => (
            <span
              key={file.id}
              className="flex items-center gap-1.5 rounded-r6 bg-[var(--bg-selected)] px-2 py-1 text-[12px] text-t3"
            >
              {file.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={file.dataUrl} alt="" className="h-[22px] w-[22px] rounded-[3px] object-cover" />
              ) : file.kind === 'web' ? (
                <Globe size={11} strokeWidth={1.9} />
              ) : (
                <Paperclip size={11} strokeWidth={1.9} />
              )}
              <span className="max-w-[200px] truncate">{file.name}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="max-w-[82%] whitespace-pre-wrap rounded-[14px] rounded-br-[5px] bg-[var(--bg-selected)] px-3.5 py-2 text-[13.5px] leading-[1.6] text-t1">
        {item.text}
      </div>
      <div className="flex items-center gap-1 opacity-40 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={copy}
          className="flex h-[22px] items-center gap-1 rounded-r5 px-1.5 text-[11.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
        >
          {copied ? <Check size={10} strokeWidth={2.2} /> : <Copy size={10} strokeWidth={1.9} />}
          {copied ? t('Copied') : t('Copy')}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-[22px] items-center gap-1 rounded-r5 px-1.5 text-[11.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
        >
          <Pencil size={10} strokeWidth={1.9} />
          {t('Edit and resend')}
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(`/workflows?new=1&prompt=${encodeURIComponent(item.text)}`)
          }
          className="flex h-[22px] items-center gap-1 rounded-r5 px-1.5 text-[11.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
        >
          <Workflow size={10} strokeWidth={1.9} />
          {t('Save as workflow')}
        </button>
        <button type="button" onClick={onBranch} title={t('Branch from here')} className="flex h-[22px] items-center gap-1 rounded-r5 px-1.5 text-[11.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1">
          <GitFork size={10} strokeWidth={1.9} />
          {t('Branch')}
        </button>
      </div>
    </div>
  );
}

export function FinalAnswer({
  item,
  onIssue,
  onKnowledge,
  onIssueLink,
  onFeedback,
  onDocument,
}: {
  item: AgentLogEntry;
  onIssue: () => void;
  onKnowledge: () => void;
  onIssueLink: (issueKey: string) => void;
  onFeedback: (value: 'up' | 'down' | null) => void;
  onDocument: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const [copiedMd, setCopiedMd] = React.useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(toPlainText(item.text)).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(item.text).catch(() => undefined);
    setCopiedMd(true);
    window.setTimeout(() => setCopiedMd(false), 1400);
  };
  return (
    <div className="group mt-2" data-agent-final>
      <div className="flex items-start gap-2.5">
        <span className="mt-[3px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[var(--bg-accent-subtle)] text-[var(--accent)]">
          <Sparkles size={11} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1 pt-[1px]">
          <Markdown text={item.text} className="prose-compact" onIssue={onIssueLink} />
          {Array.isArray(item.sources) && item.sources.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" data-citations>
              <span className="text-[11px] text-t4">{t('Sources')}</span>
              {item.sources.map((source) => {
                const href = sourceHref(source);
                if (!href) return null;
                return (
                  <a
                    key={sourceKey(source)}
                    href={href}
                    data-citation={source.kind}
                    title={source.title}
                    {...(source.kind === 'web' ? { target: '_blank', rel: 'noreferrer' } : {})}
                    className="max-w-[220px] truncate rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[11.5px] text-t3 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
                  >
                    {sourceLabel(source)}
                  </a>
                );
              })}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-1 opacity-60 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={copy}
              className="flex h-[24px] items-center gap-1 rounded-r5 px-1.5 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              {copied ? <Check size={11} strokeWidth={2.2} /> : <Copy size={11} strokeWidth={1.9} />}
              {copied ? t('Copied') : t('Copy')}
            </button>
            <button
              type="button"
              onClick={copyMarkdown}
              title={t('Copy Markdown')}
              className="flex h-[24px] items-center gap-1 rounded-r5 px-1.5 text-[11px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              {copiedMd ? <Check size={11} strokeWidth={2.2} /> : <span className="font-mono">MD</span>}
            </button>
            <button
              type="button"
              onClick={onIssue}
              className="flex h-[24px] items-center gap-1 rounded-r5 px-1.5 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              <ListPlus size={11} strokeWidth={1.9} />
              {t('Create issue')}
            </button>
            <button
              type="button"
              onClick={onKnowledge}
              className="flex h-[24px] items-center gap-1 rounded-r5 px-1.5 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              <BookOpen size={11} strokeWidth={1.9} />
              {t('Save to knowledge')}
            </button>
            <span className="mx-0.5 h-3.5 w-px bg-[var(--line-subtle)]" />
            <button
              type="button"
              data-save-document
              onClick={onDocument}
              className="flex h-[24px] items-center gap-1 rounded-r5 px-1.5 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              <FileText size={11} strokeWidth={1.9} />
              {t('Save as document')}
            </button>
            <button
              type="button"
              data-feedback="up"
              aria-pressed={item.feedback === 'up'}
              title={t('Good answer')}
              onClick={() => onFeedback(item.feedback === 'up' ? null : 'up')}
              className={cn(
                'grid h-[24px] w-[24px] place-items-center rounded-r5 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1',
                item.feedback === 'up' ? 'bg-[var(--bg-accent-subtle)] text-[var(--accent)]' : 'text-t4',
              )}
            >
              <ThumbsUp size={11} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              data-feedback="down"
              aria-pressed={item.feedback === 'down'}
              title={t('Needs work')}
              onClick={() => onFeedback(item.feedback === 'down' ? null : 'down')}
              className={cn(
                'grid h-[24px] w-[24px] place-items-center rounded-r5 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1',
                item.feedback === 'down' ? 'bg-[var(--bg-hover)] text-t1' : 'text-t4',
              )}
            >
              <ThumbsDown size={11} strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

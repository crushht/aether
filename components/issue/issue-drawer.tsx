'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bold,
  Code2,
  CornerUpLeft,
  Italic,
  Link2,
  List,
  ListChecks,
  MoreHorizontal,
  Network,
  Plus,
  Star,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  FilePlus2,
  GitBranch,
  GitMerge,
  Paperclip,
  Sparkles,
  X,
} from 'lucide-react';
import { useView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { useIsMobile } from '@/lib/use-media';
import { useT } from '@/lib/use-t';
import { selectVisibleIssues } from '@/lib/selectors';
import { STATUSES, PRIORITIES, type Issue, type RelationType } from '@/lib/types';
import { agentUser } from '@/lib/mock-data';
import { peopleNow, usePeople } from '@/lib/people';
import { cn, relativeTime, shortDate, isImeComposing } from '@/lib/utils';
import { Avatar, Button, IconButton, Kbd } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from '@/components/ui/popover';
import { StatusIcon } from '@/components/ui/icons';
import { IssueProperties } from './issue-properties';
import { DependencyGraph } from './dependency-graph';
import { AgentPanel } from '@/components/agent/agent-panel';
import { Markdown } from './markdown';
import { editableHtmlToMarkdown, markdownToEditableHtml } from '@/lib/markdown-editable';
import { readAttachmentFile, type AttachmentResult } from '@/lib/attachments';
import { AttachmentsSection } from './attachments-section';
import { CommentsSection, CommentComposer } from './comments-section';
import { useIssueTemplates } from '@/lib/store/issue-templates';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

function statusColor(status: Issue['status']) {
  if (status === 'in_progress') return 'var(--status-progress)';
  if (status === 'in_review') return 'var(--status-review)';
  if (status === 'done') return 'var(--status-done)';
  if (status === 'canceled' || status === 'duplicate') return 'var(--status-canceled)';
  return 'var(--status-todo)';
}

/* ------------------------------------------------------------------ */

function AutoTextarea({
  value,
  onChange,
  onSave,
  onKeyDown,
  className,
  placeholder,
  autoFocus,
  minRows = 1,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  minRows?: number;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className'>) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  React.useEffect(() => {
    if (autoFocus && ref.current) {
      const el = ref.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSave && !isImeComposing(e)) {
          e.preventDefault();
          onSave();
          return;
        }
        onKeyDown?.(e);
      }}
      className={cn('w-full resize-none bg-transparent outline-none', className)}
      spellCheck={false}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ */

export function IssueDrawer() {
  const { userById, meId } = usePeople();
  const activeId = useView((s) => s.activeIssueId);
  const closeIssue = useView((s) => s.closeIssue);
  const openIssue = useView((s) => s.openIssue);
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const pushToast = useUI((s) => s.pushToast);
  const isMobile = useIsMobile();
  const t = useT();
  const drawerRef = React.useRef<HTMLDivElement>(null);

  // The drawer is a modal surface: give it focus on open and keep Tab inside.
  React.useEffect(() => {
    if (!activeId) return;
    const timer = window.setTimeout(() => drawerRef.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [activeId]);

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
  };

  const issues = useData((s) => s.issues);
  const data = useData();
  const { tab, filters, sort, scope } = useView();
  const ordered = React.useMemo(
    () => selectVisibleIssues({ issues, tab, filters, sort, scope }),
    [issues, tab, filters, sort, scope],
  );

  const issue = issues.find((i) => i.id === activeId);
  const parent = issue?.parentId ? issues.find((i) => i.id === issue.parentId) : null;
  const index = issue ? ordered.findIndex((i) => i.id === issue.id) : -1;

  if (typeof document === 'undefined') return null;

  return (
    <AnimatePresence>
      {issue ? (
        <motion.div
          key="issue-overlay"
          className="fixed inset-0 z-[700]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14, delay: 0.04 } }}
          transition={{ duration: 0.16 }}
          style={{ left: isMobile ? 0 : collapsed ? 0 : 232 }}
        >
          <div
            className="absolute inset-0 bg-[rgba(8,9,10,.5)] backdrop-blur-[1px]"
            onClick={() => closeIssue()}
            aria-hidden
          />
          <motion.div
            initial={{ x: 28, opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0, transition: { duration: 0.14 } }}
            transition={{ duration: 0.24, ease: EASE }}
            className="absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden border-l border-[var(--line)] bg-panel shadow-[-24px_0_60px_rgba(0,0,0,.35)] outline-none"
            role="dialog"
            aria-modal="true"
            aria-label={issue.title}
            ref={drawerRef}
            tabIndex={-1}
            onKeyDown={trapTab}
          >
            <DrawerHeader
              issue={issue}
              index={index}
              total={ordered.length}
              onClose={closeIssue}
              onPrev={() => {
                if (index > 0) openIssue(ordered[index - 1].id);
              }}
              onNext={() => {
                if (index >= 0 && index < ordered.length - 1) openIssue(ordered[index + 1].id);
              }}
              onDelete={() => {
                data.deleteIssues([issue.id]);
                closeIssue();
                pushToast({ title: t('Issue deleted'), description: issue.key, tone: 'danger' });
              }}
            />

            <div id="issue-scroll" className="scroll-container flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto flex w-full max-w-[1120px] gap-8 px-4 pb-24 pt-4 sm:px-6 sm:pt-5 lg:gap-14 lg:px-14">
                <div className="min-w-0 flex-1 pt-1">
                  {parent ? (
                    <button
                      type="button"
                      onClick={() => openIssue(parent.id)}
                      className="mb-1 flex max-w-full items-center gap-1.5 rounded-r4 pr-1 text-left text-[13px] text-t4 transition-colors hover:text-t2"
                    >
                      <CornerUpLeft size={12} strokeWidth={1.8} className="shrink-0" />
                      <span className="shrink-0">{t('Parent')}</span>
                      <span className="tnum shrink-0">{parent.key}</span>
                      <span className="truncate">{parent.title}</span>
                    </button>
                  ) : null}
                  <IssueTitle issue={issue} />
                  {/* phones lose the right rail, so the properties become a chip row */}
                  <div className="mt-1.5 lg:hidden">
                    <IssueProperties issue={issue} layout="chips" />
                  </div>
                  <IssueDescription issue={issue} />
                  <AttachmentsSection issue={issue} />
                  <SubIssues issue={issue} />
                  <Relations issue={issue} />
                  <AgentPanel issue={issue} />
                  <div className="mt-8">
                    <ActivityFeed issue={issue} />
                  </div>
                  <div className="mt-6">
                    <CommentsSection issue={issue} />
                  </div>
                  <CommentComposer issue={issue} />
                  <div className="mt-6 flex items-center gap-2 text-[13px] text-t4">
                    <Avatar name={userById.get(meId)?.name ?? t('Me')} color={userById.get(meId)?.color ?? '#5E6AD2'} size="xs" />
                    <span>
                      {userById.get(issue.creatorId)?.name ?? userById.get(meId)?.name ?? t('Me')} {t('created this issue')} ·{' '}
                      {shortDate(issue.createdAt)}
                    </span>
                  </div>
                </div>

                <aside className="hidden w-[286px] shrink-0 lg:block">
                  <div className="sticky top-2">
                    <IssueProperties issue={issue} />
                  </div>
                </aside>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */

function ActionPill({
  label,
  onClick,
  children,
  buttonRef,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Tooltip label={label}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        aria-label={label}
        className="grid h-[30px] w-[28px] place-items-center rounded-full bg-[var(--bg-hover)] text-t3 shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--bg-selected)] hover:text-t1"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */

function DrawerHeader({
  issue,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onDelete,
}: {
  issue: Issue;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDelete: () => void;
}) {
  const data = useData();
  const pushToast = useUI((s) => s.pushToast);
  const t = useT();
  const [statusOpen, setStatusOpen] = React.useState(false);
  const statusRef = React.useRef<HTMLButtonElement>(null);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [moreOpen, setMoreOpen] = React.useState(false);

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    let added = 0;
    for (const file of Array.from(files).slice(0, 5)) {
      const result = await readAttachmentFile(file);
      if (!result.draft) {
        const message =
          result.error === 'too-large'
            ? t('That file is too large to keep in the workspace')
            : result.error === 'unsupported'
              ? t('Only images and text files can be attached')
              : t('Could not read {name}', { name: file.name });
        pushToast({ title: message, description: file.name, tone: 'danger' });
        continue;
      }
      if (data.addAttachment(issue.id, result.draft)) added += 1;
      else pushToast({ title: t('Attachments are full (10 per issue)'), tone: 'danger' });
    }
    if (added) pushToast({ title: t('Added {n} attachment(s)', { n: added }), tone: 'success' });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-[var(--line-subtle)] px-3">
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          ref={statusRef}
          type="button"
          onClick={() => setStatusOpen((v) => !v)}
          className="flex h-[30px] items-center gap-2 rounded-r6 px-2 transition-colors duration-100 hover:bg-[var(--bg-active)]"
        >
          <StatusIcon status={issue.status} size={14} style={{ color: statusColor(issue.status) }} />
          <span className="tnum text-[13.5px] font-[510] text-t4">{issue.key}</span>
        </button>
        <span className="max-w-[46vw] truncate text-[13.5px] font-[510] text-t2 sm:max-w-[42vw]">{issue.title}</span>
        <Tooltip label={issue.starred ? t('Remove from favorites') : t('Add to favorites')}>
          <IconButton
            aria-label="Star issue"
            size={26}
            onClick={() => data.starIssue(issue.id)}
            className={cn(issue.starred ? 'text-[#e2b203]' : 'text-t4')}
          >
            <Star size={14} strokeWidth={1.8} fill={issue.starred ? 'currentColor' : 'none'} />
          </IconButton>
        </Tooltip>
        <IconButton ref={moreRef} aria-label="More actions" size={26} onClick={() => setMoreOpen((v) => !v)} className="text-t4">
          <MoreHorizontal size={15} strokeWidth={1.8} />
        </IconButton>
      </div>

      <div className="flex items-center gap-1">
        <div className="mr-1.5 hidden items-center gap-1.5 sm:flex">
          <ActionPill
            label={t('Attach files')}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={14} strokeWidth={1.7} />
          </ActionPill>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.markdown,.json,.csv,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.sql,.html,.css,.log,.xml"
            className="hidden"
            data-issue-attachment-input
            onChange={(event) => void attach(event.target.files)}
          />
          <ActionPill
            label={t('Copy branch name')}
            onClick={() => {
              const branch = `${issue.key.toLowerCase()}-${issue.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 42)}`;
              navigator.clipboard?.writeText(branch);
              pushToast({ title: t('Branch name copied'), description: branch });
            }}
          >
            <GitBranch size={14} strokeWidth={1.7} />
          </ActionPill>
          <ActionPill
            label={t('Create pull request')}
            onClick={() => pushToast({ title: t('No pull request linked yet'), description: t('Connect a repository to enable this') })}
          >
            <GitMerge size={14} strokeWidth={1.7} />
          </ActionPill>
        </div>
        <span className="tnum hidden select-none pr-1 text-[13px] text-t4 sm:inline">
          {index + 1} / {total}
        </span>
        <IconButton aria-label="Previous issue" size={28} onClick={onPrev} className="hidden text-t4 sm:grid" disabled={index <= 0}>
          <ChevronUp size={14} strokeWidth={2} />
        </IconButton>
        <IconButton aria-label={t('Next issue')} size={28} onClick={onNext} className="hidden text-t4 sm:grid" disabled={index < 0 || index >= total - 1}>
          <ChevronDown size={14} strokeWidth={2} />
        </IconButton>
        <div className="mx-1 hidden h-4 w-px bg-[var(--bg-selected)] sm:block" />
        <Tooltip label="Close" shortcut="esc">
          <IconButton aria-label="Close issue" size={28} onClick={onClose} className="text-t4">
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none">
              <path d="M3.6 3.6l6.8 6.8M10.4 3.6l-6.8 6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </IconButton>
        </Tooltip>
      </div>

      <Popover open={statusOpen} onClose={() => setStatusOpen(false)} anchorRef={statusRef} width={230}>
        <MenuLabel>{t('Status')}</MenuLabel>
        {STATUSES.map((s) => (
          <MenuItem
            key={s.key}
            icon={<StatusIcon status={s.key} size={14} style={{ color: statusColor(s.key) }} />}
            label={t(s.label)}
            checked={issue.status === s.key}
            onSelect={() => {
              data.setStatus(issue.id, s.key);
              setStatusOpen(false);
            }}
          />
        ))}
      </Popover>

      <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} width={220} align="start">
        <MenuItem
          icon={<Link2 size={13} strokeWidth={1.7} />}
          label={t('Copy issue link')}
          onSelect={() => {
            navigator.clipboard?.writeText(`${window.location.origin}/team/ENG?issue=${issue.key}`);
            setMoreOpen(false);
          }}
        />
        <MenuItem
          icon={<Star size={13} strokeWidth={1.7} />}
          label={issue.starred ? t('Remove from favorites') : t('Add to favorites')}
          onSelect={() => {
            data.starIssue(issue.id);
            setMoreOpen(false);
          }}
        />
        <MenuItem
          icon={<FilePlus2 size={13} strokeWidth={1.7} />}
          label={t('Save as template')}
          onSelect={() => {
            const template = useIssueTemplates.getState().saveFromIssue(issue);
            setMoreOpen(false);
            pushToast({
              title: template ? t('Template saved') : t('Could not save the template'),
              description: template?.name,
              tone: template ? 'success' : 'danger',
            });
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 size={13} strokeWidth={1.7} />}
          label={t('Delete issue')}
          danger
          onSelect={() => {
            setMoreOpen(false);
            onDelete();
          }}
        />
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IssueTitle({ issue }: { issue: Issue }) {
  const patch = useData((s) => s.patchIssue);
  const t = useT();
  const [value, setValue] = React.useState(issue.title);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => setValue(issue.title), [issue.id, issue.title]);

  const save = () => {
    if (value.trim() && value !== issue.title) {
      patch(issue.id, { title: value.trim() });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    }
  };

  return (
    <div className="group flex items-start gap-2">
      <AutoTextarea
        value={value}
        onChange={setValue}
        onSave={save}
        onBlur={save}
        placeholder={t('Issue title')}
        className="text-title3 font-[590] leading-[32px] text-t1 placeholder:text-t4 max-sm:text-[28px] max-sm:leading-[33px]"
      />
      {saved ? (
        <span className="mt-2 flex items-center gap-1 text-[12.5px] text-t4">
          <Check size={12} /> {t('Saved')}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IssueDescription({ issue }: { issue: Issue }) {
  const patch = useData((s) => s.patchIssue);
  const addAttachment = useData((s) => s.addAttachment);
  const pushToast = useUI((s) => s.pushToast);
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const [selBox, setSelBox] = React.useState<{ top: number; left: number } | null>(null);

  // switching to another issue leaves edit mode — a description that changed
  // underneath us (another tab, or the agent) must not discard what is typed
  React.useEffect(() => {
    setEditing(false);
  }, [issue.id]);

  // seed the editable only when entering edit mode: React must not re-render it
  React.useLayoutEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = markdownToEditableHtml(issue.description);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Refill only when the editor opens or the issue changes; live description
    // edits would otherwise reset the caret while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, issue.id]);

  const save = () => {
    const el = editorRef.current;
    patch(issue.id, { description: el ? editableHtmlToMarkdown(el.innerHTML) : issue.description });
    setEditing(false);
  };

  /** read view: flip one `- [ ]` / `- [x]` line in the stored markdown */
  const toggleTask = (line: number) => {
    const lines = issue.description.replace(/\r\n/g, '\n').split('\n');
    const source = lines[line];
    if (!source) return;
    const next = source.replace(
      /^(\s*(?:[-*]|\d+\.)\s+\[)([ xX])(\])/,
      (_m, open: string, mark: string, close: string) => `${open}${mark.toLowerCase() === 'x' ? ' ' : 'x'}${close}`,
    );
    if (next === source) return;
    lines[line] = next;
    patch(issue.id, { description: lines.join('\n') });
  };

  const onInput = () => {
    const el = editorRef.current;
    if (!el) return;
    // keep the :empty placeholder working after the user clears everything
    if (!el.textContent?.trim() && el.querySelectorAll('a, code, strong, em').length === 0) {
      if (el.innerHTML !== '') el.innerHTML = '';
    }
  };

  const updateSelectionBox = () => {
    const sel = window.getSelection();
    if (!editing || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelBox(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setSelBox(null);
      return;
    }
    setSelBox({
      top: Math.max(8, rect.top - 40),
      left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 190)),
    });
  };

  const wrapCode = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const code = document.createElement('code');
    code.appendChild(range.extractContents());
    range.insertNode(code);
    const after = document.createRange();
    after.selectNodeContents(code);
    after.collapse(false);
    sel.removeAllRanges();
    sel.addRange(after);
  };

  const insertLink = () => {
    editorRef.current?.focus();
    // link stays textual until saved, so the URL is still editable inline
    const text = window.getSelection()?.toString() ?? '';
    document.execCommand('insertText', false, `[${text}](url)`);
  };

  const applyPrefix = (prefix: string) => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const start = sel.getRangeAt(0).startContainer;
    let block: HTMLElement | null =
      start.nodeType === Node.ELEMENT_NODE ? (start as HTMLElement) : start.parentElement;
    while (block && !['DIV', 'P', 'LI', 'BODY'].includes(block.tagName)) block = block.parentElement;
    const at = document.createRange();
    if (block && block.tagName !== 'BODY') {
      at.setStart(block, 0);
    } else {
      at.selectNodeContents(editorRef.current!);
      at.collapse(true);
    }
    at.collapse(true);
    sel.removeAllRanges();
    sel.addRange(at);
    document.execCommand('insertText', false, prefix);
  };

  const runCommand = (key: 'b' | 'i' | 'e') => {
    editorRef.current?.focus();
    if (key === 'b') document.execCommand('bold');
    else if (key === 'i') document.execCommand('italic');
    else wrapCode();
    requestAnimationFrame(updateSelectionBox);
  };

  if (!editing) {
    if (!issue.description.trim()) {
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 w-full rounded-r6 border border-dashed border-[var(--line)] px-3 py-2.5 text-left text-small text-t4 transition-colors duration-100 hover:border-[var(--line-strong)] hover:text-t3"
        >
          {t('Add a description…')}
        </button>
      );
    }
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          // the checklist boxes live inside this wrapper; Enter belongs to them
          if (e.key === 'Enter' && e.target === e.currentTarget) setEditing(true);
        }}
        className="-mx-2 mt-3 cursor-text rounded-r6 px-2 py-1 transition-colors duration-100 hover:bg-[var(--bg-hover)]"
      >
        <Markdown
          text={issue.description}
          onToggleTask={toggleTask}
          taskLabel={t('Toggle checklist item')}
        />
      </div>    );
  }

  return (
    <div className="mt-3">
      <div className="overflow-hidden rounded-r8 bg-[var(--bg-hover)] shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]">
        <div
          ref={editorRef}
          id="desc-editor"
          role="textbox"
          aria-multiline="true"
          aria-label={t('Description')}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={t('Write a description, add a plan, or paste a link…')}
          onInput={onInput}
          onMouseUp={updateSelectionBox}
          onKeyUp={updateSelectionBox}
          onBlur={() => setSelBox(null)}
          onPaste={(e) => {
            const images = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'));
            if (images.length) {
              e.preventDefault();
              void (async () => {
                let added = 0;
                let failure: AttachmentResult['error'] | undefined;
                for (const file of images.slice(0, 3)) {
                  const result = await readAttachmentFile(file);
                  if (result.draft && addAttachment(issue.id, result.draft)) added += 1;
                  else failure = result.error;
                }
                pushToast({
                  title: added ? t('Pasted image added as an attachment') : t('Could not attach the pasted image'),
                  description:
                    added || !failure
                      ? added
                        ? t('Open Attachments to preview it.')
                        : undefined
                      : failure === 'too-large'
                        ? t('Image is too large (max 1.5 MB)')
                        : t('That file type is not supported'),
                  tone: added ? 'success' : 'danger',
                });
              })();
              return;
            }
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
          }}
          onKeyDown={(e) => {
            const mod = e.metaKey || e.ctrlKey;
            if (!mod) return;
            if (e.key === 'Enter') {
              if (isImeComposing(e)) return;
              e.preventDefault();
              save();
              return;
            }
            const k = e.key.toLowerCase();
            if (k === 'b') {
              e.preventDefault();
              runCommand('b');
            } else if (k === 'i') {
              e.preventDefault();
              runCommand('i');
            } else if (k === 'e') {
              e.preventDefault();
              runCommand('e');
            }
          }}
          className="desc-editor min-h-[110px] px-3 py-2.5 text-reg text-t2 outline-none"
        />
        <div className="flex items-center justify-between border-t border-[var(--line-subtle)] px-2 py-1.5">
          <span className="flex items-center gap-1.5 pl-1 text-[12px] text-t4">
            <span className="hidden sm:inline">Markdown</span>
            <span className="hidden h-3 w-px bg-[var(--bg-selected)] sm:inline" />
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
            <span className="hidden sm:inline">{t('to save')}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              {t('Save')}
            </Button>
          </div>
        </div>
      </div>

      {selBox ? (
        <div
          style={{ position: 'fixed', top: selBox.top, left: selBox.left, zIndex: 900 }}
          className="flex h-[30px] items-center gap-0.5 rounded-r6 bg-[var(--bg-float)] px-1 shadow-menu animate-pop-in"
        >
          {[
            { icon: <Bold size={13} strokeWidth={2.1} />, label: t('Bold'), run: () => runCommand('b'), key: 'B' },
            { icon: <Italic size={13} strokeWidth={2.1} />, label: t('Italic'), run: () => runCommand('i'), key: 'I' },
            { icon: <Code2 size={13} strokeWidth={2.1} />, label: t('Code'), run: () => runCommand('e'), key: 'E' },
            { icon: <Link2 size={13} strokeWidth={2.1} />, label: t('Link'), run: insertLink },
            { icon: <List size={13} strokeWidth={2.1} />, label: t('Bulleted list'), run: () => applyPrefix('- ') },
            { icon: <ListChecks size={13} strokeWidth={2.1} />, label: t('Checklist'), run: () => applyPrefix('- [ ] ') },
          ].map((tool) => (
            <button
              key={tool.label}
              type="button"
              aria-label={tool.label}
              title={tool.key ? `${tool.label} ⌘${tool.key}` : tool.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={tool.run}
              className="grid h-[22px] w-[24px] place-items-center rounded-r4 text-t3 transition-colors duration-100 hover:bg-[var(--bg-selected)] hover:text-t1"
            >
              {tool.icon}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SubIssues({ issue }: { issue: Issue }) {
  const { userById } = usePeople();
  const issues = useData((s) => s.issues);
  const createIssue = useData((s) => s.createIssue);
  const openIssue = useView((s) => s.openIssue);
  const t = useT();
  const [adding, setAdding] = React.useState(false);
  const [value, setValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const children = issues.filter((i) => i.parentId === issue.id);
  const done = children.filter((c) => c.status === 'done').length;
  const pct = children.length ? Math.round((done / children.length) * 100) : 0;

  React.useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  React.useEffect(() => {
    setAdding(false);
    setValue('');
  }, [issue.id]);

  const commit = () => {
    const title = value.trim();
    if (!title) return;
    createIssue({ title, parentId: issue.id });
    setValue('');
    inputRef.current?.focus();
  };

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-[590] text-t1">{t('Sub-issues')}</h2>
        {children.length ? (
          <>
            <span className="tnum text-[13px] text-t4">
              {done} / {children.length}
            </span>
            <span className="h-[4px] w-[54px] overflow-hidden rounded-full bg-[var(--bg-selected)]">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
          </>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-[24px] items-center gap-1 rounded-r6 px-1.5 text-[13px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
        >
          <Plus size={12} strokeWidth={2} />
          {t('Add sub-issue')}
        </button>
      </div>

      {children.length ? (
        <div className="mt-1.5 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          {children.map((child, i) => {
            const assignee = child.assigneeId ? userById.get(child.assigneeId) : undefined;
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => openIssue(child.id)}
                className={cn(
                  'flex h-[40px] w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]',
                  i > 0 && 'border-t border-[var(--line-subtle)]',
                )}
              >
                <StatusIcon status={child.status} size={14} style={{ color: statusColor(child.status) }} />
                <span className="tnum w-[58px] shrink-0 text-[13px] text-t4">{child.key}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-t2">{child.title}</span>
                {assignee ? <Avatar name={assignee.name} color={assignee.color} size="xs" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {adding ? (
        <div className="mt-1.5 flex h-[40px] items-center gap-2 rounded-r6 px-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
          <Plus size={12} className="text-t4" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setAdding(false);
                setValue('');
              }
            }}
            onBlur={() => {
              if (!value.trim()) setAdding(false);
            }}
            placeholder={t('Sub-issue title')}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-t1 outline-none placeholder:text-t4"
          />
          <Kbd>↵</Kbd>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const RELATION_LABEL: Record<RelationType, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  related: 'Related to',
  duplicate: 'Duplicate of',
  duplicated_by: 'Duplicated by',
};

const RELATION_ORDER: RelationType[] = ['blocks', 'blocked_by', 'related', 'duplicate', 'duplicated_by'];
/** what the picker offers; `duplicated_by` only ever comes from the other side */
const RELATION_CHOICES: RelationType[] = ['blocked_by', 'blocks', 'related', 'duplicate'];

function Relations({ issue }: { issue: Issue }) {
  const issues = useData((s) => s.issues);
  const addRelation = useData((s) => s.addRelation);
  const removeRelation = useData((s) => s.removeRelation);
  const openIssue = useView((s) => s.openIssue);
  const t = useT();

  const [open, setOpen] = React.useState(false);
  const [showGraph, setShowGraph] = React.useState(false);
  const [step, setStep] = React.useState<'type' | 'issue'>('type');
  const [type, setType] = React.useState<RelationType>('blocked_by');
  const [query, setQuery] = React.useState('');
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const rows = React.useMemo(
    () =>
      [...(issue.relations ?? [])].sort(
        (a, b) => RELATION_ORDER.indexOf(a.type) - RELATION_ORDER.indexOf(b.type),
      ),
    [issue.relations],
  );
  // only blocking relations have a direction worth drawing
  const blocking = rows.some((rel) => rel.type === 'blocks' || rel.type === 'blocked_by');

  const candidates = React.useMemo(() => {
    const taken = new Set(rows.map((r) => r.issueId));
    const q = query.trim().toLowerCase();
    return issues
      .filter((i) => i.id !== issue.id && !taken.has(i.id))
      .filter((i) => !q || i.key.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [issues, rows, query, issue.id]);

  React.useEffect(() => {
    if (open && step === 'issue') inputRef.current?.focus();
  }, [open, step]);

  // a different issue means a fresh picker, and a fresh look at the map
  React.useEffect(() => {
    setOpen(false);
    setShowGraph(false);
    setStep('type');
    setQuery('');
  }, [issue.id]);

  const close = () => {
    setOpen(false);
    setStep('type');
    setQuery('');
  };

  const commit = (targetId: string) => {
    addRelation(issue.id, type, targetId);
    close();
  };

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-[590] text-t1">{t('Relations')}</h2>
        {rows.length ? <span className="tnum text-[13px] text-t4">{rows.length}</span> : null}
        <div className="flex-1" />
        {blocking ? (
          <button
            type="button"
            data-dep-toggle
            aria-pressed={showGraph}
            onClick={() => setShowGraph((value) => !value)}
            className="flex h-[24px] items-center gap-1 rounded-r6 px-1.5 text-[13px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
          >
            <Network size={12} strokeWidth={2} />
            {t('Map')}
          </button>
        ) : null}
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-[24px] items-center gap-1 rounded-r6 px-1.5 text-[13px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
        >
          <Plus size={12} strokeWidth={2} />
          {t('Add relation')}
        </button>
      </div>

      {showGraph ? <DependencyGraph issue={issue} /> : null}

      {rows.length ? (
        <div className="mt-1 flex flex-col">
          {rows.map((rel) => {
            const target = issues.find((i) => i.id === rel.issueId);
            if (!target) return null;
            return (
              <div
                key={`${rel.type}:${rel.issueId}`}
                data-relation={rel.type}
                className="group/rel flex h-[30px] items-center gap-2 rounded-r6 pr-1 transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="w-[88px] shrink-0 whitespace-nowrap pl-0.5 text-[13px] leading-none text-t4">
                  {t(RELATION_LABEL[rel.type])}
                </span>
                <button
                  type="button"
                  onClick={() => openIssue(target.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <StatusIcon status={target.status} size={14} style={{ color: statusColor(target.status) }} />
                  <span className="tnum shrink-0 text-[13px] text-t4">{target.key}</span>
                  <span className="truncate text-[14px] text-t2 transition-colors group-hover/rel:text-t1">
                    {target.title}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${t('Remove relation')} ${target.key}`}
                  onClick={() => removeRelation(issue.id, target.id)}
                  className="coarse-show grid h-5 w-5 shrink-0 place-items-center rounded-r4 text-t4 opacity-0 transition-[opacity,color,background-color] duration-100 hover:bg-[var(--bg-active)] hover:text-t2 group-hover/rel:opacity-100"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <Popover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        align="end"
        width={step === 'type' ? 208 : 320}
      >
        {step === 'type' ? (
          <>
            <MenuLabel>{t('Relation type')}</MenuLabel>
            {RELATION_CHOICES.map((choice) => (
              <MenuItem
                key={choice}
                label={t(RELATION_LABEL[choice])}
                onSelect={() => {
                  setType(choice);
                  setStep('issue');
                }}
              />
            ))}
          </>
        ) : (
          <div className="p-1">
            <div className="flex h-[30px] items-center gap-1.5 rounded-r6 px-2 shadow-[inset_0_0_0_1px_var(--line)]">
              <span className="shrink-0 text-[13px] text-t4">{t(RELATION_LABEL[type])}</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && candidates[0] && !isImeComposing(e)) {
                    e.preventDefault();
                    commit(candidates[0].id);
                  }
                }}
                placeholder={t('Link an issue…')}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-t1 outline-none placeholder:text-t4"
              />
            </div>
            <div className="mt-1 max-h-[248px] overflow-y-auto overscroll-contain">
              {candidates.length ? (
                candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => commit(candidate.id)}
                    className="flex h-[30px] w-full items-center gap-2 rounded-r6 px-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <span className="tnum w-[52px] shrink-0 text-[13px] text-t4">{candidate.key}</span>
                    <span className="truncate text-[14px] text-t2">{candidate.title}</span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-2 text-[13px] text-t4">{t('No issues found')}</div>
              )}
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const ACTIVITY_LABEL: Record<string, string> = {
  status: 'changed the status',
  assignee: 'assigned the issue',
  priority: 'changed priority',
  label: 'added labels',
  project: 'moved to project',
  cycle: 'added to cycle',
  comment: 'commented',
  estimate: 'set an estimate',
  attachment: 'attached a file',
  agent: 'ran an agent session',
};

function pretty(v: string | undefined, t: (key: string) => string) {
  if (!v) return '';
  const label = STATUSES.find((s) => s.key === v)?.label ?? PRIORITIES.find((p) => p.key === v)?.label ?? peopleNow().userById.get(v)?.name ?? v;
  return t(label);
}

function ActivityFeed({ issue }: { issue: Issue }) {
  const { userById } = usePeople();
  const t = useT();
  const [showAll, setShowAll] = React.useState(false);
  const rows = issue.activities.filter((a) => a.kind !== 'comment');
  if (!rows.length) return null;

  const hidden = rows.length > 8 && !showAll ? rows.length - 8 : 0;
  const visible = hidden ? rows.slice(-8) : rows;

  return (
    <div>
      <h2 className="mb-2 text-[14px] font-[590] text-t1">{t('Activity')}</h2>
      <div className="relative flex flex-col">
        <span className="absolute left-[7.5px] top-3 bottom-1 w-px bg-[var(--line-solid)] opacity-70" aria-hidden />
        {hidden ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="relative mb-1 ml-[22px] w-fit rounded-r4 px-1 text-left text-[12px] text-t3 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {t('Show {n} earlier updates', { n: hidden })}
          </button>
        ) : null}
        {visible.map((a) => {
          const actor = a.actorId === 'agent' ? agentUser : userById.get(a.actorId);
          return (
            <div key={a.id} className="relative flex items-center gap-2 py-[5px]">
              <span className="relative z-[1] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-panel">
                {a.kind === 'status' ? (
                  <StatusIcon status={(a.to as Issue['status']) ?? 'todo'} size={14} style={{ color: 'var(--status-progress)' }} />
                ) : a.actorId === 'agent' ? (
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-[color-mix(in_srgb,#B87CF0_24%,transparent)] text-[#d5b6ff]">
                    <Sparkles size={9} strokeWidth={2.2} />
                  </span>
                ) : (
                  <Avatar name={actor?.name ?? t('Me')} color={actor?.color ?? '#5E6AD2'} size="xs" />
                )}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-t4">
                <span className="font-[510] text-t3">{actor?.name ?? t('Me')}</span>
                <span>{a.kind === 'created' ? t('created the issue') : t(ACTIVITY_LABEL[a.kind] ?? a.kind)}</span>
                {a.from || a.to ? (
                  <span className="flex items-center gap-1">
                    {a.from ? <span className="rounded-[3px] bg-[var(--bg-active)] px-1">{pretty(a.from, t)}</span> : null}
                    {a.from && a.to ? <span className="text-t4">→</span> : null}
                    {a.to ? <span className="rounded-[3px] bg-[var(--bg-active)] px-1 text-t3">{pretty(a.to, t)}</span> : null}
                  </span>
                ) : null}
                <span className="text-t4">·</span>
                <span className="text-t4">{relativeTime(a.createdAt)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

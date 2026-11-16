'use client';

import * as React from 'react';
import { Paperclip, Pencil, Smile, Trash2, X } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { usePeople } from '@/lib/people';
import { useAgent } from '@/lib/agent/store';
import { Sparkles } from 'lucide-react';
import { agentUser } from '@/lib/mock-data';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn, relativeTime, isImeComposing } from '@/lib/utils';
import { Avatar, Button, IconButton, Kbd } from '@/components/ui/primitives';
import { Markdown } from './markdown';
import { readCommentDraft, writeCommentDraft, clearCommentDraft } from '@/lib/comment-drafts';
import { downloadTextFile } from '@/lib/download';
import { formatBytes, newAttachment, readAttachmentFile, type AttachmentDraft } from '@/lib/attachments';
import { AttachmentLightbox } from './attachment-lightbox';
import type { Issue, IssueAttachment } from '@/lib/types';

export function CommentsSection({ issue }: { issue: Issue }) {  const { userById, meId } = usePeople();
  const editComment = useData((s) => s.editComment);
  const deleteComment = useData((s) => s.deleteComment);
  const t = useT();
  const [showAll, setShowAll] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [lightbox, setLightbox] = React.useState<{ files: IssueAttachment[]; index: number } | null>(null);
  if (!issue.comments.length) return null;

  const openPreview = (file: IssueAttachment, attachments: IssueAttachment[]) => {
    const images = attachments.filter((item) => item.dataUrl && item.mime.startsWith('image/'));
    const index = Math.max(0, images.findIndex((item) => item.id === file.id));
    setLightbox({ files: images.length ? images : [file], index });
  };

  const hidden = issue.comments.length > 5 && !showAll ? issue.comments.length - 5 : 0;
  const comments = hidden ? issue.comments.slice(-5) : issue.comments;

  return (
    <div className="overflow-hidden rounded-r9 bg-[var(--bg-card)] shadow-[inset_0_0_0_1px_var(--line)]">
      {hidden ? (
        <div className="flex items-center gap-2 px-4 py-2">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded-r4 px-1 text-[12.5px] text-t3 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {t('Show {n} earlier comments', { n: hidden })}
          </button>
          <span className="h-px flex-1 bg-[var(--line-solid)] opacity-70" />
        </div>
      ) : null}
      {comments.map((c, i) => {
        const isAgent = c.authorId === 'agent';
        const author = isAgent ? agentUser : userById.get(c.authorId);
        const mine = c.authorId === meId;
        return (
          <div key={c.id} data-comment={c.id} data-agent-comment={isAgent ? 'true' : undefined}>
            {i > 0 || hidden ? <div className="h-px w-full bg-[var(--line-solid)] opacity-70" /> : null}
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                {isAgent ? (
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[color-mix(in_srgb,#B87CF0_22%,transparent)] text-[#d5b6ff]">
                    <Sparkles size={12} strokeWidth={2} />
                  </span>
                ) : (
                  <Avatar name={author?.name ?? 'Unknown'} color={author?.color ?? '#5E6AD2'} size="sm" />
                )}
                <span className="text-[14px] font-[510] text-t2">{author?.name ?? 'Unknown'}</span>
                {isAgent ? (
                  <span className="rounded-full bg-[color-mix(in_srgb,#B87CF0_18%,transparent)] px-1.5 text-[10.5px] leading-[16px] text-[#d5b6ff]">
                    {t('Agent')}
                  </span>
                ) : null}
                <span className="text-[13px] text-t4">·</span>
                <span className="text-[13px] text-t4">{relativeTime(c.createdAt)}</span>
                {mine ? (
                  <span className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      data-comment-edit
                      onClick={() => {
                        setEditingId(c.id);
                        setEditValue(c.body);
                      }}
                      className="flex h-[22px] items-center gap-1 rounded-r4 px-1.5 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                    >
                      <Pencil size={10} />
                      {t('Edit')}
                    </button>
                    <button
                      type="button"
                      data-comment-delete
                      aria-label={t('Delete comment')}
                      onClick={() => {
                        if (!window.confirm(t('Delete this comment?'))) return;
                        deleteComment(issue.id, c.id);
                      }}
                      className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 transition-colors hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                    >
                      <Trash2 size={10} />
                    </button>
                  </span>
                ) : null}
              </div>
              {editingId === c.id ? (
                <div className="mt-1.5 pl-6">
                  <textarea
                    autoFocus
                    data-comment-editor
                    value={editValue}
                    onChange={(event) => setEditValue(event.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-r6 bg-[var(--bg-hover)] px-2.5 py-2 text-[13.5px] leading-[1.6] text-t2 outline-none shadow-[inset_0_0_0_1px_var(--line)]"
                  />
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!editValue.trim()}
                      onClick={() => {
                        editComment(issue.id, c.id, editValue.trim());
                        setEditingId(null);
                      }}
                    >
                      {t('Save')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      {t('Cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 pl-6">
                  <Markdown text={c.body} className="prose-compact" />
                  {c.mentions?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1" data-comment-mentions>
                      {c.mentions.map((id) => {
                        const person = userById.get(id);
                        return person ? (
                          <span key={id} className="rounded-full bg-[var(--bg-accent-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">
                            @{person.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  ) : null}
                  {c.attachments?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5" data-comment-attachments>
                      {c.attachments.map((file) => (
                        <span key={file.id} className="flex max-w-[240px] items-center gap-1.5 rounded-r5 bg-[var(--bg-hover)] px-1.5 py-1 text-[12px] text-t3">
                          {file.dataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.dataUrl} alt="" className="h-[24px] w-[24px] rounded-[3px] object-cover" />
                          ) : (
                            <Paperclip size={10} className="shrink-0 text-t4" />
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (file.dataUrl && file.mime.startsWith('image/')) openPreview(file, c.attachments ?? []);
                              else if (file.text) downloadTextFile(file.name, file.text);
                              else if (file.dataUrl) window.open(file.dataUrl, '_blank');
                            }}
                            className="max-w-[160px] truncate hover:text-t1"
                          >
                            {file.name}
                          </button>
                          <span className="shrink-0 text-t4">{formatBytes(file.size)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {lightbox ? (
        <AttachmentLightbox
          files={lightbox.files}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(index) => setLightbox((current) => (current ? { ...current, index } : current))}
        />
      ) : null}
    </div>
  );
}

export function CommentComposer({ issue }: { issue: Issue }) {
  const { users, userById, meId } = usePeople();
  const addComment = useData((s) => s.addComment);
  const runAgent = useAgent((s) => s.run);
  const pushToast = useUI((s) => s.pushToast);
  const t = useT();
  const [value, setValue] = React.useState(() => readCommentDraft(issue.id));
  const [files, setFiles] = React.useState<AttachmentDraft[]>([]);
  const [focused, setFocused] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const me = userById.get(meId);
  const toAgent = /^@agent\b/i.test(value.trim());
  const [mention, setMention] = React.useState<{ start: number; query: string; index: number } | null>(null);
  const candidates = React.useMemo(() => {
    if (!mention) return [];
    const needle = mention.query.toLowerCase();
    return users
      .filter((user) => !needle || user.name.toLowerCase().includes(needle) || user.handle.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [mention, users]);

  // Recompute the mention token from the caret; called on typing, clicks and keys.
  const syncMention = () => {
    const el = ref.current;
    if (!el) return;
    const text = el.value;
    const before = text.slice(0, el.selectionStart ?? text.length);
    const match = /(^|[\s(])@([^\s@]{0,20})$/.exec(before);
    if (!match) {
      setMention(null);
      return;
    }
    setMention((current) => ({
      start: before.length - match[2].length - 1,
      query: match[2],
      index: Math.min(current?.index ?? 0, 5),
    }));
  };

  const insertMention = (userId: string) => {
    if (!mention) return;
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    const el = ref.current;
    const text = el?.value ?? value;
    const pos = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${user.handle} ${text.slice(pos)}`;
    setValue(next);
    setMention(null);
    window.requestAnimationFrame(() => {
      const at = mention.start + user.handle.length + 2;
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  };


  // A draft belongs to its issue: switching issues loads that issue's draft.
  React.useEffect(() => {
    setValue(readCommentDraft(issue.id));
    setFocused(false);
    setFiles([]);
  }, [issue.id]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => writeCommentDraft(issue.id, value), 250);
    return () => window.clearTimeout(timer);
  }, [issue.id, value]);

  const submit = () => {
    const body = value.trim();
    if (!body && !files.length) return;
    if (body && /^@agent\b/i.test(body)) {
      // an @agent comment is a prompt, not a comment: hand it to the session panel
      void runAgent(issue.id, body.replace(/^@agent\b[,\s]*/i, ''));
      setValue('');
      setFocused(false);
      setFiles([]);
      clearCommentDraft(issue.id);
      return;
    }
    const attachments = files.map((draft) => newAttachment(draft, meId));
    const mentioned = users.filter((user) => new RegExp(`(^|[\\s(])@${user.handle}\\b`, 'i').test(body));
    addComment(
      issue.id,
      meId,
      body || t('Attached files'),
      attachments.length ? attachments : undefined,
      mentioned.length ? mentioned.map((user) => user.id) : undefined,
    );
    if (mentioned.length) {
      useData.getState().pushNotification({
        issueId: issue.id,
        kind: 'mention',
        actorId: meId,
        count: mentioned.length,
      });
    }
    setValue('');
    setFocused(false);
    setFiles([]);
    setMention(null);
    clearCommentDraft(issue.id);
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    const next: AttachmentDraft[] = [];
    for (const file of Array.from(list).slice(0, 5)) {
      const result = await readAttachmentFile(file);
      if (result.draft) next.push(result.draft);
    }
    if (next.length) setFiles((current) => [...current, ...next].slice(0, 5));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div
      className={cn(
        'mt-6 flex gap-2.5 rounded-r9 bg-[var(--bg-card)] px-3 py-2.5 transition-shadow duration-160',
        focused ? 'shadow-[inset_0_0_0_1px_var(--line-strong)]' : 'shadow-[inset_0_0_0_1px_var(--line)]',
      )}
    >
      <Avatar name={me?.name ?? t('Me')} color={me?.color ?? '#5E6AD2'} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {files.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1.5" data-comment-attachment-drafts>
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="flex max-w-[220px] items-center gap-1.5 rounded-r5 bg-[var(--bg-hover)] px-1.5 py-1 text-[12px] text-t3">
                {file.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.dataUrl} alt="" className="h-[18px] w-[18px] rounded-[3px] object-cover" />
                ) : (
                  <Paperclip size={10} className="shrink-0 text-t4" />
                )}
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`${t('Remove attachment')} ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-t4 hover:bg-[var(--bg-active)] hover:text-t1"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {mention && candidates.length ? (
          <div
            data-mention-menu
            className="mb-1.5 overflow-hidden rounded-r6 bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-pop)]"
            onMouseDown={(event) => event.preventDefault()}
          >
            {candidates.map((user, index) => (
              <button
                key={user.id}
                type="button"
                data-mention-option={user.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(user.id)}
                className={cn(
                  'flex h-[28px] w-full items-center gap-2 rounded-r4 px-1.5 text-left text-[12.5px] transition-colors',
                  index === mention.index ? 'bg-[var(--bg-selected)] text-t1' : 'text-t2 hover:bg-[var(--bg-hover)]',
                )}
              >
                <Avatar name={user.name} color={user.color} size="xs" />
                <span className="min-w-0 flex-1 truncate">{user.name}</span>
                <span className="shrink-0 text-[11px] text-t4">@{user.handle}</span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={ref}
          value={value}
          rows={focused || value ? 3 : 1}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setValue(e.target.value);
            window.setTimeout(syncMention, 0);
          }}
          onKeyUp={syncMention}
          onClick={syncMention}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
            if (!images.length) return;
            event.preventDefault();
            void (async () => {
              const drafts: AttachmentDraft[] = [];
              for (const file of images.slice(0, 3)) {
                const result = await readAttachmentFile(file);
                if (result.draft) drafts.push(result.draft);
              }
              if (drafts.length) setFiles((previous) => [...previous, ...drafts]);
              pushToast({
                title: drafts.length ? t('Pasted image added to the comment') : t('Could not attach the pasted image'),
                tone: drafts.length ? 'success' : 'danger',
              });
            })();
          }}
          onKeyDown={(e) => {
            if (mention && candidates.length && !isImeComposing(e)) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMention((current) => (current ? { ...current, index: (current.index + 1) % candidates.length } : current));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMention((current) =>
                  current ? { ...current, index: (current.index - 1 + candidates.length) % candidates.length } : current,
                );
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(candidates[mention.index]?.id ?? candidates[0].id);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isImeComposing(e)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t('Leave a comment…')}
          className="w-full resize-none bg-transparent text-[14.5px] leading-[1.6] text-t2 outline-none placeholder:text-t4"
        />
        {toAgent ? (
          <div className="mt-1 text-[12.5px] text-[#9aa4ff]">
            {t('Starting with @agent sends this to the agent instead of posting a comment.')}
          </div>
        ) : null}
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <IconButton aria-label={t('Attach file')} size={24} className="text-t4" onClick={() => fileRef.current?.click()}>
              <Paperclip size={13} strokeWidth={1.8} />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.markdown,.json,.csv,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.sql,.html,.css,.log,.xml"
              className="hidden"
              data-comment-attachment-input
              onChange={(event) => void attach(event.target.files)}
            />
            <IconButton aria-label={t('Add emoji')} size={24} className="text-t4">
              <Smile size={13} strokeWidth={1.8} />
            </IconButton>
            <span className="ml-1 hidden items-center gap-1 text-[12px] text-t4 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
          </div>
          {value.trim() || files.length || focused ? (
            <Button variant="primary" size="sm" disabled={!value.trim() && !files.length} onClick={submit} className="h-[24px] px-2 text-[13px]">
              {t('Comment')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import { Check, ClipboardCopy, Download, Paperclip, Pencil, Send, ThumbsUp, Trash2 } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { usePeople } from '@/lib/people';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn, relativeTime } from '@/lib/utils';
import { Avatar, Button } from '@/components/ui/primitives';
import { Markdown } from '@/components/issue/markdown';
import { AttachmentLightbox } from '@/components/issue/attachment-lightbox';
import { formatBytes, newAttachment, readAttachmentFile, type AttachmentDraft } from '@/lib/attachments';
import type { IssueAttachment, Project, ProjectUpdate } from '@/lib/types';
import { HEALTH_COLOR, HEALTH_Y, healthSeries } from '@/lib/project-health';
import { auditFileName, auditToJson, auditToMarkdown } from '@/lib/project-audit-export';
import { summarizeReactions, dayKey, startOfWeek } from '@/lib/project-reactions-summary';
import { highlightSegments, matchSnippet } from '@/lib/highlight';
import { inAuditRange, type AuditRange } from '@/lib/audit-range';
import { weekFileName, weekToMarkdown, weeksFileName, weeksToMarkdown } from '@/lib/weekly-export';
import { downloadText } from '@/lib/agent/run-export';

const HEALTH = [
  { key: 'on_track', label: 'On track', color: 'var(--green)' },
  { key: 'at_risk', label: 'At risk', color: 'var(--orange)' },
  { key: 'off_track', label: 'Off track', color: 'var(--red)' },
] as const;

const AUDIT_ACTION_LABEL: Record<string, string> = {
  created: 'Created update',
  edited: 'Edited update',
  deleted: 'Deleted update',
  liked: 'Liked update',
  unliked: 'Unliked update',
  acknowledged: 'Acknowledged update',
  unacknowledged: 'Unacknowledged update',
};

export function ProjectUpdates({ project }: { project: Project }) {
  const t = useT();
  const { userById, meId } = usePeople();
  const pushToast = useUI((s) => s.pushToast);
  const addUpdate = useData((s) => s.addProjectUpdate);
  const deleteUpdate = useData((s) => s.deleteProjectUpdate);
  const editUpdate = useData((s) => s.editProjectUpdate);
  const toggleReaction = useData((s) => s.toggleUpdateReaction);
  const [body, setBody] = React.useState('');
  const [health, setHealth] = React.useState<ProjectUpdate['health']>(project.health);
  const [files, setFiles] = React.useState<AttachmentDraft[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editBody, setEditBody] = React.useState('');
  const [editHealth, setEditHealth] = React.useState<ProjectUpdate['health']>(project.health);
  const [auditAction, setAuditAction] = React.useState<'all' | 'created' | 'edited' | 'deleted' | 'reactions'>('all');
  const [auditActor, setAuditActor] = React.useState('all');
  const [auditRange, setAuditRange] = React.useState<AuditRange>('all');
  const [weekFilter, setWeekFilter] = React.useState<string | null>(null);
  const [lightbox, setLightbox] = React.useState<{ files: IssueAttachment[]; index: number } | null>(null);
  const [search, setSearch] = React.useState('');
  const [onlyAttachments, setOnlyAttachments] = React.useState(false);
  const [limit, setLimit] = React.useState(20);
  const [auditLimit, setAuditLimit] = React.useState(20);

  React.useEffect(() => {
    setLimit(20);
  }, [weekFilter, search, onlyAttachments]);

  React.useEffect(() => {
    setAuditLimit(20);
  }, [auditAction, auditActor, auditRange]);

  const updates = project.updates ?? [];
  const points = healthSeries(project);
  const auditEntries = project.updateAudit ?? [];
  const auditActors = Array.from(new Set(auditEntries.map((entry) => entry.actorId)));
  const shownAudits = auditEntries.filter(
    (entry) =>
      (auditAction === 'all' ||
        (auditAction === 'reactions'
          ? ['liked', 'unliked', 'acknowledged', 'unacknowledged'].includes(entry.action)
          : entry.action === auditAction)) &&
      (auditActor === 'all' || entry.actorId === auditActor) &&
      inAuditRange(entry.at, auditRange),
  );
  const reactionWeeks = summarizeReactions(project);
  const needle = search.trim().toLowerCase();
  const visibleUpdates = updates.filter((update) => {
    if (weekFilter) {
      const created = new Date(update.createdAt);
      if (Number.isNaN(created.getTime()) || dayKey(startOfWeek(created)) !== weekFilter) return false;
    }
    if (!needle) return true;
    const author = userById.get(update.authorId)?.name ?? '';
    return update.body.toLowerCase().includes(needle) || author.toLowerCase().includes(needle);
  });
  const filteredUpdates = onlyAttachments
    ? visibleUpdates.filter((update) => Boolean(update.attachments?.length))
    : visibleUpdates;
  const pageUpdates = filteredUpdates.slice(0, limit);

  const publish = () => {
    if (!body.trim()) return;
    addUpdate(
      project.id,
      body,
      health,
      files.map((draft) => newAttachment(draft, meId)),
    );
    setBody('');
    setFiles([]);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = Math.max(0, 5 - files.length);
    if (list.length > room) {
      pushToast({ title: t('Up to 5 attachments per update'), tone: 'danger' });
    }
    const drafts: AttachmentDraft[] = [];
    let skipped = 0;
    for (const file of Array.from(list).slice(0, room)) {
      const result = await readAttachmentFile(file);
      if (result.draft) drafts.push(result.draft);
      else skipped += 1;
    }
    if (skipped) {
      pushToast({ title: t('Skipped {n} files (too large or unsupported)', { n: skipped }), tone: 'danger' });
    }
    if (drafts.length) setFiles((previous) => [...previous, ...drafts].slice(0, 5));
  };

  const downloadAttachment = (file: IssueAttachment, attachments: IssueAttachment[] = []) => {
    if (file.dataUrl && file.mime.startsWith('image/')) {
      const images = attachments.filter((item) => item.dataUrl && item.mime.startsWith('image/'));
      const index = Math.max(0, images.findIndex((item) => item.id === file.id));
      setLightbox({ files: images.length ? images : [file], index });
      return;
    }
    if (file.text) {
      downloadText(file.name, file.text, file.mime || 'text/plain;charset=utf-8');
      return;
    }
    if (!file.dataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = file.dataUrl;
    anchor.download = file.name || 'attachment';
    anchor.click();
  };

  const auditExportOptions = () => ({
    authorName: (id: string) => userById.get(id)?.name ?? id,
    filterLabel: `${auditAction} / ${
      auditActor === 'all' ? t('All authors') : userById.get(auditActor)?.name ?? auditActor
    }`,
  });

  const renderHighlighted = (text: string) =>
    highlightSegments(text, search).map((segment, index) =>
      segment.hit ? (
        <mark key={`${segment.text}-${index}`} className="rounded-[2px] bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] px-0.5 text-t1">
          {segment.text}
        </mark>
      ) : (
        <span key={`${segment.text}-${index}`}>{segment.text}</span>
      ),
    );

  const copyAudit = async () => {
    try {
      await navigator.clipboard.writeText(auditToMarkdown(project, shownAudits, auditExportOptions()));
      pushToast({ title: t('Audit copied'), tone: 'success' });
    } catch {
      pushToast({ title: t('Could not copy the audit'), tone: 'danger' });
    }
  };

  return (
    <section data-project-updates className="mt-6 rounded-r10 bg-[var(--bg-elevated)] p-3.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-[590] text-t1">{t('Project updates')}</h2>
        <span className="text-[11px] text-t4">
          {weekFilter ? `${visibleUpdates.length} / ${updates.length}` : updates.length}
        </span>
        {weekFilter ? (
          <button
            type="button"
            data-clear-week
            onClick={() => setWeekFilter(null)}
            className="rounded-r4 px-1.5 py-0.5 text-[11px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {t('Clear week filter')}
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          data-update-search
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSearch('');
          }}
          placeholder={t('Search updates…')}
          className="h-[26px] w-full max-w-[240px] rounded-r6 bg-[var(--bg-hover)] px-2 text-[12px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-t4 focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
        />
        {search ? (
          <button
            type="button"
            data-clear-update-search
            onClick={() => setSearch('')}
            className="rounded-r4 px-1.5 py-0.5 text-[11.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {t('Clear')}
          </button>
        ) : null}
        {search || weekFilter || onlyAttachments ? (
          <span className="text-[11.5px] text-t4">{`${filteredUpdates.length} / ${updates.length}`}</span>
        ) : null}
        <button
          type="button"
          data-update-filter="attachments"
          aria-pressed={onlyAttachments}
          onClick={() => setOnlyAttachments((current) => !current)}
          className={cn(
            'flex h-[24px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] transition-colors',
            onlyAttachments
              ? 'bg-[var(--bg-selected)] text-t1'
              : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
          )}
        >
          <Paperclip size={10} />
          {t('With attachments')}
        </button>
      </div>

      <div className="mt-2 rounded-r8 bg-panel p-2 shadow-[inset_0_0_0_1px_var(--line)]">
        <textarea
          data-project-update-input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              publish();
            }
          }}
          rows={2}
          placeholder={t('Share progress, risks, or what changed…')}
          className="w-full resize-none bg-transparent px-1 text-[13px] leading-[1.6] text-t2 outline-none placeholder:text-t4"
        />
        {files.length ? (
          <div data-project-update-files className="mt-1 flex flex-wrap gap-1.5">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[11px] text-t3">
                {file.name} · {formatBytes(file.size)}
                <button
                  type="button"
                  aria-label={t('Remove attachment')}
                  onClick={() => setFiles((previous) => previous.filter((_, position) => position !== index))}
                  className="text-t4 hover:text-[var(--red)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-project-update-attach
            onClick={() => fileRef.current?.click()}
            className="flex h-[24px] items-center gap-1 rounded-full px-2 text-[11.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <Paperclip size={11} />
            {t('Attach')}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            data-project-update-file
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {HEALTH.map((option) => (
            <button
              key={option.key}
              type="button"
              data-project-health={option.key}
              onClick={() => setHealth(option.key)}
              className={cn(
                'flex h-[24px] items-center gap-1 rounded-full px-2 text-[11.5px] transition-colors',
                health === option.key
                  ? 'bg-[var(--bg-selected)] text-t1'
                  : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
              )}
            >
              <span className="h-[5px] w-[5px] rounded-full" style={{ background: option.color }} />
              {t(option.label)}
            </button>
          ))}
          <span className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            data-project-update-submit
            disabled={!body.trim()}
            onClick={publish}
            className="gap-1.5"
          >
            <Send size={11} strokeWidth={2} />
            {t('Post update')}
          </Button>
        </div>
      </div>

      {points.length > 1 ? (
        <div data-health-trend className="mt-2 rounded-r6 bg-panel px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          <div className="flex items-center gap-1.5 text-[10.5px] text-t4">
            <span>{t('Health trend')}</span>
            <span className="flex items-center gap-1.5">
              {(['on_track', 'at_risk', 'off_track'] as const).map((key) => (
                <span key={key} className="flex items-center gap-0.5">
                  <span className="h-[4px] w-[4px] rounded-full" style={{ background: HEALTH_COLOR[key] }} />
                  {t(key === 'on_track' ? 'On track' : key === 'at_risk' ? 'At risk' : 'Off track')}
                </span>
              ))}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${Math.max(48, (points.length - 1) * 28 + 8)} 44`}
            className="mt-1 h-[44px] w-full max-w-[420px]"
            role="img"
            aria-label={t('Project health over recent updates')}
          >
            <polyline
              fill="none"
              stroke="var(--line-strong)"
              strokeWidth="1.2"
              points={points
                .map((point, index) => `${4 + index * 28},${HEALTH_Y[point.health] ?? 22}`)
                .join(' ')}
            />
            {points.map((point, index) => (
              <circle
                key={point.updateId}
                data-health-point={point.health}
                cx={4 + index * 28}
                cy={HEALTH_Y[point.health] ?? 22}
                r={3}
                fill={HEALTH_COLOR[point.health] ?? 'var(--text-4)'}
              >
                <title>{`${t(point.health === 'on_track' ? 'On track' : point.health === 'at_risk' ? 'At risk' : 'Off track')} · ${new Date(point.at).toLocaleDateString()}`}</title>
              </circle>
            ))}
          </svg>
        </div>
      ) : null}

      {pageUpdates.length ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {pageUpdates.map((update) => {
            const author = userById.get(update.authorId);
            const tone = HEALTH.find((option) => option.key === update.health);
            return (
              <li key={update.id} data-project-update={update.id} className="rounded-r8 bg-panel px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
                <div className="flex items-center gap-2">
                  <Avatar name={author?.name ?? 'Unknown'} color={author?.color ?? '#5E6AD2'} size="xs" />
                  <span className="text-[12.5px] font-[510] text-t2">
                    {renderHighlighted(author?.name ?? t('Unknown'))}
                  </span>
                  <span className="text-[11.5px] text-t4">{relativeTime(update.createdAt)}</span>
                  {tone ? (
                    <span className="flex items-center gap-1 rounded-full bg-[var(--bg-hover)] px-1.5 text-[10.5px] text-t3">
                      <span className="h-[5px] w-[5px] rounded-full" style={{ background: tone.color }} />
                      {t(tone.label)}
                    </span>
                  ) : null}
                  {update.authorId === meId ? (
                    <>
                      <button
                        type="button"
                        aria-label={t('Edit update')}
                        onClick={() => {
                          setEditingId(update.id);
                          setEditBody(update.body);
                          setEditHealth(update.health ?? project.health);
                        }}
                        className="ml-auto grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('Delete update')}
                        onClick={() => deleteUpdate(project.id, update.id)}
                        className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="mt-1.5 pl-6">
                  {search && matchSnippet(update.body, search) ? (
                    <div data-update-match className="mb-1 rounded-r4 bg-[var(--bg-hover)] px-1.5 py-1 text-[11.5px] leading-[1.5] text-t3">
                      {renderHighlighted(matchSnippet(update.body, search))}
                    </div>
                  ) : null}
                  {editingId === update.id ? (
                    <div>
                      <textarea
                        data-project-update-edit
                        value={editBody}
                        onChange={(event) => setEditBody(event.target.value)}
                        rows={3}
                        className="w-full resize-none rounded-r6 bg-[var(--bg-hover)] px-2 py-1.5 text-[13px] leading-[1.6] text-t2 shadow-[inset_0_0_0_1px_var(--line)] outline-none"
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {HEALTH.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            data-edit-health={option.key}
                            onClick={() => setEditHealth(option.key)}
                            className={cn(
                              'flex h-[22px] items-center gap-1 rounded-full px-2 text-[11px] transition-colors',
                              editHealth === option.key
                                ? 'bg-[var(--bg-selected)] text-t1'
                                : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
                            )}
                          >
                            <span className="h-[5px] w-[5px] rounded-full" style={{ background: option.color }} />
                            {t(option.label)}
                          </button>
                        ))}
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="h-[24px] rounded-r5 px-2 text-[12px] text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
                        >
                          {t('Cancel')}
                        </button>
                        <Button
                          variant="primary"
                          size="sm"
                          data-project-update-save
                          disabled={!editBody.trim()}
                          onClick={() => {
                            editUpdate(project.id, update.id, { body: editBody, health: editHealth });
                            setEditingId(null);
                          }}
                        >
                          {t('Save')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Markdown text={update.body} className="prose-compact" />
                  )}
                  {update.attachments?.length ? (
                    <div data-update-attachments className="mt-1.5 flex flex-wrap gap-1.5">
                      {update.attachments.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => downloadAttachment(file, update.attachments ?? [])}
                          className="flex max-w-[220px] items-center gap-1.5 rounded-r6 bg-[var(--bg-hover)] px-1.5 py-1 text-[11.5px] text-t2 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
                        >
                          {file.dataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.dataUrl} alt={file.name} className="h-[20px] w-[26px] rounded-[3px] object-cover" />
                          ) : (
                            <Paperclip size={11} className="shrink-0 text-t4" />
                          )}
                          <span className="truncate">{file.name}</span>
                          <span className="shrink-0 text-[10.5px] text-t4">{formatBytes(file.size)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {(
                      [
                        ['like', t('Like'), update.likedBy ?? [], <ThumbsUp key="like" size={11} />],
                        ['ack', t('Acknowledge'), update.acknowledgedBy ?? [], <Check key="ack" size={11} />],
                      ] as const
                    ).map(([kind, label, list, icon]) => {
                      const active = list.includes(meId);
                      const names = list.map((id) => (id === meId ? t('You') : userById.get(id)?.name ?? id));
                      return (
                        <button
                          key={kind}
                          type="button"
                          data-update-react={kind}
                          aria-pressed={active}
                          aria-label={label}
                          title={names.length ? names.join(', ') : t('No reactions yet')}
                          onClick={() => toggleReaction(project.id, update.id, kind)}
                          className={cn(
                            'flex h-[22px] items-center gap-1 rounded-full px-1.5 text-[11px] transition-colors',
                            active
                              ? 'bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                              : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
                          )}
                        >
                          {icon}
                          {list.length ? <span className="tnum">{list.length}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[12.5px] text-t4">
          {search || weekFilter || onlyAttachments ? t('No matching updates') : t('No updates yet.')}
        </p>
      )}

      {filteredUpdates.length > limit ? (
        <div className="mt-2 flex items-center gap-2 text-[11.5px] text-t4">
          <span>{t('Showing {n} of {total}', { n: pageUpdates.length, total: filteredUpdates.length })}</span>
          <button
            type="button"
            data-load-more
            onClick={() => setLimit((current) => current + 20)}
            className="h-[24px] rounded-r5 bg-[var(--bg-hover)] px-2 text-[11.5px] text-t2 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
          >
            {t('Load more')}
          </button>
        </div>
      ) : null}

      {reactionWeeks.length ? (
        <div data-reaction-summary className="mt-3 rounded-r6 bg-panel px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] uppercase tracking-[.05em] text-t4">{t('Reaction summary')}</span>
            <span className="flex-1" />
            <button
              type="button"
              data-week-export-all
              aria-label={t('Export all weeks')}
              onClick={() =>
                downloadText(
                  weeksFileName(project),
                  weeksToMarkdown(project, reactionWeeks, updates, {
                    authorName: (id) => userById.get(id)?.name ?? id,
                  }),
                  'text/markdown;charset=utf-8',
                )
              }
              className="grid h-[18px] w-[18px] place-items-center rounded-r4 text-t4 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
            >
              <Download size={10} />
            </button>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {reactionWeeks.map((week) => (
              <button
                key={week.weekStart}
                type="button"
                data-reaction-week={week.weekStart}
                aria-pressed={weekFilter === week.weekStart}
                onClick={() => setWeekFilter((current) => (current === week.weekStart ? null : week.weekStart))}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11.5px] text-t3 transition-colors',
                  weekFilter === week.weekStart
                    ? 'bg-[var(--bg-selected)] text-t1'
                    : 'hover:bg-[var(--bg-hover)] hover:text-t1',
                )}
              >
                <span className="tnum text-t4">{week.weekStart.slice(5).replace('-', '/')}</span>
                <span className="flex items-center gap-0.5">
                  <ThumbsUp size={10} className="text-t4" />
                  <span className="tnum">{week.likes}</span>
                </span>
                <span className="flex items-center gap-0.5">
                  <Check size={10} className="text-t4" />
                  <span className="tnum">{week.acks}</span>
                </span>
                <span className="text-[10.5px] text-t4">· {week.updates}</span>
                <span
                  role="button"
                  tabIndex={0}
                  data-week-export={week.weekStart}
                  aria-label={t('Export week')}
                  onClick={(event) => {
                    event.stopPropagation();
                    const weekUpdates = updates.filter((update) => {
                      const created = new Date(update.createdAt);
                      return !Number.isNaN(created.getTime()) && dayKey(startOfWeek(created)) === week.weekStart;
                    });
                    downloadText(
                      weekFileName(project, week.weekStart),
                      weekToMarkdown(project, week.weekStart, weekUpdates, {
                        authorName: (id) => userById.get(id)?.name ?? id,
                      }),
                      'text/markdown;charset=utf-8',
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    (event.currentTarget as HTMLElement).click();
                  }}
                  className="ml-0.5 grid h-[18px] w-[18px] place-items-center rounded-r4 text-t4 hover:bg-[var(--bg-selected)] hover:text-t1"
                >
                  <Download size={10} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {project.updateAudit?.length ? (
        <details data-update-audit className="mt-3 border-t border-[var(--line-subtle)] pt-2">
          <summary className="cursor-pointer select-none text-[11.5px] text-t4 transition-colors hover:text-t2">
            {t('Update history')} · {project.updateAudit.length}
          </summary>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {(['all', 'created', 'edited', 'deleted', 'reactions'] as const).map((action) => (
              <button
                key={action}
                type="button"
                data-audit-filter={action}
                onClick={() => setAuditAction(action)}
                className={cn(
                  'h-[22px] rounded-full px-2 text-[11px] transition-colors',
                  auditAction === action
                    ? 'bg-[var(--bg-selected)] text-t1'
                    : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
                )}
              >
                {action === 'all' ? t('All') : action === 'reactions' ? t('Reactions') : action}
              </button>
            ))}
            <span className="flex-1" />
            <select
              data-audit-actor
              value={auditActor}
              onChange={(event) => setAuditActor(event.target.value)}
              className="h-[22px] rounded-r5 bg-[var(--bg-hover)] px-1 text-[11px] text-t2 outline-none"
            >
              <option value="all">{t('All authors')}</option>
              {auditActors.map((actorId) => (
                <option key={actorId} value={actorId}>
                  {userById.get(actorId)?.name ?? actorId}
                </option>
              ))}
            </select>
            {(['all', 'week', 'month'] as const).map((range) => (
              <button
                key={range}
                type="button"
                data-audit-range={range}
                onClick={() => setAuditRange(range)}
                className={cn(
                  'h-[22px] rounded-full px-2 text-[11px] transition-colors',
                  auditRange === range
                    ? 'bg-[var(--bg-selected)] text-t1'
                    : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
                )}
              >
                {range === 'all' ? t('All time') : range === 'week' ? t('This week') : t('This month')}
              </button>
            ))}
            <button
              type="button"
              data-audit-export="md"
              aria-label={t('Export audit')}
              onClick={() =>
                downloadText(
                  auditFileName(project),
                  auditToMarkdown(project, shownAudits, auditExportOptions()),
                  'text/markdown;charset=utf-8',
                )
              }
              className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              <Download size={11} />
            </button>
            <button
              type="button"
              data-audit-copy
              aria-label={t('Copy audit')}
              onClick={() => void copyAudit()}
              className="grid h-[22px] w-[22px] place-items-center rounded-r4 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              <ClipboardCopy size={11} />
            </button>
            <button
              type="button"
              data-audit-export="json"
              aria-label={t('Export audit as JSON')}
              onClick={() =>
                downloadText(
                  auditFileName(project, 'json'),
                  auditToJson(project, shownAudits, auditExportOptions()),
                  'application/json',
                )
              }
              className="grid h-[22px] min-w-[24px] place-items-center rounded-r4 px-1 font-mono text-[9.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              {'{}'}
            </button>
          </div>
          {shownAudits.length ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {shownAudits.slice(0, auditLimit).map((entry) => {
                const actor = userById.get(entry.actorId);
                return (
                  <li key={entry.id} data-audit-action={entry.action} className="flex items-start gap-2 text-[11.5px] leading-[1.5] text-t3">
                    <span
                      className={cn(
                        'w-[68px] shrink-0 truncate text-[10.5px]',
                        entry.action === 'deleted'
                          ? 'text-[var(--red)]'
                          : entry.action === 'edited'
                            ? 'text-[var(--accent)]'
                            : entry.action === 'liked' || entry.action === 'acknowledged'
                              ? 'text-[var(--green)]'
                              : 'text-t4',
                      )}
                      title={entry.action}
                    >
                      {t(AUDIT_ACTION_LABEL[entry.action] ?? entry.action)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {actor?.name ?? t('Unknown')} · {relativeTime(entry.at)}
                      {entry.summary ? ` · ${entry.summary}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-t4">{t('No matching history')}</p>
          )}
          {shownAudits.length > auditLimit ? (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-t4">
              <span>{t('Showing {n} of {total}', { n: auditLimit, total: shownAudits.length })}</span>
              <button
                type="button"
                data-audit-more
                onClick={() => setAuditLimit((current) => current + 20)}
                className="h-[22px] rounded-r5 bg-[var(--bg-hover)] px-2 text-[11px] text-t2 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
              >
                {t('Load more')}
              </button>
            </div>
          ) : null}
        </details>
      ) : null}

      {lightbox ? (
        <AttachmentLightbox
          files={lightbox.files}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(index) => setLightbox((current) => (current ? { ...current, index } : current))}
        />
      ) : null}
    </section>
  );
}

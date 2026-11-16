'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  FileText,
  Globe,
  Loader2,
  Pin,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/lib/agent/workspace';
import { rankKnowledge } from '@/lib/agent/search';
import { knowledgeToMarkdown } from '@/lib/agent/text';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn, relativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import { Markdown } from '@/components/issue/markdown';
import type { KnowledgeItem } from '@/lib/agent/types';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const kindIcon = (kind: KnowledgeItem['kind']) => {
  if (kind === 'web') return <Globe size={14} strokeWidth={1.8} />;
  if (kind === 'file') return <FileText size={14} strokeWidth={1.8} />;
  return <BookOpen size={14} strokeWidth={1.8} />;
};

/** Pinned entries first, then most recently updated. */
const sortKnowledge = (items: KnowledgeItem[]) =>
  [...items].sort(
    (a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || b.updatedAt - a.updatedAt,
  );

function Editor({
  item,
  onClose,
}: {
  item: KnowledgeItem | null;
  onClose: () => void;
}) {
  const t = useT();
  const updateKnowledge = useWorkspace((s) => s.updateKnowledge);
  const deleteKnowledge = useWorkspace((s) => s.deleteKnowledge);
  const pushToast = useUI((s) => s.pushToast);
  const [title, setTitle] = React.useState(item?.title ?? '');
  const [content, setContent] = React.useState(item?.content ?? '');
  const [tags, setTags] = React.useState<string[]>(item?.tags ?? []);
  const [tagDraft, setTagDraft] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const copyMarkdown = async () => {
    if (!full) return;
    await navigator.clipboard.writeText(knowledgeToMarkdown(full)).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const [saving, setSaving] = React.useState(false);
  const [full, setFull] = React.useState<KnowledgeItem | null>(item);
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => {
    setFull(item);
    setTitle(item?.title ?? '');
    setContent(item?.content ?? '');
    setTags(item?.tags ?? []);
    setEditing(false);
    if (!item?.excerpt) return;
    let alive = true;
    setLoading(true);
    void useWorkspace
      .getState()
      .loadKnowledge(item.id)
      .then((loaded) => {
        if (!alive || !loaded) return;
        setFull(loaded);
        setTitle(loaded.title);
        setContent(loaded.content);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [item]);

  if (!item || !full) return null;

  const save = async () => {
    setSaving(true);
    const result = await updateKnowledge(item.id, { title, content, tags });
    setSaving(false);
    if (result.ok) {
      setEditing(false);
      setFull({ ...full, title, content, tags, chars: content.length });
      pushToast({ title: t('Saved'), tone: 'success' });
    } else {
      pushToast({ title: t('Could not save the entry'), description: result.error, tone: 'danger' });
    }
  };

  const addTag = () => {
    const next = tagDraft.trim().toLowerCase();
    if (!next) return;
    if (tags.length >= 8) return;
    if (!tags.includes(next)) setTags([...tags, next]);
    setTagDraft('');
  };

  return (
    <div className="fixed inset-0 z-[680] flex justify-end bg-[rgba(24,25,27,.28)] backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.aside
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 24, opacity: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="flex h-full w-full max-w-[640px] flex-col border-l border-[var(--line)] bg-panel shadow-[-24px_0_60px_rgba(9,10,12,.16)]"
      >
        <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-[var(--line-subtle)] px-4">
          <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-[var(--bg-hover)] text-t3">
            {kindIcon(full.kind)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-t4">
            {full.kind} {full.url ? `· ${full.url}` : ''}
          </span>
          {editing ? (
            <>
              <Button variant="primary" size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('Save')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t('Cancel')}
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label={full.pinnedAt ? t('Unpin') : t('Pin to top')}
                title={full.pinnedAt ? t('Unpin') : t('Pin to top')}
                onClick={async () => {
                  const result = await updateKnowledge(item.id, { pin: !full.pinnedAt });
                  if (result.ok) setFull({ ...full, pinnedAt: full.pinnedAt ? undefined : Date.now() });
                }}
                className={cn(
                  'grid h-[26px] w-[26px] place-items-center rounded-r6 transition-colors hover:bg-[var(--bg-hover)]',
                  full.pinnedAt ? 'text-[var(--accent)]' : 'text-t4 hover:text-t1',
                )}
              >
                <Pin size={13} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                aria-label={t('Copy Markdown')}
                title={t('Copy Markdown')}
                onClick={() => void copyMarkdown()}
                className="grid h-[26px] w-[26px] place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
              >
                {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={1.9} />}
              </button>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {t('Edit')}
              </Button>
            </>
          )}
          <button
            type="button"
            aria-label={confirmDelete ? t('Click again to delete') : t('Delete')}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                window.setTimeout(() => setConfirmDelete(false), 3000);
                return;
              }
              await deleteKnowledge(item.id);
              onClose();
            }}
            className={cn(
              'flex h-[26px] items-center gap-1 rounded-r6 px-1.5 text-[12px] transition-colors',
              confirmDelete
                ? 'text-[var(--red)]'
                : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-[var(--red)]',
            )}
          >
            <Trash2 size={13} strokeWidth={1.9} />
            {confirmDelete ? t('Click again to delete') : null}
          </button>
          <button
            type="button"
            aria-label={t('Close')}
            onClick={onClose}
            className="grid h-[26px] w-[26px] place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <X size={14} strokeWidth={1.9} />
          </button>
        </div>

        <div className="scroll-container flex-1 overflow-y-auto px-5 py-4">
          {editing ? (
            <div className="flex flex-col gap-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-r6 bg-[var(--bg-hover)] px-2.5 py-2 text-[15px] font-[590] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
              />
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={22}
                className="w-full resize-y rounded-r6 bg-[var(--bg-hover)] px-2.5 py-2 font-mono text-[12.5px] leading-[1.65] text-t2 outline-none shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
              />
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] font-[510] text-t2">{t('Tags')}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-[4px] bg-[var(--bg-selected)] px-1.5 py-[2px] text-[11px] text-t3"
                    >
                      {tag}
                      <button
                        type="button"
                        aria-label={t('Remove tag')}
                        onClick={() => setTags(tags.filter((item) => item !== tag))}
                        className="text-t4 hover:text-[var(--red)]"
                      >
                        <X size={9} strokeWidth={2.2} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder={t('Add a tag…')}
                    className="h-[24px] w-[120px] rounded-[4px] bg-[var(--bg-hover)] px-1.5 text-[11.5px] text-t2 outline-none shadow-[inset_0_0_0_1px_var(--line)] placeholder:text-t4"
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-[19px] font-[590] leading-[1.3] tracking-[-0.015em] text-t1">{full.title}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-t4">
                <span>{relativeTime(new Date(full.updatedAt).toISOString())}</span>
                <span className="text-[var(--line-strong)]">·</span>
                <span className="tnum">{full.chars.toLocaleString()} {t('characters')}</span>
                {full.tags.length ? (
                  <>
                    <span className="text-[var(--line-strong)]">·</span>
                    {full.tags.map((tag) => (
                      <span key={tag} className="rounded-[4px] bg-[var(--bg-selected)] px-1.5 py-[1px] text-[11px]">
                        {tag}
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
              {loading ? (
                <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-t4">
                  <Loader2 size={12} className="animate-spin" /> {t('Loading…')}
                </p>
              ) : (
                <div className="mt-4">
                  <Markdown text={full.content} className="prose-compact" />
                </div>
              )}
            </>
          )}
        </div>
      </motion.aside>
    </div>
  );
}

export default function KnowledgePage() {
  const t = useT();
  const knowledge = useWorkspace((s) => s.knowledge);
  const loading = useWorkspace((s) => s.loading);
  const hydrate = useWorkspace((s) => s.hydrate);
  const addKnowledge = useWorkspace((s) => s.addKnowledge);
  const pushToast = useUI((s) => s.pushToast);

  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState<KnowledgeItem | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newKind, setNewKind] = React.useState<'note' | 'web'>('note');
  const [newTitle, setNewTitle] = React.useState('');
  const [newUrl, setNewUrl] = React.useState('');
  const [newBody, setNewBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [importing, setImporting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const exportAll = async () => {
    if (exporting) return;
    const targets = filtered.slice(0, 50);
    if (!targets.length) return;
    setExporting(true);
    const parts: string[] = [
      `# Aether knowledge\n\n> ${new Date().toISOString().slice(0, 10)} · ${targets.length} entries\n`,
    ];
    for (const entry of targets) {
      const full = entry.excerpt ? await useWorkspace.getState().loadKnowledge(entry.id) : entry;
      parts.push(knowledgeToMarkdown(full ?? entry));
    }
    const blob = new Blob([parts.join('\n\n---\n\n')], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `aether-knowledge-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
    setExporting(false);
    pushToast({ title: t('Exported {n} entries', { n: targets.length }), tone: 'success' });
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    let ok = 0;
    let skipped = 0;
    for (const file of Array.from(files).slice(0, 10)) {
      if (file.size > 500_000) {
        skipped += 1;
        continue;
      }
      const text = await file.text().catch(() => '');
      if (!text.trim()) {
        skipped += 1;
        continue;
      }
      const result = await addKnowledge({
        kind: 'file',
        title: file.name.replace(/\.[^.]+$/, ''),
        content: text.slice(0, 100_000),
        tags: ['imported'],
      });
      if (result.ok) ok += 1;
      else skipped += 1;
    }
    setImporting(false);
    pushToast({
      title: t('Imported {n} entries', { n: ok }),
      description: skipped ? t('Skipped {n} files', { n: skipped }) : undefined,
      tone: ok ? 'success' : 'danger',
    });
  };

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // ⌘K can deep-link one entry (?id=) or open the composer (?new=note|web)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
      void useWorkspace
        .getState()
        .loadKnowledge(id)
        .then((item) => {
          if (item) setOpen(item);
        });
      return;
    }
    const draft = params.get('new');
    if (draft) {
      setNewKind(draft === 'web' ? 'web' : 'note');
      setNewOpen(true);
    }
  }, []);

  const filtered = sortKnowledge(query.trim() ? rankKnowledge(knowledge, query) : knowledge);

  const create = async () => {
    if (busy) return;
    if (newKind === 'web' && !newUrl.trim()) return;
    if (newKind === 'note' && !newBody.trim() && !newTitle.trim()) return;
    setBusy(true);
    const result = await addKnowledge({
      kind: newKind,
      title: newTitle.trim() || undefined,
      url: newKind === 'web' ? newUrl.trim() : undefined,
      content: newKind === 'note' ? newBody : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      pushToast({ title: t('Could not add the entry'), description: result.error, tone: 'danger' });
      return;
    }
    pushToast({ title: t('Added to knowledge'), tone: 'success' });
    setNewOpen(false);
    setNewTitle('');
    setNewUrl('');
    setNewBody('');
    if (result.item) setOpen(result.item);
  };

  return (
    <div className="mx-auto max-w-[940px] px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title2 font-[590] text-t1">{t('Knowledge')}</h1>
          <p className="mt-1 max-w-[560px] text-[14px] leading-[1.6] text-t3">
            {t('Notes, saved pages and files the agent can search. Kept with your account, not the workspace snapshot.')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => void exportAll()}
            disabled={exporting || filtered.length === 0}
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} strokeWidth={1.9} />}
            {t('Export all')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} strokeWidth={1.9} />}
            {t('Import files')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,.json,.csv,.log,.yaml,.yml"
            className="hidden"
            onChange={(event) => {
              void importFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setNewOpen(true);
              setNewKind('web');
            }}
          >
            <Globe size={12} strokeWidth={1.9} />
            {t('Save page')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setNewOpen(true);
              setNewKind('note');
            }}
          >
            <Plus size={12} strokeWidth={2.2} />
            {t('New note')}
          </Button>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <div className="flex h-[32px] w-full max-w-[320px] items-center gap-1.5 rounded-r6 bg-[var(--bg-elevated)] px-2.5 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]">
          <Search size={13} strokeWidth={1.9} className="shrink-0 text-t4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search knowledge…')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-t1 outline-none placeholder:text-t4"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="text-t4 hover:text-t2" aria-label={t('Clear')}>
              <X size={12} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        <span className="text-[12px] text-t4">
          {t('{n} entries', { n: filtered.length })}
        </span>
        <span className="flex-1" />
        <span className="hidden items-center gap-1.5 text-[12px] text-t4 sm:flex">
          <span className="h-[5px] w-[5px] rounded-full bg-[var(--accent)]" />
          {t('The agent can search these with search_knowledge')}
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-r9 bg-[var(--bg-elevated)] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {loading && knowledge.length === 0 ? (
          <div className="flex flex-col gap-3 px-3.5 py-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex animate-pulse items-start gap-3">
                <span className="h-7 w-7 shrink-0 rounded-[7px] bg-[var(--bg-selected)]" />
                <span className="flex-1 space-y-2">
                  <span className="block h-[11px] w-[38%] rounded-full bg-[var(--bg-selected)]" />
                  <span className="block h-[9px] w-[78%] rounded-full bg-[var(--bg-hover)]" />
                </span>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--bg-hover)] text-t3">
              <BookOpen size={17} strokeWidth={1.7} />
            </span>
            <p className="mt-3 text-[14px] font-[510] text-t1">
              {query ? t('Nothing matches that search') : t('Your knowledge base is empty')}
            </p>
            <p className="mx-auto mt-1 max-w-[360px] text-[13px] leading-[1.6] text-t4">
              {query
                ? t('Try a shorter query.')
                : t('Save a page, write a note, or let the agent store a conclusion here.')}
            </p>
            {!query ? (
              <Button variant="secondary" size="sm" className="mt-4 gap-1.5" onClick={() => setNewOpen(true)}>
                <Plus size={12} strokeWidth={2.2} />
                {t('Add the first entry')}
              </Button>
            ) : null}
          </div>
        ) : (
          filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpen(item)}
              className={cn(
                'group flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]',
                index > 0 ? 'border-t border-[var(--line-subtle)]' : '',
              )}
            >
              <span className="mt-[1px] grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[var(--bg-hover)] text-t3 group-hover:text-t2">
                {kindIcon(item.kind)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {item.pinnedAt ? <Pin size={10} strokeWidth={2} className="shrink-0 text-[var(--accent)]" /> : null}
                  <span className="truncate text-[13.5px] font-[510] text-t1">{item.title}</span>
                  {item.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="shrink-0 rounded-[4px] bg-[var(--bg-selected)] px-1.5 py-[1px] text-[10.5px] text-t4">
                      {tag}
                    </span>
                  ))}
                </span>
                <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.55] text-t3">
                  {item.content.replace(/\s+/g, ' ').slice(0, 220)}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-t4">
                  <span className="uppercase tracking-[.04em]">{item.kind}</span>
                  <span className="text-[var(--line-strong)]">·</span>
                  <span className="tnum">{item.chars.toLocaleString()} {t('characters')}</span>
                  <span className="text-[var(--line-strong)]">·</span>
                  <span>{relativeTime(new Date(item.updatedAt).toISOString())}</span>
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      <AnimatePresence>
        {newOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[670] grid place-items-center bg-[rgba(24,25,27,.34)] px-4 backdrop-blur-[3px]"
            onMouseDown={(event) => event.target === event.currentTarget && setNewOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18, ease: EASE }}
              className="w-full max-w-[560px] rounded-r12 bg-panel p-4 shadow-[0_30px_70px_-20px_rgba(9,10,12,.35),inset_0_0_0_1px_var(--line)]"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-[var(--bg-hover)] text-t3">
                  {newKind === 'web' ? <Globe size={14} strokeWidth={1.8} /> : <BookOpen size={14} strokeWidth={1.8} />}
                </span>
                <span className="text-[14px] font-[590] text-t1">
                  {newKind === 'web' ? t('Save a page') : t('New note')}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={t('Close')}
                  onClick={() => setNewOpen(false)}
                  className="grid h-[26px] w-[26px] place-items-center rounded-r6 text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
                >
                  <X size={14} strokeWidth={1.9} />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-1">
                {(['note', 'web'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setNewKind(kind)}
                    className={cn(
                      'h-[26px] rounded-full px-2.5 text-[12px] font-[510] transition-colors',
                      newKind === kind
                        ? 'bg-[var(--bg-selected)] text-t1 shadow-[inset_0_0_0_1px_var(--line-strong)]'
                        : 'text-t3 hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    {kind === 'note' ? t('Note') : t('Web page')}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-col gap-2.5">
                {newKind === 'web' ? (
                  <input
                    autoFocus
                    value={newUrl}
                    onChange={(event) => setNewUrl(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void create()}
                    placeholder="https://example.com/article"
                    spellCheck={false}
                    className="h-[38px] w-full rounded-r6 bg-[var(--bg-hover)] px-2.5 font-mono text-[12.5px] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
                  />
                ) : null}
                <input
                  autoFocus={newKind === 'note'}
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder={t('Title (optional)')}
                  className="h-[38px] w-full rounded-r6 bg-[var(--bg-hover)] px-2.5 text-[13.5px] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
                />
                {newKind === 'note' ? (
                  <textarea
                    value={newBody}
                    onChange={(event) => setNewBody(event.target.value)}
                    rows={8}
                    placeholder={t('Markdown, meeting notes, a decision record…')}
                    className="w-full resize-y rounded-r6 bg-[var(--bg-hover)] px-2.5 py-2 text-[13px] leading-[1.6] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_50%,transparent)]"
                  />
                ) : (
                  <p className="text-[12px] leading-[1.55] text-t4">
                    {t('Aether reads the page on this server and stores the text. Private addresses are refused.')}
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={create}
                  disabled={busy || (newKind === 'web' ? !newUrl.trim() : !newTitle.trim() && !newBody.trim())}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                  {newKind === 'web' ? t('Read and save') : t('Save note')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
                  {t('Cancel')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{open ? <Editor item={open} onClose={() => setOpen(null)} /> : null}</AnimatePresence>
    </div>
  );
}

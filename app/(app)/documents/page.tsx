'use client';

import * as React from 'react';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import { useDocuments } from '@/lib/store/documents';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn, relativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import { Markdown } from '@/components/issue/markdown';

export default function DocumentsPage() {
  const t = useT();
  const documents = useDocuments((s) => s.documents);
  const hydrate = useDocuments((s) => s.hydrate);
  const create = useDocuments((s) => s.create);
  const update = useDocuments((s) => s.update);
  const remove = useDocuments((s) => s.remove);
  const pushToast = useUI((s) => s.pushToast);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);

  React.useEffect(() => hydrate(), [hydrate]);
  React.useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('id');
    if (requested) setActiveId(requested);
  }, []);
  React.useEffect(() => {
    if (!activeId && documents.length) setActiveId(documents[0].id);
  }, [activeId, documents]);

  const active = documents.find((doc) => doc.id === activeId) ?? null;

  const download = (doc: { title: string; content: string }) => {
    const blob = new Blob([`# ${doc.title}\n\n${doc.content}\n`], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${doc.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 60) || 'document'}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-44px)] max-w-[1200px]">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-[var(--line-subtle)]">
        <div className="flex h-[44px] items-center gap-2 px-3">
          <FileText size={13} className="text-t4" />
          <span className="text-[13px] font-[590] text-t1">{t('Documents')}</span>
          <span className="text-[11px] text-t4">{documents.length}</span>
          <span className="flex-1" />
          <button
            type="button"
            data-document-new
            aria-label={t('New document')}
            onClick={() => {
              const doc = create({ title: t('Untitled document'), content: '' });
              if (doc) setActiveId(doc.id);
            }}
            className="grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="scroll-container flex-1 overflow-y-auto px-1.5 pb-3">
          {documents.length === 0 ? (
            <p className="px-2 py-3 text-[12.5px] leading-[1.6] text-t4">
              {t('Save an agent answer as a document, or write one here. Documents stay on this device.')}
            </p>
          ) : null}
          {documents.map((doc) => (
            <button
              key={doc.id}
              type="button"
              data-document-row={doc.id}
              onClick={() => setActiveId(doc.id)}
              className={cn(
                'flex w-full flex-col gap-0.5 rounded-r6 px-2 py-1.5 text-left transition-colors',
                doc.id === activeId ? 'bg-[var(--bg-selected)] text-t1' : 'text-t3 hover:bg-[var(--bg-hover)]',
              )}
            >
              <span className="truncate text-[13px]">{doc.title}</span>
              <span className="text-[10.5px] text-t4">{relativeTime(new Date(doc.updatedAt).toISOString())}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-[var(--line-subtle)] px-4">
              <input
                data-document-title
                value={active.title}
                onChange={(event) => update(active.id, { title: event.target.value })}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-[590] text-t1 outline-none"
              />
              <button
                type="button"
                onClick={() => setPreview((value) => !value)}
                className={cn(
                  'flex h-[26px] items-center rounded-r6 px-2 text-[12.5px] transition-colors hover:bg-[var(--bg-hover)]',
                  preview ? 'text-t1' : 'text-t4',
                )}
              >
                {preview ? t('Edit') : t('Preview')}
              </button>
              <button
                type="button"
                aria-label={t('Download Markdown')}
                onClick={() => download(active)}
                className="grid h-[26px] w-[26px] place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
              >
                <Download size={13} />
              </button>
              <button
                type="button"
                aria-label={t('Delete document')}
                onClick={() => {
                  if (!window.confirm(`${t('Delete document')}「${active.title}」?`)) return;
                  remove(active.id);
                  setActiveId(null);
                  pushToast({ title: t('Document deleted'), tone: 'danger' });
                }}
                className="grid h-[26px] w-[26px] place-items-center rounded-r6 text-t4 transition-colors hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="scroll-container flex-1 overflow-y-auto px-5 py-5">
              <div className="mx-auto max-w-[760px]">
                {preview ? (
                  <Markdown text={active.content} className="prose-linear" />
                ) : (
                  <textarea
                    data-document-editor
                    value={active.content}
                    onChange={(event) => update(active.id, { content: event.target.value })}
                    placeholder={t('Write Markdown here, or start from an agent answer.')}
                    className="min-h-[60vh] w-full resize-none bg-transparent font-mono text-[13.5px] leading-[1.7] text-t2 outline-none placeholder:text-t4"
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-r8 bg-[var(--bg-elevated)] text-t4 shadow-[inset_0_0_0_1px_var(--line)]">
                <FileText size={17} />
              </div>
              <h2 className="mt-3 text-[15px] font-[590] text-t1">{t('No document selected')}</h2>
              <p className="mt-1 max-w-[360px] text-[13px] leading-[1.6] text-t4">
                {t('Save an agent answer with “Save as document”, or create a blank one.')}
              </p>
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  const doc = create({ title: t('Untitled document'), content: '' });
                  if (doc) setActiveId(doc.id);
                }}
              >
                {t('New document')}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

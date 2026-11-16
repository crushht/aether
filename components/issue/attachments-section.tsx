'use client';

import * as React from 'react';
import { Download, Paperclip, X } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';
import { formatBytes } from '@/lib/attachments';
import { downloadTextFile } from '@/lib/download';
import type { Issue, IssueAttachment } from '@/lib/types';
import { AttachmentLightbox } from './attachment-lightbox';

/** Files stored on the issue itself, bounded and previewable. */
export function AttachmentsSection({ issue }: { issue: Issue }) {
  const removeAttachment = useData((s) => s.removeAttachment);
  const t = useT();
  const files = issue.attachments ?? [];
  const [lightbox, setLightbox] = React.useState<{ files: IssueAttachment[]; index: number } | null>(null);
  if (!files.length) return null;

  const openPreview = (file: IssueAttachment) => {
    const images = files.filter((item) => item.dataUrl && item.mime.startsWith('image/'));
    const index = Math.max(0, images.findIndex((item) => item.id === file.id));
    setLightbox({ files: images.length ? images : [file], index });
  };

  const downloadAll = () => {
    files.forEach((file, index) => {
      window.setTimeout(() => {
        if (file.text) {
          downloadTextFile(file.name, file.text);
          return;
        }
        if (!file.dataUrl) return;
        const anchor = document.createElement('a');
        anchor.href = file.dataUrl;
        anchor.download = file.name || 'attachment';
        anchor.click();
      }, index * 200);
    });
  };

  return (
    <div className="mt-6" data-issue-attachments>
      <div className="flex items-center gap-2">
        <Paperclip size={13} strokeWidth={1.8} className="text-t4" />
        <h2 className="text-[14px] font-[590] text-t1">{t('Attachments')}</h2>
        <span className="tnum text-[13px] text-t4">{files.length}</span>
        <span className="flex-1" />
        {files.length > 1 ? (
          <button
            type="button"
            data-download-all
            onClick={downloadAll}
            className="flex items-center gap-1 rounded-r5 px-1.5 py-0.5 text-[11.5px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <Download size={11} />
            {t('Download all')}
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {files.map((file) => (
          <div
            key={file.id}
            data-attachment={file.id}
            className="group/att relative flex max-w-full items-center gap-2 rounded-r6 bg-[var(--bg-hover)] p-1.5 pr-2 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
          >
            {file.dataUrl ? (
              <button type="button" onClick={() => openPreview(file)} className="block shrink-0" aria-label={`${t('Attachment preview')} ${file.name}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file.dataUrl} alt={file.name} className="h-[54px] w-[72px] rounded-[4px] object-cover" />
              </button>
            ) : (
              <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[4px] bg-[var(--bg-selected)] text-t4">
                <Paperclip size={14} />
              </span>
            )}
            <span className="min-w-0">
              <button
                type="button"
                onClick={() => (file.text ? downloadTextFile(file.name, file.text) : file.dataUrl && window.open(file.dataUrl, '_blank'))}
                className="block max-w-[180px] truncate text-left text-[12.5px] text-t2 hover:text-t1"
              >
                {file.name}
              </button>
              <span className="block text-[11px] text-t4">{formatBytes(file.size)}</span>
            </span>
            <button
              type="button"
              aria-label={`${t('Remove attachment')} ${file.name}`}
              onClick={() => removeAttachment(issue.id, file.id)}
              className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full text-t4 opacity-0 transition-opacity hover:bg-[var(--bg-active)] hover:text-t1 group-hover/att:opacity-100 focus-visible:opacity-100"
            >
              <X size={11} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

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

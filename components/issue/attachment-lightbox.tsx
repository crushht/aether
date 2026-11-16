'use client';

import type { IssueAttachment } from '@/lib/types';
import { useT } from '@/lib/use-t';

interface Props {
  files: IssueAttachment[];
  index: number;
  onClose: () => void;
  onIndex: (index: number) => void;
}

/** Fullscreen preview shared by issue and project-update attachments. */
export function AttachmentLightbox({ files, index, onClose, onIndex }: Props) {
  const t = useT();
  const current = files[Math.max(0, Math.min(index, files.length - 1))];
  const next = () => onIndex((index + 1) % files.length);
  const previous = () => onIndex((index - 1 + files.length) % files.length);

  return (
    <div
      data-attachment-lightbox
      role="dialog"
      aria-modal="true"
      aria-label={t('Attachment preview')}
      className="fixed inset-0 z-[950] flex items-center justify-center bg-[rgba(8,9,10,.82)] p-6"
      tabIndex={-1}
      ref={(node) => node?.focus()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
          return;
        }
        if (event.key === 'Tab') {
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('button, [href]'),
          ).filter((node) => !node.hasAttribute('disabled'));
          if (!focusable.length) return;
          const index = focusable.indexOf(document.activeElement as HTMLElement);
          const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
          event.preventDefault();
          focusable[next]?.focus();
          return;
        }
        if (files.length < 2) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          next();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          previous();
        }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={current?.dataUrl} alt={current?.name ?? t('Attachment preview')} className="max-h-full max-w-full rounded-r8 shadow-pop" />
      {files.length > 1 ? (
        <>
          <button
            type="button"
            data-lightbox-prev
            aria-label={t('Previous attachment')}
            onClick={previous}
            className="absolute left-4 top-1/2 grid h-[34px] w-[34px] -translate-y-1/2 place-items-center rounded-full bg-[rgba(255,255,255,.12)] text-white hover:bg-[rgba(255,255,255,.22)]"
          >
            ‹
          </button>
          <button
            type="button"
            data-lightbox-next
            aria-label={t('Next attachment')}
            onClick={next}
            className="absolute right-4 top-1/2 grid h-[34px] w-[34px] -translate-y-1/2 place-items-center rounded-full bg-[rgba(255,255,255,.12)] text-white hover:bg-[rgba(255,255,255,.22)]"
          >
            ›
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[rgba(255,255,255,.12)] px-2 py-0.5 text-[11px] text-white">
            {index + 1} / {files.length}
          </span>
        </>
      ) : null}
      <button
        type="button"
        aria-label={t('Close')}
        onClick={onClose}
        className="absolute right-4 top-4 grid h-[30px] w-[30px] place-items-center rounded-full bg-[rgba(255,255,255,.12)] text-white hover:bg-[rgba(255,255,255,.22)]"
      >
        ×
      </button>
    </div>
  );
}

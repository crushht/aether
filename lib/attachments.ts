'use client';

import type { IssueAttachment } from '@/lib/types';

/**
 * Attachments live inside the workspace snapshot: small images become data
 * URLs and text files become text. Everything else is refused rather than
 * silently storing a binary blob the JSON store cannot preview or index.
 */

export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_TEXT_BYTES = 200_000;
/** Bigger originals are refused before decoding: a 40MP PNG would freeze the tab. */
export const MAX_IMAGE_SOURCE_BYTES = 12_000_000;
const IMAGE_TARGET_BYTES = 400_000;
const IMAGE_MAX_EDGE = 1_600;

export type AttachmentDraft = Omit<IssueAttachment, 'id' | 'createdAt' | 'uploaderId'>;

const TEXT_NAME = /\.(txt|md|markdown|json|csv|ya?ml|ts|tsx|js|jsx|py|go|rs|sql|html?|css|log|xml)$/i;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Snapshots carry image bytes as data URLs, so a 3 MB screenshot costs 4 MB in
 * every write, backup and sync. Downscale to a sane long edge and re-encode;
 * animation and SVG are left alone because re-encoding would destroy them.
 */
async function compressImage(file: File): Promise<Blob | null> {
  if (/svg|gif/i.test(file.type)) return null;
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  let longest = Math.max(bitmap.width, bitmap.height);
  let blob: Blob | null = null;

  // First a quality sweep, then (for pathological noise) shrink the pixels too.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scale = Math.min(1, IMAGE_MAX_EDGE / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) break;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let quality = 0.82;
    blob = await toBlob(canvas, 'image/webp', quality);
    while (blob && blob.size > IMAGE_TARGET_BYTES && quality > 0.4) {
      quality -= 0.12;
      blob = await toBlob(canvas, 'image/webp', quality);
    }
    if (blob && blob.size <= MAX_IMAGE_BYTES) break;
    longest = Math.round(longest * 0.7);
  }

  bitmap.close?.();
  return blob;
}

export interface AttachmentResult {
  draft?: AttachmentDraft;
  error?: 'too-large' | 'unsupported' | 'read-failed';
}

export async function readAttachmentFile(file: File): Promise<AttachmentResult> {
  try {
    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_SOURCE_BYTES) return { error: 'too-large' };
      let payload: Blob = file;
      let name = file.name;
      try {
        const compressed = await compressImage(file);
        if (compressed && compressed.size < file.size) {
          payload = compressed;
          name = name.replace(/\.(png|jpe?g|webp|bmp)$/i, '') + '.webp';
        }
      } catch {
        /* decoding failed: fall back to the original bytes */
      }
      if (payload.size > MAX_IMAGE_BYTES) return { error: 'too-large' };
      return {
        draft: {
          name,
          mime: payload.type || file.type,
          size: payload.size,
          dataUrl: await readAsDataUrl(payload),
        },
      };
    }
    if (file.type.startsWith('text/') || TEXT_NAME.test(file.name)) {
      if (file.size > MAX_TEXT_BYTES) return { error: 'too-large' };
      return {
        draft: {
          name: file.name,
          mime: file.type || 'text/plain',
          size: file.size,
          text: (await file.text()).slice(0, MAX_TEXT_BYTES),
        },
      };
    }
    return { error: 'unsupported' };
  } catch {
    return { error: 'read-failed' };
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export const newAttachment = (draft: AttachmentDraft, uploaderId: string): IssueAttachment => ({
  ...draft,
  id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
  uploaderId,
  createdAt: new Date().toISOString(),
});

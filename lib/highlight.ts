export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** Split text into matched / unmatched runs, case-insensitively. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = lower.indexOf(needle, cursor);
    if (index === -1) {
      segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (index > cursor) segments.push({ text: text.slice(cursor, index), hit: false });
    segments.push({ text: text.slice(index, index + needle.length), hit: true });
    cursor = index + needle.length;
  }
  return segments.length ? segments : [{ text, hit: false }];
}

/** A short window around the first match, with ellipses when clipped. */
export function matchSnippet(text: string, query: string, radius = 60): string {
  const needle = query.trim().toLowerCase();
  if (!needle) return '';
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return '';
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

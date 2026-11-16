/**
 * Markdown ⇄ contenteditable HTML.
 *
 * Scope is deliberately narrow: the description editor renders real inline
 * formatting (bold / italic / code / links) while everything else — blank
 * lines, list markers, checklists — stays literal text. That keeps a
 * round-trip lossless for the markdown we actually generate, without shipping a
 * full CommonMark implementation.
 */

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(md: string): string {
  let out = '';
  let i = 0;
  while (i < md.length) {
    const rest = md.slice(i);

    if (rest.startsWith('`')) {
      const end = rest.indexOf('`', 1);
      if (end > 0) {
        out += `<code>${escapeHtml(rest.slice(1, end))}</code>`;
        i += end + 1;
        continue;
      }
    }
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2);
      if (end > 0) {
        out += `<strong>${escapeHtml(rest.slice(2, end))}</strong>`;
        i += end + 2;
        continue;
      }
    }
    if (rest.startsWith('*')) {
      const end = rest.indexOf('*', 1);
      if (end > 0) {
        out += `<em>${escapeHtml(rest.slice(1, end))}</em>`;
        i += end + 1;
        continue;
      }
    }
    if (rest.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
      if (link) {
        out += `<a href="${escapeHtml(link[2])}">${escapeHtml(link[1])}</a>`;
        i += link[0].length;
        continue;
      }
    }

    out += escapeHtml(md[i]);
    i += 1;
  }
  return out;
}

export function markdownToEditableHtml(md: string): string {
  if (!md) return '';
  return md
    .split('\n')
    .map((line) => (line === '' ? '<div><br></div>' : `<div>${inline(line)}</div>`))
    .join('');
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(serializeNode).join('');

  switch (el.tagName) {
    case 'BR':
      return '\n';
    case 'DIV':
    case 'P':
      // a lone <br> is an empty line, not two line breaks
      return inner === '\n' ? '\n' : `\n${inner}`;
    case 'STRONG':
    case 'B':
      return inner.trim() ? `**${inner}**` : inner;
    case 'EM':
    case 'I':
      return inner.trim() ? `*${inner}*` : inner;
    case 'CODE':
      return `\`${inner}\``;
    case 'A':
      return `[${inner}](${el.getAttribute('href') ?? ''})`;
    default:
      return inner;
  }
}

export function editableHtmlToMarkdown(html: string): string {
  if (!html) return '';
  const host = document.createElement('template');
  host.innerHTML = html;
  let md = Array.from(host.content.childNodes).map(serializeNode).join('');
  md = md.replace(/\u00a0/g, ' ');
  md = md.replace(/^\n+/, '');
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.replace(/\n+$/, '');
  return md;
}

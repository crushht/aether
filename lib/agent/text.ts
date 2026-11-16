/** One knowledge entry as a portable Markdown document. */
export function knowledgeToMarkdown(item: {
  title: string;
  url?: string;
  tags: string[];
  content: string;
}) {
  const meta = [item.url ? `来源：${item.url}` : '', item.tags.length ? `标签：${item.tags.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ');
  return `# ${item.title}\n\n${meta ? `> ${meta}\n\n` : ''}${item.content}`.trim();
}

export function toPlainText(markdown: string) {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    .replace(/~~([\s\S]*?)~~/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

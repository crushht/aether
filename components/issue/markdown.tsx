import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/use-t';

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* browser may deny clipboard access */ }
  };
  return (
    <div className="group/code relative overflow-hidden rounded-r8 bg-[var(--bg-hover)] shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex h-[30px] items-center border-b border-[var(--line-subtle)] px-3 text-[11px] text-t4">
        <span className="font-mono">{lang || 'text'}</span>
        <span className="flex-1" />
        <button type="button" onClick={copy} aria-label={t('Copy code')} className="flex h-[22px] items-center gap-1 rounded-r4 px-1.5 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/code:opacity-100">
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? t('Copied') : t('Copy')}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-[1.6] text-t2"><code>{code}</code></pre>
    </div>
  );
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | {
      type: 'ul';
      items: { text: string; checked?: boolean; line: number }[];
      ordered?: boolean;
      tasks?: boolean;
    }
  | { type: 'code'; lang?: string; code: string }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

const LIST_RE = /^\s*(?:[-*]|\d+\.)\s+/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', lang, code: buf.join('\n') });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'h', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i += 1;
      continue;
    }

    if (/^(---|\*\*\*)$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: buf.join(' ') });
      continue;
    }

    if (LIST_RE.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { text: string; checked?: boolean; line: number }[] = [];
      let tasks: boolean | undefined;
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const startLine = i;
        const raw = lines[i].replace(LIST_RE, '');
        const task = /^\[([ xX])\]\s+/.exec(raw);
        if (task) tasks = true;
        const text = task ? raw.slice(task[0].length) : raw;
        items.push(
          tasks
            ? { text, checked: task ? task[1].toLowerCase() === 'x' : false, line: startLine }
            : { text, line: startLine },
        );
        i += 1;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i += 1;
        }
      }
      blocks.push({ type: 'ul', items, ordered, tasks });
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|```|---)/.test(lines[i]) && !LIST_RE.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'p', text: buf.join(' ') });
  }

  return blocks;
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;

export function renderInline(text: string, keyPrefix = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_RE.source, 'g');
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${m.index}`;
    if (token.startsWith('`')) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**')) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (link)
        out.push(
          <a key={key} href={/^(https?:\/\/|mailto:|\/)/i.test(link[2]) ? link[2] : '#'} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>,
        );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function TaskBox({
  checked,
  label,
  onToggle,
}: {
  checked?: boolean;
  label: string;
  onToggle?: () => void;
}) {
  const box = cn(
    'mt-[5px] grid h-[13px] w-[13px] shrink-0 place-items-center rounded-[3px]',
    checked
      ? 'bg-[rgba(94,106,210,.28)] shadow-[inset_0_0_0_1px_rgba(94,106,210,.55)]'
      : 'bg-[var(--bg-active)] shadow-[inset_0_0_0_1px_var(--line-strong)]',
  );
  const mark = checked ? (
    <svg viewBox="0 0 14 14" className="h-2.5 w-2.5 text-[#b9c0ff]" fill="none">
      <path d="M2.8 7.4 5.5 10 11 4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : null;

  if (!onToggle) return <span className={box}>{mark}</span>;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-label={label}
      data-checkbox={checked ? 'checked' : 'unchecked'}
      onClick={(e) => {
        // the read view opens the editor on click; a box must not do both
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        box,
        'cursor-pointer transition-[background-color,box-shadow] duration-100',
        'hover:shadow-[inset_0_0_0_1px_rgba(94,106,210,.7)]',
        'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(94,106,210,.8),0_0_0_2px_rgba(94,106,210,.3)]',
      )}
    >
      {mark}
    </button>
  );
}

/** Issue keys inside prose become buttons when the caller opts in. */
function renderWithIssues(text: string, key: string, onIssue?: (issueKey: string) => void) {
  if (!onIssue) return renderInline(text, key);
  return text.split(/([A-Z]{1,6}-\d+)/).map((part, index) => {
    if (!part) return null;
    if (!/^[A-Z]{1,6}-\d+$/.test(part)) {
      return <React.Fragment key={`${key}-${index}`}>{renderInline(part, `${key}-${index}`)}</React.Fragment>;
    }
    return (
      <button
        key={`${key}-${index}`}
        type="button"
        onClick={() => onIssue(part)}
        className="rounded-[3px] font-mono text-[0.94em] text-[var(--accent)] underline decoration-[color-mix(in_srgb,var(--accent)_35%,transparent)] underline-offset-2 transition-colors hover:text-[var(--accent-hover)]"
      >
        {part}
      </button>
    );
  });
}

export function Markdown({
  text,
  className,
  onToggleTask,
  taskLabel = 'Toggle checklist item',
  onIssue,
}: {
  text: string;
  className?: string;
  /** when given, checklist boxes become buttons that report their source line */
  onToggleTask?: (line: number) => void;
  taskLabel?: string;
  /** when given, issue keys (ENG-1) in prose become clickable */
  onIssue?: (issueKey: string) => void;
}) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  if (!text.trim()) return null;

  return (
    <div className={cn('prose-linear', className)}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h': {
            const Tag = (`h${block.level}` as unknown) as 'h1';
            return <Tag key={i}>{block.text}</Tag>;
          }
          case 'ul':
            return block.ordered ? (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderWithIssues(item.text, `li-${i}-${j}`, onIssue)}</li>
                ))}
              </ol>
            ) : (
              <ul key={i} className={block.tasks ? 'list-none pl-0' : undefined}>
                {block.items.map((item, j) => (
                  <li key={j} className={block.tasks ? 'flex items-start gap-2 pl-0' : undefined}>
                    {block.tasks ? (
                      <TaskBox
                        checked={item.checked}
                        label={taskLabel}
                        onToggle={onToggleTask ? () => onToggleTask(item.line) : undefined}
                      />
                    ) : null}
                    <span className={item.checked ? 'text-t4 line-through decoration-[var(--line-strong)]' : undefined}>
                      {renderWithIssues(item.text, `li-${i}-${j}`, onIssue)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case 'code':
            return (
              <CodeBlock key={i} code={block.code} lang={block.lang} />
            );
          case 'quote':
            return <blockquote key={i}>{renderWithIssues(block.text, `q-${i}`, onIssue)}</blockquote>;
          case 'hr':
            return <hr key={i} />;
          default:
            return <p key={i}>{renderWithIssues(block.text, `p-${i}`, onIssue)}</p>;
        }
      })}
    </div>
  );
}

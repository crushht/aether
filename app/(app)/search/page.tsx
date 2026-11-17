'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Box, BookOpen, CircleDot, FileText, Search } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useWorkspace } from '@/lib/agent/workspace';
import { useDocuments } from '@/lib/store/documents';
import { useSearchHistory } from '@/lib/store/search-history';
import { StatusIcon } from '@/components/ui/icons';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';
import { highlightSegments, matchSnippet } from '@/lib/highlight';
import { describeQuery, issueMatchesQuery, parseQuery } from '@/lib/query';
import { queryContext } from '@/lib/query-context';

const LIMIT = 20;

/** One page over issues, projects and knowledge: what ⌘K links to. */
export default function SearchPage() {
  const t = useT();
  const router = useRouter();
  const issues = useData((s) => s.issues);
  const projects = useData((s) => s.projects);
  const knowledge = useWorkspace((s) => s.knowledge);
  const documents = useDocuments((s) => s.documents);
  const recent = useSearchHistory((s) => s.entries);
  const pushHistory = useSearchHistory((s) => s.push);
  const clearHistory = useSearchHistory((s) => s.clear);
  const hydrate = useWorkspace((s) => s.hydrate);
  const openIssue = useView((s) => s.openIssue);
  const [query, setQuery] = React.useState('');
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    void hydrate();
    useDocuments.getState().hydrate();
    useSearchHistory.getState().hydrate();
  }, [hydrate]);

  const needle = query.trim().toLowerCase();
  const deferredQuery = React.useDeferredValue(query);
  const deferredNeedle = deferredQuery.trim().toLowerCase();
  const stale = deferredQuery !== query;

  // `status:todo assignee:me` is parsed, not searched for; plain words still
  // match titles and keys, so the box keeps working the way people expect.
  const parsed = React.useMemo(() => parseQuery(deferredQuery), [deferredQuery]);
  const structured = parsed.terms.length > 0;

  React.useEffect(() => {
    if (!needle) return;
    const timer = window.setTimeout(() => pushHistory(needle), 900);
    return () => window.clearTimeout(timer);
  }, [needle, pushHistory]);
  const match = (text: string | undefined) => Boolean(deferredNeedle) && (text ?? '').toLowerCase().includes(deferredNeedle);

  const issueHits = deferredNeedle
    ? issues
        .filter((issue) =>
          structured
            ? issueMatchesQuery(issue, parsed, queryContext())
            : match(issue.title) || match(issue.key) || match(issue.description),
        )
        .slice(0, LIMIT)
    : [];
  const projectHits = deferredNeedle
    ? projects.filter((project) => match(project.name) || match(project.summary)).slice(0, LIMIT)
    : [];
  const knowledgeHits = deferredNeedle
    ? knowledge.filter((item) => match(item.title) || match(item.content)).slice(0, LIMIT)
    : [];
  const documentHits = deferredNeedle
    ? documents.filter((doc) => match(doc.title) || match(doc.content)).slice(0, LIMIT)
    : [];
  const total = issueHits.length + projectHits.length + knowledgeHits.length + documentHits.length;

  type Hit = { type: 'issue' | 'project' | 'knowledge' | 'document'; id: string };
  const flat: Hit[] = [
    ...issueHits.map((issue) => ({ type: 'issue' as const, id: issue.id })),
    ...projectHits.map((project) => ({ type: 'project' as const, id: project.id })),
    ...documentHits.map((doc) => ({ type: 'document' as const, id: doc.id })),
    ...knowledgeHits.map((item) => ({ type: 'knowledge' as const, id: item.id })),
  ];
  const activeIndex = flat.length ? Math.min(index, flat.length - 1) : -1;
  const hitIndex = (type: Hit['type'], id: string) => flat.findIndex((hit) => hit.type === type && hit.id === id);

  const open = (hit: Hit) => {
    if (hit.type === 'issue') openIssue(hit.id);
    else if (hit.type === 'project') router.push(`/projects/${hit.id}`);
    else if (hit.type === 'document') router.push(`/documents?id=${encodeURIComponent(hit.id)}`);
    else router.push(`/knowledge?id=${encodeURIComponent(hit.id)}`);
  };

  const renderHighlighted = (text: string) =>
    highlightSegments(text, deferredNeedle).map((segment, segmentIndex) =>
      segment.hit ? (
        <mark key={`${segment.text}-${segmentIndex}`} className="rounded-[2px] bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] px-0.5 text-t1">
          {segment.text}
        </mark>
      ) : (
        <span key={`${segment.text}-${segmentIndex}`}>{segment.text}</span>
      ),
    );

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6 sm:px-6">
      <div className="flex items-center gap-2">
        <Search size={15} className="text-t4" />
        <h1 className="text-[15px] font-[590] text-t1">{t('Search')}</h1>
      </div>
      <div className="mt-3 flex h-[38px] items-center gap-2 rounded-r8 bg-[var(--bg-elevated)] px-3 shadow-[inset_0_0_0_1px_var(--line-strong)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]">
        <Search size={13} className="shrink-0 text-t4" />
        <input
          data-global-search
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((current) => Math.min(current + 1, Math.max(0, flat.length - 1)));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((current) => Math.max(0, current - 1));
              return;
            }
            if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              open(flat[activeIndex]);
            }
          }}
          placeholder={t('Search issues, projects and knowledge…')}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-t1 outline-none placeholder:text-t4"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="shrink-0 rounded-r4 px-1.5 py-0.5 text-[11.5px] text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            {t('Clear')}
          </button>
        ) : null}
      </div>

      {parsed.terms.length || parsed.unknown.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-query-chips>
          {describeQuery(parsed).map((part) => (
            <span
              key={part}
              className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[11px] text-t3"
            >
              {part}
            </span>
          ))}
          {parsed.unknown.length ? (
            <span className="text-[11.5px] text-[var(--red)]" data-query-unknown>
              {t('Unknown filter: {q}', { q: parsed.unknown.join(', ') })}
            </span>
          ) : null}
        </div>
      ) : null}

      {!deferredNeedle ? (
        <div className="mt-4">
          <p className="text-[13px] text-t4">{t('Type to search across the workspace.')}</p>
          <p className="mt-1 font-mono text-[11.5px] text-t4" data-query-syntax>
            {t('status:todo · assignee:me · label:Bug · -priority:low · due:overdue · "exact phrase"')}
          </p>
          {recent.length ? (
            <div className="mt-3" data-search-recent>
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[.05em] text-t4">
                <span>{t('Recent searches')}</span>
                <button
                  type="button"
                  onClick={() => clearHistory()}
                  className="rounded-r4 px-1 py-0.5 text-[10.5px] normal-case tracking-normal text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
                >
                  {t('Clear')}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {recent.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    data-search-recent-item={entry}
                    onClick={() => setQuery(entry)}
                    className="rounded-full bg-[var(--bg-hover)] px-2.5 py-1 text-[12px] text-t2 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: 'issues', label: t('Issues'), icon: <CircleDot size={13} />, path: '/my-issues' },
              { key: 'projects', label: t('Projects'), icon: <Box size={13} />, path: '/projects' },
              { key: 'documents', label: t('Documents'), icon: <FileText size={13} />, path: '/documents' },
              { key: 'knowledge', label: t('Knowledge'), icon: <BookOpen size={13} />, path: '/knowledge' },
            ].map((shortcut) => (
              <button
                key={shortcut.key}
                type="button"
                data-search-shortcut={shortcut.key}
                onClick={() => router.push(shortcut.path)}
                className="flex h-[64px] flex-col items-start justify-center gap-1.5 rounded-r8 bg-[var(--bg-elevated)] px-3 text-left text-[13px] text-t2 shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
              >
                <span className="text-t4">{shortcut.icon}</span>
                {shortcut.label}
              </button>
            ))}
          </div>
        </div>
      ) : total === 0 ? (
        <p className="mt-4 text-[13px] text-t4" data-search-empty>
          {t('No results for "{q}"', { q: query })}
        </p>
      ) : (
        <div className={cn('mt-4 flex flex-col gap-4 transition-opacity', stale && 'opacity-60')}>
          {issueHits.length ? (
            <section data-search-group="issues">
              <h2 className="text-[11px] font-[510] uppercase tracking-[.05em] text-t4">{t('Issues')} · {issueHits.length}</h2>
              <div className="mt-1 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
                {issueHits.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    data-search-result="issue"
                    data-search-index={hitIndex('issue', issue.id)}
                    data-search-active={hitIndex('issue', issue.id) === activeIndex ? 'true' : undefined}
                    onClick={() => open({ type: 'issue', id: issue.id })}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2 text-left last:border-0 hover:bg-[var(--bg-hover)]',
                      hitIndex('issue', issue.id) === activeIndex && 'bg-[var(--bg-hover)]',
                    )}
                  >
                    <StatusIcon status={issue.status} size={12} />
                    <span className="tnum shrink-0 text-[11.5px] text-t4">{issue.key}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-t2">{renderHighlighted(issue.title)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {projectHits.length ? (
            <section data-search-group="projects">
              <h2 className="text-[11px] font-[510] uppercase tracking-[.05em] text-t4">{t('Projects')} · {projectHits.length}</h2>
              <div className="mt-1 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
                {projectHits.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    data-search-result="project"
                    data-search-index={hitIndex('project', project.id)}
                    data-search-active={hitIndex('project', project.id) === activeIndex ? 'true' : undefined}
                    onClick={() => open({ type: 'project', id: project.id })}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2 text-left last:border-0 hover:bg-[var(--bg-hover)]',
                      hitIndex('project', project.id) === activeIndex && 'bg-[var(--bg-hover)]',
                    )}
                  >
                    <Box size={12} className="shrink-0 text-t4" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-t2">{renderHighlighted(project.name)}</span>
                    <span className="shrink-0 text-[11.5px] text-t4">{project.status}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {documentHits.length ? (
            <section data-search-group="documents">
              <h2 className="text-[11px] font-[510] uppercase tracking-[.05em] text-t4">{t('Documents')} · {documentHits.length}</h2>
              <div className="mt-1 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
                {documentHits.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    data-search-result="document"
                    data-search-index={hitIndex('document', doc.id)}
                    data-search-active={hitIndex('document', doc.id) === activeIndex ? 'true' : undefined}
                    onClick={() => open({ type: 'document', id: doc.id })}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2 text-left last:border-0 hover:bg-[var(--bg-hover)]',
                      hitIndex('document', doc.id) === activeIndex && 'bg-[var(--bg-hover)]',
                    )}
                  >
                    <FileText size={12} className="shrink-0 text-t4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-t2">{renderHighlighted(doc.title)}</span>
                      {matchSnippet(doc.content, deferredNeedle) ? (
                        <span className="block truncate text-[11.5px] text-t4">
                          {renderHighlighted(matchSnippet(doc.content, deferredNeedle) ?? '')}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-t4">{t('Document')}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {knowledgeHits.length ? (
            <section data-search-group="knowledge">
              <h2 className="text-[11px] font-[510] uppercase tracking-[.05em] text-t4">{t('Knowledge')} · {knowledgeHits.length}</h2>
              <div className="mt-1 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
                {knowledgeHits.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-search-result="knowledge"
                    data-search-index={hitIndex('knowledge', item.id)}
                    data-search-active={hitIndex('knowledge', item.id) === activeIndex ? 'true' : undefined}
                    onClick={() => open({ type: 'knowledge', id: item.id })}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2 text-left last:border-0 hover:bg-[var(--bg-hover)]',
                      hitIndex('knowledge', item.id) === activeIndex && 'bg-[var(--bg-hover)]',
                    )}
                  >
                    <BookOpen size={12} className="shrink-0 text-t4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-t2">{renderHighlighted(item.title)}</span>
                      {matchSnippet(item.content, deferredNeedle) ? (
                        <span className="block truncate text-[11.5px] text-t4">
                          {renderHighlighted(matchSnippet(item.content, deferredNeedle) ?? '')}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-t4">{item.kind}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

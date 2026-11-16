'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Box,
  CalendarRange,
  ChevronDown,
  CircleUser,
  FileText,
  Inbox,
  LayoutList,
  Milestone,
  PanelLeft,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useUI } from '@/lib/store/ui';
import { useView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { useWorkspace } from '@/lib/agent/workspace';
import { runWorkflowNow } from '@/lib/agent/workflow-runner';
import { useT } from '@/lib/use-t';
import { projectProgress } from '@/lib/selectors';
import { cn, fuzzyScore, isImeComposing } from '@/lib/utils';
import { rememberCommand, useRecentCommands, clearRecentCommands } from '@/lib/recent';
import { usePeople } from '@/lib/people';
import { useIssueTemplates } from '@/lib/store/issue-templates';
import { currentUserId } from '@/lib/session';
import { Kbd } from '@/components/ui/primitives';
import { StatusIcon } from '@/components/ui/icons';

interface CommandItem {
  id: string;
  title: string;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  group: string;
  run: () => void;
}

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;

  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    while (from <= lower.length) {
      const idx = lower.indexOf(term, from);
      if (idx === -1) break;
      ranges.push([idx, idx + term.length]);
      from = idx + term.length;
    }
  }
  if (!ranges.length) return <>{text}</>;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <span key={`h-${start}`} className="text-t1">
        {text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

export function CommandMenu() {
  const router = useRouter();
  const open = useUI((s) => s.commandOpen);
  const initialQuery = useUI((s) => s.commandQuery);
  const close = useUI((s) => s.closeCommand);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const [collapsed, setCollapsed] = React.useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`linear-lab:command-collapsed:${currentUserId()}`) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 20) : [];
    } catch {
      return [];
    }
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem(`linear-lab:command-collapsed:${currentUserId()}`, JSON.stringify(collapsed));
    } catch {
      /* quota */
    }
  }, [collapsed]);

  const issues = useData((s) => s.issues);
  const projects = useData((s) => s.projects);
  const workflows = useWorkspace((s) => s.workflows);
  const knowledge = useWorkspace((s) => s.knowledge);
  const createIssue = useData((s) => s.createIssue);
  const openIssue = useView((s) => s.openIssue);
  const setViewMode = useView((s) => s.setViewMode);
  const selectedIds = useView((s) => s.selectedIds);
  const clearSelection = useView((s) => s.clearSelection);
  const meId = usePeople().meId;
  const templates = useIssueTemplates((s) => s.templates);
  const hydrateTemplates = useIssueTemplates((s) => s.hydrate);
  const applyTemplate = useIssueTemplates((s) => s.apply);
  const t = useT();

  const [query, setQuery] = React.useState(initialQuery);
  const [index, setIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  React.useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setIndex(0);
      void useWorkspace.getState().hydrate();
      hydrateTemplates();
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(initialQuery.length, initialQuery.length);
      }, 20);
    }
  }, [open, initialQuery, hydrateTemplates]);

  const creating = /^new\s+(.*)$/i.exec(query);
  const createTitle = creating?.[1]?.trim() ?? '';
  const searchQuery = creating ? '' : query;

  // Every entry the palette can offer, built once. Sections are slices of this,
  // and it is also what lets the "Recent" list resolve an id after a reload.
  const catalog = React.useMemo(() => {
    const nav: CommandItem[] = [
      { id: 'nav-inbox', title: t('Go to Inbox'), icon: <Inbox size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/inbox') },
      { id: 'nav-mine', title: t('Go to My issues'), icon: <CircleUser size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/my-issues') },
      { id: 'nav-pulse', title: t('Go to Pulse'), icon: <Activity size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/pulse') },
      { id: 'nav-projects', title: t('Go to Projects'), icon: <Box size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/projects') },
      { id: 'nav-roadmap', title: t('Go to Roadmap'), icon: <CalendarRange size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/roadmap') },
  { id: 'nav-cycles', title: t('Go to Cycles'), icon: <RefreshCw size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/cycles') },
  { id: 'nav-knowledge', title: t('Go to Knowledge'), icon: <BookOpen size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/knowledge') },
  { id: 'nav-documents', title: t('Go to Documents'), icon: <FileText size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/documents') },
  { id: 'nav-workflows', title: t('Go to Workflows'), icon: <Workflow size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/workflows') },
  { id: 'nav-agent', title: t('Ask the agent'), hint: <Kbd>⌘J</Kbd>, icon: <Sparkles size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => useUI.getState().openChat() },
  { id: 'nav-search', title: t('Go to Search'), icon: <Search size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/search') },
      { id: 'nav-team', title: t('Go to Engineering'), icon: <Milestone size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/team/ENG') },
      { id: 'nav-settings', title: t('Open settings'), icon: <Settings size={14} strokeWidth={1.8} />, group: 'Navigation', run: () => router.push('/settings') },
    ];

    const actions: CommandItem[] = [
      {
        id: 'new-knowledge',
        title: t('New knowledge note'),
        icon: <BookOpen size={14} strokeWidth={1.8} />,
        group: 'Create',
        run: () => router.push('/knowledge?new=note'),
      },
      {
        id: 'new-workflow',
        title: t('New workflow'),
        icon: <Workflow size={14} strokeWidth={1.8} />,
        group: 'Create',
        run: () => router.push('/workflows?new=1'),
      },
      {
        id: 'act-new-project',
        title: t('New project'),
        icon: <Box size={14} strokeWidth={1.8} />,
        group: 'Actions',
        run: () => router.push('/projects?new=1'),
      },
      {
        id: 'act-create',
        title: t('Create new issue'),
        hint: 'C',
        icon: <Plus size={14} strokeWidth={2} />,
        group: 'Actions',
        run: () => {
          close();
          useView.getState().setComposing('todo');
          window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-inline-composer]')?.focus(), 60);
        },
      },
      {
        id: 'act-toggle-sidebar',
        title: t('Toggle sidebar'),
        hint: '⌘\\',
        icon: <PanelLeft size={14} strokeWidth={1.8} />,
        group: 'Actions',
        run: toggleSidebar,
      },
      {
        id: 'act-view-list',
        title: t('Switch to list view'),
        hint: 'V L',
        icon: <Rows3 size={14} strokeWidth={1.8} />,
        group: 'Actions',
        run: () => setViewMode('list'),
      },
      {
        id: 'act-view-board',
        title: t('Switch to board view'),
        hint: 'V B',
        icon: <LayoutList size={14} strokeWidth={1.8} />,
        group: 'Actions',
        run: () => setViewMode('board'),
      },
      {
        id: 'act-filter',
        title: t('Filter by priority: Urgent'),
        icon: <SlidersHorizontal size={14} strokeWidth={1.8} />,
        group: 'Actions',
        run: () => {
          useView.getState().setFilter('priority', ['urgent']);
          close();
        },
      },
    ];

    // Selection-aware actions: only when the list/board has selected issues.
    const selection: CommandItem[] = selectedIds.length
      ? [
          {
            id: 'sel-done',
            title: t('Mark {n} selected as Done', { n: selectedIds.length }),
            group: 'Selection',
            icon: <ArrowRight size={14} strokeWidth={1.8} />,
            run: () => {
              const data = useData.getState();
              data.batchIssues(() => selectedIds.forEach((id) => data.setStatus(id, 'done')));
              clearSelection();
            },
          },
          {
            id: 'sel-assign-me',
            title: t('Assign {n} selected to me', { n: selectedIds.length }),
            group: 'Selection',
            icon: <CircleUser size={14} strokeWidth={1.8} />,
            run: () => {
              const data = useData.getState();
              data.batchIssues(() => selectedIds.forEach((id) => data.setAssignee(id, meId)));
              clearSelection();
            },
          },
          {
            id: 'sel-copy',
            title: t('Copy links for {n} selected', { n: selectedIds.length }),
            group: 'Selection',
            icon: <Search size={14} strokeWidth={1.8} />,
            run: () => {
              const data = useData.getState();
              const links = data.issues
                .filter((issue) => selectedIds.includes(issue.id))
                .map((issue) => `${window.location.origin}/team/${issue.teamKey}?issue=${issue.key}`)
                .join('\n');
              void navigator.clipboard?.writeText(links);
              clearSelection();
            },
          },
          {
            id: 'sel-delete',
            title: t('Delete {n} selected issues', { n: selectedIds.length }),
            group: 'Selection',
            icon: <Trash2 size={14} strokeWidth={1.8} />,
            run: () => {
              if (!window.confirm(t('Delete {n} selected issues?', { n: selectedIds.length }))) return;
              useData.getState().deleteIssues(selectedIds);
              clearSelection();
            },
          },
        ]
      : [];

    const templateItems: CommandItem[] = templates.map((template) => ({
      id: `tpl-${template.id}`,
      title: t('Create issue from “{name}”', { name: template.name }),
      group: 'Templates',
      icon: <FileText size={14} strokeWidth={1.8} />,
      run: () => {
        const issue = applyTemplate(template.id);
        if (issue) openIssue(issue.id);
      },
    }));

    const issueItems: CommandItem[] = issues.map((i) => ({
      id: `issue-${i.id}`,
      title: i.title,
      hint: i.key,
      group: 'Issues',
      icon: (
        <StatusIcon
          status={i.status}
          size={14}
          style={{
            color:
              i.status === 'in_progress'
                ? 'var(--status-progress)'
                : i.status === 'done'
                  ? 'var(--status-done)'
                  : i.status === 'in_review'
                    ? 'var(--status-review)'
                    : 'var(--status-todo)',
          }}
        />
      ),
      run: () => {
        close();
        openIssue(i.id);
      },
    }));

  const knowledgeItems: CommandItem[] = knowledge.map((item) => ({
    id: `knowledge-${item.id}`,
    title: item.title,
    hint: item.kind,
    group: 'Knowledge',
    icon: <BookOpen size={14} strokeWidth={1.8} />,
    run: () => router.push(`/knowledge?id=${item.id}`),
  }));

  const workflowItems: CommandItem[] = workflows.map((workflow) => ({
    id: `run-workflow-${workflow.id}`,
    title: t('Run workflow: {name}', { name: workflow.name }),
    group: 'Workflows',
    icon: <Workflow size={14} strokeWidth={1.8} />,
    run: () => {
      void runWorkflowNow(workflow);
    },
  }));

  const projectItems: CommandItem[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      title: p.name,
      hint: `${Math.round(projectProgress(issues, p.id).ratio * 100)}%`,
      group: 'Projects',
      icon: (
        <span className="grid h-4 w-4 place-items-center rounded-[4px] text-[10px]" style={{ background: `color-mix(in srgb, ${p.color} 20%, transparent)`, color: p.color }}>
          {p.icon}
        </span>
      ),
      run: () => router.push(`/projects/${p.id}`),
    }));

    return { nav, actions, selectionActions: selection, issueItems, projectItems, workflowItems, knowledgeItems, templateItems };
  }, [issues, router, close, openIssue, setViewMode, toggleSidebar, t, workflows, knowledge, selectedIds, meId, clearSelection, templates, applyTemplate, projects]);

  const itemById = React.useMemo(() => {
    const map = new Map<string, CommandItem>();
    for (const item of [...catalog.nav, ...catalog.actions, ...catalog.selectionActions, ...catalog.issueItems, ...catalog.projectItems, ...catalog.workflowItems, ...catalog.knowledgeItems, ...catalog.templateItems]) {
      map.set(item.id, item);
    }
    return map;
  }, [catalog]);

  const recentIds = useRecentCommands();

  const sections = React.useMemo(() => {
    const out: { title: string; items: CommandItem[] }[] = [];
    const q = query.trim();
    const lower = q.toLowerCase();
    const { nav, actions } = catalog;

    if (creating) {
      out.push({
        title: t('Create'),
        items: [
          {
            id: 'create-issue',
            title: createTitle
              ? t('Create issue: {title}', { title: createTitle })
              : t('Create new issue'),
            hint: '↵',
            icon: <Plus size={14} strokeWidth={2} />,
            group: 'Create',
            run: () => {
              const issue = createIssue({ title: createTitle || t('Untitled issue'), status: 'todo' });
              close();
              openIssue(issue.id);
            },
          },
        ],
      });
      return out;
    }

    const matchedIssues = q
      ? catalog.issueItems
          .map((item) => ({ item, s: Math.max(fuzzyScore(q, item.title), fuzzyScore(q, String(item.hint ?? '')) * 0.9) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 6)
          .map((x) => x.item)
      : [...issues]
          .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
          .slice(0, 4)
          .map((i) => itemById.get(`issue-${i.id}`))
          .filter((item): item is CommandItem => Boolean(item));

    const matchedActions = q
      ? actions.filter((a) => a.title.toLowerCase().includes(lower) || fuzzyScore(q, a.title) > 0)
      : actions.slice(0, 4);
    const matchedNav = q ? nav.filter((n) => fuzzyScore(q, n.title) > 0) : nav.slice(0, 2);
    const matchedProjects = q
      ? catalog.projectItems.filter((p) => fuzzyScore(q, p.title) > 0).slice(0, 3)
      : catalog.projectItems.slice(0, 2);
    const matchedWorkflows = q
      ? catalog.workflowItems.filter((item) => fuzzyScore(q, item.title) > 0).slice(0, 4)
      : catalog.workflowItems.slice(0, 2);
    const matchedKnowledge = q
      ? catalog.knowledgeItems.filter((item) => fuzzyScore(q, item.title) > 0).slice(0, 4)
      : catalog.knowledgeItems.slice(0, 2);

    const recentItems = !q
      ? recentIds
          .map((id) => itemById.get(id))
          .filter((item): item is CommandItem => Boolean(item))
          .slice(0, 4)
      : [];
    if (recentItems.length) out.push({ title: t('Recent'), items: recentItems });

    if (catalog.selectionActions.length) {
      const matchedSelection = q
        ? catalog.selectionActions.filter((item) => fuzzyScore(q, item.title) > 0)
        : catalog.selectionActions;
      if (matchedSelection.length) out.push({ title: t('Selection'), items: matchedSelection });
    }

    out.push({ title: t('Actions'), items: matchedActions });
    if (matchedIssues.length) out.push({ title: q ? t('Issues') : t('Recently updated'), items: matchedIssues });
    if (matchedProjects.length) out.push({ title: t('Projects'), items: matchedProjects });
    if (matchedWorkflows.length) out.push({ title: t('Workflows'), items: matchedWorkflows });
    if (matchedKnowledge.length) out.push({ title: t('Knowledge'), items: matchedKnowledge });
    if (catalog.templateItems.length) {
      const matchedTemplates = q
        ? catalog.templateItems.filter((item) => fuzzyScore(q, item.title) > 0)
        : catalog.templateItems.slice(0, 3);
      if (matchedTemplates.length) out.push({ title: t('Templates'), items: matchedTemplates });
    }
    if (matchedNav.length) out.push({ title: t('Navigation'), items: matchedNav });

    return out.filter((s) => s.items.length > 0);
  }, [query, creating, createTitle, issues, catalog, itemById, recentIds, close, createIssue, openIssue, t]);

  const visibleSections = React.useMemo(
    () => sections.filter((s) => !collapsed.includes(s.title)),
    [sections, collapsed],
  );

  const flat = React.useMemo(() => visibleSections.flatMap((s) => s.items), [visibleSections]);

  const runItem = React.useCallback(
    (item: CommandItem) => {
      if (itemById.has(item.id)) rememberCommand(item.id);
      item.run();
      // every palette entry dismisses the palette, including plain navigation
      close();
    },
    [itemById, close],
  );

  React.useEffect(() => setIndex(0), [query]);

  React.useEffect(() => {
    itemRefs.current[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (typeof document === 'undefined') return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      if (isImeComposing(e)) return;
      e.preventDefault();
      const item = flat[index];
      if (item) runItem(item);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    }
  };

  let cursor = -1;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[900] flex items-start justify-center px-4 pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.16, ease: EASE }}
        >
          <div
            className="absolute inset-0 bg-[rgba(8,9,10,.55)] backdrop-blur-[2px]"
            onClick={close}
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label={t('Command menu')}
            className="relative flex w-full max-w-[640px] flex-col overflow-hidden rounded-r12 bg-[var(--bg-command)] shadow-pop"
            onKeyDown={onKeyDown}
          >
            <div className="flex h-[52px] items-center gap-2.5 px-4">
              <Search size={16} strokeWidth={1.9} className="shrink-0 text-t4" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search issues, projects and commands…')}
                className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-t1 outline-none placeholder:text-t4"
                spellCheck={false}
                autoComplete="off"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-results"
                aria-autocomplete="list"
                aria-activedescendant={flat[index] ? `command-option-${index}` : undefined}
              />
              <Kbd className="shrink-0">esc</Kbd>
            </div>
            <div className="h-px w-full bg-[var(--line-subtle)]" />
            <div ref={listRef} id="command-results" role="listbox" aria-label={t('Command results')} className="max-h-[440px] min-h-[120px] overflow-y-auto p-1.5">
              {sections.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
                  <Sparkles size={16} className="text-t4" />
                  <div className="text-mini text-t2">{t('No results for "{q}"', { q: query })}</div>
                  <div className="text-[12.5px] text-t4">{t('Try a different keyword, or press ↵ to create an issue')}</div>
                </div>
              ) : (
                sections.map((section) => {
                  const isCollapsed = collapsed.includes(section.title);
                  return (
                  <div key={section.title} className="pb-1">
                    <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        onClick={() =>
                          setCollapsed((prev) =>
                            prev.includes(section.title)
                              ? prev.filter((x) => x !== section.title)
                              : [...prev, section.title],
                          )
                        }
                        className="flex items-center gap-1 rounded-r4 pr-1 text-[12px] font-[510] uppercase tracking-[.05em] text-t4 transition-colors hover:text-t2"
                      >
                        <ChevronDown
                          size={12}
                          strokeWidth={2}
                          className={cn('transition-transform duration-150', isCollapsed && '-rotate-90')}
                        />
                        {section.title}
                        <span className="tnum lowercase opacity-60">{section.items.length}</span>
                      </button>
                      {section.title === t('Recent') && !isCollapsed ? (
                        <button
                          type="button"
                          onClick={() => clearRecentCommands()}
                          className="rounded-r4 px-1 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
                        >
                          {t('Clear')}
                        </button>
                      ) : null}
                    </div>
                    {!isCollapsed && section.items.map((item) => {
                      cursor += 1;
                      const isActive = cursor === index;
                      const myIndex = cursor;
                      return (
                        <button
                          key={item.id}
                          ref={(el) => {
                            itemRefs.current[myIndex] = el;
                          }}
                          type="button"
                          id={`command-option-${myIndex}`}
                          role="option"
                          aria-selected={isActive}
                          onMouseMove={() => setIndex(myIndex)}
                          onClick={() => runItem(item)}
                          className={cn(
                            'flex h-[40px] w-full items-center gap-2.5 rounded-r6 px-2 text-left text-mini transition-colors duration-75',
                            isActive ? 'bg-[var(--bg-selected)] text-t1' : 'text-t2',
                          )}
                        >
                          <span className="grid h-4 w-4 shrink-0 place-items-center text-t4">{item.icon}</span>
                          <span className="min-w-0 flex-1 truncate">
                            <Highlight text={item.title} query={searchQuery} />
                          </span>
                          {item.hint ? (
                            <span className="shrink-0 text-[12.5px] text-t4">
                              {typeof item.hint === 'string' && /^[A-Z]+-\d+$/.test(item.hint) ? (
                                <span className="tnum">{item.hint}</span>
                              ) : (
                                item.hint
                              )}
                            </span>
                          ) : null}
                          {isActive ? <ArrowRight size={13} className="shrink-0 text-t4" /> : null}
                        </button>
                      );
                    })}
                  </div>
                  );
                })
              )}
            </div>
            <div className="flex h-[40px] items-center justify-between border-t border-[var(--line-subtle)] px-3 text-[12.5px] text-t4">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> {t('navigate')}
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>↵</Kbd> {t('select')}
                </span>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex">
                <span>{t('New issue')}</span>
                <Kbd>new&nbsp;title</Kbd>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

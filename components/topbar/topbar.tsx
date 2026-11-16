'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, PanelLeft, Plus } from 'lucide-react';
import { useUI } from '@/lib/store/ui';
import { useView } from '@/lib/store/view';
import { useData } from '@/lib/store/data';
import { useT } from '@/lib/use-t';
import { teamByKey } from '@/lib/mock-data';
import { selectVisibleIssues, countActiveFilters } from '@/lib/selectors';
import { cn, plural } from '@/lib/utils';
import { TeamIcon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/popover';
import { ActiveFilterChips, DisplayButton, FilterButton, SortButton, ViewSwitch, SavedViewsButton } from './view-menus';
import { SyncStatus } from '@/components/shell/sync-status';
import { TaskCenter } from '@/components/shell/task-center';

const TABS = [
  { key: 'all', label: 'All issues' },
  { key: 'active', label: 'Active' },
  { key: 'backlog', label: 'Backlog' },
] as const;

/** Shared by the desktop bar and the second row phones get. */
function ViewTabs({
  tab,
  setTab,
  className,
}: {
  tab: string;
  setTab: (key: 'all' | 'active' | 'backlog') => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {TABS.map((tabItem) => (
        <button
          key={tabItem.key}
          type="button"
          onClick={() => setTab(tabItem.key)}
          className={cn(
            'relative h-[26px] shrink-0 select-none rounded-r6 px-2 text-[13.5px] font-[510] transition-colors duration-100',
            tab === tabItem.key
              ? 'bg-[var(--bg-active)] text-t1'
              : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
          )}
        >
          {t(tabItem.label)}
        </button>
      ))}
    </div>
  );
}

/** The breadcrumb label for each top-level route. */
const SECTION_NAMES: [string, string][] = [
  ['/projects', 'Projects'],
  ['/inbox', 'Inbox'],
  ['/my-issues', 'My issues'],
  ['/settings', 'Settings'],
  ['/initiatives', 'Initiatives'],
  ['/roadmap', 'Roadmap'],
  ['/cycles', 'Cycles'],
  ['/knowledge', 'Knowledge'],
  ['/workflows', 'Workflows'],
  ['/search', 'Search'],
  ['/pulse', 'Pulse'],
  ['/reviews', 'Reviews'],
];

export function Topbar() {
  const pathname = usePathname();
  const t = useT();
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const openCommand = useUI((s) => s.openCommand);

  const { tab, setTab, filters, sort, scope, viewMode } = useView();
  const issues = useData((s) => s.issues);

  const match = pathname.match(/^\/team\/([^/]+)/i);
  const team = teamByKey.get((match?.[1] ?? 'eng').toLowerCase()) ?? teamByKey.get('eng')!;
  const isTeamView = Boolean(match);
  const viewName = SECTION_NAMES.find(([path]) => pathname.startsWith(path))?.[1] ?? 'Issues';

  const visible = selectVisibleIssues({ issues, tab, filters, sort, scope });
  const activeFilters = countActiveFilters(filters);

  return (
    <div className="window-drag sticky top-0 z-[100] shrink-0 bg-[color-mix(in_srgb,var(--bg-panel)_88%,transparent)] backdrop-blur-md">
      <div className="flex h-[44px] items-center gap-2 px-3 sm:px-4">
        {/* phones get a drawer trigger, desktop keeps the collapse toggle */}
        <IconButton
          data-mobile-hit
          aria-label={t('Open navigation')}
          onClick={() => setMobileNavOpen(true)}
          size={26}
          className="-ml-1 mr-0.5 text-t4 lg:hidden"
        >
          <PanelLeft size={15} strokeWidth={1.8} />
        </IconButton>
        {collapsed ? (
          <Tooltip label={t('Open sidebar')} shortcut="⌘\">
            <IconButton aria-label={t('Open sidebar')} onClick={toggleSidebar} size={26} className="-ml-1 mr-1 hidden text-t4 lg:grid">
              <PanelLeft size={15} strokeWidth={1.8} />
            </IconButton>
          </Tooltip>
        ) : null}

        {isTeamView ? (
          <Link
            href={`/team/${team.key}`}
            prefetch={false}
            className="flex h-[30px] min-w-0 items-center gap-1.5 rounded-r6 px-1 text-[14px] font-[510] text-t2 transition-colors duration-100 hover:bg-[var(--bg-active)] hover:text-t1"
          >
            <TeamIcon color={team.color} size={14} />
            <span className="truncate">{team.name}</span>
            <ChevronDown size={13} strokeWidth={1.9} className="text-t4" />
          </Link>
        ) : (
          <span className="flex h-[30px] items-center gap-1.5 px-1 text-[14px] font-[590] text-t1">
            <span className="grid h-[14px] w-[14px] place-items-center text-[var(--accent)]">
              <svg viewBox="0 0 32 32" className="h-3.5 w-3.5" fill="none">
                <ellipse cx="16" cy="16" rx="12" ry="5.4" stroke="currentColor" strokeWidth="2.4" transform="rotate(-28 16 16)" />
                <circle cx="16" cy="16" r="3.4" fill="currentColor" />
              </svg>
            </span>
            Aether
          </span>
        )}

        {isTeamView ? (
          <>
            <span className="hidden text-[14px] text-t4 lg:inline">/</span>
            <span className="hidden truncate text-[14px] font-[510] text-t2 lg:inline">{t(viewName)}</span>

            <div className="mx-1 hidden h-4 w-px bg-[var(--bg-selected)] lg:block" />

            <ViewTabs tab={tab} setTab={setTab} className="hidden sm:flex" />
          </>
        ) : (
          <>
            <span className="text-[14px] text-t4">/</span>
            <span className="truncate text-[14px] font-[510] text-t2">{t(viewName)}</span>
          </>
        )}

        <div className="flex-1" />

        <SyncStatus />
        <TaskCenter />

        {isTeamView ? (
          <>
            <span className="mr-1 hidden select-none text-[13px] text-t4 lg:inline tnum">{plural(visible.length, 'issue')}</span>
            <ViewSwitch />
            <div className="mx-0.5 hidden h-4 w-px bg-[var(--bg-selected)] sm:block" />
            <SavedViewsButton />
            <FilterButton activeCount={activeFilters} />
            <SortButton />
            <DisplayButton />
          </>
        ) : null}
        <Tooltip label={t('New issue')} shortcut="C">
          <IconButton
            data-mobile-hit
            aria-label={t('New issue')}
            onClick={() => openCommand('new ')}
            size={28}
            className="ml-0.5 bg-[var(--bg-active)] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-[var(--bg-selected)] hover:text-t1"
          >
            <Plus size={15} strokeWidth={2} />
          </IconButton>
        </Tooltip>
      </div>

      {/* phones: the tab row moves to its own line so the title bar keeps breathing room */}
      {isTeamView ? (
        <div className="flex h-[40px] items-center overflow-x-auto px-2 [scrollbar-width:none] sm:hidden">
          <ViewTabs tab={tab} setTab={setTab} />
        </div>
      ) : null}

      {isTeamView && activeFilters > 0 ? <ActiveFilterChips /> : null}
      {isTeamView && viewMode === 'board' && activeFilters === 0 ? (
        <div className="h-[1px] w-full bg-[var(--line-subtle)]" />
      ) : null}
    </div>
  );
}

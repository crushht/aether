'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  BookOpen,
  Box,
  CalendarRange,
  FileText,
  ChevronDown,
  CircleUser,
  GitPullRequest,
  Inbox,
  Milestone,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react';
import { useUI } from '@/lib/store/ui';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useIsMobile } from '@/lib/use-media';
import { useT } from '@/lib/use-t';
import { teams } from '@/lib/mock-data';
import { usePeople } from '@/lib/people';
import { cn } from '@/lib/utils';
import { actionableUnread } from '@/lib/notification-snooze';
import { Avatar, IconButton, Kbd } from '@/components/ui/primitives';
import { MenuItem, MenuSeparator, Popover } from '@/components/ui/popover';
import { StatusIcon, TeamIcon } from '@/components/ui/icons';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

function NavRow({
  icon,
  label,
  href,
  active,
  badge,
  onClick,
  trailing,
  indent,
  meta,
}: {
  icon?: React.ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  badge?: React.ReactNode;
  onClick?: () => void;
  trailing?: React.ReactNode;
  indent?: boolean;
  meta?: React.ReactNode;
}) {
  const content = (
    <>
      {icon ? <span className="grid h-[14px] w-[14px] shrink-0 place-items-center text-t4">{icon}</span> : null}
      <span className={cn('min-w-0 flex-1 truncate', active ? 'text-t1' : 'text-t2')}>{label}</span>
      {meta}
      {badge}
      {trailing}
    </>
  );

  const cls = cn(
    'group/nav flex h-[30px] w-full select-none items-center gap-2 rounded-r8 px-[7px] text-left text-[14px] font-[510]',
    'transition-[background-color,color] duration-100 ease-out',
    indent && 'pl-[27px]',
    active
      ? 'bg-[var(--bg-active)] text-t1'
      : 'text-t2 hover:bg-[var(--bg-hover)] hover:text-t1',
  );

  if (href) {
    return (
      <Link href={href} className={cls} prefetch={false}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {content}
    </button>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="group/section flex h-[24px] items-center">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-[24px] min-w-0 flex-1 items-center gap-1.5 rounded-r6 pl-1.5 text-left text-[13px] font-[510] text-t4 transition-colors duration-100 hover:text-t2"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={cn('shrink-0 transition-transform duration-160 ease-out', !open && '-rotate-90')}
        />
      </button>
      {action ? <div className="pr-1 opacity-0 transition-opacity group-hover/section:opacity-100">{action}</div> : null}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const openCommand = useUI((s) => s.openCommand);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const issues = useData((s) => s.issues);
  const openIssue = useView((s) => s.openIssue);

  const [openSections, setOpenSections] = React.useState({ workspace: true, favorites: true, teams: true });
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLSpanElement>(null);
  const toggle = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const isMobile = useIsMobile();
  const t = useT();

  // the drawer is a route-level thing: navigating closes it (Linear does the same)
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  React.useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen, setMobileNavOpen]);

  const starred = issues.filter((i) => i.starred).slice(0, 4);
  const readNotifications = useUI((s) => s.readNotifications);
  const notifications = useData((s) => s.notifications);
  const inboxCount = actionableUnread(notifications, readNotifications);
  const { meId, userById } = usePeople();
  const mine = issues.filter((i) => (i.assigneeId === meId || i.creatorId === meId) && i.status !== 'done' && i.status !== 'canceled').length;

  const isTeam = pathname.startsWith('/team/');

  /* phones: swipe the drawer left to dismiss. `pan-y` on the drawer keeps the
     vertical list native while horizontal gestures come to us as pointers. */
  const swipe = React.useRef<{ x: number; y: number; horizontal: boolean } | null>(null);
  const swipeDxRef = React.useRef(0);
  const swipeMoved = React.useRef(false);
  const [swipeDx, setSwipeDx] = React.useState(0);
  const [swiping, setSwiping] = React.useState(false);

  const onDrawerDown = (e: React.PointerEvent) => {
    if (!isMobile || !mobileNavOpen || e.pointerType === 'mouse') return;
    swipe.current = { x: e.clientX, y: e.clientY, horizontal: false };
    swipeMoved.current = false;
  };

  const onDrawerMove = (e: React.PointerEvent) => {
    const s = swipe.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.horizontal) {
      if (Math.abs(dx) < 12) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.1) {
        swipe.current = null; // it's a scroll
        return;
      }
      s.horizontal = true;
      setSwiping(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    swipeDxRef.current = Math.min(0, dx);
    setSwipeDx(swipeDxRef.current);
    if (Math.abs(dx) > 8) swipeMoved.current = true;
  };

  const onDrawerUp = () => {
    const s = swipe.current;
    swipe.current = null;
    const dx = swipeDxRef.current;
    swipeDxRef.current = 0;
    setSwipeDx(0);
    setSwiping(false);
    if (s?.horizontal && dx < -64) setMobileNavOpen(false);
    window.setTimeout(() => {
      swipeMoved.current = false;
    }, 80);
  };

  /*
   * No edge-swipe-to-open: a left-edge drag belongs to the browser/OS back
   * gesture (Chrome Android and Safari both claim it), so the drawer keeps its
   * explicit entry points — the hamburger, ⌘\ — and only the close gesture.
   */

  return (
    <>
      {/* scrim: below lg the sidebar floats above the content */}
      <div
        aria-hidden
        onClick={() => setMobileNavOpen(false)}
        style={swiping ? { opacity: Math.max(0, Math.min(1, 1 + swipeDx / 267)), transition: 'none' } : undefined}
        className={cn(
          'fixed inset-0 z-[440] bg-[rgba(8,9,10,.55)] backdrop-blur-[1px] transition-opacity duration-160 ease-out lg:hidden',
          mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        aria-hidden={isMobile ? !mobileNavOpen : collapsed}
        inert={isMobile ? !mobileNavOpen : collapsed}
        aria-label="Workspace navigation"
        data-open={mobileNavOpen}
        onPointerDown={onDrawerDown}
        onPointerMove={onDrawerMove}
        onPointerUp={onDrawerUp}
        onPointerCancel={onDrawerUp}
        onClickCapture={(e) => {
          // a swipe should not also activate the nav item under the finger
          if (swipeMoved.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={swiping ? { transform: `translateX(${swipeDx}px)`, transition: 'none' } : undefined}
        className={cn(
          'z-20 h-full shrink-0 overflow-hidden max-lg:touch-pan-y',
          'transition-[width,opacity,transform] duration-[240ms] ease-[cubic-bezier(.25,.46,.45,.94)]',
          // below lg: an overlay drawer, never a column
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-[450] max-lg:w-[264px] max-lg:bg-base',
          'max-lg:shadow-[1px_0_0_var(--line-subtle),28px_0_64px_rgba(0,0,0,.45)]',
          mobileNavOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-[101%]',
          // lg and up: the classic width collapse
          collapsed ? 'lg:w-0 lg:opacity-0' : 'lg:w-[232px] lg:opacity-100',
        )}
      >
      <div className="drawer-body flex h-full w-full flex-col pb-2 pl-2 pr-4 pt-2 lg:w-[232px]">
        {/* workspace switcher + quick actions */}
        <div className="mb-1 flex h-[30px] items-center justify-between">
          <button
            type="button"
            className="flex h-[30px] items-center gap-1.5 rounded-r8 px-1 text-left text-[14px] font-[590] text-t1 transition-colors duration-100 hover:bg-[var(--bg-hover)]"
          >
            <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-[linear-gradient(145deg,#7c86e8,#5e6ad2_58%,#4c56b8)] shadow-[inset_0_1px_0_rgba(255,255,255,.24),0_1px_2px_rgba(9,10,12,.12)]">
              <svg width="13" height="13" viewBox="0 0 32 32" fill="none" aria-hidden>
                <ellipse cx="16" cy="16" rx="12" ry="5.4" stroke="white" strokeOpacity=".72" strokeWidth="1.8" transform="rotate(-28 16 16)" />
                <ellipse cx="16" cy="16" rx="12" ry="5.4" stroke="white" strokeOpacity=".34" strokeWidth="1.5" transform="rotate(32 16 16)" />
                <circle cx="16" cy="16" r="3.2" fill="white" />
              </svg>
            </span>
            <span className="tracking-[-0.01em]">Aether</span>
            <ChevronDown size={14} strokeWidth={1.9} className="ml-0.5 text-t4" />
          </button>
          <div className="flex items-center gap-1.5">
            <IconButton aria-label={t('Search')} onClick={() => openCommand()} size={28}>
              <Search size={15} strokeWidth={1.8} />
            </IconButton>
            <IconButton
              aria-label={t('New issue')}
              onClick={() => openCommand('new ')}
              size={28}
              className="bg-[var(--bg-hover)] text-t2 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-[var(--bg-active)]"
            >
              <svg viewBox="0 0 14 14" className="h-[15px] w-[15px]" fill="none">
                <path d="M2.6 2.6h8.8v8.8H2.6z" stroke="currentColor" strokeWidth="1.4" />
                <path d="M6.6 4.9 4.4 7.1l2.2 2.2M9.7 4.9v4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2 pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* primary nav */}
          <div className="flex flex-col gap-[2px] pt-1">
            <NavRow
              icon={<Activity size={14} strokeWidth={1.8} />}
              label={t('Pulse')}
              href="/pulse"
              active={pathname.startsWith('/pulse')}
            />
            <NavRow
              icon={<Inbox size={14} strokeWidth={1.8} />}
              label={t('Inbox')}
              href="/inbox"
              active={pathname.startsWith('/inbox')}
              badge={
                inboxCount > 0 ? (
                  <span data-inbox-badge className="rounded-full bg-[var(--bg-selected)] px-1.5 text-[12px] font-[510] leading-[16px] text-t3">
                    {inboxCount}
                  </span>
                ) : null
              }
            />
            <NavRow
              icon={<CircleUser size={14} strokeWidth={1.8} />}
              label={t('My issues')}
              href="/my-issues"
              active={pathname.startsWith('/my-issues')}
              badge={<span className="text-[12px] text-t4">{mine}</span>}
            />
            <button
              type="button"
              onClick={() => useUI.getState().openChat(pathname.match(/^\/projects\/([^/]+)/)?.[1])}
              className="flex h-[30px] w-full items-center gap-2 rounded-r8 px-[7px] text-left text-[14px] font-[510] text-t2 transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-t1"
              data-agent-chat-entry
            >
              <span className="grid h-[14px] w-[14px] place-items-center text-t3">
                <Sparkles size={14} strokeWidth={1.8} />
              </span>
              <span className="truncate">{t('Agent')}</span>
              <span className="ml-auto hidden text-[12px] text-t4 lg:inline">⌘J</span>
            </button>
            <NavRow
              icon={<GitPullRequest size={14} strokeWidth={1.8} />}
              label={t('Reviews')}
              href="/reviews"
              active={pathname.startsWith('/reviews')}
            />
          </div>

          <div className="my-2 h-px bg-[var(--bg-active)]" />

          <SectionHeader
            label={t('Workspace')}
            open={openSections.workspace}
            onToggle={() => toggle('workspace')}
            action={
              <IconButton aria-label={t('Workspace actions')} size={18} className="text-t4">
                <Plus size={13} strokeWidth={2} />
              </IconButton>
            }
          />
          <AnimatePresence initial={false}>
            {openSections.workspace ? (
              <motion.div
                key="workspace"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-[2px]">
                  <NavRow icon={<Milestone size={14} strokeWidth={1.8} />} label={t('Initiatives')} href="/initiatives" active={pathname.startsWith('/initiatives')} />
                  <NavRow icon={<Box size={14} strokeWidth={1.8} />} label={t('Projects')} href="/projects" active={pathname.startsWith('/projects')} />
                  <NavRow icon={<CalendarRange size={14} strokeWidth={1.8} />} label={t('Roadmap')} href="/roadmap" active={pathname.startsWith('/roadmap')} />
                  <NavRow icon={<RefreshCw size={14} strokeWidth={1.8} />} label={t('Cycles')} href="/cycles" active={pathname.startsWith('/cycles')} />
                  <NavRow icon={<BookOpen size={14} strokeWidth={1.8} />} label={t('Knowledge')} href="/knowledge" active={pathname.startsWith('/knowledge')} />
                  <NavRow icon={<FileText size={14} strokeWidth={1.8} />} label={t('Documents')} href="/documents" active={pathname.startsWith('/documents')} />
                  <NavRow icon={<Workflow size={14} strokeWidth={1.8} />} label={t('Workflows')} href="/workflows" active={pathname.startsWith('/workflows')} />
                  <span ref={moreRef} className="block">
                    <NavRow
                      icon={<MoreHorizontal size={14} strokeWidth={1.8} />}
                      label={t('More')}
                      active={moreOpen}
                      onClick={() => setMoreOpen((v) => !v)}
                    />
                  </span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} width={210} align="start">
            <MenuItem
              icon={<CalendarRange size={13} strokeWidth={1.8} />}
              label={t('Roadmap')}
              onSelect={() => {
                setMoreOpen(false);
                router.push('/roadmap');
              }}
            />
            <MenuItem
              icon={<Milestone size={13} strokeWidth={1.8} />}
              label={t('Initiatives')}
              onSelect={() => {
                setMoreOpen(false);
                router.push('/initiatives');
              }}
            />
            <MenuItem
              icon={<RefreshCw size={13} strokeWidth={1.8} />}
              label={t('Cycles')}
              onSelect={() => {
                setMoreOpen(false);
                router.push('/cycles');
              }}
            />
            <MenuSeparator />
            <MenuItem
              icon={<Users size={13} strokeWidth={1.8} />}
              label={t('Members')}
              onSelect={() => {
                setMoreOpen(false);
                router.push('/settings/members');
              }}
            />
            <MenuItem
              icon={<Settings size={13} strokeWidth={1.8} />}
              label={t('Workspace settings')}
              onSelect={() => {
                setMoreOpen(false);
                router.push('/settings');
              }}
            />
          </Popover>

          <div className="my-2 h-px bg-[var(--bg-active)]" />

          {starred.length ? (
            <>
              <SectionHeader
                label={t('Favorites')}
                open={openSections.favorites}
                onToggle={() => toggle('favorites')}
              />
              <AnimatePresence initial={false}>
            {openSections.favorites ? (
              <motion.div
                key="favorites"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-[2px]">
                  {starred.map((issue) => (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => openIssue(issue.id)}
                      className="flex h-[30px] w-full items-center gap-2 rounded-r8 px-[7px] text-left text-[14px] font-[510] text-t2 transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-t1"
                    >
                      <span className="grid h-[14px] w-[14px] shrink-0 place-items-center">
                        <StatusIcon
                          status={issue.status}
                          size={14}
                          style={{
                            color:
                              issue.status === 'in_progress'
                                ? 'var(--status-progress)'
                                : issue.status === 'done'
                                  ? 'var(--status-done)'
                                  : issue.status === 'in_review'
                                    ? 'var(--status-review)'
                                    : 'var(--status-todo)',
                          }}
                        />
                      </span>
                      <span className="truncate">{issue.title}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
            </>
          ) : null}

          <div className="my-2 h-px bg-[var(--bg-active)]" />

          <SectionHeader label={t('Teams')} open={openSections.teams} onToggle={() => toggle('teams')} />
          <AnimatePresence initial={false}>
            {openSections.teams ? (
              <motion.div
                key="teams"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-[2px]">
                  {teams.map((team) => (
                    <NavRow
                      key={team.id}
                      icon={<TeamIcon color={team.color} size={14} />}
                      label={team.name}
                      href={`/team/${team.key}`}
                      active={pathname.toLowerCase().startsWith(`/team/${team.key.toLowerCase()}`) && team.key === 'ENG' && isTeam}
                    />
                  ))}
                  <NavRow icon={<Users size={14} strokeWidth={1.8} />} label={t('Members')} href="/settings/members" active={pathname.startsWith('/settings/members')} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* footer */}
        <div className="mt-1 border-t border-[var(--line-subtle)] pt-1.5">
          <button
            type="button"
            onClick={() => openCommand('invite')}
            className="flex h-[24px] w-full items-center gap-2 rounded-r6 px-1.5 text-left text-[13.5px] text-t3 transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <span className="grid h-[15px] w-[15px] place-items-center rounded-[4px] border border-dashed border-[var(--line-strong)] text-t4">
              <Plus size={10} strokeWidth={2.2} />
            </span>
            {t('Invite people')}
          </button>
          <button
            type="button"
            onClick={() => openCommand("what's new")}
            className="flex h-[24px] w-full items-center gap-2 rounded-r6 px-1.5 text-left text-[13.5px] text-t3 transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <span className="grid h-[15px] w-[15px] place-items-center text-t4">
              <Sparkles size={13} strokeWidth={1.8} />
            </span>
            {t("What's new")}
          </button>
          <div className="flex h-[40px] items-center gap-2 rounded-r6 px-1 transition-colors duration-100 hover:bg-[var(--bg-hover)]">
            <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2">
              <span className="relative">
                <Avatar name={userById.get(meId)?.name ?? t('Me')} color={userById.get(meId)?.color ?? '#5E6AD2'} size="md" />
                <span className="absolute -bottom-px -right-px h-[7px] w-[7px] rounded-full bg-[#27a644] shadow-[0_0_0_1.5px_var(--bg-base)]" />
              </span>
              <span className="truncate text-[13.5px] font-[510] text-t2">{userById.get(meId)?.name ?? t('Me')}</span>
            </Link>
            <IconButton aria-label={t('Settings')} size={24} onClick={() => openCommand('settings')} className="text-t4">
              <Settings size={14} strokeWidth={1.8} />
            </IconButton>
          </div>
          <div className="mt-1 hidden items-center gap-1 px-1 text-[12px] text-t4 lg:flex">
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex items-center gap-1 rounded-r4 px-1 py-0.5 transition-colors hover:bg-[var(--bg-active)] hover:text-t3"
            >
              <Kbd>⌘</Kbd>
              <Kbd>\</Kbd>
              <span className="ml-0.5">{t('Collapse')}</span>
            </button>
          </div>
        </div>
      </div>
      </aside>
    </>
  );
}

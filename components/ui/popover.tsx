'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, clamp } from '@/lib/utils';

export const EASE_OUT: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

/* ------------------------------------------------------------------ */
/* Popover                                                             */
/* ------------------------------------------------------------------ */

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  offset?: number;
  width?: number;
  className?: string;
  matchAnchorWidth?: boolean;
  zIndex?: number;
}

export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = 'start',
  side = 'bottom',
  offset = 6,
  width,
  className,
  matchAnchorWidth,
  /*
   * 760 keeps menus above the issue drawer (z 700) while staying under the
   * command menu (900) / help sheet (910). Anything lower made every picker
   * opened from the drawer's property rail paint underneath the drawer panel.
   */
  zIndex = 760,
}: PopoverProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ left: 0, top: 0, ready: false });

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const pw = matchAnchorWidth ? r.width : panel?.offsetWidth ?? width ?? 240;
      const ph = panel?.offsetHeight ?? 0;
      let left =
        align === 'start' ? r.left : align === 'end' ? r.right - pw : r.left + r.width / 2 - pw / 2;
      let top = side === 'bottom' ? r.bottom + offset : r.top - ph - offset;
      if (side === 'bottom' && top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - offset);
      if (side === 'top' && top < 8) top = r.bottom + offset;
      left = clamp(left, 8, Math.max(8, window.innerWidth - pw - 8));
      top = clamp(top, 8, Math.max(8, window.innerHeight - ph - 8));
      setPos({ left, top, ready: true });
    };
    place();
    const ro = new ResizeObserver(place);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, side, offset, width, matchAnchorWidth, anchorRef]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          // portals keep React's event tree: without this, a menu opened inside a
          // clickable row would bubble its clicks up and open the row itself
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.985, y: side === 'bottom' ? -4 : 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.99, y: side === 'bottom' ? -2 : 2, transition: { duration: 0.1 } }}
          transition={{ duration: 0.14, ease: EASE_OUT }}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            width: matchAnchorWidth ? undefined : width,
            minWidth: matchAnchorWidth ? undefined : undefined,
            zIndex,
            visibility: pos.ready ? 'visible' : 'hidden',
            transformOrigin: side === 'bottom' ? 'top left' : 'bottom left',
          }}
          className={cn(
            'rounded-r8 bg-elevated p-1 text-t2 shadow-menu',
            'max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Menu building blocks                                                */
/* ------------------------------------------------------------------ */

export function MenuLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('px-2 pb-1 pt-1.5 text-[12px] font-[510] uppercase tracking-[.04em] text-t4', className)}>
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-[var(--line)]" />;
}

export function MenuItem({
  icon,
  label,
  hint,
  checked,
  danger,
  disabled,
  onSelect,
  selected,
  className,
  children,
}: {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  selected?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex h-[30px] w-full select-none items-center gap-2 rounded-r6 px-2 text-left text-mini',
        'transition-colors duration-75 ease-out',
        'hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-[#f08080] hover:bg-[rgba(235,87,87,.1)]' : 'text-t2 hover:text-t1',
        selected && 'bg-[var(--bg-hover)] text-t1',
        className,
      )}
    >
      {icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center text-t4">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label ?? children}</span>
      {checked ? (
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 shrink-0 text-t2" fill="none">
          <path d="M2.8 7.4 5.5 10 11 4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {hint ? <span className="shrink-0 text-[12px] text-t4">{hint}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export function Tooltip({
  label,
  shortcut,
  children,
  side = 'bottom',
  delay = 260,
  className,
}: {
  label: React.ReactNode;
  shortcut?: string;
  children: React.ReactNode;
  side?: 'bottom' | 'top' | 'right';
  delay?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);
  const timer = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ left: 0, top: 0 });

  // keep the tip inside the viewport once it has been measured
  React.useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!open || !tip) return;
    const r = tip.getBoundingClientRect();
    const pad = 8;
    if (side === 'right') {
      const top = Math.min(Math.max(r.top, pad), window.innerHeight - r.height - pad);
      tip.style.top = `${top}px`;
    } else {
      const center = pos.left;
      const left = Math.min(Math.max(center, pad + r.width / 2), window.innerWidth - pad - r.width / 2);
      tip.style.left = `${left}px`;
    }
  }, [open, pos, side]);

  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (side === 'right') setPos({ left: r.right + 8, top: r.top + r.height / 2 });
      else setPos({ left: r.left + r.width / 2, top: side === 'bottom' ? r.bottom + 6 : r.top - 6 });
      setOpen(true);
    }, delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };
  React.useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide} className={cn('inline-flex', className)}>
        {children}
      </span>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tipRef}
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                transform:
                  side === 'right'
                    ? 'translate(0, -50%)'
                    : side === 'bottom'
                      ? 'translate(-50%, 0)'
                      : 'translate(-50%, -100%)',
                zIndex: 1100,
              }}
              className="pointer-events-none flex select-none items-center gap-2 whitespace-nowrap rounded-r6 bg-[var(--bg-float)] px-2 py-[5px] text-[13px] text-t2 shadow-[0_6px_18px_rgba(0,0,0,.4),inset_0_0_0_1px_var(--float-ring)] animate-fade-in"
            >
              {label}
              {shortcut ? <span className="text-[12px] text-t4">{shortcut}</span> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useUI } from '@/lib/store/ui';
import { cn } from '@/lib/utils';
import { CheckMark } from './icons';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[800] flex flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={cn(
              'pointer-events-auto flex min-w-[260px] max-w-[420px] items-center gap-2.5 rounded-r8 px-2.5 py-2',
              'bg-[var(--bg-float)] text-t2 shadow-[0_12px_36px_rgba(0,0,0,.5),inset_0_0_0_1px_var(--float-ring)]',
            )}
          >
            <span
              className={cn(
                'grid h-4 w-4 shrink-0 place-items-center rounded-full',
                t.tone === 'danger' ? 'bg-[rgba(235,87,87,.18)] text-[#f08080]' : 'bg-[rgba(94,106,210,.2)] text-[#9aa4ff]',
              )}
            >
              <CheckMark width={10} height={10} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-mini text-t1">{t.title}</div>
              {t.description ? <div className="truncate text-[12.5px] text-t4">{t.description}</div> : null}
            </div>
            {t.actionLabel ? (
              <button
                type="button"
                onClick={() => {
                  t.onAction?.();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded-r4 px-1.5 py-0.5 text-[13px] font-[510] text-t2 transition-colors hover:bg-[var(--bg-selected)] hover:text-t1"
              >
                {t.actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-r4 text-t4 transition-colors hover:bg-[var(--bg-selected)] hover:text-t2"
            >
              <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

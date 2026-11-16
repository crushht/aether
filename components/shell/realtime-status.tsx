'use client';

import { WifiOff } from 'lucide-react';
import { useRealtime } from '@/lib/store/workspace-events';
import { useT } from '@/lib/use-t';

/** A quiet strip that only appears when the workspace stream drops. */
export function RealtimeStatus() {
  const connected = useRealtime((s) => s.connected);
  const t = useT();
  if (connected) return null;
  return (
    <div
      data-realtime-offline
      role="status"
      className="pointer-events-none fixed bottom-3 left-1/2 z-[700] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-[11.5px] text-t3 shadow-pop"
    >
      <WifiOff size={11} className="text-t4" />
      {t('Live updates paused — reconnecting…')}
    </div>
  );
}

'use client';

import { create } from 'zustand';
import { useData } from './data';

/**
 * One EventSource per visible tab. Hidden tabs close the stream so a laptop
 * with ten tabs does not hold ten long-lived connections; coming back
 * reconnects. `useRealtime` exposes the stream's health to the shell so a
 * dropped connection is visible instead of silently stale.
 */

export const useRealtime = create<{ connected: boolean }>(() => ({ connected: true }));

let source: EventSource | null = null;
let cleanup: (() => void) | null = null;

const isSupported = () => typeof window !== 'undefined' && typeof EventSource !== 'undefined';

function connect() {
  if (!isSupported() || source) return;
  const events = new EventSource('/api/workspace/events');
  source = events;
  events.addEventListener('open', () => useRealtime.setState({ connected: true }));
  events.addEventListener('error', () => useRealtime.setState({ connected: false }));
  events.addEventListener('change', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as { updatedAt?: number };
      if (typeof data.updatedAt === 'number') useData.getState().noteRemoteChange(data.updatedAt);
    } catch {
      /* malformed frame */
    }
  });
}

function disconnect() {
  source?.close();
  source = null;
}

export function startWorkspaceEvents() {
  if (!isSupported()) return () => undefined;
  if (cleanup) return cleanup;

  connect();
  const onVisibility = () => {
    if (document.hidden) disconnect();
    else connect();
  };
  document.addEventListener('visibilitychange', onVisibility);

  cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    disconnect();
    useRealtime.setState({ connected: true });
    cleanup = null;
  };
  return cleanup;
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_REALTIME__?: typeof useRealtime }).__AETHER_REALTIME__ = useRealtime;
}

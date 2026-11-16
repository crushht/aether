'use client';

import * as React from 'react';

/**
 * Small, SSR-safe media query hook.
 *
 * The first render (server + hydration) always reports `false`, so markup stays
 * identical on both sides; the real value lands in the same effect that reads
 * matchMedia. Only use it for behaviour (which element a click drives, whether
 * a pointer can drag) — layout decisions belong in CSS breakpoints, otherwise
 * the phone gets a frame of desktop chrome before the effect runs.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);

  return matches;
}

/** Below the `lg` breakpoint the sidebar becomes an overlay drawer. */
export const useIsMobile = () => useMediaQuery('(max-width: 1023px)');

/** Touch devices: no hover affordances, and card drag has to yield to scrolling. */
export const useCoarsePointer = () => useMediaQuery('(hover: none) and (pointer: coarse)');

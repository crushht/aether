'use client';

import * as React from 'react';
import { useT } from '@/lib/use-t';

/**
 * Segment-level boundary for the workspace shell: keeps the sidebar/route
 * chrome alive and offers a retry instead of a white screen.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const [detail, setDetail] = React.useState(false);

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-3 px-6 py-16" role="alert">
      <h1 className="text-[16px] font-[590] text-t1">{t('Something broke on this screen')}</h1>
      <p className="text-[13px] leading-[1.6] text-t3">
        {t('The rest of the app still works. Retry, and if it repeats, copy the details below.')}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="h-[30px] rounded-r6 bg-[var(--accent)] px-3 text-[13px] font-[510] text-[var(--accent-fg)] hover:opacity-90"
        >
          {t('Retry')}
        </button>
        <button
          type="button"
          onClick={() => setDetail((open) => !open)}
          className="h-[30px] rounded-r6 px-2 text-[12.5px] text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
        >
          {detail ? t('Hide details') : t('Show details')}
        </button>
      </div>
      {detail ? (
        <pre
          data-error-detail
          className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-r8 bg-[var(--bg-elevated)] p-3 text-[11.5px] leading-[1.55] text-t3 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
        >
          {error.message || 'Unknown error'}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
      ) : null}
    </div>
  );
}

'use client';

import * as React from 'react';
import { Loader2, X } from 'lucide-react';
import { ToolCardPanel } from '@/components/agent/chat/tool-card';
import { inspectCardFromResponse, inspectRequestBody } from '@/lib/agent/inspect-report';
import type { InspectCard } from '@/lib/agent/tool-cards';
import type { IssueAttachment } from '@/lib/types';
import { useT } from '@/lib/use-t';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; card: InspectCard };

/**
 * Static triage of one issue attachment, run through the same endpoint the
 * agent uses (`/api/agent/inspect`). The bytes never leave the request and the
 * report renders with the transcript's card body, so a hash or an indicator
 * reads the same in both places.
 */
export function AttachmentAnalysis({ file, onClose }: { file: IssueAttachment; onClose: () => void }) {
  const t = useT();
  const [state, setState] = React.useState<State>({ status: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    const body = inspectRequestBody(file);
    if (!body) {
      setState({ status: 'error', message: t('This attachment carries no bytes to analyze.') });
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const response = await fetch('/api/agent/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (cancelled) return;
        const card = response.ok ? inspectCardFromResponse(json) : null;
        if (!card) {
          setState({ status: 'error', message: (json && json.error) || t('Analysis failed') });
          return;
        }
        setState({ status: 'ready', card });
      } catch {
        if (!cancelled) setState({ status: 'error', message: t('Analysis failed') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, t]);

  return (
    <div
      data-attachment-analysis
      role="dialog"
      aria-modal="true"
      aria-label={`${t('Artifact analysis')} ${file.name}`}
      className="fixed inset-0 z-[950] flex items-center justify-center bg-[rgba(8,9,10,.82)] p-6"
      tabIndex={-1}
      ref={(node) => node?.focus()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Modal: Escape closes the panel, never the issue drawer behind it
        // (that one listens for Escape on window).
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="flex max-h-[82vh] w-[min(620px,100%)] flex-col overflow-hidden rounded-r10 bg-[var(--bg-elevated)] shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-[560] text-t1" data-analysis-name>
            {file.name}
          </span>
          <button
            type="button"
            data-analysis-close
            aria-label={t('Close')}
            onClick={onClose}
            className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-[64px] overflow-auto px-2 py-2" data-analysis-body>
          {state.status === 'loading' ? (
            <div className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-t3">
              <Loader2 size={12} className="animate-spin" />
              {t('Analyzing')}
            </div>
          ) : null}
          {state.status === 'error' ? (
            <div data-analysis-error className="px-1 py-2 text-[12.5px] text-[var(--red)]">
              {state.message}
            </div>
          ) : null}
          {state.status === 'ready' ? <ToolCardPanel card={state.card} /> : null}
        </div>
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Globe, ShieldAlert } from 'lucide-react';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';
import {
  formatBytes,
  hostOf,
  type InspectCard,
  type SearchCard,
  type ToolCard,
} from '@/lib/agent/tool-cards';

/** Small copy affordance used by the hashes; the value never leaves the browser. */
function CopyValue({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      data-copy-value={testId}
      title={`${t('Copy')} ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="flex h-[18px] shrink-0 items-center gap-1 rounded-r4 px-1 text-[11px] text-t4 transition-colors hover:bg-[var(--bg-active)] hover:text-t1"
    >
      {copied ? <Check size={9} strokeWidth={2.4} /> : <Copy size={9} strokeWidth={2} />}
      {copied ? t('Copied') : t('Copy')}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 mb-0.5 px-1 text-[10.5px] font-[560] uppercase tracking-[0.06em] text-t4">{children}</div>;
}

function HashLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="w-[54px] shrink-0 text-[11px] text-t4">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-t2" title={value}>
        {value}
      </code>
      <CopyValue value={value} label={label} testId={label.toLowerCase().replace(/[^a-z0-9]/g, '')} />
    </div>
  );
}

function SearchCardBody({ card }: { card: SearchCard }) {
  const t = useT();
  if (!card.hits.length) return <div className="px-1 pb-1 text-[12px] text-t4">{t('No search hits')}</div>;
  return (
    <div className="flex flex-col gap-0.5 pb-1" data-tool-card="search">
      {card.hits.map((hit, index) => {
        const host = hostOf(hit.url);
        const row = (
          <>
            <span className="mt-[1px] w-[14px] shrink-0 text-right text-[11px] tabular-nums text-t4">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate text-[12.5px] text-t2 group-hover:text-[var(--accent)]">{hit.title}</span>
                {hit.url ? (
                  <ExternalLink size={9} strokeWidth={2} className="shrink-0 text-t4 opacity-0 transition-opacity group-hover:opacity-100" />
                ) : null}
              </span>
              <span className="block truncate text-[11px] text-t4">{host || hit.url}</span>
              {hit.snippet ? <span className="mt-[1px] block text-[11.5px] leading-[1.45] text-t3">{hit.snippet}</span> : null}
            </span>
          </>
        );
        const className =
          'group flex w-full items-start gap-1.5 rounded-r5 px-1 py-[3px] text-left transition-colors hover:bg-[var(--bg-selected)]';
        return hit.url ? (
          <a
            key={`${hit.url}-${index}`}
            data-tool-hit={index}
            href={hit.url}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
          >
            {row}
          </a>
        ) : (
          <div key={`hit-${index}`} data-tool-hit={index} className="flex w-full items-start gap-1.5 px-1 py-[3px]">
            {row}
          </div>
        );
      })}
      {card.source ? (
        <div className="flex items-center gap-1 px-1 pt-0.5 text-[11px] text-t4">
          <Globe size={9} strokeWidth={2} />
          {t('Source')}: <span className="font-mono">{card.source}</span>
        </div>
      ) : null}
    </div>
  );
}

const INDICATOR_TONE: Record<string, string> = {
  command: 'text-[#f08080]',
  api: 'text-[#e8b062]',
  url: 'text-[#7ac977]',
  domain: 'text-[#7ac977]',
  ip: 'text-[#7ac977]',
  registry: 'text-[#e8b062]',
};

function InspectCardBody({ card }: { card: InspectCard }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1 pb-1" data-tool-card="inspect">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5 text-[11.5px] text-t3">
        <span>
          {t('Format')}: <span className="text-t2">{card.format}</span>
        </span>
        <span>
          {t('Size')}: <span className="tnum text-t2">{formatBytes(card.size)}</span>
        </span>
        <span>
          {t('Entropy')}: <span className="tnum text-t2">{card.entropy.toFixed(2)}</span>
        </span>
        {card.packed ? (
          <span className="flex items-center gap-1 rounded-r4 bg-[color-mix(in_srgb,var(--orange)_18%,transparent)] px-1.5 py-[1px] text-[11px] text-[var(--orange)]">
            <ShieldAlert size={9} strokeWidth={2} />
            {t('Possibly packed')}
          </span>
        ) : null}
      </div>

      <HashLine label={t('SHA-256')} value={card.sha256} />
      <HashLine label={t('MD5')} value={card.md5} />

      {card.structure.length ? (
        <>
          <SectionLabel>{t('Structure')}</SectionLabel>
          <div className="flex flex-col gap-[1px]">
            {card.structure.map((line, index) => (
              <code key={index} className="whitespace-pre-wrap break-all px-1 font-mono text-[11px] leading-[1.5] text-t2">
                {line}
              </code>
            ))}
          </div>
        </>
      ) : null}

      {card.notes.length ? (
        <>
          <SectionLabel>{t('Notes')}</SectionLabel>
          <div className="flex flex-col gap-[2px]">
            {card.notes.map((note, index) => (
              <div key={index} className="flex items-start gap-1 px-1 text-[11.5px] leading-[1.45] text-t3">
                <AlertTriangle size={10} strokeWidth={2} className="mt-[2px] shrink-0 text-[var(--orange)]" />
                <span className="min-w-0 flex-1">{note}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {card.indicators.length ? (
        <>
          <SectionLabel>{t('Indicators')}</SectionLabel>
          <div className="flex flex-col gap-[1px]">
            {card.indicators.map((item, index) => (
              <div key={index} className="flex items-start gap-1.5 px-1 font-mono text-[11px] leading-[1.5]">
                <span className={cn('w-[52px] shrink-0 truncate', INDICATOR_TONE[item.kind] ?? 'text-t4')}>{item.kind}</span>
                <span className="min-w-0 flex-1 break-all text-t2">{item.value}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {card.embedded.length ? (
        <>
          <SectionLabel>{t('Embedded payloads')}</SectionLabel>
          <div className="flex flex-col gap-[1px]">
            {card.embedded.map((item, index) => (
              <div key={index} className="flex items-center gap-1.5 px-1 font-mono text-[11px] text-t2">
                <span className="text-t4">{item.kind}</span>
                <span className="text-t4">→</span>
                <span className="min-w-0 flex-1 truncate">{item.format}</span>
                <span className="tnum shrink-0 text-t4">{formatBytes(item.bytes)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {card.strings.length ? (
        <>
          <SectionLabel>
            {t('Strings')}
            {card.stringTotal > card.strings.length
              ? ` · ${t('first {shown} of {total}', { shown: card.strings.length, total: card.stringTotal })}`
              : ''}
          </SectionLabel>
          <div className="flex flex-col gap-[1px]">
            {card.strings.map((line, index) => (
              <code key={index} className="truncate px-1 font-mono text-[11px] leading-[1.5] text-t3" title={line}>
                {line}
              </code>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The expandable body of a tool receipt. The header row lives in `LogRow`. */
export function ToolCardPanel({ card }: { card: ToolCard }) {
  return card.kind === 'search' ? <SearchCardBody card={card} /> : <InspectCardBody card={card} />;
}

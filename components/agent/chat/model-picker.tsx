'use client';

import * as React from 'react';
import { Check, Search } from 'lucide-react';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';
import { isModelReady, useModelTarget, useWorkspace } from '@/lib/agent/workspace';

export function ModelChip({ onClick }: { onClick: () => void }) {
  const t = useT();
  const target = useModelTarget('chat');
  const ready = isModelReady(target);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[26px] max-w-[260px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors',
        ready
          ? 'text-t3 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[var(--bg-hover)] hover:text-t1'
          : 'bg-[color-mix(in_srgb,var(--red)_9%,transparent)] text-[var(--red)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--red)_22%,transparent)]',
      )}
      data-model-chip
    >
      <span className={cn('h-[6px] w-[6px] shrink-0 rounded-full', ready ? 'bg-[var(--green)]' : 'bg-[var(--red)]')} />
      <span className="truncate font-mono">{target?.model || t('No model')}</span>
      {target?.providerName ? <span className="shrink-0 text-t4">· {target.providerName}</span> : null}
    </button>
  );
}

/** Pick the provider/model for the workspace chat without leaving the panel. */
export function ModelMenu({ onClose }: { onClose: () => void }) {
  const t = useT();
  const providers = useWorkspace((s) => s.providers);
  const routes = useWorkspace((s) => s.routes);
  const setRoutes = useWorkspace((s) => s.setRoutes);
  const [query, setQuery] = React.useState('');

  if (!providers.length) {
    return <div className="px-2 py-2 text-[12.5px] text-t4">{t('No providers yet')}</div>;
  }

  const needle = query.trim().toLowerCase();
  const groups = providers
    .map((provider) => {
      const models = (provider.models.length ? provider.models : [provider.defaultModel]).filter(Boolean);
      const providerHit = provider.name.toLowerCase().includes(needle);
      return {
        provider,
        models: needle ? models.filter((model) => providerHit || model.toLowerCase().includes(needle)) : models,
      };
    })
    .filter((group) => group.models.length)
    .map((group) => ({ ...group, models: group.models.slice(0, 8) }));

  return (
    <div>
      <div className="mb-1 flex h-[28px] items-center gap-1.5 rounded-r6 bg-[var(--bg-hover)] px-2">
        <Search size={12} strokeWidth={1.9} className="shrink-0 text-t4" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Filter models…')}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-t1 outline-none placeholder:text-t4"
        />
      </div>
      <div className="scroll-container max-h-[300px] overflow-y-auto">
        {groups.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-t4">{t('No models match that.')}</div>
        ) : null}
        {groups.map(({ provider, models }) => (
          <div key={provider.id} className="mb-1 last:mb-0">
            <div className="px-2 py-1 text-[10.5px] font-[590] uppercase tracking-[.06em] text-t4">
              {provider.name}
            </div>
            {models.map((model) => {
              const active =
                routes.chat.providerId === provider.id &&
                (routes.chat.model || provider.defaultModel) === model;
              return (
                <button
                  key={`${provider.id}-${model}`}
                  type="button"
                  onClick={() => {
                    setRoutes({ ...routes, chat: { providerId: provider.id, model } });
                    onClose();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-r6 px-2 py-[5px] text-left text-[12.5px] transition-colors',
                    active ? 'bg-[var(--bg-selected)] text-t1' : 'text-t2 hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{model}</span>
                  {active ? <Check size={12} strokeWidth={2.4} className="shrink-0 text-[var(--accent)]" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--line-subtle)] px-2 pt-1.5 text-[11px] text-t4">
        {t('Applies to workspace chat only')}
      </div>
    </div>
  );
}

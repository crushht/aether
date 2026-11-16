'use client';

import * as React from 'react';
import { Loader2, Plug, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';
import type { ConnectorConfig, ConnectorDraft } from '@/lib/agent/types';

const field =
  'h-[36px] w-full rounded-r6 bg-[var(--bg-hover)] px-2.5 text-[13.5px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]';

export function ConnectorsPanel() {
  const t = useT();
  const [connectors, setConnectors] = React.useState<ConnectorConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [draft, setDraft] = React.useState<ConnectorDraft>({ name: '', baseUrl: '', token: '' });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/agent/connectors', { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; connectors?: ConnectorConfig[]; error?: string };
      if (json.ok) setConnectors(json.connectors ?? []);
      else setError(json.error ?? 'Could not load connectors.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: ConnectorDraft[]) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/agent/connectors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectors: next }),
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; connectors?: ConnectorConfig[]; error?: string };
      if (!response.ok || !json.ok) {
        setError(json.error ?? `Save failed (${response.status})`);
        return false;
      }
      setConnectors(json.connectors ?? []);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!draft.name.trim() || !draft.baseUrl.trim()) return;
    const existing: ConnectorDraft[] = connectors.map((connector) => ({
      id: connector.id,
      name: connector.name,
      baseUrl: connector.baseUrl,
    }));
    const saved = await persist([...existing, { ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim() }]);
    if (saved) setDraft({ name: '', baseUrl: '', token: '' });
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('Delete this connector?'))) return;
    await persist(
      connectors
        .filter((connector) => connector.id !== id)
        .map((connector) => ({ id: connector.id, name: connector.name, baseUrl: connector.baseUrl })),
    );
  };

  return (
    <div data-connectors-panel className="max-w-[720px]">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-r6 bg-[var(--bg-hover)] text-t3">
          <Plug size={14} />
        </span>
        <div>
          <h2 className="text-[15px] font-[590] text-t1">{t('Connectors')}</h2>
          <p className="mt-0.5 text-[13px] leading-[1.55] text-t3">
            {t('Let the agent read from and write to your own services. Read requests run directly; every write waits for your approval. Tokens stay on the server.')}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-r6 bg-[color-mix(in_srgb,var(--red)_9%,transparent)] px-2.5 py-2 text-[12.5px] text-[var(--red)]">
          {error}
        </div>
      ) : null}

      <div className="rounded-r9 bg-[var(--bg-elevated)] p-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {loading ? (
          <div className="flex h-[80px] items-center justify-center text-t4">
            <Loader2 size={14} className="animate-spin" />
          </div>
        ) : connectors.length ? (
          <div className="flex flex-col">
            {connectors.map((connector) => (
              <div key={connector.id} data-connector={connector.id} className="flex items-center gap-2 border-b border-[var(--line-subtle)] py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-[510] text-t1">{connector.name}</span>
                    {connector.hasToken ? (
                      <span className="rounded-full bg-[var(--bg-hover)] px-1.5 text-[10.5px] text-t4">{connector.tokenHint}</span>
                    ) : (
                      <span className="rounded-full bg-[var(--bg-hover)] px-1.5 text-[10.5px] text-t4">{t('No token')}</span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[12px] text-t4">{connector.baseUrl}</div>
                </div>
                <button
                  type="button"
                  aria-label={t('Delete connector')}
                  onClick={() => remove(connector.id)}
                  className="grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 hover:bg-[rgba(235,87,87,.12)] hover:text-[var(--red)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-3 text-[13px] text-t4">{t('No connectors yet. Add one below.')}</p>
        )}
      </div>

      <div className="mt-4 rounded-r9 bg-[var(--bg-elevated)] p-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <h3 className="text-[13px] font-[510] text-t2">{t('Add a connector')}</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <input
            data-connector-name
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder={t('Name, e.g. GitHub')}
            className={field}
          />
          <input
            data-connector-url
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            placeholder="https://api.github.com"
            spellCheck={false}
            className={cn(field, 'font-mono')}
          />
        </div>
        <div className="mt-2">
          <input
            data-connector-token
            value={draft.token ?? ''}
            onChange={(event) => setDraft({ ...draft, token: event.target.value })}
            placeholder={t('Access token (optional for local services)')}
            type="password"
            autoComplete="off"
            className={field}
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !draft.name.trim() || !draft.baseUrl.trim()}
            onClick={add}
            className="gap-1.5"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {t('Add connector')}
          </Button>
          <span className="text-[12px] text-t4">
            {t('Plain http is only allowed for localhost. Paths cannot leave the base URL.')}
          </span>
        </div>
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import { Check, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { moveEngine, toggleEngine } from '@/lib/search-settings';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { cn } from '@/lib/utils';

const field =
  'h-[36px] w-full rounded-r6 bg-[var(--bg-hover)] px-2.5 text-[13.5px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]';
const labelClass = 'mb-1 block text-[12px] font-[510] text-t4';

type Kind = 'builtin' | 'searxng' | 'custom';
type Source = 'settings' | 'env' | 'default';

interface SavedSearch {
  url: string;
  engines: string[];
  updatedAt: string;
  updatedBy?: string;
}

interface SearchPayload {
  ok?: boolean;
  canManage?: boolean;
  saved?: SavedSearch | null;
  effective?: { kind: Kind; host: string; endpoint: string; engines: string[]; source: Source };
  env?: { url: string; engines: string[] } | null;
  catalog?: { id: string; label: string }[];
  error?: string;
  errors?: { url?: string };
}

interface ProbePayload {
  ok?: boolean;
  provider?: string;
  elapsedMs?: number;
  results?: { title: string; url: string; snippet: string }[];
  error?: string;
}

/**
 * Web search source: which engine answers `web_search`, and in what order.
 *
 * A pinned endpoint (a self-hosted SearXNG, usually) replaces the built-in
 * chain — an operator who runs their own metasearch does not want the agent
 * leaking queries back to public engines — so the engine order only matters
 * when no endpoint is set. Saving applies to the next search, no restart.
 */
export function SearchPanel() {
  const t = useT();
  const pushToast = useUI((s) => s.pushToast);
  const [payload, setPayload] = React.useState<SearchPayload | null>(null);
  const [url, setUrl] = React.useState('');
  const [engines, setEngines] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [urlError, setUrlError] = React.useState('');
  const [note, setNote] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [probe, setProbe] = React.useState<ProbePayload | null>(null);

  const apply = React.useCallback((next: SearchPayload) => {
    setPayload(next);
    setUrl(next.saved ? next.saved.url : (next.env?.url ?? ''));
    const savedEngines = next.saved?.engines ?? [];
    setEngines(savedEngines.length ? savedEngines : (next.effective?.engines ?? []));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/search', { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as SearchPayload;
      if (!response.ok || !json.ok) setError(json.error ?? 'Could not load the search settings.');
      else apply(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const canManage = Boolean(payload?.canManage);
  const catalog = payload?.catalog ?? [];
  const kind = payload?.effective?.kind ?? 'builtin';
  const source = payload?.effective?.source ?? 'default';
  const endpointLabel = payload?.effective?.endpoint ?? '';
  const onEngines = engines.filter((id) => catalog.some((engine) => engine.id === id));
  const offEngines = catalog.filter((engine) => !onEngines.includes(engine.id));

  const request = async (method: 'PUT' | 'POST' | 'DELETE', body?: unknown) => {
    const response = await fetch('/api/settings/search', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => ({}))) as SearchPayload & ProbePayload;
    return { ok: response.ok && Boolean(json.ok), json, status: response.status };
  };

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setError('');
    setUrlError('');
    setNote('');
    setProbe(null);
    try {
      const result = await request('PUT', { url, engines });
      if (!result.ok) {
        setError(result.json.error ?? `Save failed (${result.status})`);
        setUrlError(result.json.errors?.url ?? '');
        return;
      }
      apply(result.json);
      setNote(t('Saved. The next web_search uses this source.'));
      pushToast({ title: t('Search source saved'), tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy('reset');
    setError('');
    setUrlError('');
    setNote('');
    setProbe(null);
    try {
      const result = await request('DELETE');
      if (!result.ok) {
        setError(result.json.error ?? `Reset failed (${result.status})`);
        return;
      }
      apply(result.json);
      setNote(t('Cleared. AETHER_SEARCH_URL or the built-in chain takes over.'));
      pushToast({ title: t('Search source reset'), tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy('test');
    setError('');
    setUrlError('');
    setProbe(null);
    try {
      const result = await request('POST', { query, url, engines });
      setProbe(result.json);
      if (!result.ok) setUrlError(result.json.errors?.url ?? '');
    } catch (err) {
      setProbe({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy('');
    }
  };

  if (loading && !payload) {
    return (
      <div data-search-panel className="text-[13px] text-t4">
        {t('Loading…')}
      </div>
    );
  }

  return (
    <div data-search-panel>
      <h1 className="text-title2 font-[590] text-t1">{t('Web search')}</h1>
      <p className="mt-1 max-w-[560px] text-[14px] leading-[1.6] text-t4">
        {t(
          'The agent reaches the web through exactly one source. A SearXNG endpoint replaces the built-in chain; the engine order decides what gets tried when no endpoint is set.',
        )}
      </p>

      <div
        data-search-status
        data-search-kind={kind}
        data-search-source={source}
        data-search-host={payload?.effective?.host ?? ''}
        className="mt-5 overflow-hidden rounded-r8 px-4 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line-subtle)] py-3">
          <div className="min-w-0">
            <div className="text-[14px] font-[510] text-t2">{t('Source')}</div>
            <div className="mt-0.5 text-[12.5px] text-t4">
              {source === 'settings'
                ? t('Saved in this workspace.')
                : source === 'env'
                  ? t('From the environment (AETHER_SEARCH_URL).')
                  : t('Shipped default — nothing configured yet.')}
            </div>
          </div>
          <span
            data-search-kind-badge
            className={cn(
              'shrink-0 rounded-full px-2 py-[2px] text-[12px]',
              kind === 'builtin' ? 'bg-[var(--bg-selected)] text-t3' : 'bg-[rgba(94,106,210,.16)] text-[#9aa4ff]',
            )}
          >
            {kind === 'builtin' ? t('Built-in chain') : kind === 'searxng' ? t('SearXNG') : t('Custom endpoint')}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="text-[14px] font-[510] text-t2">{t('Answering endpoint')}</div>
            <div data-search-endpoint className="mt-0.5 truncate font-mono text-[12px] text-t4">
              {endpointLabel || '—'}
            </div>
          </div>
          <span className="tnum shrink-0 text-[12.5px] text-t4">
            {payload?.effective?.engines.length ?? 0}/{catalog.length || 5} {t('engines')}
          </span>
        </div>
      </div>

      <div className="mt-5 rounded-r8 px-4 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        <label className="block max-w-[520px]">
          <span className={labelClass}>{t('Search endpoint')}</span>
          <input
            data-search-url
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://127.0.0.1:8888/search"
            spellCheck={false}
            disabled={!canManage}
            className={cn(field, 'font-mono text-[13px]')}
          />
        </label>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-t4">
          {t('A SearXNG instance, or any engine that accepts ?q=. Leave it empty to use the chain below.')}
        </p>
        {urlError ? (
          <p data-search-error className="mt-1 text-[12.5px] text-[#f08080]">
            {urlError}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button data-search-save variant="secondary" size="sm" disabled={!canManage || busy === 'save'} onClick={save}>
            {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('Save changes')}
          </Button>
          <Button
            data-search-clear
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={!canManage || busy === 'reset' || !payload?.saved}
            onClick={reset}
          >
            <Trash2 size={12} strokeWidth={2} />
            {t('Reset to default')}
          </Button>
          {note ? (
            <span data-search-note className="flex items-center gap-1 text-[12.5px] text-[#7ac977]">
              <Check size={12} strokeWidth={2.4} /> {note}
            </span>
          ) : null}
        </div>
        {error ? (
          <p data-search-save-error className="mt-1.5 text-[12.5px] text-[#f08080]">
            {error}
          </p>
        ) : null}
      </div>

      <h2 className="mt-8 text-[14px] font-[590] text-t2">{t('Engine priority')}</h2>
      <p className="mt-1 text-[13px] text-t4">
        {t('Move an engine up to try it earlier, or turn it off to skip it. The chain stops at the first engine that answers.')}
      </p>
      {kind !== 'builtin' ? (
        <p data-search-endpoint-wins className="mt-1 text-[12.5px] text-[#d8a657]">
          {t('The endpoint wins over this order — the chain only runs when no endpoint is saved.')}
        </p>
      ) : null}

      <div className="mt-2 overflow-hidden rounded-r8 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
        {onEngines.map((id, index) => {
          const engine = catalog.find((row) => row.id === id);
          return (
            <div
              key={id}
              data-search-engine={id}
              data-engine-on="1"
              data-engine-index={index}
              className="flex items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-2 last:border-0"
            >
              <span className="tnum w-[18px] text-[12px] text-t4">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-t2">{engine?.label ?? id}</span>
              <span className="font-mono text-[11.5px] text-t4">{id}</span>
              <button
                type="button"
                data-engine-up
                aria-label={t('Higher priority')}
                disabled={!canManage || index === 0}
                onClick={() => setEngines((current) => moveEngine(current, id, -1))}
                className="rounded-r5 px-1.5 text-[12px] text-t3 hover:bg-[var(--bg-hover)] hover:text-t1 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                data-engine-down
                aria-label={t('Lower priority')}
                disabled={!canManage || index === onEngines.length - 1}
                onClick={() => setEngines((current) => moveEngine(current, id, 1))}
                className="rounded-r5 px-1.5 text-[12px] text-t3 hover:bg-[var(--bg-hover)] hover:text-t1 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                data-engine-toggle
                aria-label={t('Turn off')}
                disabled={!canManage || onEngines.length === 1}
                onClick={() => setEngines((current) => toggleEngine(current, id))}
                className="rounded-r5 px-1.5 text-[11.5px] text-t4 hover:bg-[var(--bg-hover)] hover:text-t1 disabled:opacity-30"
              >
                {t('On')}
              </button>
            </div>
          );
        })}
        {offEngines.length ? (
          <div className="border-t border-[var(--line-subtle)] px-3 py-2">
            <div className="mb-1 text-[12px] text-t4">{t('Turned off')}</div>
            <div className="flex flex-wrap gap-1.5">
              {offEngines.map((engine) => (
                <button
                  key={engine.id}
                  type="button"
                  data-search-engine={engine.id}
                  data-engine-on="0"
                  disabled={!canManage}
                  onClick={() => setEngines((current) => toggleEngine(current, engine.id))}
                  className="rounded-r5 bg-[var(--bg-hover)] px-2 py-0.5 text-[12px] text-t4 hover:text-t1 disabled:opacity-50"
                >
                  {engine.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <h2 className="mt-8 text-[14px] font-[590] text-t2">{t('Run a test')}</h2>
      <p className="mt-1 text-[13px] text-t4">
        {t('Runs the endpoint and order above right now — saving is not required.')}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          data-search-test-query
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('A query to try, for example aether release notes')}
          className={cn(field, 'sm:max-w-[380px]')}
        />
        <Button data-search-test variant="secondary" size="sm" disabled={!canManage || busy === 'test'} onClick={test}>
          {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} strokeWidth={2} />}
          {t('Run a test')}
        </Button>
      </div>

      {probe ? (
        <div data-search-test-result data-test-ok={probe.ok ? '1' : '0'} className="mt-2 rounded-r8 px-3 py-2 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          {probe.ok ? (
            <>
              <div className="flex items-center gap-2 text-[12.5px] text-t4">
                <span data-search-test-provider className="text-t2">
                  {probe.provider}
                </span>
                <span className="tnum">{probe.elapsedMs ?? 0} ms</span>
                <span>
                  {probe.results?.length ?? 0} {t('hits')}
                </span>
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {(probe.results ?? []).slice(0, 3).map((hit) => (
                  <li key={hit.url} data-search-hit className="truncate text-[12.5px]">
                    <a href={hit.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline-offset-2 hover:underline">
                      {hit.title}
                    </a>
                    <span className="ml-1.5 font-mono text-[11px] text-t4">{hit.url}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p data-search-test-error className="text-[12.5px] text-[#f08080]">
              {probe.error ?? t('The test returned nothing.')}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

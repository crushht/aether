import {
  describeSearchSource,
  envSearchSettings,
  normalizeSearchSettings,
  resolveSearchSettings,
  SEARCH_ENGINES,
  validateSearchDraft,
  type SearchKind,
  type SearchSettings,
  type SearchSource,
} from '@/lib/search-settings';
import { readJson, removeFile, withLock, writeJson } from './store';

/**
 * The search source, saved in this data directory.
 *
 * `search.json` keeps the pinned endpoint (if any) and the engine order. It is
 * read on every lookup instead of cached, for the same reason as the mail
 * relay: Next serves each route from its own module instance, so a cache in
 * `/api/settings/search` would not be the cache `web_search` sees, and "save
 * then it works" would become "save then restart". The file is a few hundred
 * bytes.
 *
 * A saved entry outranks `.env.local`; deleting it hands control back.
 */

const FILE = 'search.json';
const VERSION = 1;

export interface StoredSearch {
  version: number;
  url: string;
  engines: string[];
  updatedAt: string;
  updatedBy?: string;
}

export interface PublicSearch extends SearchSettings {
  updatedAt: string;
  updatedBy?: string;
}

export interface SearchState {
  /** What the settings page edits; null when nothing was ever saved. */
  saved: PublicSearch | null;
  /** What `web_search` would use right now. */
  effective: {
    kind: SearchKind;
    host: string;
    endpoint: string;
    engines: string[];
    source: SearchSource;
  };
  /** `.env.local` still works; shown so the UI can explain the fallback. */
  env: { url: string; engines: string[] } | null;
  /** The engines the UI can order; ids and labels only, no url builders. */
  catalog: { id: string; label: string }[];
}

export async function readStoredSearch(): Promise<StoredSearch | null> {
  const stored = await readJson<StoredSearch | null>(FILE, null);
  if (!stored || typeof stored !== 'object') return null;
  if (typeof stored.url !== 'string' || !Array.isArray(stored.engines)) return null;
  return stored;
}

function publicOf(stored: StoredSearch): PublicSearch {
  const settings = normalizeSearchSettings(stored, null);
  return {
    ...settings,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
    ...(stored.updatedBy ? { updatedBy: stored.updatedBy } : {}),
  };
}

export async function publicSearchSettings(): Promise<PublicSearch | null> {
  const stored = await readStoredSearch();
  return stored ? publicOf(stored) : null;
}

export function searchSettingsFromEnv(): SearchSettings | null {
  return envSearchSettings(process.env);
}

/** Saved settings first, then `.env.local`, then the shipped chain. */
export async function effectiveSearchSettings(): Promise<{ settings: SearchSettings; source: SearchSource }> {
  return resolveSearchSettings(await publicSearchSettings(), searchSettingsFromEnv());
}

export async function searchState(): Promise<SearchState> {
  const saved = await publicSearchSettings();
  const { settings, source } = await effectiveSearchSettings();
  const described = describeSearchSource(settings, source);
  const env = searchSettingsFromEnv();
  return {
    saved,
    effective: {
      kind: described.kind,
      host: described.host,
      endpoint: described.endpoint,
      engines: settings.engines,
      source,
    },
    env: env ? { url: env.url, engines: env.engines } : null,
    catalog: SEARCH_ENGINES.map((engine) => ({ id: engine.id, label: engine.label })),
  };
}

export type SaveSearchResult =
  | { ok: true; settings: PublicSearch }
  | { ok: false; error: string; errors: { url?: string } };

/** Validate and store one draft; saving '' for the url clears the pin. */
export async function saveSearchSettings(
  draft: { url?: unknown; engines?: unknown },
  options: { updatedBy?: string } = {},
): Promise<SaveSearchResult> {
  return withLock(FILE, async () => {
    const stored = await readStoredSearch();
    const base = stored ? normalizeSearchSettings(stored, null) : null;
    const checked = validateSearchDraft(draft, { base });
    if (!checked.ok) {
      return {
        ok: false,
        error: checked.errors.url ?? 'That search source is not usable.',
        errors: checked.errors,
      } as SaveSearchResult;
    }

    const record: StoredSearch = {
      version: VERSION,
      url: checked.settings.url,
      engines: checked.settings.engines,
      updatedAt: new Date().toISOString(),
      ...(options.updatedBy ? { updatedBy: options.updatedBy } : {}),
    };
    await writeJson(FILE, record);
    return { ok: true, settings: publicOf(record) } as SaveSearchResult;
  });
}

/** Forget the saved entry: `.env.local` (if any) takes over again. */
export async function clearSearchSettings(): Promise<void> {
  await withLock(FILE, () => removeFile(FILE));
}

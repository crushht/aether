'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { useModelTarget, isModelReady, useWorkspace } from '@/lib/agent/workspace';
import { useToolApprovals } from '@/lib/store/tool-approvals';
import { MODEL_ROUTES, PROVIDER_PRESETS, type ModelRoutes, type ProviderConfig, type ProviderDraft } from '@/lib/agent/types';
import { UsageSummaryCard } from '@/components/agent/usage-summary';
import { useT } from '@/lib/use-t';
import { cn, relativeTime, isImeComposing } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';

const inputClass =
  'h-[36px] w-full rounded-r6 bg-[var(--bg-panel)] px-2.5 text-[13.5px] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_55%,transparent),0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]';

const textareaClass =
  'w-full resize-y rounded-r6 bg-[var(--bg-panel)] px-2.5 py-2 text-[13.5px] leading-[1.6] text-t1 shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_55%,transparent),0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-[510] text-t2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] leading-[1.5] text-t4">{hint}</span> : null}
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-160 ease-out',
        on ? 'bg-[var(--accent)]' : 'bg-[var(--bg-selected)]',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.32)] transition-transform duration-160 ease-out',
          on ? 'translate-x-[14px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[13px] font-[590] uppercase tracking-[.06em] text-t3">{title}</h2>
        {hint ? <p className="mt-1 max-w-[560px] text-[12.5px] leading-[1.55] text-t4">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

const toDraft = (provider: ProviderConfig): ProviderDraft => ({
  id: provider.id,
  name: provider.name,
  baseUrl: provider.baseUrl,
  presetId: provider.presetId,
  models: provider.models,
  defaultModel: provider.defaultModel,
  embeddingModel: provider.embeddingModel ?? '',
  temperature: provider.temperature,
  maxSteps: provider.maxSteps,
  contextWindow: provider.contextWindow,
});

const blankDraft = (): ProviderDraft => ({
  name: 'OpenAI',
  baseUrl: PROVIDER_PRESETS[0].baseUrl,
  presetId: PROVIDER_PRESETS[0].id,
  apiKey: '',
  models: PROVIDER_PRESETS[0].models,
  defaultModel: PROVIDER_PRESETS[0].models[0],
  embeddingModel: '',
  temperature: 0.3,
  maxSteps: 8,
  contextWindow: PROVIDER_PRESETS[0].contextWindow,
});

function ProviderForm({
  draft,
  onChange,
  onCancel,
  onSave,
  onDelete,
  saving,
}: {
  draft: ProviderDraft;
  onChange: (patch: Partial<ProviderDraft>) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const t = useT();
  const [showKey, setShowKey] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch('/api/agent/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: draft.id, baseUrl: draft.baseUrl, apiKey: draft.apiKey || undefined }),
      });
      const json = (await response.json()) as { ok?: boolean; models?: string[]; ms?: number; error?: string; code?: string };
      if (json.ok) {
        const models = json.models ?? [];
        if (models.length) {
          // Prefer keeping a valid choice; otherwise adopt what the upstream actually serves.
          const nextDefault =
            draft.defaultModel && models.includes(draft.defaultModel) ? draft.defaultModel : models[0];
          onChange({ models, defaultModel: nextDefault });
          setResult({
            ok: true,
            text: `${models.length} ${t('models')} · ${json.ms ?? 0}ms · ${t('default set to {model}', { model: nextDefault })}`,
          });
        } else {
          setResult({ ok: true, text: t('Connected, but the endpoint returned no model list. Type the model name yourself.') });
        }
      } else {
        setResult({ ok: false, text: `${json.code ? `${json.code} · ` : ''}${json.error ?? `HTTP ${response.status}`}` });
      }
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const unknownDefault =
    draft.models.length > 0 && Boolean(draft.defaultModel) && !draft.models.includes(draft.defaultModel);

  return (
    <div className="rounded-r10 bg-[var(--bg-elevated)] p-4 shadow-[0_1px_2px_rgba(9,10,12,.05),inset_0_0_0_1px_var(--line)]">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PROVIDER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              if (!preset.baseUrl) return;
              onChange({
                name: preset.name,
                baseUrl: preset.baseUrl,
                presetId: preset.id,
                models: preset.models,
                defaultModel: preset.models[0] ?? draft.defaultModel,
                contextWindow: preset.contextWindow,
              });
            }}
            className={cn(
              'h-[24px] rounded-full px-2.5 text-[12px] font-[510] transition-colors',
              draft.presetId === preset.id
                ? 'bg-[var(--bg-selected)] text-t1 shadow-[inset_0_0_0_1px_var(--line-strong)]'
                : 'text-t3 hover:bg-[var(--bg-hover)] hover:text-t1',
            )}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('Name')}>
          <input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} className={inputClass} />
        </Field>
        <Field label={t('Default model')} hint={t('The model this provider uses when a scene does not override it.')}>
          <input
            value={draft.defaultModel}
            onChange={(event) => onChange({ defaultModel: event.target.value })}
            list={`models-${draft.id ?? 'new'}`}
            spellCheck={false}
            className={cn(inputClass, 'font-mono text-[12.5px]')}
          />
          <datalist id={`models-${draft.id ?? 'new'}`}>
            {draft.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          {draft.models.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1" data-model-choices>
              {draft.models.slice(0, 30).map((model) => (
                <button
                  key={model}
                  type="button"
                  data-model-choice={model}
                  onClick={() => onChange({ defaultModel: model })}
                  className={cn(
                    'max-w-full truncate rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors',
                    draft.defaultModel === model
                      ? 'bg-[var(--bg-selected)] text-t1 shadow-[inset_0_0_0_1px_var(--line-strong)]'
                      : 'bg-[var(--bg-hover)] text-t3 hover:text-t1',
                  )}
                >
                  {model}
                </button>
              ))}
              {draft.models.length > 30 ? (
                <span className="self-center text-[11px] text-t4">+{draft.models.length - 30}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-t4">{t('No models yet — press Test connection to fetch them.')}</p>
          )}
          {unknownDefault ? (
            <div data-model-warning className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--orange)]">
              <span>{t('Not in the upstream list — it may fail to call.')}</span>
              <button
                type="button"
                data-use-first-model
                onClick={() => onChange({ defaultModel: draft.models[0] })}
                className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[11px] text-t2 hover:text-t1"
              >
                {t('Use {model}', { model: draft.models[0] })}
              </button>
            </div>
          ) : null}
        </Field>
        <Field label={t('Base URL')} hint={t('Any OpenAI-compatible endpoint, including a local gateway.')}>
          <input
            value={draft.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            className={cn(inputClass, 'font-mono text-[12.5px]')}
          />
        </Field>
        <Field
          label={t('API key')}
          hint={t('Encrypted on this server. The browser never receives it again.')}
        >
          <div className="flex items-center gap-1.5">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey ?? ''}
              onChange={(event) => onChange({ apiKey: event.target.value, clearKey: false })}
              placeholder={draft.id ? t('Leave empty to keep the stored key') : 'sk-…'}
              autoComplete="off"
              spellCheck={false}
              className={cn(inputClass, 'font-mono text-[12.5px]')}
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              className="h-[36px] shrink-0 rounded-r6 px-2 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
            >
              {showKey ? t('Hide') : t('Show')}
            </button>
            {draft.id ? (
              <button
                type="button"
                aria-label={t('Remove key')}
                onClick={() => onChange({ apiKey: '', clearKey: true })}
                className="grid h-[36px] w-[30px] shrink-0 place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--red)]"
              >
                <Trash2 size={13} strokeWidth={1.9} />
              </button>
            ) : null}
          </div>
        </Field>
        <Field label={t('Temperature')} hint={t('0.2–0.4 suits tool use.')}>
          <div className="flex h-[36px] items-center gap-2.5">
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={draft.temperature}
              onChange={(event) => onChange({ temperature: Number(event.target.value) })}
              className="h-1 flex-1 accent-[var(--accent)]"
            />
            <span className="tnum w-[28px] text-right text-[12.5px] text-t3">{draft.temperature.toFixed(1)}</span>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Max steps')}>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.maxSteps}
              onChange={(event) => onChange({ maxSteps: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })}
              className={cn(inputClass, 'tnum')}
            />
          </Field>
          <Field label={t('Context')} hint={t('tokens')}>
            <input
              type="number"
              min={2_000}
              max={2_000_000}
              step={1_000}
              value={draft.contextWindow}
              onChange={(event) => onChange({ contextWindow: Number(event.target.value) || 128_000 })}
              className={cn(inputClass, 'tnum')}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field
            label={t('Embedding model')}
            hint={t('Optional. Enables semantic knowledge search; falls back to keyword search when empty.')}
          >
            <input
              data-embedding-model
              value={draft.embeddingModel ?? ''}
              onChange={(event) => onChange({ embeddingModel: event.target.value })}
              placeholder="text-embedding-3-small / bge-m3"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving || !draft.baseUrl.trim()}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {t('Save provider')}
        </Button>
        <Button variant="secondary" size="sm" onClick={test} disabled={testing}>
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} strokeWidth={1.9} />}
          {t('Test connection')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        {result ? (
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-[12.5px]',
              result.ok ? 'text-[var(--green)]' : 'text-[var(--red)]',
            )}
          >
            {result.ok ? <Check size={12} strokeWidth={2.4} /> : null}
            <span className="max-w-[360px] truncate">{result.text}</span>
          </span>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto flex h-[26px] items-center gap-1 rounded-r5 px-2 text-[12px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--red)]"
          >
            <Trash2 size={11} strokeWidth={1.9} />
            {t('Delete provider')}
          </button>
        ) : null}
      </div>
      {draft.models.length ? (
        <p className="mt-2 text-[11.5px] leading-[1.5] text-t4">
          {t('Known models')}: <span className="font-mono">{draft.models.slice(0, 6).join(', ')}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Agents settings: several providers, a model per scene, the agent persona,
 * durable memory, and the doorways to knowledge and workflows.
 */
export function AgentSettingsPanel() {
  const t = useT();
  const providers = useWorkspace((s) => s.providers);
  const workspaceLoading = useWorkspace((s) => s.loading);
  const routes = useWorkspace((s) => s.routes);
  const persona = useWorkspace((s) => s.persona);
  const instructions = useWorkspace((s) => s.instructions);
  const requireApproval = useWorkspace((s) => s.requireApproval);
  const memoryEnabled = useWorkspace((s) => s.memoryEnabled);
  const allowedTools = useToolApprovals((s) => s.allowed);
  const revokeTool = useToolApprovals((s) => s.revoke);
  const clearTools = useToolApprovals((s) => s.clear);
  const memory = useWorkspace((s) => s.memory);
  const knowledge = useWorkspace((s) => s.knowledge);
  const workflows = useWorkspace((s) => s.workflows);
  const hydrate = useWorkspace((s) => s.hydrate);
  const saveProviders = useWorkspace((s) => s.saveProviders);
  const saveProfile = useWorkspace((s) => s.saveProfile);
  const setRoutes = useWorkspace((s) => s.setRoutes);
  const addMemory = useWorkspace((s) => s.addMemory);
  const removeMemory = useWorkspace((s) => s.removeMemory);
  const clearMemory = useWorkspace((s) => s.clearMemory);

  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ProviderDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [memoryDraft, setMemoryDraft] = React.useState('');
  const [memoryScope, setMemoryScope] = React.useState<'all' | 'global' | 'chat' | 'issue'>('all');
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState('');
  const [personaDraft, setPersonaDraft] = React.useState(persona);
  const [instructionsDraft, setInstructionsDraft] = React.useState(instructions);

  React.useEffect(() => {
    void hydrate();
    useToolApprovals.getState().hydrate();
  }, [hydrate]);

  React.useEffect(() => setPersonaDraft(persona), [persona]);
  React.useEffect(() => setInstructionsDraft(instructions), [instructions]);

  const active = useModelTarget('chat');
  const ready = isModelReady(active);
  const filteredMemory = memoryScope === 'all' ? memory : memory.filter((entry) => entry.scope === memoryScope);

  const startNew = () => {
    setEditing('new');
    setDraft(blankDraft());
  };

  const startEdit = (provider: ProviderConfig) => {
    setEditing(provider.id);
    setDraft(toDraft(provider));
  };

  const persist = async (next: ProviderDraft[], message?: string) => {
    setSaving(true);
    const result = await saveProviders(next);
    setSaving(false);
    if (!result.ok) {
      setNote(result.error ?? t('Could not save the provider.'));
      return false;
    }
    setNote(message ?? t('Saved'));
    return true;
  };

  const saveDraft = async () => {
    if (!draft) return;
    // An empty default cannot be called; an unknown one is the person's call.
    const normalized = draft.defaultModel ? draft : { ...draft, defaultModel: draft.models[0] ?? '' };
    const drafts = providers.map(toDraft);
    const index = drafts.findIndex((item) => item.id === draft.id);
    const next = [...drafts];
    if (index >= 0) next[index] = normalized;
    else next.push({ ...normalized, id: undefined });
    if (await persist(next, t('Provider saved'))) {
      setEditing(null);
      setDraft(null);
    }
  };

  const removeProvider = async (id: string) => {
    if (await persist(providers.filter((item) => item.id !== id).map(toDraft), t('Provider removed'))) {
      setEditing(null);
      setDraft(null);
    }
  };

  const savePersona = async () => {
    setSaving(true);
    const result = await saveProfile({
      persona: personaDraft,
      instructions: instructionsDraft,
      requireApproval,
      memoryEnabled,
    });
    setSaving(false);
    setNote(result.ok ? t('Saved') : result.error ?? t('Could not save.'));
  };

  /** Providers and routing travel; API keys never leave the server. */
  const exportConfig = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      providers: providers.map(({ name, baseUrl, models, defaultModel, embeddingModel, temperature, maxSteps, contextWindow, presetId }) => ({
        name,
        baseUrl,
        models,
        defaultModel,
        embeddingModel,
        temperature,
        maxSteps,
        contextWindow,
        presetId,
      })),
      routes,
      persona,
      instructions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'aether-agent-config.json';
    link.click();
    URL.revokeObjectURL(link.href);
    setNote(t('Exported. Keys are never included.'));
  };

  const importConfig = async () => {
    try {
      const raw = JSON.parse(importText) as {
        providers?: ProviderDraft[];
        routes?: ModelRoutes;
        persona?: string;
        instructions?: string;
      };
      if (!Array.isArray(raw.providers)) {
        setNote(t('That JSON has no providers.'));
        return;
      }
      const drafts: ProviderDraft[] = raw.providers.map((provider) => {
        const base = String(provider.baseUrl ?? '').replace(/\/+$/, '');
        const existing = providers.find((item) => item.baseUrl.replace(/\/+$/, '') === base);
        return { ...provider, id: existing?.id };
      });
      const saved = await saveProviders(drafts);
      if (!saved.ok) {
        setNote(saved.error ?? t('Could not import.'));
        return;
      }
      if (raw.routes || raw.persona !== undefined || raw.instructions !== undefined) {
        await saveProfile({ routes: raw.routes, persona: raw.persona, instructions: raw.instructions });
      }
      setImportOpen(false);
      setImportText('');
      setNote(t('Imported. Add a key for each provider before running the agent.'));
    } catch {
      setNote(t('That file is not valid JSON.'));
    }
  };

  const updateRoute = (key: (typeof MODEL_ROUTES)[number]['key'], patch: { providerId?: string | null; model?: string }) => {
    const next = { ...routes, [key]: { ...routes[key], ...patch } };
    setRoutes(next);
  };

  const submitMemory = async () => {
    const text = memoryDraft.trim();
    if (!text) return;
    const result = await addMemory({ text, kind: 'note', scope: 'global' });
    if (result.ok) setMemoryDraft('');
  };

  return (
    <div className="max-w-[860px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title2 font-[590] text-t1">{t('Agents')}</h1>
          <p className="mt-1 max-w-[640px] text-[14px] leading-[1.6] text-t3">
            {t(
              'Aether ships with no model. Add any OpenAI-compatible provider; each scene can use a different one.',
            )}
          </p>
        </div>
        <span
          className={cn(
            'mt-1 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]',
            ready
              ? 'bg-[color-mix(in_srgb,var(--green)_10%,transparent)] text-[var(--green)]'
              : 'bg-[color-mix(in_srgb,var(--red)_9%,transparent)] text-[var(--red)]',
          )}
        >
          <span className={cn('h-[6px] w-[6px] rounded-full', ready ? 'bg-[var(--green)]' : 'bg-[var(--red)]')} />
          {ready ? `${active?.providerName} · ${active?.model}` : t('No model configured')}
        </span>
      </div>

      <UsageSummaryCard />

      {/* providers */}
      <section className="mt-7">
        <SectionTitle
          title={t('Providers')}
          hint={t('Connections to your own endpoints. Keys are encrypted with this server’s secret and never sent back to the browser.')}
          action={
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={exportConfig} className="gap-1.5">
                <Download size={12} strokeWidth={1.9} />
                {t('Export')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImportOpen((open) => !open)}
                className="gap-1.5"
              >
                <Upload size={12} strokeWidth={1.9} />
                {t('Import')}
              </Button>
              <Button variant="secondary" size="sm" onClick={startNew} className="gap-1.5">
                <Plus size={12} strokeWidth={2.2} />
                {t('Add provider')}
              </Button>
            </div>
          }
        />

        {importOpen ? (
          <div className="mb-2 rounded-r10 bg-[var(--bg-elevated)] p-3 shadow-[inset_0_0_0_1px_var(--line)]">
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={5}
              spellCheck={false}
              placeholder='{"version":1,"providers":[{"name":"OpenAI","baseUrl":"https://api.openai.com/v1",…}]}'
              className="w-full resize-y rounded-r6 bg-[var(--bg-hover)] px-2.5 py-2 font-mono text-[12px] leading-[1.6] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line)] placeholder:text-t4"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={importConfig} disabled={!importText.trim()}>
                {t('Import')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setImportOpen(false)}>
                {t('Cancel')}
              </Button>
              <span className="text-[11.5px] text-t4">{t('Keys are not in the file; add them after importing.')}</span>
            </div>
          </div>
        ) : null}

        {editing === 'new' && draft ? (
          <ProviderForm
            draft={draft}
            onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
            onCancel={() => {
              setEditing(null);
              setDraft(null);
            }}
            onSave={saveDraft}
            saving={saving}
          />
        ) : null}

        <div className="flex flex-col gap-2">
          {providers.length === 0 && workspaceLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((row) => (
                <div
                  key={row}
                  className="flex animate-pulse items-center gap-3 rounded-r9 bg-[var(--bg-elevated)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
                >
                  <span className="h-8 w-8 shrink-0 rounded-[8px] bg-[var(--bg-selected)]" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-[11px] w-[32%] rounded-full bg-[var(--bg-selected)]" />
                    <span className="block h-[9px] w-[58%] rounded-full bg-[var(--bg-hover)]" />
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {providers.length === 0 && !workspaceLoading && editing !== 'new' ? (
            <div className="rounded-r10 bg-[var(--bg-elevated)] px-4 py-6 text-center shadow-[inset_0_0_0_1px_var(--line-subtle)]">
              <span className="mx-auto grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--bg-hover)] text-t3">
                <KeyRound size={16} strokeWidth={1.8} />
              </span>
              <p className="mt-2.5 text-[13.5px] font-[510] text-t1">{t('No providers yet')}</p>
              <p className="mx-auto mt-1 max-w-[380px] text-[12.5px] leading-[1.55] text-t4">
                {t('Add OpenAI, DeepSeek, OpenRouter, a local Ollama gateway — anything that speaks /chat/completions.')}
              </p>
              <Button variant="primary" size="sm" className="mt-3 gap-1.5" onClick={startNew}>
                <Plus size={12} strokeWidth={2.2} />
                {t('Add provider')}
              </Button>
            </div>
          ) : null}

          {providers.map((provider) =>
            editing === provider.id && draft ? (
              <ProviderForm
                key={provider.id}
                draft={draft}
                onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
                onCancel={() => {
                  setEditing(null);
                  setDraft(null);
                }}
                onSave={saveDraft}
                onDelete={() => void removeProvider(provider.id)}
                saving={saving}
              />
            ) : (
              <div
                key={provider.id}
                data-provider={provider.id}
                className="group flex items-center gap-3 rounded-r9 bg-[var(--bg-elevated)] px-3.5 py-3 shadow-[0_1px_2px_rgba(9,10,12,.04),inset_0_0_0_1px_var(--line-subtle)] transition-shadow hover:shadow-[0_2px_6px_rgba(9,10,12,.06),inset_0_0_0_1px_var(--line)]"
              >
                <span
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[13px] font-[590]',
                    provider.hasKey ? 'bg-[var(--bg-accent-subtle)] text-[var(--accent)]' : 'bg-[var(--bg-selected)] text-t3',
                  )}
                >
                  {provider.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13.5px] font-[510] text-t1">{provider.name}</span>
                    {provider.hasKey ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-t4">
                        <Check size={10} strokeWidth={2.4} className="text-[var(--green)]" />
                        {provider.keyHint || t('key stored')}
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-[var(--red)]">
                        <span className="h-[5px] w-[5px] rounded-full bg-[var(--red)]" />
                        {t('no key')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] text-t4">
                    <span className="truncate font-mono">{provider.baseUrl}</span>
                    <span className="shrink-0 text-[var(--line-strong)]">·</span>
                    <span className="shrink-0 font-mono">{provider.defaultModel || '—'}</span>
                    <span className="hidden shrink-0 text-[var(--line-strong)] sm:inline">·</span>
                    <span className="hidden shrink-0 sm:inline">{Math.round(provider.contextWindow / 1000)}k</span>
                  </div>
                </div>
                <button
                  type="button"
                  data-edit-provider={provider.id}
                  onClick={() => startEdit(provider)}
                  className="grid h-[26px] w-[26px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                  aria-label={t('Edit provider')}
                >
                  <Pencil size={12} strokeWidth={1.9} />
                </button>
              </div>
            ),
          )}
        </div>
      </section>

      {/* scene routes */}
      <section className="mt-8">
        <SectionTitle
          title={t('Model per scene')}
          hint={t('Pick which provider each surface uses. An empty model means the provider’s default.')}
        />
        <div className="overflow-hidden rounded-r10 bg-[var(--bg-elevated)] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          {MODEL_ROUTES.map((route, index) => {
            const binding = routes[route.key];
            const provider = providers.find((item) => item.id === binding.providerId) ?? providers[0];
            return (
              <div
                key={route.key}
                className={cn(
                  'flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-3',
                  index > 0 ? 'border-t border-[var(--line-subtle)]' : '',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-[510] text-t1">{t(route.label)}</div>
                  <div className="mt-0.5 text-[11.5px] leading-[1.5] text-t4">{t(route.hint)}</div>
                </div>
                <select
                  value={binding.providerId ?? ''}
                  onChange={(event) => updateRoute(route.key, { providerId: event.target.value || null, model: '' })}
                  className="h-[30px] w-full shrink-0 rounded-r6 bg-[var(--bg-panel)] px-2 text-[12.5px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] outline-none sm:w-[148px]"
                  aria-label={t(route.label)}
                >
                  <option value="">{t('Automatic')}</option>
                  {providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <div className="flex w-full shrink-0 flex-col gap-1 sm:w-[172px]">
                  <input
                    value={binding.model}
                    onChange={(event) => updateRoute(route.key, { model: event.target.value })}
                    list={`route-models-${route.key}`}
                    placeholder={provider?.defaultModel || t('provider default')}
                    spellCheck={false}
                    className="h-[30px] w-full rounded-r6 bg-[var(--bg-panel)] px-2 font-mono text-[12px] text-t2 shadow-[inset_0_0_0_1px_var(--line)] outline-none"
                    aria-label={`${t(route.label)} ${t('Model')}`}
                  />
                  <datalist id={`route-models-${route.key}`}>
                    {(provider?.models ?? []).map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                  {provider?.models?.length ? (
                    <div className="flex flex-wrap gap-1" data-route-models={route.key}>
                      {provider.models.slice(0, 6).map((model) => (
                        <button
                          key={model}
                          type="button"
                          data-route-model={model}
                          onClick={() => updateRoute(route.key, { model })}
                          className={cn(
                            'max-w-full truncate rounded-full px-1.5 py-0.5 font-mono text-[10.5px] transition-colors',
                            binding.model === model
                              ? 'bg-[var(--bg-selected)] text-t1 shadow-[inset_0_0_0_1px_var(--line-strong)]'
                              : 'bg-[var(--bg-hover)] text-t4 hover:text-t1',
                          )}
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* persona */}
      <section className="mt-8">
        <SectionTitle
          title={t('Persona & instructions')}
          hint={t('The persona leads every system prompt; instructions add house rules. Both apply to all scenes.')}
        />
        <div className="flex flex-col gap-3 rounded-r10 bg-[var(--bg-elevated)] p-3.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          <Field label={t('Agent persona')}>
            <textarea
              value={personaDraft}
              onChange={(event) => setPersonaDraft(event.target.value)}
              rows={2}
              placeholder={t('e.g. You are Aether’s operations lead: concise, concrete, never invent data.')}
              className={textareaClass}
            />
          </Field>
          <Field label={t('Workspace instructions')}>
            <textarea
              value={instructionsDraft}
              onChange={(event) => setInstructionsDraft(event.target.value)}
              rows={2}
              placeholder={t('e.g. Always answer in Chinese and use issue keys.')}
              className={textareaClass}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--line-subtle)] pt-3">
            <label className="flex items-center gap-2.5">
              <Toggle on={requireApproval} onChange={(value) => void saveProfile({ requireApproval: value })} />
              <span className="text-[12.5px] text-t2">{t('Review changes before they apply')}</span>
            </label>
            <label className="flex items-center gap-2.5">
              <Toggle on={memoryEnabled} onChange={(value) => void saveProfile({ memoryEnabled: value })} />
              <span className="text-[12.5px] text-t2">{t('Use long-term memory')}</span>
            </label>
            <span className="flex-1" />
            <Button variant="secondary" size="sm" onClick={savePersona} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              {t('Save')}
            </Button>
          </div>
          <div data-allowed-tools className="mt-3 border-t border-[var(--line-subtle)] pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] uppercase tracking-[.05em] text-t4">{t('Always-allowed tools')}</span>
              {allowedTools.length ? (
                allowedTools.map((tool) => (
                  <span key={tool} className="flex items-center gap-1 rounded-full bg-[var(--bg-selected)] px-2 py-0.5 font-mono text-[11px] text-t2">
                    {tool}
                    <button
                      type="button"
                      aria-label={t('Revoke {tool}', { tool })}
                      onClick={() => revokeTool(tool)}
                      className="text-t4 hover:text-[var(--red)]"
                    >
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-[12px] text-t4">{t('No tools are always allowed.')}</span>
              )}
              {allowedTools.length ? (
                <button
                  type="button"
                  data-clear-allowed-tools
                  onClick={() => clearTools()}
                  className="rounded-r4 px-1.5 py-0.5 text-[11.5px] text-t4 hover:bg-[var(--bg-hover)] hover:text-t1"
                >
                  {t('Clear')}
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-[11.5px] text-t4">{t('Stored in this browser; approving a tool with “Always allow” adds it here.')}</p>
          </div>
        </div>
      </section>

      {/* memory */}
      <section className="mt-8">
        <SectionTitle
          title={t('Memory')}
          hint={t('Durable facts the agent may rely on. It can add its own with the remember tool.')}
          action={
            memory.length ? (
              <button
                type="button"
                onClick={() => void clearMemory()}
                className="text-[12px] text-t4 transition-colors hover:text-[var(--red)]"
              >
                {t('Clear all')}
              </button>
            ) : null
          }
        />
        <div className="rounded-r10 bg-[var(--bg-elevated)] p-3.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {(['all', 'global', 'chat', 'issue'] as const).map((scope) => {
              const count = scope === 'all' ? memory.length : memory.filter((entry) => entry.scope === scope).length;
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setMemoryScope(scope)}
                  className={cn(
                    'flex h-[22px] items-center gap-1 rounded-full px-2 text-[11.5px] font-[510] transition-colors',
                    memoryScope === scope
                      ? 'bg-[var(--bg-selected)] text-t1'
                      : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t2',
                  )}
                >
                  {scope === 'all' ? t('All') : scope}
                  <span className="tnum text-[10.5px] text-t4">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isImeComposing(event)) void submitMemory();
              }}
              placeholder={t('Add something worth remembering…')}
              className={inputClass}
            />
            <Button variant="secondary" size="sm" onClick={submitMemory} disabled={!memoryDraft.trim()}>
              {t('Add')}
            </Button>
          </div>
          {filteredMemory.length ? (
            <ul className="mt-2.5 flex flex-col">
              {[...filteredMemory].reverse().map((entry) => (
                <li
                  key={entry.id}
                  className="group flex items-start gap-2 border-b border-[var(--line-subtle)] py-2 last:border-0"
                >
                  <span className="mt-[3px] shrink-0 rounded-[4px] bg-[var(--bg-selected)] px-1 py-[1px] font-mono text-[10.5px] uppercase text-t4">
                    {entry.kind}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-[1.55] text-t2">{entry.text}</span>
                  <span className="shrink-0 text-[11px] text-t4">{relativeTime(new Date(entry.at).toISOString())}</span>
                  <button
                    type="button"
                    onClick={() => void removeMemory(entry.id)}
                    aria-label={t('Delete')}
                    className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-r4 text-t4 opacity-0 transition-opacity hover:text-[var(--red)] group-hover:opacity-100"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2.5 text-[12.5px] text-t4">
              {memory.length ? t('No memories in this scope.') : t('Nothing remembered yet.')}
            </p>
          )}
        </div>
      </section>

      {/* doorways */}
      <section className="mt-8 grid gap-2 sm:grid-cols-2">
        <Link
          href="/knowledge"
          className="group flex items-start gap-3 rounded-r9 bg-[var(--bg-elevated)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-shadow hover:shadow-[0_2px_6px_rgba(9,10,12,.06),inset_0_0_0_1px_var(--line)]"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[var(--bg-hover)] text-t3">
            <BookOpen size={14} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-[510] text-t1">{t('Knowledge')}</span>
            <span className="mt-0.5 block text-[11.5px] text-t4">
              {t('{n} entries the agent can search', { n: knowledge.length })}
            </span>
          </span>
          <ChevronDown size={13} className="-rotate-90 text-t4" />
        </Link>
        <Link
          href="/workflows"
          className="group flex items-start gap-3 rounded-r9 bg-[var(--bg-elevated)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-shadow hover:shadow-[0_2px_6px_rgba(9,10,12,.06),inset_0_0_0_1px_var(--line)]"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[var(--bg-hover)] text-t3">
            <Workflow size={14} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-[510] text-t1">{t('Workflows')}</span>
            <span className="mt-0.5 block text-[11.5px] text-t4">
              {t('{n} saved automations', { n: workflows.length })}
            </span>
          </span>
          <ChevronDown size={13} className="-rotate-90 text-t4" />
        </Link>
      </section>

      {note ? (
        <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-t3" data-agent-note>
          <span className="h-[5px] w-[5px] rounded-full bg-[var(--accent)]" />
          {note}
        </p>
      ) : null}

      <p className="mt-6 text-[12px] leading-[1.6] text-t4">
        {t('Without a provider the agent stays off and the rest of the app works exactly as before.')}
      </p>
    </div>
  );
}
